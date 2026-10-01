import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    LoopAlreadyRunningError,
    loopStateAt,
    RepairAlreadySpentError,
} from "../../src/workspace/LoopState.ts";
import { workspaceAt } from "../../src/workspace/Workspace.ts";

describe("LoopState", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "loop-state-test-"));

        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
| 2 | Second | 1 | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("runs a full lifecycle: start, in-flight, checkpoint, advance, exhaustion", async () => {
        const loop = loopStateAt(root, workspaceAt(root));

        expect(await loop.read()).toBeUndefined();

        const phaseIds = await loop.start("all");
        expect(phaseIds).toEqual(["1", "2"]);
        expect(await loop.read()).toMatchObject({
            scope: ["1", "2"],
            phaseIds: ["1", "2"],
            cycle: 0,
            phaseId: "1",
            bases: {},
            conditions: [],
        });

        await expect(loop.start("all")).rejects.toThrow(
            LoopAlreadyRunningError,
        );

        await loop.writeInFlight("implement", "1", { baseSha: "abc123" });
        expect(await loop.read()).toMatchObject({
            inFlight: { task: "implement", phaseId: "1" },
            bases: { "1": "abc123" },
        });

        await loop.clearInFlight();
        expect((await loop.read())?.inFlight).toBeUndefined();

        await loop.updateCheckpoint("1", "phase-1", "FAIL");
        expect(await loop.read()).toMatchObject({
            checkpoint: { phaseId: "1", label: "phase-1", verdict: "FAIL" },
            conditions: [],
        });

        await loop.stop("review failed, awaiting human repair");
        expect((await loop.read())?.stoppedReason).toBe(
            "review failed, awaiting human repair",
        );
        await loop.ok();
        expect((await loop.read())?.stoppedReason).toBeUndefined();

        await loop.updateCheckpoint("1", "phase-1-r1", "PASS");
        expect((await loop.read())?.conditions).toEqual([]);

        await loop.advance();
        expect((await loop.read())?.cycle).toBe(0);

        // phase 1 completed
        await writeFile(
            join(root, "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 2 | Second | 1 | . | 1 | [ ] |
`,
        );
        await loopStateAt(root, workspaceAt(root)).advance();
        expect(await loop.read()).toMatchObject({ cycle: 1, phaseId: "2" });
        expect((await loop.read())?.checkpoint).toBeUndefined();
        expect((await loop.status())?.action).toBe("implement");

        // phaseIds exhausted once phase 2 is also [x]: file is deleted
        await writeFile(
            join(root, "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 2 | Second | 1 | . | 1 | [x] |
`,
        );
        await loopStateAt(root, workspaceAt(root)).advance();
        expect(await loop.read()).toBeUndefined();
    });

    it("refuses a second --loop repair once nextLabel() shows the attempt spent", async () => {
        await writeFile(
            join(root, "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("all");

        // phase-1-r1.md doesn't exist yet: attempt available
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-1.md"), "...");
        await loop.writeInFlight("repair", "1");

        // phase-1-r1.md now exists: attempt spent
        await writeFile(join(root, "reviews/phase-1-r1.md"), "...");
        await expect(loop.writeInFlight("repair", "1")).rejects.toThrow(
            RepairAlreadySpentError,
        );
    });

    it("derives next.action through implement, review, repair, and acknowledge-required", async () => {
        await mkdir(join(root, "plans"), { recursive: true });
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("1");
        await loop.writeInFlight("implement", "1", { baseSha: "abc123" });

        // no checkpoint yet, steps not all [x]: implement
        expect((await loop.status())?.action).toBe("implement");

        // steps now all [x], still no checkpoint: review, with label+diff
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        expect(await loop.status()).toMatchObject({
            action: "review",
            label: "phase-1",
            diff: "git diff abc123..HEAD",
        });

        // reviewed and failed: repair, with the failed review's path.
        // reviews/phase-1.md must exist for repairSpent() to correctly
        // read the attempt as available.
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-1.md"), "...");
        await loop.updateCheckpoint("1", "phase-1", "FAIL");
        expect(await loop.status()).toMatchObject({
            action: "repair",
            review: "reviews/phase-1.md",
        });

        // a stop takes priority over everything else
        await loop.stop("needs a human");
        const stopped = await loop.status();
        expect(stopped?.action).toBe("acknowledge-required");
        expect(stopped?.stoppedReason).toBe("needs a human");

        await loop.ok();

        // reviewed and passed: advance
        await loop.updateCheckpoint("1", "phase-1-r1", "PASS");
        expect((await loop.status())?.action).toBe("advance");
    });

    it("reuses an in-flight review label instead of allocating past a pending review", async () => {
        await mkdir(join(root, "plans"), { recursive: true });
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(
            join(root, "reviews/phase-1.md"),
            "## Verdict: PENDING\n",
        );

        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("1");
        await loop.writeInFlight("review", "1", {
            label: "phase-1",
            baseSha: "abc123",
        });

        expect(await loop.status()).toMatchObject({
            action: "review",
            label: "phase-1",
            diff: "git diff abc123..HEAD",
        });
    });

    it("accumulates PASS WITH CONDITIONS across phases, and clears only on that phase's own clean PASS", async () => {
        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("all");

        // phase 1 passes with a condition: advance, condition recorded
        await loop.updateCheckpoint("1", "phase-1", "PASS WITH CONDITIONS");
        expect((await loop.status())?.action).toBe("advance");
        expect((await loop.read())?.conditions).toEqual([
            { phaseId: "1", label: "phase-1" },
        ]);

        // phase 2's clean PASS doesn't touch phase 1's condition
        await loop.updateCheckpoint("2", "phase-2", "PASS");
        expect((await loop.read())?.conditions).toEqual([
            { phaseId: "1", label: "phase-1" },
        ]);
    });

    it("reports stop once the one --loop repair attempt is already spent", async () => {
        await mkdir(join(root, "plans"), { recursive: true });
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-1.md"), "...");
        await writeFile(join(root, "reviews/phase-1-r1.md"), "...");

        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("1");

        // phase-1-r1 itself failed: no attempt left
        await loop.updateCheckpoint("1", "phase-1-r1", "FAIL");
        expect((await loop.status())?.action).toBe("stop");
    });

    it("tells repair from re-review by whether reviews/phase-<id>-r1.md has launched", async () => {
        await mkdir(join(root, "plans"), { recursive: true });
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-1.md"), "## Verdict: FAIL\n");

        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("1");
        await loop.writeInFlight("implement", "1", { baseSha: "abc123" });
        await loop.updateCheckpoint("1", "phase-1", "FAIL");

        // phase-1-r1.md doesn't exist yet: repair
        expect((await loop.status())?.action).toBe("repair");

        // PENDING stub counts as launched: re-review, with label+diff
        await writeFile(
            join(root, "reviews/phase-1-r1.md"),
            "## Verdict: PENDING\n",
        );
        expect(await loop.status()).toMatchObject({
            action: "re-review",
            label: "phase-1-r1",
            diff: "git diff abc123..HEAD",
        });
    });

    it("status() returns undefined when no loop is running", async () => {
        const loop = loopStateAt(root, workspaceAt(root));
        expect(await loop.status()).toBeUndefined();
    });

    it("keeps working even when plan.md's Depends On graph has a cycle elsewhere", async () => {
        // phase 1 is the loop's own phase, self-contained; phases 3/4
        // cycle on each other but are unrelated to it
        await writeFile(
            join(root, "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 3 | Third | 4 | . | 1 | [ ] |
| 4 | Fourth | 3 | . | 1 | [ ] |
`,
        );
        await mkdir(join(root, "plans"), { recursive: true });
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );

        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("1");

        // status() never touches the dependency graph at all, so a cycle
        // sitting elsewhere in plan.md can't break it
        await loop.updateCheckpoint("1", "phase-1", "PASS");
        expect((await loop.status())?.action).toBe("advance");
    });

    it("abandon deletes the file outright, and a missing file is quietly tolerated", async () => {
        const loop = loopStateAt(root, workspaceAt(root));
        await loop.start("all");
        await loop.abandon();
        expect(await loop.read()).toBeUndefined();

        // every mutator is a safe no-op when no loop is running
        await loop.advance();
        await loop.clearInFlight();
        await loop.stop("whatever");
        await loop.ok();
        await loop.abandon();
        expect(await loop.read()).toBeUndefined();
    });
});

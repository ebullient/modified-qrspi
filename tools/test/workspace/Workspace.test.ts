import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    backupPath,
    NoActivePhaseError,
    phaseFilePath,
    reviewPath,
    workspaceAt,
} from "../../src/workspace/Workspace.ts";

describe("paths", () => {
    it("builds each artifact's relative path", () => {
        expect(phaseFilePath("2a")).toBe("plans/plan-phase-2a.md");
        expect(reviewPath("phase-2-r2")).toBe("reviews/phase-2-r2.md");
        expect(backupPath("approach", 2)).toBe("backups/approach-2.md");
    });
});

describe("deriveStep", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("walks latest-to-earliest through every artifact stage", async () => {
        const ws = workspaceAt(root);

        expect(await ws.deriveStep()).toBe("query");

        await writeFile(join(root, "queries.md"), "...");
        expect(await ws.deriveStep()).toBe("research");

        await writeFile(join(root, "research.md"), "...");
        expect(await ws.deriveStep()).toBe("research");

        await writeFile(join(root, "approach.md"), "## Decision\nNone.\n");
        expect(await ws.deriveStep()).toBe("shape");

        await writeFile(join(root, "approach.md"), "## Decision\nGo with B.\n");
        expect(await ws.deriveStep()).toBe("spec");

        await writeFile(join(root, "spec.md"), "...");
        expect(await ws.deriveStep()).toBe("plan");

        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | Does a thing | 3 | [~] |
`;
        // plan.md is memoized per workspaceAt(root), so a fresh instance
        // is needed after each rewrite below.
        await writeFile(join(root, "plan.md"), table);
        expect(await workspaceAt(root).deriveStep()).toBe("implement");

        const doneTable = table.replace("[~]", "[x]");
        await writeFile(join(root, "plan.md"), doneTable);
        expect(await workspaceAt(root).deriveStep()).toBe("done");
    });
});

describe("checkProgress", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
        await mkdir(join(root, "plans"), { recursive: true });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("walks Depends On transitively and reports own step progress", async () => {
        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 2 | [x] |
| 2 | Second | 1 | . | 2 | [~] |
| 3 | Third | 2 | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);
        await writeFile(
            join(root, "plans/plan-phase-2.md"),
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
        );
        await writeFile(
            join(root, "plans/plan-phase-3.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const ws = workspaceAt(root);

        // phase 1's dependency ("none") is trivially satisfied
        const phase2 = await ws.checkProgress("2");
        expect(phase2).toEqual({
            dependenciesSatisfied: true,
            total: 2,
            complete: 1,
        });

        // phase 3 depends on phase 2, which is only [~], not [x]
        const phase3 = await ws.checkProgress("3");
        expect(phase3).toEqual({
            dependenciesSatisfied: false,
            total: 1,
            complete: 0,
        });
    });
});

describe("findActivePhase", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
        await mkdir(join(root, "plans"), { recursive: true });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("picks the first unblocked row and surfaces stale-input", async () => {
        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 2 | [x] |
| 2 | Second | 1 | . | 2 | [~] |
| 3 | Third | 4 | . | 1 | [ ] |
| 4 | Fourth | 3 | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);
        await writeFile(
            join(root, "plans/plan-phase-2.md"),
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
        );
        await writeFile(join(root, "spec.md"), "...");

        // phase file predates spec.md: stale-input should surface
        const old = new Date("2020-01-01");
        const recent = new Date("2024-01-01");
        await utimes(join(root, "plans/plan-phase-2.md"), old, old);
        await utimes(join(root, "spec.md"), recent, recent);

        // phase 3 depends on 4 (circular/unsatisfiable here), so phase 2
        // is the only row that qualifies
        const active = await workspaceAt(root).findActivePhase();
        expect(active.phase).toBe("2");
        expect(active.planProgress).toBe("1/2 steps");
        expect(active.staleInput).toMatchObject({
            phaseFile: "plans/plan-phase-2.md",
        });
    });

    it("throws when every incomplete row is blocked", async () => {
        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | 2 | . | 1 | [ ] |
| 2 | Second | 1 | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);
        await writeFile(
            join(root, "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );
        await writeFile(
            join(root, "plans/plan-phase-2.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const error = await workspaceAt(root)
            .findActivePhase()
            .catch((e) => e);
        expect(error).toBeInstanceOf(NoActivePhaseError);
        expect(error.blockedPhases).toEqual(["1", "2"]);
    });
});

describe("nextLabel/nextFile", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("computes each naming sequence and the full path", async () => {
        const ws = workspaceAt(root);

        // backups/: no directory yet, starts at 1
        expect(await ws.nextLabel("spec")).toBe("spec-1");
        expect(await ws.nextFile("spec")).toBe("backups/spec-1.md");

        await mkdir(join(root, "backups"), { recursive: true });
        await writeFile(join(root, "backups/spec-1.md"), "...");
        expect(await ws.nextLabel("spec")).toBe("spec-2");

        // reviews/: bare label first, then -r1
        expect(await ws.nextLabel("review", { phase: "3" })).toBe("phase-3");
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-3.md"), "...");
        expect(await ws.nextLabel("review", { phase: "3" })).toBe("phase-3-r1");
        expect(await ws.nextFile("review", { phase: "3" })).toBe(
            "reviews/phase-3-r1.md",
        );

        // --step has its own bare-then-r1 sequence, same shape as the
        // phase-level case
        expect(await ws.nextLabel("review", { phase: "3", step: 2 })).toBe(
            "phase-3-step-2",
        );
        await writeFile(join(root, "reviews/phase-3-step-2.md"), "...");
        expect(await ws.nextLabel("review", { phase: "3", step: 2 })).toBe(
            "phase-3-step-2-r1",
        );

        // final follows the same bare-then-r1 pattern
        expect(await ws.nextLabel("final")).toBe("final");
        await writeFile(join(root, "reviews/final.md"), "...");
        expect(await ws.nextLabel("final")).toBe("final-r1");

        await expect(ws.nextLabel("review")).rejects.toThrow();
    });
});

describe("lastLabel/lastFile", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("returns undefined when nothing in the sequence exists yet", async () => {
        const ws = workspaceAt(root);
        expect(await ws.lastLabel("review", { phase: "3" })).toBeUndefined();
        expect(await ws.lastFile("review", { phase: "3" })).toBeUndefined();
        expect(await ws.lastLabel("final")).toBeUndefined();
    });

    it("returns the most recently used label in the sequence", async () => {
        const ws = workspaceAt(root);
        await mkdir(join(root, "reviews"), { recursive: true });
        await writeFile(join(root, "reviews/phase-3.md"), "...");
        expect(await ws.lastLabel("review", { phase: "3" })).toBe("phase-3");
        expect(await ws.lastFile("review", { phase: "3" })).toBe(
            "reviews/phase-3.md",
        );

        await writeFile(join(root, "reviews/phase-3-r1.md"), "...");
        expect(await ws.lastLabel("review", { phase: "3" })).toBe("phase-3-r1");

        await writeFile(join(root, "reviews/final.md"), "...");
        expect(await ws.lastLabel("final")).toBe("final");
    });

    it("throws when review is requested without --phase", async () => {
        await expect(workspaceAt(root).lastLabel("review")).rejects.toThrow();
    });
});

describe("checkProgress: already-complete vs. blocked", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
        await mkdir(join(root, "plans"), { recursive: true });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("distinguishes a phase already done from one blocked on a dependency", async () => {
        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 3 | Third | 4 | . | 1 | [ ] |
| 4 | Fourth | none | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);
        await writeFile(
            join(root, "plans/plan-phase-3.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );
        await writeFile(
            join(root, "plans/plan-phase-4.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );

        const ws = workspaceAt(root);

        // phase 3 depends on phase 4, whose table row isn't [x] yet
        expect(await ws.checkProgress("3")).toEqual({
            dependenciesSatisfied: false,
            total: 1,
            complete: 0,
        });

        // phase 4's own steps are all [x], even though its table row isn't
        expect(await ws.checkProgress("4")).toEqual({
            dependenciesSatisfied: true,
            total: 1,
            complete: 1,
        });
    });
});

describe("resolveScope", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "workspace-test-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("expands a selector through the memoized graph", async () => {
        const table = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 2 | Second | 1 | . | 1 | [ ] |
| 3 | Third | 2 | . | 1 | [ ] |
`;
        await writeFile(join(root, "plan.md"), table);

        const ws = workspaceAt(root);
        expect(await ws.resolveScope("all")).toEqual({
            scope: ["1", "2", "3"],
            phaseIds: ["2", "3"],
        });
        expect(await ws.resolveScope("3")).toEqual({
            scope: ["3"],
            phaseIds: ["2", "3"],
        });
    });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historyAt } from "../../src/workspace/History.ts";

describe("History", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "history-test-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("appends, reads with filters, and derives parked", async () => {
        const history = historyAt(root);
        await history.append({ kind: "implement", phase: "1" });
        await history.append({ kind: "review", phase: "1", verdict: "PASS" });
        await history.append({ kind: "park", text: "blocked on infra" });
        await history.append({
            kind: "note",
            text: "checked in with the team",
        });

        const all = await history.read({ all: true });
        expect(all).toHaveLength(4);
        expect(all.map((e) => e.kind)).toEqual([
            "implement",
            "review",
            "park",
            "note",
        ]);

        const reviews = await history.read({ kind: "review" });
        expect(reviews).toHaveLength(1);
        expect(reviews[0]).toMatchObject({ phase: "1", verdict: "PASS" });

        expect(await history.isParked()).toBe(true);

        await history.append({ kind: "loop", action: "ok", text: "resuming" });
        expect(await history.isParked()).toBe(false);
    });

    it("composes --kind and --phase before --tail truncates, and defaults the tail to 20", async () => {
        const history = historyAt(root);
        await history.append({ kind: "review", phase: "1", verdict: "FAIL" });
        await history.append({ kind: "review", phase: "2", verdict: "PASS" });
        await history.append({ kind: "review", phase: "1", verdict: "PASS" });

        const filtered = await history.read({
            kind: "review",
            phase: "1",
            tail: 1,
        });
        expect(filtered).toHaveLength(1);
        expect(filtered[0]).toMatchObject({
            kind: "review",
            phase: "1",
            verdict: "PASS",
        });
        expect(filtered[0].timestamp).toEqual(expect.any(String));

        for (let i = 0; i < 20; i++) {
            await history.append({ kind: "note", text: `entry ${i}` });
        }
        expect(await history.read()).toHaveLength(20);
        expect(await history.read({ all: true })).toHaveLength(23);
    });

    describe("conditionalAppend", () => {
        it("writes when there's no matching entry yet", async () => {
            const history = historyAt(root);
            const wrote = await history.conditionalAppend(
                { kind: "implement", phase: "1" },
                { action: "end" },
                { kind: "implement", action: "begin", phase: "1" },
            );
            expect(wrote).toBe(true);
            expect(await history.read({ all: true })).toEqual([
                {
                    kind: "implement",
                    action: "begin",
                    phase: "1",
                    timestamp: expect.any(String),
                },
            ]);
        });

        it("skips when the last matching entry already satisfies unless", async () => {
            const history = historyAt(root);
            await history.append({
                kind: "implement",
                action: "begin",
                phase: "1",
            });

            const wrote = await history.conditionalAppend(
                { kind: "implement", phase: "1" },
                { action: "begin" },
                { kind: "implement", action: "begin", phase: "1" },
            );
            expect(wrote).toBe(false);
            expect(await history.read({ all: true })).toHaveLength(1);
        });

        it("writes when the last matching entry doesn't satisfy unless", async () => {
            const history = historyAt(root);
            await history.append({
                kind: "implement",
                action: "end",
                phase: "1",
            });

            const wrote = await history.conditionalAppend(
                { kind: "implement", phase: "1" },
                { action: "begin" },
                { kind: "implement", action: "begin", phase: "1" },
            );
            expect(wrote).toBe(true);
            expect(await history.read({ all: true })).toHaveLength(2);
        });

        it("only looks at the most recent matching entry, not any match", async () => {
            const history = historyAt(root);
            await history.append({
                kind: "implement",
                action: "begin",
                phase: "1",
            });
            await history.append({
                kind: "implement",
                action: "end",
                phase: "1",
            });

            // the most recent phase-1 entry is now "end", so a second
            // begin is not a duplicate of the first
            const wrote = await history.conditionalAppend(
                { kind: "implement", phase: "1" },
                { action: "begin" },
                { kind: "implement", action: "begin", phase: "1" },
            );
            expect(wrote).toBe(true);
            expect(await history.read({ all: true })).toHaveLength(3);
        });
    });
});

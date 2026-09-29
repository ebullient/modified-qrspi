import { describe, expect, it } from "vitest";
import { recordInit } from "../../../src/state/commands/Init.ts";
import { recordPlan } from "../../../src/state/commands/Plan.ts";
import { recordQuery } from "../../../src/state/commands/Query.ts";
import {
    recordDecision,
    recordDone,
} from "../../../src/state/commands/Record.ts";
import { recordResearch } from "../../../src/state/commands/Research.ts";
import { recordSpec } from "../../../src/state/commands/Spec.ts";
import { UsageError } from "../../../src/state/errors.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { State } from "../../../src/state/types.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

const workspaceFiles: { [path: string]: string } = {
    "request.md": "# Request",
    "queries.md": "# Queries",
    "research.md": "## New Questions\nNone.",
    "spec.md": "# Spec",
    "plan.md":
        "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
    "plan-phase-1.md": "## Phase 1\n### Step 1\n- [ ] Status marker\n",
};

const testState = (overrides: Partial<State> = {}): State =>
    baseState({
        history: [{ step: "init", timestamp: "2026-09-25T00:00:00Z" }],
        ...overrides,
    });

function record(fs: MemoryStateFileSystem) {
    const inputs = {
        services: {
            store: new Store({ feature: "f", path: statePath, fileSystem: fs }),
            workspace: fakeWorkspace(workspaceFiles),
            git: fakeGit(),
            clock: fakeClock(),
        },
        context: { feature: "f" },
    };
    return {
        init: (options: Parameters<typeof recordInit>[1]) =>
            recordInit(inputs, options),
        query: (options: Parameters<typeof recordQuery>[1]) =>
            recordQuery(inputs, options),
        research: (options: Parameters<typeof recordResearch>[1]) =>
            recordResearch(inputs, options),
        spec: (options: Parameters<typeof recordSpec>[1]) =>
            recordSpec(inputs, options),
        plan: (options: Parameters<typeof recordPlan>[1]) =>
            recordPlan(inputs, options),
        done: (options: Parameters<typeof recordDone>[1]) =>
            recordDone(inputs, options),
        decision: (options: Parameters<typeof recordDecision>[1]) =>
            recordDecision(inputs, options),
    };
}

function withState(state: State): MemoryStateFileSystem {
    const fs = new MemoryStateFileSystem();
    fs.files.set(statePath, JSON.stringify(state));
    return fs;
}

describe("Record", () => {
    it("record init on existing state moves the position back to init", () => {
        const fs = withState(
            testState({
                currentStep: "spec",
                decisions: ["kept"],
            }),
        );

        const outcome = record(fs).init({ reason: "Starting over." });

        expect(outcome.wrote).toBe(true);
        expect(outcome.result).toMatchObject({
            currentPhase: "discovery",
            currentStep: "init",
            decisions: ["kept"],
        });
        expect(outcome.result?.history.at(-1)).toEqual({
            step: "init",
            timestamp: "2026-09-26T00:00:00Z",
            reason: "Starting over.",
        });
    });

    it("recording the current step with the same mode and reason is a no-op", () => {
        const fs = withState(
            testState({
                currentStep: "query",
                history: [
                    {
                        step: "query",
                        timestamp: "2026-09-25T00:00:00Z",
                        mode: "refinement",
                        reason: "Follow-up.",
                    },
                ],
            }),
        );
        const before = fs.files.get(statePath);

        const outcome = record(fs).query({
            mode: "refinement",
            reason: "Follow-up.",
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it.each([
        ["a different mode", { mode: "regeneration", reason: "Follow-up." }],
        ["a different reason", { mode: "refinement", reason: "Another." }],
        ["no reason", { mode: "refinement" }],
    ] as const)(
        "recording the current step with %s writes",
        (_name, options) => {
            const fs = withState(
                testState({
                    currentStep: "query",
                    history: [
                        {
                            step: "query",
                            timestamp: "2026-09-25T00:00:00Z",
                            mode: "refinement",
                            reason: "Follow-up.",
                        },
                    ],
                }),
            );

            const outcome = record(fs).query(options);

            expect(outcome.wrote).toBe(true);
            expect(outcome.result?.history).toHaveLength(2);
        },
    );

    it("recording a step other than currentStep writes even if it repeats that step's last entry", () => {
        const fs = withState(
            testState({
                currentStep: "research",
                history: [
                    {
                        step: "query",
                        timestamp: "2026-09-25T00:00:00Z",
                        mode: "initial",
                    },
                    { step: "research", timestamp: "2026-09-25T00:00:00Z" },
                ],
            }),
        );

        const outcome = record(fs).query({ mode: "initial" });

        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("query");
    });

    it.each(["spec", "plan"] as const)(
        "%s --mode revision without --reason is a usage error",
        (step) => {
            const fs = withState(testState());

            expect(() => record(fs)[step]({ mode: "revision" })).toThrow(
                UsageError,
            );
        },
    );

    it("a blank --reason is a usage error", () => {
        const fs = withState(testState());

        expect(() => record(fs).research({ reason: "  " })).toThrow(UsageError);
    });

    it("record decision appends every time, with no position change or history entry", () => {
        const fs = withState(testState({ currentStep: "spec" }));
        const r = record(fs);

        r.decision({ text: "Chose approach A." });
        const outcome = r.decision({ text: "Chose approach A." });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.decisions).toEqual([
            "Chose approach A.",
            "Chose approach A.",
        ]);
        expect(outcome.result?.currentStep).toBe("spec");
        expect(outcome.result?.history).toHaveLength(1);
    });

    it("record decision with no state.json recovers the position from the workspace", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = record(fs).decision({ text: "Chose approach A." });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result).toMatchObject({
            currentPhase: "definition",
            currentStep: "plan",
            decisions: ["Chose approach A."],
            history: [
                {
                    step: "plan",
                    timestamp: "2026-09-26T00:00:00Z",
                    reason: "recovered from workspace evidence: state.json",
                },
            ],
        });
        expect(fs.files.has(statePath)).toBe(true);
    });

    it("record decision recovers an invalid field the same way", () => {
        const fs = withState(testState({ commitMode: "squash" as never }));

        const outcome = record(fs).decision({ text: "Chose approach A." });

        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.commitMode).toBe("phase");
        expect(outcome.result?.history.at(-1)?.reason).toBe(
            "recovered from workspace evidence: commitMode",
        );
    });

    it("record decision with blank text is a usage error", () => {
        const fs = withState(testState());

        expect(() => record(fs).decision({ text: " " })).toThrow(UsageError);
    });

    it("record decision --dry-run writes nothing", () => {
        const fs = withState(testState());
        const before = fs.files.get(statePath);

        const outcome = record(fs).decision({ text: "Maybe.", dryRun: true });

        expect(outcome.wrote).toBe(false);
        expect(outcome.result?.decisions).toEqual(["Maybe."]);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("record done sets completed: true, with no position change or history entry", () => {
        const fs = withState(testState({ currentStep: "review" }));

        const outcome = record(fs).done({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.completed).toBe(true);
        expect(outcome.result?.currentStep).toBe("review");
        expect(outcome.result?.history).toHaveLength(1);
    });

    it("record done is a no-op when already completed", () => {
        const fs = withState(
            testState({ currentStep: "review", completed: true }),
        );

        const outcome = record(fs).done({});

        expect(outcome.wrote).toBe(false);
    });

    it("record done preserves an old-shape file when already completed", () => {
        const fs = withState({
            ...testState({ currentStep: "review", completed: true }),
            currentPhase: "execution",
        } as State & { currentPhase: string });
        const before = fs.files.get(statePath);

        const outcome = record(fs).done({});

        expect(outcome.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("record done --dry-run writes nothing", () => {
        const fs = withState(testState());
        const before = fs.files.get(statePath);

        const outcome = record(fs).done({ dryRun: true });

        expect(outcome.wrote).toBe(false);
        expect(outcome.result?.completed).toBe(true);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("record done with no state.json recovers the position from the workspace", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = record(fs).done({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result).toMatchObject({
            currentPhase: "definition",
            currentStep: "plan",
            completed: true,
        });
    });

    it("any other record <step> clears completed, since resuming work means it isn't done", () => {
        const fs = withState(
            testState({ currentStep: "spec", completed: true }),
        );

        const outcome = record(fs).plan({});

        expect(outcome.result?.completed).toBeUndefined();
        expect(JSON.parse(fs.files.get(statePath) ?? "{}")).not.toHaveProperty(
            "completed",
        );
    });

    it("re-recording the same step when nothing else changed stays a no-op even if completed is true", () => {
        const fs = withState(
            testState({
                currentStep: "query",
                completed: true,
                history: [
                    {
                        step: "query",
                        timestamp: "2026-09-25T00:00:00Z",
                        mode: "initial",
                    },
                ],
            }),
        );

        const outcome = record(fs).query({ mode: "initial" });

        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.completed).toBeUndefined();
    });

    it("a stored completed: false loads as not done and is not re-emitted", () => {
        const fs = withState({
            ...testState({ currentStep: "spec" }),
            completed: false,
        });

        const outcome = record(fs).plan({});

        expect(outcome.result?.completed).toBeUndefined();
        expect(JSON.parse(fs.files.get(statePath) ?? "{}")).not.toHaveProperty(
            "completed",
        );
    });
});

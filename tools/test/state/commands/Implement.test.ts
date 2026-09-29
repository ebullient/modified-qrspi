import { describe, expect, it } from "vitest";
import { recordImplement } from "../../../src/state/commands/Implement.ts";
import { reportFeature } from "../../../src/state/commands/Report.ts";
import type { GitRunner, StatusEntry } from "../../../src/state/ports.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { HistoryEntry, PhaseId, State } from "../../../src/state/types.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

const header = "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n";
const unstarted =
    "### Step 1: A\n- [ ] Status marker\n\n### Step 2: B\n- [ ] Status marker\n";

function planFiles(
    rows: string,
    phaseFiles: { [phase: string]: string },
): { [path: string]: string } {
    const files: { [path: string]: string } = {
        "plan.md": header + rows,
    };
    for (const [phase, body] of Object.entries(phaseFiles)) {
        files[`plan-phase-${phase}.md`] = body;
    }
    return files;
}

const twoPhases = planFiles("| 1 | A | none | [ ] |\n| 2 | B | 1 | [ ] |\n", {
    "1": unstarted,
    "2": unstarted,
});

const testState = (overrides: Partial<State> = {}): State =>
    baseState({
        currentStep: "plan",
        history: [{ step: "plan", timestamp: "2026-09-25T00:00:00Z" }],
        planPhase: "1" as State["planPhase"],
        ...overrides,
    });

interface Fixture {
    files?: { [path: string]: string };
    state?: State | null;
    status?: StatusEntry[];
    git?: Partial<GitRunner>;
}

function setup({
    files = twoPhases,
    state = testState(),
    status = [],
    git = {},
}: Fixture) {
    const fs = new MemoryStateFileSystem();
    if (state !== null) fs.files.set(statePath, JSON.stringify(state));
    const services = {
        store: new Store({ feature: "f", path: statePath, fileSystem: fs }),
        workspace: fakeWorkspace(files),
        git: fakeGit({ status: () => status, ...git }),
        clock: fakeClock(),
    };
    const context = { feature: "f" };
    return {
        fs,
        record: {
            implement: (options: Parameters<typeof recordImplement>[1]) =>
                recordImplement({ services, context }, options),
        },
        report: {
            run: (options?: Parameters<typeof reportFeature>[1]) =>
                reportFeature({ services, context }, options),
        },
    };
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe("record implement --base", () => {
    const begun = planFiles("| 1 | A | none | [ ] |\n| 2 | B | 1 | [ ] |\n", {
        "1": "### Step 1: A\n- [x] Status marker\n",
        "2": unstarted,
    });

    it("sets the base for a new phase, whatever planPhase named", () => {
        const { record } = setup({});
        const outcome = record.implement({ phase: "2", base: "1234567" });
        expect(outcome.result).toMatchObject({
            planPhase: "2",
            phaseBaseSha: "1234567",
        });
    });

    it("replaces a resumed phase's base without warning phase-base-reset", () => {
        const { record } = setup({
            files: begun,
            state: testState({
                currentStep: "implement",
                phaseBaseSha: "abcdef0",
            }),
        });
        const outcome = record.implement({ phase: "1", base: "1234567" });
        expect(outcome.result?.phaseBaseSha).toBe("1234567");
        expect(codes(outcome.findings)).not.toContain("phase-base-reset");
    });

    it("stores the full SHA git resolves", () => {
        const { record } = setup({
            git: { resolve: (rev) => (rev === "main" ? "a".repeat(40) : null) },
        });
        expect(
            record.implement({ phase: "1", base: "main" }).result?.phaseBaseSha,
        ).toBe("a".repeat(40));
    });

    it("a commit-ish git cannot resolve is a usage error, and nothing is written", () => {
        const { record, fs } = setup({});
        const before = fs.files.get(statePath);
        expect(() =>
            record.implement({ phase: "1", base: "no-such-rev" }),
        ).toThrow("--base");
        expect(fs.files.get(statePath)).toBe(before);
    });
});

describe("base-not-ancestor and loop-active", () => {
    it("warns when the kept base is no longer an ancestor of HEAD", () => {
        const { record, report } = setup({
            state: testState({
                currentStep: "implement",
                phaseBaseSha: "abcdef0",
            }),
            git: { isAncestor: () => false },
        });
        expect(codes(record.implement({ phase: "1" }).findings)).toContain(
            "base-not-ancestor",
        );
        expect(codes(report.run().findings)).toContain("base-not-ancestor");
    });

    const launch: HistoryEntry = {
        step: "implement",
        mode: "phase",
        phase: "1" as PhaseId,
        by: "autoloop",
    };
    const withLoop = (
        cycle: "implement" | "done",
        history: HistoryEntry[],
        stoppedReason: string | null = null,
    ) =>
        testState({
            currentStep: "implement",
            phaseBaseSha: "abcdef0",
            history: [{ step: "plan" }, ...history],
            loop: {
                scope: "1",
                phases: ["1" as PhaseId],
                cycle,
                phase: "1" as PhaseId,
                conditions: [],
                stoppedReason,
            },
        });

    it("warns loop-active on a record while a loop launch is open", () => {
        const { record } = setup({ state: withLoop("implement", [launch]) });
        expect(codes(record.implement({ phase: "1" }).findings)).toContain(
            "loop-active",
        );
    });

    it.each([
        [
            "while stopped",
            withLoop(
                "implement",
                [launch, { ...launch, mode: undefined, outcome: "STOPPED" }],
                "implementer STOPPED",
            ),
        ],
        [
            "while stopped with its launch still open",
            withLoop("implement", [launch], "interrupted"),
        ],
        [
            "while blockers wait for the human",
            { ...withLoop("implement", [launch]), blockers: ["note"] },
        ],
        ["with no launch open", withLoop("implement", [])],
        ["after the loop is done", withLoop("done", [launch])],
    ])("does not warn loop-active %s", (_when, state) => {
        const { record } = setup({ state });
        expect(codes(record.implement({ phase: "1" }).findings)).not.toContain(
            "loop-active",
        );
    });
});

describe("record implement --phase", () => {
    it("starting a fresh phase sets the position, HEAD as the base, and the default commit mode", () => {
        const { record } = setup({});

        const outcome = record.implement({ phase: "1" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result).toMatchObject({
            currentPhase: "execution",
            currentStep: "implement",
            planPhase: "1",
            phaseBaseSha: "abcdef0",
            commitMode: "phase",
        });
        expect(outcome.result?.history.at(-1)).toEqual({
            step: "implement",
            timestamp: "2026-09-26T00:00:00Z",
            mode: "start",
            phase: "1",
        });
    });

    it("a fresh phase uses a supplied commit mode, and records --reason", () => {
        const { record } = setup({});

        const outcome = record.implement({
            phase: "1",
            commitMode: "step",
            reason: "Picking up phase 1.",
        });

        expect(outcome.result?.commitMode).toBe("step");
        expect(outcome.result?.history.at(-1)?.reason).toBe(
            "Picking up phase 1.",
        );
    });

    it("resuming with a supplied commit mode replaces the persisted one", () => {
        const { record } = setup({
            state: testState({ phaseBaseSha: "1234567", commitMode: "step" }),
        });

        const outcome = record.implement({ phase: "1", commitMode: "phase" });

        expect(outcome.result?.commitMode).toBe("phase");
    });

    it("a begun phase with no base gets HEAD, keeps its commit mode, and warns that the diff starts here", () => {
        const { record } = setup({
            files: planFiles("| 1 | A | none | [~] |\n", {
                "1": "### Step 1: A\n- [~] Status marker\n",
            }),
            state: testState({ commitMode: "step" }),
            status: [{ path: "src/app.ts" }],
        });

        const outcome = record.implement({ phase: "1" });

        expect(outcome.result?.phaseBaseSha).toBe("abcdef0");
        expect(outcome.result?.commitMode).toBe("step");
        expect(codes(outcome.findings)).toEqual(["phase-base-reset"]);
    });

    it("a recorded phaseBaseSha makes the phase a resume even when no step has begun", () => {
        const { record } = setup({
            state: testState({ phaseBaseSha: "1234567", commitMode: "step" }),
            status: [{ path: "src/app.ts" }],
        });

        const outcome = record.implement({ phase: "1" });

        expect(outcome.result?.phaseBaseSha).toBe("1234567");
        expect(outcome.result?.commitMode).toBe("step");
        expect(codes(outcome.findings)).not.toContain("dirty-tree");
    });

    it("starting a different phase is fresh even with the previous phase's base recorded", () => {
        const { record } = setup({
            files: planFiles("| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |\n", {
                "1": "### Step 1: A\n- [x] Status marker\n",
                "2": unstarted,
            }),
            state: testState({
                currentStep: "implement",
                planPhase: "1" as PhaseId,
                phaseBaseSha: "1234567",
                commitMode: "step",
            }),
            status: [{ path: "src/app.ts" }],
        });

        const outcome = record.implement({ phase: "2" });

        expect(outcome.result).toMatchObject({
            planPhase: "2",
            phaseBaseSha: "abcdef0",
            commitMode: "phase",
        });
        expect(codes(outcome.findings)).toEqual(["dirty-tree"]);
    });

    it("start, finish by marking every step [x], then start the next phase", () => {
        const files = planFiles(
            "| 1 | A | none | [ ] |\n| 2 | B | 1 | [ ] |\n",
            { "1": unstarted, "2": unstarted },
        );
        const first = setup({ files });
        const started = first.record.implement({
            phase: "1",
            commitMode: "step",
        });

        // Marking every step [x] finishes the phase.
        const finished = planFiles(
            "| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |\n",
            {
                "1": "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [x] Status marker\n",
                "2": unstarted,
            },
        );
        const second = setup({
            files: { ...finished, "request.md": "# Request" },
            state: started.result ?? null,
        });
        expect(second.report.run().result?.next).toMatchObject({
            step: "review",
            phase: "1",
        });

        const next = second.record.implement({ phase: "2" });

        expect(next.findings).toEqual([]);
        expect(next.result).toMatchObject({
            planPhase: "2",
            phaseBaseSha: "abcdef0",
            commitMode: "phase",
        });
        expect(
            next.result?.history
                .filter((entry) => entry.step === "implement")
                .map((entry) => entry.phase),
        ).toEqual(["1", "2"]);
    });

    it("switching back to a begun phase never inherits the other phase's base", () => {
        const files = planFiles(
            "| 1 | A | none | [ ] |\n| 2 | B | none | [ ] |\n",
            {
                "1": "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
                "2": unstarted,
            },
        );
        const { record } = setup({
            files,
            state: testState({
                currentStep: "implement",
                planPhase: "2" as PhaseId,
                phaseBaseSha: "1234567",
            }),
        });

        const outcome = record.implement({ phase: "1" });

        expect(outcome.result?.phaseBaseSha).toBe("abcdef0");
        expect(codes(outcome.findings)).toEqual(["phase-base-reset"]);
    });

    it("resuming the active phase keeps its base, with no warning", () => {
        const { record } = setup({
            files: planFiles("| 1 | A | none | [ ] |\n", {
                "1": "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
            }),
            state: testState({
                currentStep: "implement",
                phaseBaseSha: "1234567",
            }),
        });

        const outcome = record.implement({ phase: "1", reason: "Resume." });

        expect(outcome.result?.phaseBaseSha).toBe("1234567");
        expect(outcome.findings).toEqual([]);
    });

    it("a repeat that would change commit mode is not a no-op", () => {
        const { record } = setup({});
        record.implement({ phase: "1" });

        const second = record.implement({ phase: "1", commitMode: "step" });

        expect(second.wrote).toBe(true);
        expect(second.result?.commitMode).toBe("step");
        expect(
            second.result?.history.filter((e) => e.step === "implement"),
        ).toHaveLength(2);
    });

    it("recording the same start twice changes nothing the second time", () => {
        const { record, fs } = setup({});
        record.implement({ phase: "1" });
        const before = fs.files.get(statePath);

        const second = record.implement({ phase: "1" });

        expect(second.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("starting a different phase with the same reason still writes", () => {
        const files = planFiles(
            "| 1 | A | none | [ ] |\n| 2 | B | none | [ ] |\n",
            { "1": unstarted, "2": unstarted },
        );
        const { record } = setup({ files });
        record.implement({ phase: "1", reason: "Next." });

        const second = record.implement({ phase: "2", reason: "Next." });

        expect(second.wrote).toBe(true);
        expect(second.result?.planPhase).toBe("2");
    });

    it.each([
        ["plan.md is missing", {}, "1", "plan.md"],
        ["the phase is not in plan.md", twoPhases, "9", "plan.md"],
        [
            "the phase file is missing",
            planFiles("| 1 | A | none | [ ] |\n", {}),
            "1",
            "plans/plan-phase-1.md",
        ],
    ] as const)(
        "stops without writing when %s",
        (_name, files, phase, file) => {
            const { record, fs } = setup({ files });
            const before = fs.files.get(statePath);

            const outcome = record.implement({ phase });

            expect(outcome.exitCode).toBe(1);
            expect(outcome.wrote).toBe(false);
            expect(outcome.findings).toEqual([
                expect.objectContaining({ code: "workspace-incomplete", file }),
            ]);
            expect(fs.files.get(statePath)).toBe(before);
        },
    );

    it("completeness comes from the steps, not the plan.md row", () => {
        const { record } = setup({
            files: planFiles("| 1 | A | none | [ ] |\n| 2 | B | 1 | [ ] |\n", {
                "1": "### Step 1: A\n- [x] Status marker\n",
                "2": unstarted,
            }),
        });

        const outcome = record.implement({ phase: "1" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(codes(outcome.findings)).toEqual([
            "phase-complete",
            "phase-base-reset",
        ]);
    });

    it("a dependency whose row is [x] but whose steps are not still warns", () => {
        const { record } = setup({
            files: planFiles("| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |\n", {
                "1": unstarted,
                "2": unstarted,
            }),
        });

        const outcome = record.implement({ phase: "2" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            expect.objectContaining({
                code: "dependency-incomplete",
                message: expect.stringContaining("phase 1"),
            }),
        ]);
    });

    it("warns about a dirty tree when starting fresh", () => {
        const { record } = setup({
            status: [{ path: "src/app.ts" }, { path: "qrspi/f/notes.md" }],
        });

        const outcome = record.implement({ phase: "1" });

        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            expect.objectContaining({
                code: "dirty-tree",
                message: expect.stringContaining("src/app.ts"),
            }),
        ]);
    });

    it("starts an inserted phase, and report reads its 7a.1-style step ids", () => {
        const files = planFiles(
            "| 7 | A | none | [x] |\n| 7a | Inserted | 7 | [ ] |\n| 8 | B | 7a | [ ] |\n",
            {
                "7": "### Step 1: A\n- [x] Status marker\n",
                "7a": "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [~] Status marker\n",
                "8": unstarted,
            },
        );
        const { record, report } = setup({ files });

        const outcome = record.implement({ phase: "7a" });

        expect(outcome.exitCode).toBe(0);
        expect(codes(outcome.findings)).toEqual(["phase-base-reset"]);
        expect(outcome.result?.planPhase).toBe("7a");
        expect(report.run().result?.current.planProgress).toEqual({
            current: "7a.2",
            completed: ["7a.1"],
            blocked: [],
        });
    });
});

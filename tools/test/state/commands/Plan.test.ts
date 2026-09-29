import { describe, expect, it } from "vitest";
import {
    type PlanOptions,
    recordPlan,
} from "../../../src/state/commands/Plan.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type {
    CommandOutcome,
    PhaseId,
    State,
} from "../../../src/state/types.ts";
import type { Workspace } from "../../../src/workspace/Workspace.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

const planTable =
    "| Phase | Name | Depends On | Status |\n" +
    "|---|---|---|---|\n" +
    "| 1 | First phase | none | [ ] |\n" +
    "| 2 | Second phase | 1 | [ ] |\n";

interface FixtureFiles {
    planMarkdown?: string | null;
    phase1Markdown?: string | null;
    phase2Markdown?: string | null;
    approachMarkdown?: string | null;
    specMarkdown?: string | null;
    requestMarkdown?: string | null;
    researchMarkdown?: string | null;
}

function workspaceWith(fixture: FixtureFiles): Workspace {
    const or = (key: keyof FixtureFiles, fallback: string | null) =>
        key in fixture ? (fixture[key] ?? null) : fallback;
    return fakeWorkspace({
        "plan.md": or("planMarkdown", planTable),
        "plan-phase-1.md": or(
            "phase1Markdown",
            "## Phase 1\n### Step 1\n- [ ] Status marker\n",
        ),
        "plan-phase-2.md": or(
            "phase2Markdown",
            "## Phase 2\n### Step 1\n- [ ] Status marker\n",
        ),
        "spec.md": or("specMarkdown", "# Spec"),
        "request.md": or("requestMarkdown", null),
        "research.md": or("researchMarkdown", null),
        "approach.md": or("approachMarkdown", null),
    });
}

const testState = (overrides: Partial<State> = {}): State =>
    baseState({ currentStep: "spec", ...overrides });

function planCommand(
    fs: MemoryStateFileSystem,
    fixture: FixtureFiles,
): { run: (options: PlanOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(fixture),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordPlan({ services, context: { feature: "f" } }, options),
    };
}

describe("Plan", () => {
    it("succeeds on the happy path with planPhase set to the first phase", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {}).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("plan");
        expect(outcome.result?.planPhase).toBe("1");
        expect(outcome.result?.history).toEqual([
            { step: "plan", timestamp: "2026-09-26T00:00:00Z" },
        ]);
    });

    it("succeeds with planPhase: null when plan.md has a well-formed table with no rows", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {
            planMarkdown:
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n",
        }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.planPhase).toBeNull();
    });

    it("refuses when plan.md is missing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, { planMarkdown: null }).run({});

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "plan.md is missing; a human must supply it before the workflow can continue",
                file: "plan.md",
            },
        ]);
    });

    it("refuses when plan.md's table is malformed", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {
            planMarkdown: "| Phase | Name | Status |\n|---|---|---|\n",
        }).run({});

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            {
                code: "format-invalid",
                message:
                    "Plan table must include Phase, Name, Depends On, and Status columns",
                file: "plan.md",
            },
        ]);
    });

    it("refuses when a phase file listed in plan.md is missing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, { phase2Markdown: null }).run({});

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "plans/plan-phase-2.md is missing; a human must supply it before the workflow can continue",
                file: "plans/plan-phase-2.md",
            },
        ]);
    });

    it("warns when approach.md exists with no Decision section, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {
            approachMarkdown: "## Decision\nNone.",
        }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "approach-undecided",
                message:
                    "approach.md exists but has no filled-in Decision section yet",
                file: "approach.md",
            },
        ]);
    });

    it.each([
        ["spec.md is missing", { specMarkdown: null }, "workspace-incomplete"],
        [
            "request.md has open questions",
            { requestMarkdown: "## Open Questions\n- Still open?" },
            "open-questions",
        ],
        [
            "research.md has open New Questions",
            { researchMarkdown: "## New Questions\n- Still open?" },
            "new-questions",
        ],
        [
            "a phase file is malformed",
            {
                phase2Markdown: "### Step 1: A\n\nno status marker line",
            },
            "format-invalid",
        ],
    ] satisfies Array<[string, FixtureFiles, string]>)(
        "warns when %s, and still writes",
        (_name, fixture, code) => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, JSON.stringify(testState()));

            const outcome = planCommand(fs, fixture).run({});

            expect(outcome.exitCode).toBe(0);
            expect(outcome.wrote).toBe(true);
            expect(outcome.findings.map((f) => f.code)).toEqual([code]);
        },
    );

    it("--mode revision --reason records mode: revision in history", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {}).run({
            mode: "revision",
            reason: "Restructured phases after Plan review.",
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.history).toEqual([
            {
                step: "plan",
                timestamp: "2026-09-26T00:00:00Z",
                mode: "revision",
                reason: "Restructured phases after Plan review.",
            },
        ]);
    });

    it("records --reason without --mode", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = planCommand(fs, {}).run({
            reason: "Picking this back up.",
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.history.at(-1)).toMatchObject({
            step: "plan",
            reason: "Picking this back up.",
        });
        expect(outcome.result?.history.at(-1)).not.toHaveProperty("mode");
    });

    it("recovers a missing state.json when plan.md already exists", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = planCommand(fs, {}).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("plan");
        expect(outcome.result?.planPhase).toBe("1");
    });

    const table = (rows: string) =>
        `| Phase | Name | Depends On | Status |\n|---|---|---|---|\n${rows}`;

    const done = "### Step 1: A\n- [x] Status marker\n";
    const unstartedRows =
        "| 1 | First phase | none | [ ] |\n| 2 | Second phase | 1 | [ ] |\n";

    it.each([
        [
            "skips a phase whose steps are all [x], even with a [ ] row",
            { planMarkdown: table(unstartedRows), phase1Markdown: done },
            "2",
        ],
        [
            "does not skip a phase whose row is [x] but whose steps are not",
            {
                planMarkdown: table(
                    "| 1 | First phase | none | [x] |\n| 2 | Second phase | 1 | [ ] |\n",
                ),
                phase1Markdown: "### Step 1: A\n- [ ] Status marker\n",
            },
            "1",
        ],
        [
            "skips a phase whose dependency is not complete",
            {
                planMarkdown: table(
                    "| 1 | First phase | 2 | [ ] |\n| 2 | Second phase | none | [ ] |\n",
                ),
                phase1Markdown: "### Step 1: A\n- [ ] Status marker\n",
                phase2Markdown: "### Step 1: A\n- [ ] Status marker\n",
            },
            "2",
        ],
        [
            "is null when every phase is complete",
            {
                planMarkdown: table(unstartedRows),
                phase1Markdown: done,
                phase2Markdown: done,
            },
            null,
        ],
    ] satisfies Array<[string, FixtureFiles, string | null]>)(
        "planPhase %s",
        (_name, fixture, expected) => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, JSON.stringify(testState()));

            const outcome = planCommand(fs, fixture).run({});

            expect(outcome.result?.planPhase).toBe(expected);
        },
    );

    const revision = {
        mode: "revision" as const,
        reason: "Split phase 2.",
    };

    it.each([
        [
            "an implement history entry for a phase",
            {
                history: [
                    {
                        step: "implement" as const,
                        timestamp: "2026-09-25T00:00:00Z",
                        mode: "start",
                        phase: "1" as PhaseId,
                    },
                ],
            },
            planTable,
        ],
        ["a set phaseBaseSha", { phaseBaseSha: "1234567" }, planTable],
        [
            "a phase-file step that is not [ ], under a [ ] row",
            {},
            planTable,
            "### Step 1: A\n- [~] Status marker\n",
        ],
    ] satisfies Array<[string, Partial<State>, string, string?]>)(
        "a revision after implementation began (%s) resets the phase and records a decision",
        (_name, overrides, planMarkdown, phase1Markdown?: string) => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(
                statePath,
                JSON.stringify(testState({ commitMode: "step", ...overrides })),
            );

            const outcome = planCommand(fs, {
                planMarkdown,
                ...(phase1Markdown !== undefined ? { phase1Markdown } : {}),
            }).run(revision);

            expect(outcome.exitCode).toBe(0);
            expect(outcome.result).toMatchObject({
                planPhase: "1",
                phaseBaseSha: null,
            });
            expect(outcome.result).not.toHaveProperty("commitMode");
            expect(outcome.result?.decisions).toEqual([
                "Plan revised after implementation began: Split phase 2.",
            ]);
        },
    );

    it("reviews recorded before the first plan are not implementation evidence", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(
            statePath,
            JSON.stringify(
                testState({
                    commitMode: "step",
                    history: [
                        {
                            step: "review",
                            timestamp: "2026-09-25T00:00:00Z",
                            label: "phase-1",
                            verdict: "PASS",
                        },
                    ],
                }),
            ),
        );

        const outcome = planCommand(fs, {}).run(revision);

        expect(outcome.result?.commitMode).toBe("step");
        expect(outcome.result?.decisions).toEqual([]);
        expect(outcome.result?.planPhase).toBe("1");
    });

    it("a [~] plan.md row alone is not implementation evidence", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(
            statePath,
            JSON.stringify(testState({ commitMode: "step" })),
        );

        const outcome = planCommand(fs, {
            planMarkdown: table(
                "| 1 | First phase | none | [~] |\n| 2 | Second phase | 1 | [ ] |\n",
            ),
            phase1Markdown: "### Step 1: A\n- [ ] Status marker\n",
        }).run(revision);

        expect(outcome.result?.commitMode).toBe("step");
        expect(outcome.result?.decisions).toEqual([]);
    });

    it("a plain record plan after implementation began only recomputes planPhase", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(
            statePath,
            JSON.stringify(
                testState({
                    planPhase: "1" as PhaseId,
                    phaseBaseSha: "1234567",
                    commitMode: "step",
                }),
            ),
        );

        const outcome = planCommand(fs, {
            planMarkdown: table(unstartedRows),
            phase1Markdown: done,
        }).run({ reason: "Back to the plan." });

        expect(outcome.result).toMatchObject({
            planPhase: "2",
            phaseBaseSha: "1234567",
            commitMode: "step",
            decisions: [],
        });
    });

    it("a planPhase set by an earlier record plan is not implementation evidence", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(
            statePath,
            JSON.stringify(testState({ commitMode: "step" })),
        );
        planCommand(fs, {}).run({});

        const outcome = planCommand(fs, {}).run(revision);

        expect(outcome.result?.planPhase).toBe("1");
        expect(outcome.result?.commitMode).toBe("step");
        expect(outcome.result?.decisions).toEqual([]);
    });

    it("repeating the same revision after implementation began changes nothing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(
            statePath,
            JSON.stringify(testState({ phaseBaseSha: "1234567" })),
        );
        const first = planCommand(fs, {}).run(revision);
        const before = fs.files.get(statePath);

        const second = planCommand(fs, {}).run(revision);

        expect(first.result?.decisions).toHaveLength(1);
        expect(second.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(before);
    });
});

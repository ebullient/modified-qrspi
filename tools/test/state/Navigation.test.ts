import { describe, expect, it } from "vitest";
import { navigate } from "../../src/state/Navigation.ts";
import type { HistoryEntry, State, Verdict } from "../../src/state/types.ts";
import { baseState, fakeWorkspace } from "./fixtures.ts";

const planMarkdown = (rows: string) =>
    [
        "| Phase | Name | Depends On | Status |",
        "|-------|------|------------|--------|",
        rows,
    ].join("\n");

// Phase state comes from step markers, not the plan.md Status column.
const completedPhase = "### Step 1: A\n- [x] Status marker";

function humanReview(label: string, verdict: Verdict): HistoryEntry {
    return {
        step: "review",
        label,
        verdict,
        timestamp: "2026-01-01T00:00:00Z",
    };
}

describe("navigate", () => {
    it("neither request.md nor state.json exists -> init", () => {
        const result = navigate({ state: null, workspace: fakeWorkspace({}) });
        expect(result).toEqual({
            next: { step: "init" },
            alternatives: [],
            findings: [],
        });
    });

    it("request.md exists but state.json does not -> init (state.json is recoverable)", () => {
        const result = navigate({
            state: null,
            workspace: fakeWorkspace({ "request.md": "# Request" }),
        });
        expect(result).toEqual({
            next: { step: "init" },
            alternatives: [],
            findings: [],
        });
    });

    it("state.json exists but request.md does not -> workspace-incomplete", () => {
        const result = navigate({
            state: baseState(),
            workspace: fakeWorkspace({}),
        });
        expect(result.next).toBeNull();
        expect(result.findings).toEqual([
            expect.objectContaining({
                code: "workspace-incomplete",
                file: "request.md",
            }),
        ]);
    });

    it("loop active AND a non-loop condition holds -> loop still wins", () => {
        const result = navigate({
            state: baseState({
                currentStep: "research",
                loop: {
                    scope: "all",
                    phases: ["1"] as never,
                    cycle: "review",
                    phase: "1" as never,
                    conditions: [],
                    stoppedReason: null,
                },
            }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "loop" });
    });

    it("currentStep init -> query (mode: initial)", () => {
        const result = navigate({
            state: baseState({ currentStep: "init" }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result).toEqual({
            next: { step: "query", mode: "initial" },
            alternatives: [],
            findings: [],
        });
    });

    it("currentStep init, queries.md exists -> query (mode: regeneration)", () => {
        const result = navigate({
            state: baseState({ currentStep: "init" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "queries.md": "# Queries",
            }),
        });
        expect(result.next).toEqual({ step: "query", mode: "regeneration" });
    });

    it("currentStep query -> research, alt query", () => {
        const result = navigate({
            state: baseState({
                currentStep: "query",
            }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "research" });
        expect(result.alternatives).toEqual(["query"]);
    });

    it("research, open New Questions -> query (refinement), alts research, shape, spec", () => {
        const result = navigate({
            state: baseState({
                currentStep: "research",
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "research.md": "## New Questions\n- Still open?",
            }),
        });
        expect(result.next).toEqual({ step: "query", mode: "refinement" });
        expect(result.alternatives).toEqual(["research", "shape", "spec"]);
    });

    it("research, approach.md exists with no Decision section -> shape", () => {
        const result = navigate({
            state: baseState({
                currentStep: "research",
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "approach.md": "# Approach",
            }),
        });
        expect(result.next).toEqual({ step: "shape", gate: "decide" });
        expect(result.alternatives).toEqual([]);
    });

    it("boundary: approach.md has a Decision section -> spec, not shape", () => {
        const result = navigate({
            state: baseState({
                currentStep: "research",
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "approach.md": "# Approach\n\n## Decision\n\nApproach A.",
            }),
        });
        expect(result.next).toEqual({ step: "spec" });
    });

    it("research, otherwise -> spec, alt shape/query", () => {
        const result = navigate({
            state: baseState({
                currentStep: "research",
            }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "spec" });
        expect(result.alternatives).toEqual(["shape", "query"]);
    });

    it("shape, no Decision section -> shape (gate: decide)", () => {
        const result = navigate({
            state: baseState({ currentStep: "shape" }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "shape", gate: "decide" });
        expect(result.alternatives).toEqual(["query", "research"]);
    });

    it("shape, decided -> spec", () => {
        const result = navigate({
            state: baseState({ currentStep: "shape" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "approach.md": "## Decision\n\nApproach A.",
            }),
        });
        expect(result.next).toEqual({ step: "spec" });
        expect(result.alternatives).toEqual(["query", "research", "shape"]);
    });

    it("currentStep spec -> plan", () => {
        const result = navigate({
            state: baseState({ currentStep: "spec" }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "plan" });
        expect(result.alternatives).toEqual(["shape", "query", "spec"]);
    });

    it("currentStep plan -> implement (phase: first eligible)", () => {
        const result = navigate({
            state: baseState({ currentStep: "plan" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan-phase-1.md": completedPhase,
                "plan.md": planMarkdown(
                    "| 1 | Phase 1 | none | [x] |\n| 2 | Phase 2 | 1 | [ ] |\n| 3 | Phase 3 | 1 | [ ] |",
                ),
            }),
        });
        expect(result.next).toEqual({ step: "implement", phase: "2" });
        expect(result.alternatives).toEqual(["loop", "plan"]);
    });

    it("currentStep plan, no plan.md -> implement with no phase", () => {
        const result = navigate({
            state: baseState({ currentStep: "plan" }),
            workspace: fakeWorkspace({ "request.md": "x" }),
        });
        expect(result.next).toEqual({ step: "implement" });
        expect(result.alternatives).toEqual(["loop", "plan"]);
    });

    it("implement, a step in planPhase is not [x] -> implement", () => {
        const result = navigate({
            state: baseState({
                currentStep: "implement",
                planPhase: "1" as never,
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan-phase-1.md":
                    "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker",
                "plan.md": planMarkdown("| 1 | Phase 1 | none | [~] |"),
            }),
        });
        expect(result.next).toEqual({
            step: "implement",
            phase: "1",
            planStep: "1.2",
        });
        expect(result.alternatives).toEqual(["review"]);
    });

    it("boundary: every step [x] finishes the phase even while its plan.md row is not [x]", () => {
        const result = navigate({
            state: baseState({
                currentStep: "implement",
                planPhase: "1" as never,
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                "plan.md": planMarkdown(
                    "| 1 | Phase 1 | none | [~] |\n| 2 | Phase 2 | 1 | [ ] |",
                ),
            }),
        });
        expect(result.next).toEqual({
            step: "review",
            phase: "1",
            label: "phase-1",
        });
        expect(result.alternatives).toEqual(["implement"]);
    });

    it("review, last review is final PASS WITH CONDITIONS -> plan revision", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [humanReview("final", "PASS WITH CONDITIONS")],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
            }),
        });
        expect(result.next).toEqual({ step: "plan", mode: "revision" });
        expect(result.alternatives).toEqual(["spec", "review"]);
    });

    it("review, last review is final FAIL with every phase complete -> plan revision", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [humanReview("final", "FAIL")],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan-phase-1.md": completedPhase,
                "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
            }),
        });
        expect(result.next).toEqual({ step: "plan", mode: "revision" });
        expect(result.alternatives).toEqual(["spec", "review"]);
    });

    it("last phase/mid-phase review PASS, phases remain -> implement", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [humanReview("phase-1", "PASS")],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan.md": planMarkdown(
                    "| 1 | Phase 1 | none | [x] |\n| 2 | Phase 2 | 1 | [ ] |",
                ),
            }),
        });
        expect(result.next).toEqual({ step: "implement" });
    });

    it("last phase/mid-phase review FAIL -> plan revision", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [humanReview("phase-1", "FAIL")],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan.md": planMarkdown("| 1 | Phase 1 | none | [~] |"),
            }),
        });
        expect(result.next).toEqual({ step: "plan", mode: "revision" });
        expect(result.alternatives).toEqual(["review", "spec"]);
    });

    it("last mid-phase review PASS WITH CONDITIONS -> plan revision", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [
                    humanReview("phase-1-step-1", "PASS WITH CONDITIONS"),
                ],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan.md": planMarkdown("| 1 | Phase 1 | none | [~] |"),
            }),
        });
        expect(result.next).toEqual({ step: "plan", mode: "revision" });
        expect(result.alternatives).toEqual(["review", "spec"]);
    });

    it("the most recent review wins over an earlier final FAIL", () => {
        const result = navigate({
            state: baseState({
                currentStep: "review",
                history: [
                    humanReview("final", "FAIL"),
                    humanReview("phase-2", "PASS"),
                ],
            }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan-phase-1.md": completedPhase,
                "plan-phase-2.md": completedPhase,
                "plan.md": planMarkdown(
                    "| 1 | Phase 1 | none | [x] |\n| 2 | Phase 2 | 1 | [x] |",
                ),
            }),
        });
        expect(result.next).toEqual({ step: "review", label: "final-r2" });
    });

    describe("phase state comes from step markers", () => {
        const unfinished = "### Step 1: A\n- [ ] Status marker";
        const execution = (overrides: Partial<State> = {}) =>
            baseState({
                currentStep: "implement",
                planPhase: "1" as never,
                ...overrides,
            });

        it("a [x] row whose steps are not [x] is still the next phase", () => {
            const result = navigate({
                state: baseState({ currentStep: "plan" }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": unfinished,
                    "plan.md": planMarkdown(
                        "| 1 | Phase 1 | none | [x] |\n| 2 | Phase 2 | 1 | [ ] |",
                    ),
                }),
            });
            expect(result.next).toEqual({ step: "implement", phase: "1" });
        });

        it("every phase complete by steps, rows [ ] -> final review", () => {
            const result = navigate({
                state: execution(),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [ ] |"),
                }),
            });
            expect(result.next).toEqual({ step: "review", label: "final" });
            expect(result.alternatives).toEqual(["plan"]);
        });

        it("[x] rows whose steps are not complete are phases that remain", () => {
            const result = navigate({
                state: execution(),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan-phase-2.md": unfinished,
                    "plan.md": planMarkdown(
                        "| 1 | Phase 1 | none | [x] |\n| 2 | Phase 2 | 1 | [x] |",
                    ),
                }),
            });
            expect(result.next).toEqual({
                step: "review",
                phase: "1",
                label: "phase-1",
            });
        });

        it("final PASS with [ ] rows but every phase complete -> done", () => {
            const result = navigate({
                state: execution({
                    currentStep: "review",
                    history: [humanReview("final", "PASS")],
                }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [ ] |"),
                }),
            });
            expect(result).toEqual({
                next: null,
                alternatives: [],
                findings: [],
            });
        });

        it("a re-run final review (final-r2) is a final review: PASS -> done", () => {
            const result = navigate({
                state: execution({
                    currentStep: "review",
                    history: [
                        humanReview("final", "FAIL"),
                        humanReview("final-r2", "PASS"),
                    ],
                }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
                }),
            });
            expect(result).toEqual({
                next: null,
                alternatives: [],
                findings: [],
            });
        });

        it("a re-run final review (final-r2) is a final review: FAIL -> plan revision", () => {
            const result = navigate({
                state: execution({
                    currentStep: "review",
                    history: [
                        humanReview("final", "FAIL"),
                        humanReview("final-r2", "FAIL"),
                    ],
                }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
                }),
            });
            expect(result.next).toEqual({ step: "plan", mode: "revision" });
            expect(result.alternatives).toEqual(["spec", "review"]);
        });

        it("final PASS with [x] rows but an unfinished phase -> implement", () => {
            const result = navigate({
                state: execution({
                    currentStep: "review",
                    history: [humanReview("final", "PASS")],
                }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": unfinished,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
                }),
            });
            expect(result.next).toEqual({ step: "implement" });
            expect(result.alternatives).toEqual(["plan", "spec", "review"]);
        });

        it("a phase PASS with every phase complete by steps -> final review", () => {
            const result = navigate({
                state: execution({
                    currentStep: "review",
                    history: [humanReview("phase-1", "PASS")],
                }),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": completedPhase,
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [~] |"),
                }),
            });
            expect(result.next).toEqual({ step: "review", label: "final" });
        });

        it("a malformed phase file never counts as complete", () => {
            const result = navigate({
                state: execution(),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md":
                        "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n\nno status marker line",
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [ ] |"),
                }),
            });
            expect(result.next).toEqual({ step: "implement", phase: "1" });
        });

        it("a missing phase file keeps implementation on planPhase", () => {
            const result = navigate({
                state: execution(),
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [ ] |"),
                }),
            });
            expect(result.next).toEqual({ step: "implement", phase: "1" });
        });
    });

    it("stale-downstream when spec.md exists ahead of query", () => {
        const result = navigate({
            state: baseState({ currentStep: "query" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "research.md": "# Research",
                "spec.md": "# Spec",
            }),
        });
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "stale-downstream" }),
        ]);
    });

    it("stale-downstream when plan.md exists ahead of research", () => {
        const result = navigate({
            state: baseState({ currentStep: "research" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "spec.md": "# Spec",
                "plan.md": "# Plan",
            }),
        });
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "stale-downstream" }),
        ]);
    });

    it("does not report stale-downstream once currentStep has caught back up", () => {
        const result = navigate({
            state: baseState({ currentStep: "spec" }),
            workspace: fakeWorkspace({
                "request.md": "x",
                "queries.md": "# Queries",
                "research.md": "# Research",
                "spec.md": "# Spec",
            }),
        });
        expect(result.findings.some((f) => f.code === "stale-downstream")).toBe(
            false,
        );
    });
});

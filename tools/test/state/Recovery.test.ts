import { describe, expect, it } from "vitest";
import { Recovery, type RecoveryResult } from "../../src/state/Recovery.ts";
import type { StateLoad } from "../../src/state/store/Store.ts";
import type { LoopBlock, PhaseId, State } from "../../src/state/types.ts";
import { reviewPath } from "../../src/workspace/Workspace.ts";
import { fakeClock, fakeWorkspace } from "./fixtures.ts";

const now = "2026-09-27T00:00:00Z";

function recover(
    loaded: StateLoad,
    files: { [name: string]: string } = {},
): RecoveryResult {
    return new Recovery(fakeWorkspace(files), fakeClock(now), "f").recover(
        loaded,
    );
}

function parsed(
    values: Partial<State>,
    invalid: string[] = [],
    loopMembers?: Partial<LoopBlock>,
): StateLoad {
    return {
        kind: "parsed",
        values,
        invalid,
        ...(loopMembers !== undefined ? { loopMembers } : {}),
    };
}

const missing: StateLoad = { kind: "missing" };
const unparseable: StateLoad = { kind: "unparseable", reason: "not JSON" };

function valid(overrides: Partial<State> = {}): State {
    return {
        feature: "f",
        currentStep: "implement",
        blockers: ["kept blocker"],
        decisions: ["kept decision"],
        history: [{ step: "plan", timestamp: now }],
        planPhase: "1" as PhaseId,
        phaseBaseSha: "abcdef0",
        commitMode: "step",
        ...overrides,
    };
}

const without = (field: keyof State, overrides: Partial<State> = {}) => {
    const { [field]: _, ...rest } = valid(overrides);
    return rest;
};

const plan = (...rows: string[]) =>
    [
        "| Phase | Name | Depends On | Status |",
        "|---|---|---|---|",
        ...rows.map((row) => `| ${row} | [ ] |`),
    ].join("\n");

const steps = (...markers: string[]) =>
    markers
        .map((m, i) => `### Step ${i + 1}: S\n- [${m}] Status marker\n`)
        .join("\n");

const review = (verdict: string) =>
    `## Verdict: ${verdict}\n\n| Severity | Blocking | Description |\n|---|---|---|\n`;

const twoPhasePlan = plan("1 | A | none", "2 | B | 1");

function state(result: RecoveryResult): State {
    if (result.kind === "ambiguous") {
        throw new Error(`ambiguous: ${result.finding.message}`);
    }
    return result.state;
}

function ambiguity(result: RecoveryResult) {
    if (result.kind !== "ambiguous") throw new Error("expected ambiguity");
    return result.finding;
}

describe("Recovery: a parseable file", () => {
    it("a valid file is returned unchanged with nothing reconstructed", () => {
        expect(recover(parsed(valid()))).toEqual({
            kind: "recovered",
            state: valid(),
            reconstructed: [],
            discovered: [],
        });
    });

    it("one invalid field is rebuilt alone, keeping every other value", () => {
        const result = recover(parsed(without("commitMode"), ["commitMode"]));
        expect(result).toEqual({
            kind: "recovered",
            state: valid({ commitMode: "phase" }),
            reconstructed: ["commitMode"],
            discovered: [],
        });
    });

    it("an invalid phaseBaseSha becomes null", () => {
        expect(
            state(recover(parsed(without("phaseBaseSha"), ["phaseBaseSha"])))
                .phaseBaseSha,
        ).toBeNull();
    });

    it("dropped array entries leave the surviving ones", () => {
        const result = recover(
            parsed(valid(), ["decisions[1]", "history[0].step"]),
        );
        expect(state(result)).toEqual(valid());
        expect("reconstructed" in result && result.reconstructed).toEqual([
            "decisions[1]",
            "history[0].step",
        ]);
    });

    it("a missing array becomes empty", () => {
        expect(
            state(recover(parsed(without("decisions"), ["decisions"])))
                .decisions,
        ).toEqual([]);
    });

    it("an invalid feature becomes the workspace name", () => {
        expect(
            state(recover(parsed(without("feature"), ["feature"]))).feature,
        ).toBe("f");
    });

    it("planPhase alone invalid comes from the markers", () => {
        const result = recover(parsed(without("planPhase"), ["planPhase"]), {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps("x", "~"),
        });
        expect(state(result).planPhase).toBe("2");
    });

    it("a valid planPhase is kept when the position is recovered", () => {
        const result = recover(
            parsed(without("currentStep", { planPhase: "1" as PhaseId }), [
                "currentStep",
            ]),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x"),
                "plan-phase-2.md": steps("~"),
            },
        );
        expect(state(result)).toMatchObject({
            currentStep: "implement",
            planPhase: "1",
        });
    });
});

describe("Recovery: position from evidence", () => {
    it("with no file and no artifacts, starts at init", () => {
        expect(state(recover(missing))).toMatchObject({
            feature: "f",
            currentStep: "init",
            history: [],
        });
    });

    it("before a plan, the latest artifact in workflow order", () => {
        const result = recover(missing, {
            "request.md": "x",
            "queries.md": "x",
            "research.md": "x",
        });
        expect(state(result)).toMatchObject({
            currentStep: "research",
        });
        expect(
            state(recover(unparseable, { "request.md": "x", "spec.md": "x" })),
        ).toMatchObject({ currentStep: "spec" });
    });

    it("with a plan and no phase begun, plan with the first ready phase", () => {
        const result = recover(unparseable, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps(" "),
            "plan-phase-2.md": steps(" "),
        });
        expect(state(result)).toMatchObject({
            currentStep: "plan",
            planPhase: "1",
        });
    });

    it("with a phase in progress, implement on it", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps("x", "~"),
        });
        expect(state(result)).toMatchObject({
            currentStep: "implement",
            planPhase: "2",
        });
    });

    it("the only begun, incomplete phase is active without a [~] step", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps("x", " "),
        });
        expect(state(result).planPhase).toBe("2");
    });
});

describe("Recovery: discovered reviews", () => {
    const discoveredEntry = (
        label: string,
        verdict: string,
        phase?: string,
    ) => ({
        step: "review",
        timestamp: now,
        label,
        verdict,
        artifact: reviewPath(label),
        ...(phase !== undefined ? { phase } : {}),
        reason: `discovered ${reviewPath(label)}`,
    });

    it("only the review the markers call for is discovered; older ones are left alone", () => {
        const result = recover(
            parsed(valid({ history: [], planPhase: "2" as PhaseId })),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x", "x"),
                "plan-phase-2.md": steps("x", "~"),
                "reviews/phase-1.md": review("FAIL"),
                "reviews/phase-1-r2.md": review("PASS"),
                "reviews/phase-2-step-1.md": review("PASS"),
            },
        );
        expect(result).toMatchObject({
            reconstructed: [],
            discovered: ["phase-2-step-1"],
        });
        expect(state(result).history).toEqual([
            discoveredEntry("phase-2-step-1", "PASS", "2"),
        ]);
    });

    it("checkpoints, unclear verdicts, and non-review files are not discovered", () => {
        const result = recover(parsed(valid({ history: [] })), {
            "reviews/phase-1-chk1.md": review("PASS"),
            "reviews/phase-1.md": "## Verdict: MAYBE\n",
            "reviews/plan-review.md": review("PASS"),
        });
        expect(result).toMatchObject({ discovered: [] });
    });

    it("a recorded review whose verdict was lost gets it back from its file", () => {
        const kept = { step: "review" as const, label: "phase-1" };
        const result = recover(
            parsed(valid({ history: [kept] }), ["history[0].verdict"]),
            { "reviews/phase-1.md": review("FAIL") },
        );
        expect(result).toMatchObject({ discovered: [] });
        expect(state(result).history).toEqual([{ ...kept, verdict: "FAIL" }]);
    });

    it("an absent verdict restored from its file is named as rebuilt", () => {
        const kept = { step: "review" as const, label: "phase-1" };
        const result = recover(parsed(valid({ history: [kept] })), {
            "reviews/phase-1.md": review("PASS"),
        });
        expect(result).toMatchObject({ reconstructed: ["history[0].verdict"] });
        expect(state(result).history).toEqual([{ ...kept, verdict: "PASS" }]);
    });

    it("a step in progress keeps a rebuilt position at implement despite a recorded review", () => {
        const result = recover(
            parsed(
                without("currentStep", {
                    history: [
                        {
                            step: "review",
                            label: "phase-1-step-1",
                            verdict: "FAIL",
                        },
                        { step: "implement", phase: "1" as PhaseId },
                    ],
                }),
                ["currentStep"],
            ),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x", "~"),
                "plan-phase-2.md": steps(" "),
                "reviews/phase-1-step-1.md": review("FAIL"),
            },
        );
        expect(state(result).currentStep).toBe("implement");
    });

    it("a step in progress keeps implement even when the review is discovered", () => {
        const result = recover(
            parsed(valid({ currentStep: "implement", history: [] })),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x", "~"),
                "plan-phase-2.md": steps(" "),
                "reviews/phase-1-step-1.md": review("PASS"),
            },
        );
        expect(state(result)).toMatchObject({
            currentStep: "implement",
            history: [discoveredEntry("phase-1-step-1", "PASS", "1")],
        });
    });

    it("a discovered review the markers call for moves implement to review", () => {
        const result = recover(
            parsed(valid({ currentStep: "implement", history: [] })),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x"),
                "plan-phase-2.md": steps(" "),
                "reviews/phase-1.md": review("PASS"),
            },
        );
        expect(state(result).currentStep).toBe("review");
    });

    it("a review the markers do not call for is not discovered", () => {
        const result = recover(
            parsed(valid({ currentStep: "implement", history: [] })),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x", " "),
                "plan-phase-2.md": steps(" "),
                "reviews/phase-1-step-2.md": review("PASS"),
            },
        );
        expect(state(result)).toMatchObject({
            currentStep: "implement",
            history: [],
        });
    });

    it("a rebuilt position uses the newest round of a complete phase's review", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps(" "),
            "reviews/phase-1.md": review("PASS"),
            "reviews/phase-1-r2.md": review("FAIL"),
        });
        expect(state(result)).toMatchObject({
            currentStep: "review",
            planPhase: "1",
        });
    });

    it("a rebuilt position at a mid-phase review", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x", " "),
            "plan-phase-2.md": steps(" "),
            "reviews/phase-1-step-1.md": review("PASS WITH CONDITIONS"),
        });
        expect(state(result).currentStep).toBe("review");
    });

    it("a newest round with an unclear verdict is not replaced by an older one", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps(" "),
            "reviews/phase-1.md": review("PASS"),
            "reviews/phase-1-r2.md": "## Verdict: MAYBE\n",
        });
        expect(state(result).currentStep).toBe("implement");
    });

    it("a verdict line stands without a findings table", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps(" "),
            "reviews/phase-1.md": "## Verdict: PASS\n",
        });
        expect(state(result).currentStep).toBe("review");
    });

    it("stray round suffixes are not rounds", () => {
        const result = recover(missing, {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps(" "),
            "reviews/phase-1.md": review("PASS"),
            "reviews/phase-1-r1.md": "## Verdict: MAYBE\n",
            "reviews/phase-1-r02.md": "## Verdict: MAYBE\n",
        });
        expect(state(result).currentStep).toBe("review");
    });

    it("every phase complete: final, else the active phase's own review", () => {
        const files = {
            "plan.md": twoPhasePlan,
            "plan-phase-1.md": steps("x"),
            "plan-phase-2.md": steps("x"),
            "reviews/phase-2.md": review("PASS"),
        };
        expect(state(recover(missing, files)).currentStep).toBe("review");
        expect(
            state(
                recover(
                    parsed(
                        without("history", {
                            currentStep: "review",
                            planPhase: "2" as PhaseId,
                        }),
                        ["history"],
                    ),
                    files,
                ),
            ).history,
        ).toEqual([discoveredEntry("phase-2", "PASS", "2")]);
    });

    it("a review already in the surviving history is not added again", () => {
        const recorded = {
            step: "review" as const,
            timestamp: "2026-01-01T00:00:00Z",
            label: "final",
            verdict: "PASS" as const,
        };
        const result = recover(
            parsed(without("currentStep", { history: [recorded] }), [
                "currentStep",
            ]),
            {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("x"),
                "plan-phase-2.md": steps("x"),
                "reviews/final.md": review("PASS"),
            },
        );
        expect(state(result)).toMatchObject({
            currentStep: "review",
            history: [recorded],
        });
    });
});

describe("Recovery: ambiguous evidence", () => {
    it("[~] steps in two phases", () => {
        const finding = ambiguity(
            recover(missing, {
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("~"),
                "plan-phase-2.md": steps("~"),
            }),
        );
        expect(finding.code).toBe("multiple-in-progress");
    });

    it("two begun, incomplete phases with no [~] step", () => {
        const finding = ambiguity(
            recover(missing, {
                "plan.md": plan("1 | A | none", "2 | B | none"),
                "plan-phase-1.md": steps("x", " "),
                "plan-phase-2.md": steps("x", " "),
            }),
        );
        expect(finding.code).toBe("state-invalid");
    });

    it("a malformed plan table", () => {
        const finding = ambiguity(
            recover(missing, {
                "plan.md":
                    "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| one | A | none | [ ] |",
            }),
        );
        expect(finding.code).toBe("format-invalid");
    });

    it("an invalid loop block with no active phase", () => {
        expect(ambiguity(recover(parsed(valid(), ["loop.cycle"]))).code).toBe(
            "state-invalid",
        );
    });

    it("checkpoint reviews with no plan recover no loop", () => {
        expect(
            state(
                recover(unparseable, {
                    "request.md": "x",
                    "reviews/phase-1-chk1.md": review("PASS"),
                }),
            ).loop,
        ).toBeUndefined();
    });

    it("checkpoint reviews beside a valid file need no recovery", () => {
        expect(
            state(
                recover(parsed(valid()), {
                    "reviews/phase-1-chk1.md": review("PASS"),
                }),
            ),
        ).toEqual(valid());
    });
});

describe("Recovery: the loop block from checkpoint evidence", () => {
    const phase2 = "2" as PhaseId;
    const loopFiles = (
        phase2Steps: string,
        reviews: { [label: string]: string } = {},
    ) => ({
        "request.md": "x",
        "plan.md": twoPhasePlan,
        "plan-phase-1.md": steps("x"),
        "plan-phase-2.md": phase2Steps,
        "reviews/phase-1-chk1.md": review("PASS"),
        ...Object.fromEntries(
            Object.entries(reviews).map(([label, body]) => [
                reviewPath(label),
                body,
            ]),
        ),
    });
    const onPhase2 = (overrides: Partial<State> = {}) =>
        without("loop", { planPhase: phase2, ...overrides });
    const invalidCycle = (
        members: Partial<LoopBlock> = {},
        overrides: Partial<State> = {},
    ) => parsed(onPhase2(overrides), ["loop.cycle"], members);

    it("a lost block with a PASS checkpoint recovers advance", () => {
        const result = recover(
            unparseable,
            loopFiles(steps("x", "x"), { "phase-2-chk1": review("PASS") }),
        );
        expect(state(result).loop).toEqual({
            scope: "2",
            phases: ["2"],
            cycle: "advance",
            phase: "2",
            conditions: [],
            stoppedReason: null,
        });
        expect(state(result)).toMatchObject({
            currentStep: "implement",
            planPhase: "2",
        });
    });

    it("a PASS checkpoint on a phase with an unfinished step recovers implement", () => {
        const result = recover(
            unparseable,
            loopFiles(steps("x", " "), { "phase-2-chk1": review("PASS") }),
        );
        expect(state(result).loop).toMatchObject({
            cycle: "implement",
            phase: "2",
        });
    });

    it("PASS WITH CONDITIONS does not invent the lost conditions", () => {
        const result = recover(
            invalidCycle(),
            loopFiles(steps("x", "x"), {
                "phase-2-chk1": review("PASS WITH CONDITIONS"),
            }),
        );
        expect(state(result).loop).toMatchObject({
            cycle: "advance",
            conditions: [],
        });
    });

    it("FAIL returns to repair, keeping the valid siblings", () => {
        const conditions = [
            { phase: "1" as PhaseId, label: "phase-1-chk1", note: "LOW: x" },
        ];
        const result = recover(
            invalidCycle({
                scope: "1..2",
                phases: ["1" as PhaseId, phase2],
                phase: phase2,
                conditions,
            }),
            loopFiles(steps("x", "x"), { "phase-2-chk1": review("FAIL") }),
        );
        expect(state(result).loop).toEqual({
            scope: "1..2",
            phases: ["1", "2"],
            cycle: "repair",
            phase: "2",
            conditions,
            stoppedReason: null,
        });
        expect(state(result)).toMatchObject({
            blockers: ["kept blocker"],
            decisions: ["kept decision"],
            commitMode: "step",
        });
        if ("state" in result) {
            expect(result.reconstructed).toEqual(["loop.cycle"]);
        }
    });

    it("FAIL with no repair boundary recovers repair without a human stop", () => {
        const result = recover(
            unparseable,
            loopFiles(steps("x", "x"), { "phase-2-chk1": review("FAIL") }),
        );
        expect(state(result).loop).toMatchObject({ cycle: "repair" });
    });

    it("no checkpoint with steps left recovers implement", () => {
        const result = recover(invalidCycle(), loopFiles(steps("x", "~")));
        expect(state(result).loop).toMatchObject({ cycle: "implement" });
        expect(state(result).currentStep).toBe("implement");
    });

    it("no checkpoint with every step done recovers review", () => {
        const result = recover(invalidCycle(), loopFiles(steps("x", "x")));
        expect(state(result).loop).toMatchObject({ cycle: "review" });
        expect(state(result).currentStep).toBe("checkpoint");
    });

    it("a lost block is named among the rebuilt fields", () => {
        const result = recover(
            parsed(onPhase2(), ["commitMode"]),
            loopFiles(steps("x", "x"), { "phase-2-chk1": review("PASS") }),
        );
        if (!("state" in result)) throw new Error("expected a state");
        expect(result.reconstructed).toEqual(["commitMode", "loop"]);
    });

    it("another phase's checkpoint is not evidence of a lost loop", () => {
        const result = recover(
            parsed(onPhase2(), ["commitMode"]),
            loopFiles(steps("x", "~")),
        );
        expect(state(result).loop).toBeUndefined();
    });

    it("a PENDING stub recovers review with the stub's label", () => {
        const result = recover(
            unparseable,
            loopFiles(steps("x", "x"), {
                "phase-2-chk1": review("FAIL"),
                "phase-2-chk2": "## Verdict: PENDING\n",
            }),
        );
        expect(state(result).loop).toMatchObject({
            cycle: "re-review",
        });
        expect(state(result).currentStep).toBe("checkpoint");
    });

    it("an absent loop with no checkpoint evidence stays absent", () => {
        const { "reviews/phase-1-chk1.md": _chk, ...files } = loopFiles(
            steps("x", "~"),
        );
        expect(state(recover(unparseable, files)).loop).toBeUndefined();
    });

    it("a loop phase that disagrees with the markers is resolved by the markers", () => {
        const result = recover(
            invalidCycle({ phase: "1" as PhaseId }),
            loopFiles(steps("x", "~")),
        );
        expect(state(result).loop).toMatchObject({ phase: "2" });
    });

    it("a planPhase that disagrees with the markers is resolved by the markers", () => {
        const result = recover(
            invalidCycle({}, { planPhase: "1" as PhaseId }),
            loopFiles(steps("x", "~")),
        );
        expect(state(result)).toMatchObject({ planPhase: "2" });
    });

    it("a legacy loop block just after loop --advance recovers instead of raising state-invalid", () => {
        // The stored loop/planPhase already point at phase 2, the phase
        // loop --advance just moved to and which has not begun yet, while
        // the markers still show phase 1 in progress (old evidence for the
        // phase just finished) and no repairBaseSha/repairUsed is present,
        // as in a pre-phase-13 file. That disagreement is not ambiguous:
        // the markers' reconstruction is trusted outright, the same way it
        // already is when the loop block is missing entirely.
        const result = recover(
            invalidCycle({ phase: phase2 }, { planPhase: phase2 }),
            {
                "request.md": "x",
                "plan.md": twoPhasePlan,
                "plan-phase-1.md": steps("~"),
                "plan-phase-2.md": steps(" "),
            },
        );
        expect(state(result).loop).toMatchObject({ phase: "1" });
        expect(state(result)).toMatchObject({ planPhase: "1" });
    });

    it("a newest checkpoint with no clear verdict is ambiguous", () => {
        const finding = ambiguity(
            recover(
                invalidCycle(),
                loopFiles(steps("x", "x"), {
                    "phase-2-chk1": review("PASS"),
                    "phase-2-chk2": "no verdict here",
                }),
            ),
        );
        expect(finding).toMatchObject({
            code: "format-invalid",
            file: "reviews/phase-2-chk2.md",
        });
    });
});

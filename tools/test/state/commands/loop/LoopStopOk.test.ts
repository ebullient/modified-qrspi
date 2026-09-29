import { describe, expect, it } from "vitest";
import { report } from "../../../../src/state/commands/Report.ts";
import type {
    HistoryEntry,
    LoopBlock,
    State,
} from "../../../../src/state/types.ts";
import { reviewPath } from "../../../../src/workspace/Workspace.ts";
import { fakeGit, fakeWorkspace, now, statePath } from "../../fixtures.ts";
import {
    loopBlock,
    loopFixture,
    loopState,
    phaseId,
    phaseSteps,
    plannedState,
    readyFiles,
    reviewFile,
} from "../../loop/fixtures.ts";

const stop: HistoryEntry = {
    step: "implement",
    phase: phaseId("2"),
    outcome: "STOPPED",
    reason: "kept until ok",
    by: "autoloop",
};
const humanReview = (label: string, verdict = "PASS"): HistoryEntry =>
    ({
        step: "review",
        label,
        verdict,
        artifact: reviewPath(label),
    }) as HistoryEntry;

function stoppedState(
    loop: Partial<LoopBlock> = {},
    afterStop: HistoryEntry[] = [],
): State {
    return loopState({
        currentStep: "implement",
        phaseBaseSha: "abcdef0",
        blockers: ["kept until ok"],
        loop: loopBlock("implement", {
            stoppedReason: "needs a human",
            ...loop,
        }),
        history: [{ step: "plan" }, stop, ...afterStop],
    });
}
const complete = readyFiles(phaseSteps("x"));
const ok = (state: State, files = readyFiles()) =>
    loopFixture({ state, files }).loop.ok({}).result;

describe("loop --stop", () => {
    it("records the reason as a STOPPED history entry", () => {
        const outcome = loopFixture().loop.stop({ reason: "operator pause" });
        expect(outcome.result).toMatchObject({
            action: "acknowledge-required",
            state: { loop: { stoppedReason: "operator pause" } },
        });
        expect(outcome.result?.state.history.at(-1)).toEqual({
            step: "plan",
            timestamp: now,
            reason: "stopped: operator pause",
            outcome: "STOPPED",
        });
    });

    it.each([
        ["no loop", plannedState()],
        ["a done loop", loopState({ loop: loopBlock("done") })],
    ])("refuses with %s", (_what, state) => {
        expect(loopFixture({ state }).loop.stop({ reason: "x" })).toMatchObject(
            {
                exitCode: 1,
                findings: [expect.objectContaining({ code: "loop-refused" })],
            },
        );
    });

    it("rejects a blank reason", () => {
        expect(() => loopFixture().loop.stop({ reason: "  " })).toThrow(
            "--stop",
        );
    });
});

describe("loop --ok", () => {
    it("resumes a phase with steps left, clearing the stop and blockers", () => {
        const result = loopFixture({ state: stoppedState() }).loop.ok({
            reason: "fixed",
        }).result;
        expect(result).toMatchObject({
            action: "implement",
            state: {
                blockers: [],
                currentStep: "implement",
                loop: { cycle: "implement", stoppedReason: null },
            },
        });
        expect(result?.state.decisions.at(-1)).toContain("fixed");
        expect(result?.state.decisions.at(-1)).toContain("kept until ok");
        expect(result?.state.history.at(-1)?.reason).toContain("implement");
    });

    it.each([
        ["mid-scope", { scope: "2..3", phases: [phaseId("2"), phaseId("3")] }],
        ["last in scope", {}],
    ])(
        "reviews a complete phase with no review after the stop (%s)",
        (_where, loop) => {
            expect(ok(stoppedState(loop), complete)).toMatchObject({
                action: "review",
                label: "phase-2-chk1",
                state: { loop: { cycle: "review" } },
            });
        },
    );

    it("returns a PENDING stub's label for review", () => {
        expect(
            ok(stoppedState(), {
                ...complete,
                "reviews/phase-2-chk1.md": "## Verdict: PENDING\n",
            }),
        ).toMatchObject({ action: "review", label: "phase-2-chk1" });
    });

    describe("a PENDING stub left by a review that stopped", () => {
        const reviewStop = (
            reason = "review phase-2-chk1 returned incomplete twice",
        ): State =>
            loopState({
                currentStep: "implement",
                phaseBaseSha: "abcdef0",
                loop: loopBlock("review", { stoppedReason: reason }),
                history: [
                    { step: "plan" },
                    {
                        step: "checkpoint",
                        phase: phaseId("2"),
                        label: "phase-2-chk1",
                        by: "autoloop",
                    },
                    {
                        step: "checkpoint",
                        phase: phaseId("2"),
                        label: "phase-2-chk1",
                        artifact: "reviews/phase-2-chk1.md",
                        by: "autoloop",
                        outcome: "STOPPED",
                        reason,
                    },
                ],
            });

        it.each([
            ["left", { "reviews/phase-2-chk1.md": "## Verdict: PENDING\n" }],
            ["removed", {}],
        ])(
            "relaunches the review with the same label when %s",
            (_how, file) => {
                expect(
                    ok(reviewStop(), { ...complete, ...file }),
                ).toMatchObject({
                    action: "review",
                    label: "phase-2-chk1",
                });
            },
        );

        it("a fixed file is consumed after an invalid-artifact stop", () => {
            expect(
                ok(
                    reviewStop(
                        "invalid review artifact: reviews/phase-2-chk1.md",
                    ),
                    {
                        ...complete,
                        "reviews/phase-2-chk1.md": reviewFile("PASS"),
                    },
                ),
            ).toMatchObject({
                action: "advance",
                state: { loop: { cycle: "advance" } },
            });
        });

        it("is consumed when the human replaced it with a verdict", () => {
            const result = ok(reviewStop(), {
                ...complete,
                "reviews/phase-2-chk1.md": reviewFile("PASS WITH CONDITIONS", [
                    "| LOW | no | Checked by hand |",
                ]),
            });
            expect(result).toMatchObject({
                action: "advance",
                state: {
                    loop: {
                        cycle: "advance",
                        conditions: [
                            {
                                phase: "2",
                                label: "phase-2-chk1",
                                note: "LOW: Checked by hand",
                            },
                        ],
                    },
                },
            });
            expect(result?.state.history.at(-2)).toEqual({
                step: "checkpoint",
                timestamp: now,
                phase: "2",
                label: "phase-2-chk1",
                artifact: "reviews/phase-2-chk1.md",
                verdict: "PASS WITH CONDITIONS",
            });
        });
    });

    it("names the open review launch's label, as dispatch does", () => {
        const state = loopState({
            currentStep: "checkpoint",
            phaseBaseSha: "abcdef0",
            loop: loopBlock("review", { stoppedReason: "operator pause" }),
            history: [
                { step: "plan" },
                {
                    step: "checkpoint",
                    phase: phaseId("2"),
                    label: "phase-2-chk1",
                    by: "autoloop",
                },
                {
                    step: "checkpoint",
                    outcome: "STOPPED",
                    reason: "stopped: x",
                },
            ],
        });
        expect(
            ok(state, {
                ...complete,
                "reviews/phase-2-chk1.md": reviewFile("PASS"),
            }),
        ).toMatchObject({ action: "review", label: "phase-2-chk1" });
    });

    it.each([
        [
            "a passing checkpoint",
            {
                step: "checkpoint",
                phase: phaseId("2"),
                label: "phase-2-chk2",
                verdict: "PASS",
                outcome: "COMPLETE",
                by: "autoloop",
            } as HistoryEntry,
        ],
        ["a passing human phase review", humanReview("phase-2-r2")],
    ])("advances a complete phase with %s after the stop", (_what, entry) => {
        expect(ok(stoppedState({}, [entry]), complete)).toMatchObject({
            action: "advance",
            state: { loop: { cycle: "advance" } },
        });
    });

    it.each(["phase-2-r0", "phase-2-r1", "phase-2-r01"])(
        "a passing human review labelled %s does not count as a checkpoint for phase 2",
        (label) => {
            expect(
                ok(stoppedState({}, [humanReview(label)]), complete),
            ).not.toMatchObject({ action: "advance" });
        },
    );

    it("a passing human final review after a FAIL-after-repair stop closes the scope", () => {
        const failStop: HistoryEntry = {
            step: "checkpoint",
            phase: phaseId("2"),
            label: "phase-2-chk2",
            verdict: "FAIL",
            outcome: "STOPPED",
            by: "autoloop",
        };
        const state = loopState({
            currentStep: "review",
            phaseBaseSha: "abcdef0",
            loop: loopBlock("re-review", {
                stoppedReason: "checkpoint phase-2-chk2 FAIL after repair",
            }),
            history: [{ step: "plan" }, failStop, humanReview("final")],
        });
        const allDone = { ...complete, "plan-phase-3.md": phaseSteps("x") };
        const result = ok(state, allDone);
        expect(result).toMatchObject({
            action: "done",
            state: {
                currentStep: "review",
                loop: { cycle: "done" },
            },
        });

        const after = report(result?.state as State, {
            workspace: fakeWorkspace({ ...allDone, "request.md": "x" }),
            git: fakeGit(),
        });
        expect(after.result?.next.step).toBeNull();
    });

    it("a final review from before the stop does not close the scope", () => {
        const state = stoppedState();
        state.history = [{ step: "plan" }, humanReview("final"), stop];
        expect(ok(state, complete)).toMatchObject({ action: "review" });
    });

    it("is a no-op when there is nothing to acknowledge", () => {
        const built = loopFixture();
        const before = built.stateFs.files.get(statePath);
        const outcome = built.loop.ok({ reason: "retry" });
        expect(outcome).toMatchObject({ exitCode: 0, wrote: false });
        expect(built.stateFs.files.get(statePath)).toBe(before);
    });
});

describe("loop --abandon", () => {
    it.each([
        ["stopped", stoppedState()],
        ["running", loopState({ loop: loopBlock("implement") })],
    ])("ends a %s loop, keeping blockers for the human", (_how, state) => {
        const result = loopFixture({ state }).loop.abandon({
            reason: "finishing by hand",
        }).result;
        expect(result).toMatchObject({
            action: "done",
            state: {
                blockers: state.blockers,
                loop: { cycle: "done", stoppedReason: null },
            },
        });
        expect(result?.state.decisions.at(-1)).toBe(
            "loop --abandon: finishing by hand",
        );
        expect(result?.state.history.at(-1)?.reason).toBe(
            "abandoned: finishing by hand",
        );
    });

    it.each([
        ["no loop", plannedState()],
        ["a loop that is already done", loopState({ loop: loopBlock("done") })],
    ])("refuses %s", (_what, state) => {
        expect(
            loopFixture({ state }).loop.abandon({ reason: "x" }),
        ).toMatchObject({
            exitCode: 1,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("stays done: --ok keeps the blockers and --end of the open launch changes nothing", () => {
        const running = loopState({
            currentStep: "implement",
            phaseBaseSha: "abcdef0",
            blockers: ["note"],
            loop: loopBlock("implement"),
            history: [
                { step: "plan" },
                {
                    step: "implement",
                    mode: "phase",
                    phase: phaseId("2"),
                    by: "autoloop",
                },
            ],
        });
        const built = loopFixture({ state: running, files: complete });
        built.loop.abandon({ reason: "finishing by hand" });
        const abandoned = built.stateFs.files.get(statePath);

        expect(built.loop.ok({})).toMatchObject({
            wrote: false,
            result: { action: "done" },
        });
        const end = built.loop.end({ action: "implement" });
        expect(end).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: { action: "implement", done: true },
        });
        expect(end.result?.outcome).toBeUndefined();
        expect(built.stateFs.files.get(statePath)).toBe(abandoned);
    });
});

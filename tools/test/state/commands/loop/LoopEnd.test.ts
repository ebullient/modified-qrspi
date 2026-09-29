import { describe, expect, it } from "vitest";
import type { HistoryEntry, LoopBlock } from "../../../../src/state/types.ts";
import {
    loopBlock,
    loopFixture,
    loopState,
    phaseId,
    phaseSteps,
    readyFiles,
    reviewFile,
} from "../../loop/fixtures.ts";

const launch = (fields: Partial<HistoryEntry>): HistoryEntry => ({
    step: "implement",
    phase: phaseId("2"),
    by: "autoloop",
    ...fields,
});
const implementLaunch = launch({ mode: "phase" });
const repairLaunch = launch({ mode: "repair" });
const reviewLaunch = launch({ step: "checkpoint", label: "phase-2-chk1" });
const reReviewLaunch = {
    ...launch({ step: "checkpoint", label: "phase-2-chk2" }),
    mode: "re-review",
};

/** A loop in `cycle` whose history ends with `entries`. */
function openState(
    cycle: LoopBlock["cycle"],
    entries: HistoryEntry[],
    overrides: Partial<LoopBlock> = {},
) {
    return loopState({
        currentStep:
            cycle === "review" || cycle === "re-review"
                ? "checkpoint"
                : "implement",
        phaseBaseSha: "abcdef0",
        loop: loopBlock(cycle, overrides),
        history: [{ step: "plan" }, ...entries],
    });
}

function reviewFiles(body?: string) {
    return {
        ...readyFiles(phaseSteps("x")),
        ...(body === undefined ? {} : { "reviews/phase-2-chk1.md": body }),
    };
}

describe("loop --end implement", () => {
    it("records COMPLETE and moves to review", () => {
        const outcome = loopFixture({
            state: openState("implement", [implementLaunch]),
            files: readyFiles(phaseSteps("x", "x")),
        }).loop.end({ action: "implement" });
        expect(outcome.result).toMatchObject({
            outcome: "COMPLETE",
            state: { currentStep: "implement", loop: { cycle: "review" } },
        });
        expect(outcome.result?.state.history.at(-1)).toMatchObject({
            step: "implement",
            phase: "2",
            outcome: "COMPLETE",
            by: "autoloop",
        });
    });

    it("records incomplete and keeps the cycle, then a stop on the second in a row", () => {
        expect(
            loopFixture({
                state: openState("implement", [implementLaunch]),
            }).loop.end({ action: "implement" }).result,
        ).toMatchObject({
            outcome: "incomplete",
            state: { loop: { cycle: "implement", stoppedReason: null } },
        });

        const again = loopFixture({
            state: openState("implement", [
                implementLaunch,
                launch({ outcome: "incomplete" }),
                implementLaunch,
            ]),
        });
        expect(again.loop.end({ action: "implement" }).result).toMatchObject({
            outcome: "STOPPED",
            state: {
                loop: {
                    cycle: "implement",
                    stoppedReason: "implement returned incomplete twice",
                },
            },
        });
    });

    it("counts incomplete ends afresh after a stop", () => {
        const state = openState("implement", [
            implementLaunch,
            launch({ outcome: "incomplete" }),
            { step: "implement", outcome: "STOPPED", reason: "stopped: pause" },
            { step: "implement", reason: "ok: pause; implement" },
            implementLaunch,
        ]);
        expect(
            loopFixture({ state }).loop.end({ action: "implement" }).result,
        ).toMatchObject({ outcome: "incomplete" });
    });

    it("records a note on an end that is not a stop", () => {
        const result = loopFixture({
            state: openState("implement", [implementLaunch]),
            files: readyFiles(phaseSteps("x", "x")),
        }).loop.end({ action: "implement", note: "finished early" }).result;
        expect(result).toMatchObject({
            outcome: "COMPLETE",
            state: { blockers: [] },
        });
        expect(result?.state.history.at(-1)?.reason).toBe("finished early");
    });

    it("records STOPPED and keeps an exact note; a repeat is a no-op", () => {
        const built = loopFixture({
            state: openState("implement", [implementLaunch]),
        });
        const first = built.loop.end({
            action: "implement",
            result: "STOPPED",
            note: "exact blocker text",
        });
        expect(first.result).toMatchObject({
            outcome: "STOPPED",
            state: {
                blockers: ["exact blocker text"],
                loop: { stoppedReason: "implementer STOPPED" },
            },
        });
        expect(first.result?.state.history.at(-1)?.reason).toBe(
            "exact blocker text",
        );

        const second = built.loop.end({
            action: "implement",
            result: "STOPPED",
            note: "exact blocker text",
        });
        expect(second).toMatchObject({
            wrote: false,
            result: { outcome: "STOPPED" },
        });
        expect(second.result?.state.blockers).toEqual(["exact blocker text"]);
    });

    it.each([
        [
            "no implement launch is open",
            loopState({ loop: loopBlock("implement") }),
        ],
        ["a review launch is open", openState("review", [reviewLaunch])],
        [
            "the loop is stopped",
            openState("implement", [implementLaunch], {
                stoppedReason: "operator pause",
            }),
        ],
    ])("refuses when %s", (_when, state) => {
        expect(
            loopFixture({ state }).loop.end({ action: "implement" }),
        ).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("rejects --note when ending a review", () => {
        expect(() =>
            loopFixture().loop.end({ action: "review", note: "x" }),
        ).toThrow("--note");
    });
});

describe("loop --end repair", () => {
    const repairState = (entries: HistoryEntry[] = [repairLaunch]) =>
        openState("repair", entries);

    it("records COMPLETE and moves to re-review", () => {
        expect(
            loopFixture({ state: repairState() }).loop.end({
                action: "repair",
            }).result,
        ).toMatchObject({
            outcome: "COMPLETE",
            state: { loop: { cycle: "re-review" } },
        });
    });

    it("records STOPPED when the implementer reports it", () => {
        expect(
            loopFixture({ state: repairState() }).loop.end({
                action: "repair",
                result: "STOPPED",
                note: "could not fix it",
            }).result,
        ).toMatchObject({
            outcome: "STOPPED",
            state: { loop: { stoppedReason: "repair STOPPED" } },
        });
    });
});

describe("loop --end review", () => {
    const reviewing = (cycle: "review" | "re-review" = "review") =>
        openState(cycle, [reviewLaunch]);

    it("PASS moves to advance and back to implement", () => {
        const result = loopFixture({
            state: reviewing(),
            files: reviewFiles(reviewFile("PASS")),
        }).loop.end({ action: "review" }).result;
        expect(result).toMatchObject({
            outcome: "COMPLETE",
            verdict: "PASS",
            state: { currentStep: "implement", loop: { cycle: "advance" } },
        });
        expect(result?.state.history.at(-1)).toMatchObject({
            step: "checkpoint",
            label: "phase-2-chk1",
            verdict: "PASS",
            artifact: "reviews/phase-2-chk1.md",
            outcome: "COMPLETE",
        });
    });

    it("PASS WITH CONDITIONS keeps each non-blocking finding", () => {
        const result = loopFixture({
            state: reviewing(),
            files: reviewFiles(
                reviewFile("PASS WITH CONDITIONS", [
                    "| LOW | no | Keep this |",
                    "| HIGH | yes | Do not carry this |",
                ]),
            ),
        }).loop.end({ action: "review" }).result;
        expect(result).toMatchObject({
            verdict: "PASS WITH CONDITIONS",
            state: {
                loop: {
                    cycle: "advance",
                    conditions: [
                        {
                            phase: "2",
                            label: "phase-2-chk1",
                            note: "LOW: Keep this",
                        },
                    ],
                },
            },
        });
    });

    it("the first FAIL moves to the one repair", () => {
        expect(
            loopFixture({
                state: reviewing(),
                files: reviewFiles(reviewFile("FAIL")),
            }).loop.end({ action: "review" }).result,
        ).toMatchObject({
            verdict: "FAIL",
            state: {
                currentStep: "implement",
                loop: { cycle: "repair", stoppedReason: null },
            },
        });
    });

    it("FAIL after repair records a STOPPED entry that keeps the verdict", () => {
        const state = openState("re-review", [reReviewLaunch]);
        const result = loopFixture({
            state,
            files: {
                ...reviewFiles(reviewFile("FAIL")),
                "reviews/phase-2-chk2.md": reviewFile("FAIL"),
            },
        }).loop.end({ action: "re-review" }).result;
        expect(result).toMatchObject({
            outcome: "STOPPED",
            state: {
                currentStep: "implement",
                loop: {
                    stoppedReason: "checkpoint phase-2-chk2 FAIL after repair",
                },
            },
        });
        expect(result?.state.history.at(-1)).toMatchObject({
            outcome: "STOPPED",
            verdict: "FAIL",
        });
    });

    it("keeps repeated review and re-review ends distinct", () => {
        const review = loopFixture({
            state: reviewing("review"),
            files: reviewFiles(reviewFile("PASS")),
        }).loop;
        expect(review.end({ action: "review" }).result?.outcome).toBe(
            "COMPLETE",
        );
        expect(review.end({ action: "review" })).toMatchObject({
            wrote: false,
            result: { outcome: "COMPLETE" },
        });

        const reReview = loopFixture({
            state: openState("re-review", [reReviewLaunch]),
            files: {
                ...reviewFiles(reviewFile("FAIL")),
                "reviews/phase-2-chk2.md": reviewFile("PASS"),
            },
        }).loop;
        expect(reReview.end({ action: "re-review" }).result?.outcome).toBe(
            "COMPLETE",
        );
        expect(reReview.end({ action: "re-review" })).toMatchObject({
            wrote: false,
            result: { outcome: "COMPLETE" },
        });
        expect(reReview.end({ action: "review" })).toMatchObject({
            exitCode: 1,
            wrote: false,
        });
    });

    it("an unusable artifact records a stop", () => {
        expect(
            loopFixture({
                state: reviewing(),
                files: reviewFiles("## Verdict: MAYBE\n"),
            }).loop.end({ action: "review" }).result,
        ).toMatchObject({
            outcome: "STOPPED",
            state: {
                loop: {
                    stoppedReason:
                        "invalid review artifact: reviews/phase-2-chk1.md",
                },
            },
        });
    });

    it.each([
        ["missing", undefined],
        ["a PENDING stub", "## Verdict: PENDING\n"],
    ])(
        "a reviewer that wrote nothing (%s) is incomplete, then stopped the second time",
        (_kind, body) => {
            expect(
                loopFixture({
                    state: reviewing(),
                    files: reviewFiles(body),
                }).loop.end({ action: "review" }).result,
            ).toMatchObject({
                outcome: "incomplete",
                state: { loop: { cycle: "review" } },
            });
            const again = openState("review", [
                reviewLaunch,
                { ...reviewLaunch, outcome: "incomplete" },
                reviewLaunch,
            ]);
            expect(
                loopFixture({
                    state: again,
                    files: reviewFiles(body),
                }).loop.end({ action: "review" }).result,
            ).toMatchObject({
                outcome: "STOPPED",
                state: {
                    loop: {
                        stoppedReason:
                            "review phase-2-chk1 returned incomplete twice",
                    },
                },
            });
        },
    );

    it("a repeated end is a no-op, and ending another kind of launch is refused", () => {
        const built = loopFixture({
            state: reviewing(),
            files: reviewFiles(reviewFile("PASS")),
        });
        expect(built.loop.end({ action: "review" }).wrote).toBe(true);
        expect(built.loop.end({ action: "review" })).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: { outcome: "COMPLETE" },
        });
        expect(built.loop.end({ action: "implement" })).toMatchObject({
            exitCode: 1,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });
});

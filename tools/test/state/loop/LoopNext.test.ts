import { describe, expect, it } from "vitest";
import { nextLoopAction } from "../../../src/state/loop/LoopNext.ts";
import type {
    HistoryEntry,
    LoopBlock,
    State,
} from "../../../src/state/types.ts";
import { fakeGit, fakeWorkspace } from "../fixtures.ts";
import {
    loopBlock,
    loopState,
    phaseId,
    phaseSteps,
    readyFiles,
    reviewFile,
} from "./fixtures.ts";

function cycleState(
    cycle: LoopBlock["cycle"],
    overrides: Partial<LoopBlock> = {},
    history: HistoryEntry[] = [],
): State {
    return loopState({
        phaseBaseSha: "abcdef0",
        loop: loopBlock(cycle, overrides),
        history: [{ step: "plan" }, ...history],
    });
}

const implementLaunch: HistoryEntry = {
    step: "implement",
    mode: "phase",
    phase: phaseId("2"),
    by: "autoloop",
};
const repairLaunch: HistoryEntry = { ...implementLaunch, mode: "repair" };
const reviewLaunch = (label = "phase-2-chk1"): HistoryEntry => ({
    step: "checkpoint",
    phase: phaseId("2"),
    label,
    by: "autoloop",
});

const phaseTwo = (...markers: string[]) => ({
    ...readyFiles(),
    "plan-phase-2.md": phaseSteps(...markers),
});
const dirty = fakeGit({ status: () => [{ path: "src/product.ts" }] });

const next = (
    state: State,
    files: Record<string, string> = readyFiles(),
    gitRunner = fakeGit(),
) => nextLoopAction(state, fakeWorkspace(files), gitRunner);
const codes = (result: ReturnType<typeof next>) =>
    result.findings.map((finding) => finding.code);

describe("nextLoopAction: stops and completion", () => {
    it("requires acknowledgement before every other action", () => {
        const result = next(
            cycleState("implement", { stoppedReason: "human needed" }),
        );
        expect(result.next).toMatchObject({ action: "acknowledge-required" });
        expect(codes(result)).toContain("loop-stopped");
    });

    it("returns done for a completed loop, even with blockers kept for the human", () => {
        expect(next(cycleState("done")).next).toEqual({ action: "done" });
        expect(
            next({ ...cycleState("done"), blockers: ["note"] }).next,
        ).toEqual({ action: "done" });
    });

    it("stops when the phase base is no longer an ancestor of HEAD", () => {
        const result = next(
            cycleState("implement"),
            readyFiles(),
            fakeGit({ isAncestor: () => false }),
        );
        expect(result.next).toMatchObject({ action: "stop" });
        expect(codes(result)).toEqual(["base-not-ancestor"]);
    });

    it("stops for a dirty tree outside partial work, even with the phase complete", () => {
        const result = next(cycleState("implement"), phaseTwo("x"), dirty);
        expect(result.next).toMatchObject({ action: "stop" });
        expect(codes(result)).toEqual(["dirty-tree"]);
    });

    it("allows dirty partial implementation and repair work", () => {
        expect(
            next(cycleState("implement"), phaseTwo("x", "~"), dirty).next,
        ).toMatchObject({ action: "implement" });
        expect(
            next(
                cycleState("repair"),
                {
                    ...phaseTwo("x"),
                    "reviews/phase-2-chk1.md": reviewFile("FAIL"),
                },
                dirty,
            ).next,
        ).toMatchObject({ action: "repair" });
    });

    it("stops dirty repair work without a failing checkpoint", () => {
        const result = next(cycleState("repair"), phaseTwo("x"), dirty);
        expect(result.next).toMatchObject({ action: "stop" });
        expect(codes(result)).toEqual(["dirty-tree"]);
    });
});

describe("nextLoopAction: implement", () => {
    it("launches implementation when none is open", () => {
        expect(next(cycleState("implement")).next).toEqual({
            action: "implement",
            phase: "2",
        });
    });

    it("relaunches an open implementation that has not finished", () => {
        expect(
            next(
                cycleState("implement", {}, [implementLaunch]),
                phaseTwo("x", " "),
            ).next,
        ).toEqual({ action: "implement", phase: "2" });
    });

    it("relaunches implementation after it ended incomplete", () => {
        const state = cycleState("implement", {}, [
            implementLaunch,
            { ...implementLaunch, outcome: "incomplete" },
        ]);
        expect(next(state, phaseTwo("x", " ")).next).toEqual({
            action: "implement",
            phase: "2",
        });
    });

    it("ends an open implementation whose steps are all done, so the review is not skipped", () => {
        expect(
            next(cycleState("implement", {}, [implementLaunch]), phaseTwo("x"))
                .next,
        ).toEqual({ action: "end", launch: "implement", phase: "2" });
    });

    it("ends an open implementation with a blocked step instead of relaunching it", () => {
        expect(
            next(
                cycleState("implement", {}, [implementLaunch]),
                phaseTwo("x", "!"),
            ).next,
        ).toEqual({ action: "end", launch: "implement", phase: "2" });
    });

    it("reviews a complete phase with no open launch", () => {
        expect(next(cycleState("implement"), phaseTwo("x")).next).toEqual({
            action: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("ignores interactive implement entries when finding an open launch", () => {
        const interactive: HistoryEntry = {
            step: "implement",
            mode: "start",
            phase: phaseId("2"),
        };
        expect(
            next(cycleState("implement", {}, [interactive]), phaseTwo("x"))
                .next,
        ).toMatchObject({ action: "review" });
    });
});

describe("nextLoopAction: review", () => {
    const reviewing = (label = "phase-2-chk1") =>
        cycleState("review", {}, [reviewLaunch(label)]);

    it("launches a review with the next checkpoint label", () => {
        expect(next(cycleState("review"), phaseTwo("x")).next).toEqual({
            action: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("relaunches an open review whose file is missing, with the same label", () => {
        expect(next(reviewing(), phaseTwo("x")).next).toEqual({
            action: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("relaunches an open review whose file is still a PENDING stub", () => {
        expect(
            next(reviewing(), {
                ...phaseTwo("x"),
                "reviews/phase-2-chk1.md": "## Verdict: PENDING\n",
            }).next,
        ).toEqual({ action: "review", phase: "2", label: "phase-2-chk1" });
    });

    it("ends an open review whose file has a verdict", () => {
        const result = next(reviewing(), {
            ...phaseTwo("x"),
            "reviews/phase-2-chk1.md": reviewFile("PASS"),
        });
        expect(result.next).toEqual({
            action: "end",
            launch: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
        expect(codes(result)).toEqual(["review-pending"]);
    });

    it("stops on an open review whose file is unusable", () => {
        const result = next(reviewing(), {
            ...phaseTwo("x"),
            "reviews/phase-2-chk1.md": "## Verdict: MAYBE\n",
        });
        expect(result.next).toMatchObject({
            action: "stop",
            reason: "invalid review artifact: reviews/phase-2-chk1.md",
        });
        expect(codes(result)).toEqual(["format-invalid"]);
    });

    it("relaunches a review that ended incomplete with the same label", () => {
        const state = cycleState("review", {}, [
            reviewLaunch(),
            { ...reviewLaunch(), outcome: "incomplete" },
        ]);
        expect(next(state, phaseTwo("x")).next).toEqual({
            action: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("reuses a PENDING stub's label when no launch is recorded", () => {
        expect(
            next(cycleState("review"), {
                ...phaseTwo("x"),
                "reviews/phase-2-chk1.md": reviewFile("FAIL"),
                "reviews/phase-2-chk2.md": "## Verdict: PENDING\n",
            }).next,
        ).toEqual({ action: "review", phase: "2", label: "phase-2-chk2" });
    });

    it("launches a re-review with its checkpoint label", () => {
        const state = cycleState("re-review", {}, [
            { ...reviewLaunch(), verdict: "FAIL", outcome: "COMPLETE" },
        ]);
        expect(next(state, phaseTwo("x")).next).toEqual({
            action: "re-review",
            phase: "2",
            label: "phase-2-chk2",
        });
    });

    it("dispatches an open re-review launch with its existing label", () => {
        const state = cycleState("re-review", {}, [
            { ...reviewLaunch(), mode: "re-review" },
        ]);
        expect(
            next(state, {
                ...phaseTwo("x"),
                "reviews/phase-2-chk1.md": "## Verdict: PENDING\n",
            }).next,
        ).toEqual({
            action: "re-review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("relaunches an incomplete review with the same label when its file now has a verdict", () => {
        const state = cycleState("review", {}, [
            reviewLaunch(),
            { ...reviewLaunch(), outcome: "incomplete" },
        ]);
        expect(
            next(state, {
                ...phaseTwo("x"),
                "reviews/phase-2-chk1.md": reviewFile("PASS"),
            }).next,
        ).toEqual({ action: "review", phase: "2", label: "phase-2-chk1" });
    });

    it("advances a phase whose checkpoint passed", () => {
        const result = next(cycleState("advance"), phaseTwo("x"));
        expect(result.next).toEqual({ action: "advance", phase: "2" });
        expect(codes(result)).toEqual(["advance-pending"]);
    });
});

describe("nextLoopAction: repair", () => {
    it("launches a repair when none is open", () => {
        expect(next(cycleState("repair"), phaseTwo("x")).next).toEqual({
            action: "repair",
            phase: "2",
        });
    });

    it("relaunches an open repair", () => {
        expect(
            next(cycleState("repair", {}, [repairLaunch]), phaseTwo("x")).next,
        ).toEqual({ action: "repair", phase: "2" });
    });

    it("ends an open repair with a blocked step", () => {
        expect(
            next(cycleState("repair", {}, [repairLaunch]), phaseTwo("x", "!"))
                .next,
        ).toEqual({ action: "end", launch: "repair", phase: "2" });
    });
});

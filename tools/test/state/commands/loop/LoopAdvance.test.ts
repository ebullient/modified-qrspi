import { describe, expect, it } from "vitest";
import { statePath } from "../../fixtures.ts";
import {
    loopBlock,
    loopFixture,
    loopState,
    phaseId,
    phaseSteps,
    planTable,
    readyFiles,
} from "../../loop/fixtures.ts";

describe("loop --advance", () => {
    it.each([
        ["an unfinished phase", loopBlock("implement"), readyFiles()],
        [
            "a complete phase not yet reviewed",
            loopBlock("review"),
            readyFiles(phaseSteps("x")),
        ],
        [
            "a stopped loop",
            loopBlock("advance", { stoppedReason: "needs a human" }),
            readyFiles(phaseSteps("x")),
        ],
    ])("refuses %s", (_name, loop, files) => {
        expect(
            loopFixture({
                state: loopState({ phaseBaseSha: "abcdef0", loop }),
                files,
            }).loop.advance({}),
        ).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("advances a phase that passed review to the next phase in scope", () => {
        const state = loopState({
            currentStep: "implement",
            planPhase: phaseId("2"),
            phaseBaseSha: "abcdef0",
            commitMode: "step",
            loop: loopBlock("advance", {
                scope: "2..3",
                phases: [phaseId("2"), phaseId("3")],
            }),
        });
        const outcome = loopFixture({
            state,
            files: readyFiles(phaseSteps("x")),
        }).loop.advance({});
        expect(outcome.result).toMatchObject({
            action: "implement",
            phase: "3",
            state: {
                currentStep: "implement",
                planPhase: "3",
                phaseBaseSha: null,
                loop: {
                    phases: ["2", "3"],
                    phase: "3",
                    cycle: "implement",
                },
            },
        });
        expect(outcome.result?.state.commitMode).toBeUndefined();
    });

    it("uses persisted scope order after plan row order changes", () => {
        const state = loopState({
            loop: loopBlock("advance", {
                scope: "2,3",
                phases: [phaseId("2"), phaseId("3")],
            }),
        });
        const files = {
            ...readyFiles(phaseSteps("x")),
            "plan.md": planTable(
                "1 | Base | none",
                "3 | Later | 2",
                "2 | Feature | 1",
            ),
        };
        expect(
            loopFixture({ state, files }).loop.advance({}).result,
        ).toMatchObject({
            phase: "3",
            state: { loop: { phases: ["2", "3"] } },
        });
    });

    it("terminal advance keeps a done block and selects ready work outside scope", () => {
        const state = loopState({
            phaseBaseSha: "abcdef0",
            commitMode: "phase",
            loop: loopBlock("advance"),
        });
        const outcome = loopFixture({
            state,
            files: readyFiles(phaseSteps("x")),
        }).loop.advance({});
        expect(outcome.result).toMatchObject({
            action: "done",
            phase: "2",
            nextPhase: "3",
            state: {
                currentStep: "implement",
                planPhase: "3",
                phaseBaseSha: null,
                loop: { cycle: "done", phase: "2" },
            },
        });
        expect(outcome.result?.state.commitMode).toBeUndefined();
    });

    it("a repeated terminal advance is an exact no-op", () => {
        const built = loopFixture({
            state: loopState({ loop: loopBlock("advance") }),
            files: readyFiles(phaseSteps("x")),
        });
        const first = built.loop.advance({});
        expect(first.wrote).toBe(true);
        const afterFirst = built.stateFs.files.get(statePath);
        const second = built.loop.advance({});
        expect(second).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: { action: "done" },
        });
        expect(built.stateFs.files.get(statePath)).toBe(afterFirst);
    });
});

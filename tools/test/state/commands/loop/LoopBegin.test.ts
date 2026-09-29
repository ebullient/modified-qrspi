import { describe, expect, it } from "vitest";
import { now, statePath } from "../../fixtures.ts";
import {
    loopBlock,
    loopFixture,
    loopState,
    phaseId,
    phaseSteps,
    readyFiles,
    reviewFile,
} from "../../loop/fixtures.ts";

describe("loop --begin", () => {
    it("starts fresh implementation with the default mode and HEAD base", () => {
        const outcome = loopFixture().loop.begin({ action: "implement" });
        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: true,
            result: {
                action: "implement",
                phase: "2",
                commitMode: "phase",
                state: {
                    currentPhase: "execution",
                    currentStep: "implement",
                    planPhase: "2",
                    phaseBaseSha: "abcdef0",
                    commitMode: "phase",
                },
            },
        });
        expect(outcome.result?.state.history.at(-1)).toMatchObject({
            step: "implement",
            phase: "2",
            by: "autoloop",
            timestamp: now,
        });
    });

    it("uses an explicit mode for a fresh phase", () => {
        expect(
            loopFixture().loop.begin({
                action: "implement",
                commitMode: "step",
            }).result,
        ).toMatchObject({ commitMode: "step", state: { commitMode: "step" } });
    });

    it("retains the persisted mode and base on resume", () => {
        const state = loopState({
            currentStep: "implement",
            phaseBaseSha: "1234567",
            commitMode: "step",
        });
        const files = readyFiles(phaseSteps("~"));
        expect(
            loopFixture({
                state,
                files,
                status: [{ path: "src/work.ts" }],
            }).loop.begin({
                action: "implement",
                commitMode: "phase",
            }).result,
        ).toMatchObject({
            commitMode: "step",
            state: { phaseBaseSha: "1234567", commitMode: "step" },
        });
    });

    it("starts repair with the failed review path", () => {
        const state = loopState({
            currentStep: "checkpoint",
            loop: loopBlock("repair"),
            history: [
                { step: "plan", timestamp: now },
                {
                    step: "checkpoint",
                    timestamp: now,
                    phase: phaseId("2"),
                    label: "phase-2-chk1",
                    verdict: "FAIL",
                    outcome: "COMPLETE",
                    by: "autoloop",
                },
            ],
        });
        expect(
            loopFixture({ state }).loop.begin({ action: "repair" }),
        ).toMatchObject({
            result: {
                action: "repair",
                phase: "2",
                mode: "repair",
                review: "reviews/phase-2-chk1.md",
                state: {
                    currentStep: "implement",
                    loop: { cycle: "repair" },
                },
            },
        });
    });

    it("launches review with a checkpoint label and root-aware diff", () => {
        const state = loopState({
            currentStep: "implement",
            phaseBaseSha: "root",
            loop: loopBlock("review"),
        });
        const files = readyFiles(phaseSteps("x"));
        const outcome = loopFixture({ state, files }).loop.begin({
            action: "review",
        });
        expect(outcome.result).toMatchObject({
            action: "review",
            label: "phase-2-chk1",
            diff: "git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            state: { currentStep: "checkpoint", loop: { cycle: "review" } },
        });
        expect(outcome.result?.state.history.at(-1)).toMatchObject({
            step: "checkpoint",
            label: "phase-2-chk1",
            phase: "2",
            by: "autoloop",
        });
    });

    it("launches re-review with the next checkpoint label", () => {
        const state = loopState({
            currentStep: "implement",
            phaseBaseSha: "1234567",
            loop: loopBlock("re-review"),
            history: [
                { step: "plan" },
                {
                    step: "checkpoint",
                    phase: phaseId("2"),
                    label: "phase-2-chk1",
                    verdict: "FAIL",
                    outcome: "COMPLETE",
                },
            ],
        });
        expect(
            loopFixture({
                state,
                files: readyFiles(phaseSteps("x")),
            }).loop.begin({
                action: "re-review",
            }).result,
        ).toMatchObject({
            action: "re-review",
            label: "phase-2-chk2",
            diff: "git diff 1234567",
            state: { currentStep: "checkpoint", loop: { cycle: "re-review" } },
        });
        const result = loopFixture({
            state,
            files: readyFiles(phaseSteps("x")),
        }).loop.begin({ action: "re-review" }).result;
        expect(result?.state.history.at(-1)).toMatchObject({
            step: "checkpoint",
            mode: "re-review",
        });
    });

    it("refuses a launch that differs from read-only dispatch", () => {
        expect(loopFixture().loop.begin({ action: "repair" })).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("gives a begun phase with no base of its own a new base at HEAD", () => {
        const state = loopState({
            currentStep: "implement",
            planPhase: phaseId("2"),
            phaseBaseSha: null,
        });
        expect(
            loopFixture({
                state,
                files: readyFiles(phaseSteps("x", "~")),
                head: "fedcba9",
                status: [{ path: "src/work.ts" }],
            }).loop.begin({ action: "implement" }).result?.state,
        ).toMatchObject({ phaseBaseSha: "fedcba9" });
    });

    it("keeps a base the human set for the phase, as record implement --base does", () => {
        const state = loopState({
            currentStep: "implement",
            planPhase: phaseId("2"),
            phaseBaseSha: "1234567",
        });
        expect(
            loopFixture({ state, head: "fedcba9" }).loop.begin({
                action: "implement",
            }).result?.state,
        ).toMatchObject({ phaseBaseSha: "1234567" });
    });

    it("refuses to launch over a pending review artifact", () => {
        const files = {
            ...readyFiles(phaseSteps("x")),
            "reviews/phase-2-chk1.md": reviewFile("PASS"),
        };
        const state = loopState({
            currentStep: "checkpoint",
            loop: loopBlock("review"),
            history: [
                { step: "plan" },
                {
                    step: "checkpoint",
                    phase: phaseId("2"),
                    label: "phase-2-chk1",
                    by: "autoloop",
                },
            ],
        });
        expect(
            loopFixture({ state, files }).loop.begin({ action: "review" }),
        ).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("rejects commit mode outside implement", () => {
        expect(() =>
            loopFixture().loop.begin({ action: "repair", commitMode: "step" }),
        ).toThrow("--commit-mode");
    });

    it("dry-run returns launch state without writing", () => {
        const { loop, stateFs } = loopFixture();
        const before = stateFs.files.get(statePath);
        const outcome = loop.begin({ action: "implement", dryRun: true });
        expect(outcome.wrote).toBe(false);
        expect(outcome.result).toMatchObject({
            state: { phaseBaseSha: "abcdef0" },
        });
        expect(stateFs.files.get(statePath)).toBe(before);
    });
});

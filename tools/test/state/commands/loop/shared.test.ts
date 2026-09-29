import { describe, expect, it } from "vitest";
import {
    type LoopDecision,
    loopTransition,
    noChange,
    refuses,
    writes,
} from "../../../../src/state/commands/loop/shared.ts";
import type { State, StateView } from "../../../../src/state/types.ts";
import { loopFixture, loopState } from "../../loop/fixtures.ts";

interface TestResult {
    action: "written" | "unchanged";
    state: StateView;
}

function run(decide: (state: State | null) => LoopDecision<TestResult>) {
    const fixture = loopFixture();
    return {
        fixture,
        outcome: loopTransition(
            { services: fixture.services, context: fixture.context },
            {},
            decide,
        ),
    };
}

describe("loopTransition", () => {
    it("returns a write decision's payload with the saved state", () => {
        const { fixture, outcome } = run(() =>
            writes<TestResult>(loopState({ currentStep: "implement" }), {
                action: "written",
            }),
        );

        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: true,
            result: {
                action: "written",
                state: { currentStep: "implement" },
            },
        });
        expect(
            JSON.parse(fixture.stateFs.files.get("qrspi/f/state.json") ?? "{}")
                .currentStep,
        ).toBe("implement");
    });

    it("returns an unchanged decision's payload without writing", () => {
        const { fixture, outcome } = run(() =>
            noChange<TestResult>({ action: "unchanged" }),
        );
        const before = fixture.stateFs.files.get("qrspi/f/state.json");

        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: {
                action: "unchanged",
                state: { currentStep: "plan" },
            },
        });
        expect(fixture.stateFs.files.get("qrspi/f/state.json")).toBe(before);
    });

    it("returns a refusal without a result or write", () => {
        const { fixture, outcome } = run(() =>
            refuses<TestResult>({ code: "loop-refused", message: "stopped" }),
        );

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.result).toBeUndefined();
        expect(outcome.findings).toEqual([
            { code: "loop-refused", message: "stopped" },
        ]);
        expect(fixture.stateFs.files.get("qrspi/f/state.json")).toContain(
            '"currentStep":"plan"',
        );
    });
});

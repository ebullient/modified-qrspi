import { approachUndecidedFindings, newQuestionsFindings } from "../checks.ts";
import type { CommandOutcome, Finding, State, StateView } from "../types.ts";
import type { CommandInputs, RecordOptions } from "./inputs.ts";
import {
    initialState,
    reasonOf,
    recordStep,
    type StepTransition,
    writePlan,
} from "./transition.ts";

export type ShapeOptions = RecordOptions;

/**
 * `record shape`: records a Shape pass, or that Shape was skipped.
 * `approach.md` missing means Shape was skipped, which is not a finding.
 * Warns when `approach.md` has no filled-in Decision section, or
 * `research.md` has open New Questions.
 */
export function shapePlan({
    services,
    context,
}: CommandInputs): StepTransition<ShapeOptions> {
    const { workspace, clock } = services;

    return {
        warnings(): Finding[] {
            return [
                ...approachUndecidedFindings(workspace),
                ...newQuestionsFindings(workspace),
            ];
        },

        plan(state: State | null) {
            return writePlan({
                ...(state ?? initialState(context.feature)),
                currentStep: "shape",
            });
        },

        historyEntry(_state: State | null, options: ShapeOptions) {
            return {
                step: "shape",
                timestamp: clock.now(),
                ...reasonOf(options),
            };
        },
    };
}

export function recordShape(
    inputs: CommandInputs,
    options: ShapeOptions,
): CommandOutcome<StateView> {
    return recordStep(inputs, "shape", shapePlan(inputs), options);
}

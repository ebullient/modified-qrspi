import { Findings } from "../Findings.ts";
import type { CommandOutcome, State, StateView } from "../types.ts";
import type { CommandInputs, RecordOptions } from "./inputs.ts";
import {
    initialState,
    reasonOf,
    recordStep,
    type StepTransition,
    writePlan,
} from "./transition.ts";

export type InitOptions = RecordOptions;

/**
 * `record init`: creates a fresh `state.json`, or moves an existing one
 * back to `init`. Warns when `request.md` is missing.
 */
export function initPlan({
    services,
    context,
}: CommandInputs): StepTransition<InitOptions> {
    const { workspace, clock } = services;

    return {
        warnings() {
            return workspace.hasFile("request.md")
                ? []
                : [Findings.workspaceIncomplete("request.md")];
        },

        plan(state: State | null) {
            return writePlan(
                state === null
                    ? initialState(context.feature)
                    : { ...state, currentStep: "init" },
            );
        },

        historyEntry(_state: State | null, options: InitOptions) {
            return {
                step: "init",
                timestamp: clock.now(),
                ...reasonOf(options),
            };
        },
    };
}

export function recordInit(
    inputs: CommandInputs,
    options: InitOptions,
): CommandOutcome<StateView> {
    return recordStep(inputs, "init", initPlan(inputs), options);
}

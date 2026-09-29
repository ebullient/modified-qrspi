import type { CommandOutcome, StateView } from "../types.ts";
import { initPlan } from "./Init.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "./inputs.ts";
import { noopPlan, transition, writePlan } from "./transition.ts";

export interface DecisionOptions extends TransitionOptions {
    text: string;
}

/** `record done`: asserts the feature is finished. No position change or history entry; a no-op when already `completed: true`. */
export function recordDone(
    inputs: CommandInputs,
    options: TransitionOptions,
): CommandOutcome<StateView> {
    return transition(inputs, options, {
        startsAs: initPlan(inputs),
        plan(state) {
            if (state === null || state.completed === true) {
                return noopPlan();
            }
            return writePlan({ ...state, completed: true });
        },
    });
}

/** `record decision --text`: always appends to `decisions`; no position change or history entry. */
export function recordDecision(
    inputs: CommandInputs,
    options: DecisionOptions,
): CommandOutcome<StateView> {
    requireText(options.text, "--text");
    return transition(inputs, options, {
        startsAs: initPlan(inputs),
        plan(state) {
            if (state === null) return noopPlan();
            return writePlan({
                ...state,
                decisions: [...state.decisions, options.text],
            });
        },
    });
}

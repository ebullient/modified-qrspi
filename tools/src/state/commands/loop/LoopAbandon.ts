import { Findings } from "../../Findings.ts";
import type { CommandOutcome, State, StateView } from "../../types.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "../inputs.ts";
import { loopTransition, refuses, writes } from "./shared.ts";

export interface LoopAbandonOptions extends TransitionOptions {
    reason: string;
}

export interface LoopAbandonResult {
    action: "done";
    state: StateView;
}

/** Ends a loop the human no longer wants run; blockers stay for the human. */
export function loopAbandon(
    inputs: CommandInputs,
    options: LoopAbandonOptions,
): CommandOutcome<LoopAbandonResult> {
    requireText(options.reason, "--abandon");
    return loopTransition(inputs, options, (state) => {
        if (state?.loop === undefined || state.loop.cycle === "done") {
            return refuses(
                Findings.loopRefused("--abandon", "no loop is running"),
            );
        }
        const next: State = {
            ...state,
            decisions: [
                ...state.decisions,
                `loop --abandon: ${options.reason}`,
            ],
            loop: { ...state.loop, cycle: "done", stoppedReason: null },
            history: [
                ...state.history,
                {
                    step: state.currentStep,
                    timestamp: inputs.services.clock.now(),
                    reason: `abandoned: ${options.reason}`,
                },
            ],
        };
        return writes(next, { action: "done" });
    });
}

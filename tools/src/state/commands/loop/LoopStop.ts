import { Findings } from "../../Findings.ts";
import type { CommandOutcome, State, StateView } from "../../types.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "../inputs.ts";
import { loopTransition, refuses, writes } from "./shared.ts";

export interface LoopStopOptions extends TransitionOptions {
    reason: string;
}

export interface LoopStopResult {
    action: "acknowledge-required";
    state: StateView;
}

/** Interrupts a loop: a recorded stop that `loop --ok` acknowledges. */
export function loopStop(
    inputs: CommandInputs,
    options: LoopStopOptions,
): CommandOutcome<LoopStopResult> {
    requireText(options.reason, "--stop");
    return loopTransition(inputs, options, (state) => {
        if (state?.loop === undefined || state.loop.cycle === "done") {
            return refuses(
                Findings.loopRefused("--stop", "no loop is running"),
            );
        }
        const next: State = {
            ...state,
            loop: { ...state.loop, stoppedReason: options.reason },
            history: [
                ...state.history,
                {
                    step: state.currentStep,
                    timestamp: inputs.services.clock.now(),
                    reason: `stopped: ${options.reason}`,
                    outcome: "STOPPED",
                },
            ],
        };
        return writes(next, { action: "acknowledge-required" });
    });
}

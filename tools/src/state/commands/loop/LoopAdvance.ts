import { Findings } from "../../Findings.ts";
import { nextLoopAction } from "../../loop/LoopNext.ts";
import type { CommandOutcome, PhaseId, State, StateView } from "../../types.ts";
import type { CommandInputs, TransitionOptions } from "../inputs.ts";
import {
    type LoopDecision,
    loopTransition,
    noChange,
    refuses,
    writes,
} from "./shared.ts";

export type LoopAdvanceOptions = TransitionOptions;

export interface LoopAdvanceResult {
    action: "implement" | "done";
    phase: PhaseId;
    nextPhase?: PhaseId | null;
    state: StateView;
}

/** Moves a phase that passed review to the next phase in the persisted scope, or completes that scope. */
export function loopAdvance(
    inputs: CommandInputs,
    options: LoopAdvanceOptions,
): CommandOutcome<LoopAdvanceResult> {
    return loopTransition(inputs, options, (state) =>
        decideAdvance(inputs, state),
    );
}

function decideAdvance(
    { services }: CommandInputs,
    state: State | null,
): LoopDecision<LoopAdvanceResult> {
    if (state?.loop === undefined) {
        return refuses(
            Findings.loopRefused("--advance", "no loop has started"),
        );
    }
    const { loop } = state;
    if (loop.cycle === "done") {
        return noChange({
            action: "done",
            phase: loop.phase,
            nextPhase: state.planPhase ?? null,
        });
    }
    const expected = nextLoopAction(
        state,
        services.workspace,
        services.git,
    ).next;
    if (expected?.action !== "advance") {
        return refuses(
            Findings.loopRefused(
                "--advance",
                `report recommends ${expected?.action ?? "no action"}`,
            ),
        );
    }

    const following = loop.phases[loop.phases.indexOf(loop.phase) + 1];
    const { commitMode: _commitMode, ...withoutCommitMode } = state;
    if (following !== undefined) {
        const next: State = {
            ...withoutCommitMode,
            currentStep: "implement",
            planPhase: following,
            phaseBaseSha: null,
            loop: {
                ...loop,
                phase: following,
                cycle: "implement",
                stoppedReason: null,
            },
        };
        return writes(next, {
            action: "implement",
            phase: following,
        });
    }

    const nextPhase = services.workspace.firstReadyPhase(loop.phases);
    const next: State = {
        ...withoutCommitMode,
        currentStep: "implement",
        planPhase: nextPhase,
        phaseBaseSha: null,
        loop: { ...loop, cycle: "done" },
    };
    return writes(next, {
        action: "done",
        phase: loop.phase,
        nextPhase,
    });
}

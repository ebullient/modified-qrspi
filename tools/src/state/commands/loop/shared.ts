import { UsageError } from "../../errors.ts";
import { type LoopLaunch, loopLaunches } from "../../loop/LoopNext.ts";
import type { CommandOutcome, Finding, State, StateView } from "../../types.ts";
import type { CommandInputs, TransitionOptions } from "../inputs.ts";
import { transition } from "../transition.ts";

export const loopActors = ["autoloop", "runner"] as const;

export type LoopActor = (typeof loopActors)[number];

export type { LoopLaunch };

export function validateLaunch(launch: string, flag: string): void {
    if (!loopLaunches.includes(launch as LoopLaunch)) {
        throw new UsageError(
            `${flag} must be one of ${loopLaunches.join(", ")}`,
        );
    }
}

export function validateActor(by: string | undefined): void {
    if (by !== undefined && !loopActors.includes(by as LoopActor)) {
        throw new UsageError(`--by must be ${loopActors.join(" or ")}`);
    }
}

/** The unattended actor recorded in history; `autoloop` unless `--by` names another. */
export function actorOf(options: { by?: LoopActor }): LoopActor {
    return options.by ?? "autoloop";
}

/** What a loop action decides: refuse (nothing written), change nothing, or write `next`. */
export type LoopDecision<Result extends { state: StateView }> =
    | { kind: "refuse"; findings: Finding[] }
    | { kind: "unchanged"; result: Omit<Result, "state"> }
    | { kind: "write"; next: State; result: Omit<Result, "state"> };

/** A loop refusal: nothing is written. */
export function refuses<Result extends { state: StateView }>(
    finding: Finding,
): LoopDecision<Result> {
    return { kind: "refuse", findings: [finding] };
}

/** The action changes nothing (recovery is still written). */
export function noChange<Result extends { state: StateView }>(
    result: Omit<Result, "state">,
): LoopDecision<Result> {
    return { kind: "unchanged", result };
}

/** The action writes `next` and reports `result` carrying the saved state. */
export function writes<Result extends { state: StateView }>(
    next: State,
    result: Omit<Result, "state">,
): LoopDecision<Result> {
    return { kind: "write", next, result };
}

/** A loop action's decision mapped to the shared transition result. */
export function loopTransition<Result extends { state: StateView }>(
    inputs: CommandInputs,
    options: TransitionOptions,
    decide: (state: State | null) => LoopDecision<Result>,
): CommandOutcome<Result> {
    return transition<TransitionOptions, Result>(inputs, options, {
        plan(state) {
            const decision = decide(state);
            switch (decision.kind) {
                case "refuse":
                    return { kind: "stop", findings: decision.findings };
                case "unchanged":
                    return {
                        kind: "noop",
                        result: (view) =>
                            ({ ...decision.result, state: view }) as Result,
                    };
                case "write":
                    return {
                        kind: "write",
                        next: decision.next,
                        result: (view) =>
                            ({ ...decision.result, state: view }) as Result,
                    };
            }
        },
    });
}

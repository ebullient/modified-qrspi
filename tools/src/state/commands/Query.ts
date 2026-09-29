import { UsageError } from "../errors.ts";
import { Findings } from "../Findings.ts";
import type { CommandOutcome, Finding, State, StateView } from "../types.ts";
import type { CommandInputs, RecordOptions } from "./inputs.ts";
import {
    initialState,
    reasonOf,
    recordStep,
    type StepTransition,
    writePlan,
} from "./transition.ts";

export const queryModes = ["initial", "refinement", "regeneration"] as const;

export type QueryMode = (typeof queryModes)[number];

export interface QueryOptions extends RecordOptions {
    mode: QueryMode;
}

/** `record query`: records a Query pass. Warns when `queries.md` is missing. */
export function queryPlan({
    services,
    context,
}: CommandInputs): StepTransition<QueryOptions> {
    const { workspace, clock } = services;

    return {
        warnings(): Finding[] {
            return workspace.hasFile("queries.md")
                ? []
                : [Findings.workspaceIncomplete("queries.md")];
        },

        plan(state: State | null) {
            return writePlan({
                ...(state ?? initialState(context.feature)),
                currentStep: "query",
            });
        },

        historyEntry(_state: State | null, options: QueryOptions) {
            return {
                step: "query",
                timestamp: clock.now(),
                mode: options.mode,
                ...reasonOf(options),
            };
        },
    };
}

export function validateQueryOptions(options: QueryOptions): void {
    if (!queryModes.includes(options.mode)) {
        throw new UsageError(`--mode must be one of ${queryModes.join(", ")}`);
    }
}

export function recordQuery(
    inputs: CommandInputs,
    options: QueryOptions,
): CommandOutcome<StateView> {
    return recordStep(
        inputs,
        "query",
        queryPlan(inputs),
        options,
        validateQueryOptions,
    );
}

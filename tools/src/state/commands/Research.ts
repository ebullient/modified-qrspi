import { newQuestionsFindings } from "../checks.ts";
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

export type ResearchOptions = RecordOptions;

/**
 * `record research`: records a Research pass. Warns when `research.md`
 * is missing or has open New Questions.
 */
export function researchPlan({
    services,
    context,
}: CommandInputs): StepTransition<ResearchOptions> {
    const { workspace, clock } = services;

    return {
        warnings(): Finding[] {
            if (!workspace.hasFile("research.md")) {
                return [Findings.workspaceIncomplete("research.md")];
            }
            return newQuestionsFindings(workspace);
        },

        plan(state: State | null) {
            return writePlan({
                ...(state ?? initialState(context.feature)),
                currentStep: "research",
            });
        },

        historyEntry(_state: State | null, options: ResearchOptions) {
            return {
                step: "research",
                timestamp: clock.now(),
                ...reasonOf(options),
            };
        },
    };
}

export function recordResearch(
    inputs: CommandInputs,
    options: ResearchOptions,
): CommandOutcome<StateView> {
    return recordStep(inputs, "research", researchPlan(inputs), options);
}

import type { Workspace } from "../../workspace/Workspace.ts";
import {
    approachUndecidedFindings,
    newQuestionsFindings,
    openQuestionsFindings,
} from "../checks.ts";
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

export interface SpecOptions extends RecordOptions {
    mode?: "revision";
}

/**
 * `record spec`: records a Spec pass. `--mode revision` records the pass
 * as a revision instead of an initial one.
 */
export function specPlan({
    services,
    context,
}: CommandInputs): StepTransition<SpecOptions> {
    const { workspace, clock } = services;

    return {
        warnings(): Finding[] {
            return definitionWarnings(workspace);
        },

        plan(state: State | null) {
            return writePlan({
                ...(state ?? initialState(context.feature)),
                currentStep: "spec",
            });
        },

        historyEntry(_state: State | null, options: SpecOptions) {
            return {
                step: "spec",
                timestamp: clock.now(),
                ...(options.mode !== undefined ? { mode: options.mode } : {}),
                ...reasonOf(options),
            };
        },
    };
}

/**
 * What `spec` and `plan` warn about: `spec.md` missing, open Open
 * Questions in `request.md`, open New Questions in `research.md`, or
 * `approach.md` with no filled-in Decision section.
 */
export function definitionWarnings(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];
    if (!workspace.hasFile("spec.md")) {
        findings.push(Findings.workspaceIncomplete("spec.md"));
    }
    findings.push(
        ...openQuestionsFindings(workspace),
        ...newQuestionsFindings(workspace),
        ...approachUndecidedFindings(workspace),
    );
    return findings;
}

/** `--mode revision` is the only mode, and it requires `--reason`. */
export function validateRevisionOptions(options: {
    mode?: string;
    reason?: string;
}): void {
    if (options.mode === undefined) return;
    if (options.mode !== "revision") {
        throw new UsageError("--mode must be revision");
    }
    if (options.reason === undefined) {
        throw new UsageError("--mode revision requires --reason <text>");
    }
}

export function recordSpec(
    inputs: CommandInputs,
    options: SpecOptions,
): CommandOutcome<StateView> {
    return recordStep(
        inputs,
        "spec",
        specPlan(inputs),
        options,
        validateRevisionOptions,
    );
}

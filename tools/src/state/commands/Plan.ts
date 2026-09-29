import type { Workspace } from "../../workspace/Workspace.ts";
import {
    missingPhaseFileFindings,
    phaseFormatFindings,
    planFormatFindings,
} from "../checks.ts";
import { Findings } from "../Findings.ts";
import type { CommandOutcome, Finding, State, StateView } from "../types.ts";
import type { CommandInputs } from "./inputs.ts";
import {
    definitionWarnings,
    type SpecOptions,
    validateRevisionOptions,
} from "./Spec.ts";
import {
    initialState,
    reasonOf,
    recordStep,
    type StepTransition,
    stopPlan,
    writePlan,
} from "./transition.ts";

export type PlanOptions = SpecOptions;

/** `record plan`: sets `planPhase` to the first ready phase. A revision after implementation began clears the phase base and commit mode and records a decision. */
export function planPlan({
    services,
    context,
}: CommandInputs): StepTransition<PlanOptions> {
    const { workspace, clock } = services;

    return {
        plan(state: State | null, options: PlanOptions) {
            const planTable = workspace.plan();
            if (planTable === null) {
                return stopPlan([Findings.workspaceIncomplete("plan.md")]);
            }

            const findings: Finding[] = planFormatFindings(workspace);
            for (const row of planTable.rows) {
                findings.push(
                    ...missingPhaseFileFindings(workspace, row.phase),
                );
            }
            if (findings.length > 0) {
                return stopPlan(findings);
            }

            const base = state ?? initialState(context.feature);
            const next: State = {
                ...base,
                currentStep: "plan",
                planPhase: workspace.firstReadyPhase(),
            };
            if (
                options.mode === "revision" &&
                implementationBegan(base, workspace)
            ) {
                next.phaseBaseSha = null;
                delete next.commitMode;
                next.decisions = [
                    ...base.decisions,
                    `Plan revised after implementation began: ${options.reason}`,
                ];
            }
            return writePlan(next);
        },

        warnings(): Finding[] {
            const findings = definitionWarnings(workspace);
            findings.push(...phaseFormatFindings(workspace, "plan-rows"));
            return findings;
        },

        historyEntry(_state: State | null, options: PlanOptions) {
            return {
                step: "plan",
                timestamp: clock.now(),
                ...(options.mode !== undefined ? { mode: options.mode } : {}),
                ...reasonOf(options),
            };
        },
    };
}

export function recordPlan(
    inputs: CommandInputs,
    options: PlanOptions,
): CommandOutcome<StateView> {
    return recordStep(
        inputs,
        "plan",
        planPlan(inputs),
        options,
        validateRevisionOptions,
    );
}

/** Implementation began: an `implement` history entry, a recorded `phaseBaseSha`, or a listed phase with a begun step. */
function implementationBegan(state: State, workspace: Workspace): boolean {
    return (
        state.history.some(
            (entry) => entry.step === "implement" && entry.phase !== undefined,
        ) ||
        (state.phaseBaseSha ?? null) !== null ||
        (workspace.plan()?.rows ?? []).some((row) =>
            workspace.phaseBegun(row.phase),
        )
    );
}

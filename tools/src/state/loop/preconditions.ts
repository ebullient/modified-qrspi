import type { Workspace } from "../../workspace/Workspace.ts";
import {
    approachUndecidedFindings,
    blockersFindings,
    dirtyTreeFindings,
    missingPhaseFileFindings,
    phaseFormatFindings,
    planFormatFindings,
} from "../checks.ts";
import { Findings } from "../Findings.ts";
import type { GitRunner } from "../ports.ts";
import { stepArtifacts } from "../steps.ts";
import {
    type Finding,
    isDefinitionStep,
    type PhaseId,
    type State,
    stateFileName,
    type WorkflowStep,
    workflowOrder,
} from "../types.ts";

export interface LoopPreconditionInput {
    state: State | null;
    workspace: Workspace;
    git: GitRunner;
    phases: readonly PhaseId[];
}

/** All strict entry checks for unattended loop execution. */
export function loopPreconditions(input: LoopPreconditionInput): Finding[] {
    const { state, workspace, git, phases } = input;
    if (state === null) {
        return [
            Findings.stateInvalid(
                stateFileName,
                "recover the workflow position before starting a loop",
            ),
        ];
    }

    return [
        ...artifactPreconditions(state, workspace),
        ...planFormatFindings(workspace),
        ...phaseFormatFindings(workspace, phases, true),
        ...approachUndecidedFindings(workspace),
        ...dirtyTreeFindings(git),
        ...blockersFindings(state),
        ...planCurrentPrecondition(state),
        ...dependencyOrderPrecondition(workspace, phases),
    ];
}

/**
 * The entry checks `report` does not already make: every precondition
 * except the ones its cross-checks cover (`plan.md` and phase-file format,
 * approach, dirty tree, blockers). `loopPreconditions` is these plus those.
 */
export function startOnlyPreconditions(
    state: State,
    workspace: Workspace,
    phases: readonly PhaseId[],
): Finding[] {
    return [
        ...artifactPreconditions(state, workspace),
        ...phases.flatMap((phase) =>
            missingPhaseFileFindings(workspace, phase),
        ),
        ...planCurrentPrecondition(state),
        ...dependencyOrderPrecondition(workspace, phases),
    ];
}

function artifactPreconditions(state: State, workspace: Workspace): Finding[] {
    const findings: Finding[] = [];
    for (const [file, step] of stepArtifacts.filter(
        ([, step]) => step === "spec" || step === "plan",
    )) {
        if (!workspace.hasFile(file)) {
            findings.push(Findings.workspaceIncomplete(file));
        } else if (before(state.currentStep, step)) {
            findings.push(Findings.staleDownstream(step));
        }
    }
    return findings;
}

function planCurrentPrecondition(state: State): Finding[] {
    const last = state.history.findLast((entry) =>
        isDefinitionStep(entry.step),
    );
    return last !== undefined && last.step !== "plan"
        ? [Findings.planNotCurrent(last.step)]
        : [];
}

function dependencyOrderPrecondition(
    workspace: Workspace,
    phases: readonly PhaseId[],
): Finding[] {
    const rows = workspace.plan()?.rows ?? [];
    const positions = new Map(phases.map((phase, index) => [phase, index]));
    const findings: Finding[] = [];
    for (const phase of phases) {
        const dependentIndex = positions.get(phase) ?? -1;
        const row = rows.find((candidate) => candidate.phase === phase);
        for (const dependency of row?.dependsOn ?? []) {
            if (workspace.phaseComplete(dependency)) continue;
            const dependencyIndex = positions.get(dependency);
            if (
                dependencyIndex === undefined ||
                dependencyIndex >= dependentIndex
            ) {
                findings.push(Findings.dependencyIncomplete(phase, dependency));
            }
        }
    }
    return findings;
}

function before(
    current: State["currentStep"],
    required: WorkflowStep,
): boolean {
    const step = current === "checkpoint" ? "implement" : current;
    return workflowOrder.indexOf(step) < workflowOrder.indexOf(required);
}

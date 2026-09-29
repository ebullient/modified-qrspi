import {
    baseNotAncestorFindings,
    dirtyTreeFindings,
    missingPhaseFileFindings,
} from "../checks.ts";
import { UsageError } from "../errors.ts";
import { Findings } from "../Findings.ts";
import { isPhaseId } from "../ids.ts";
import { isFreshPhase, needsBase, resolveCommitMode } from "../loop/base.ts";
import type { GitRunner } from "../ports.ts";
import {
    type CommandOutcome,
    type CommitMode,
    commitModes,
    type Finding,
    type PhaseId,
    type State,
    type StateView,
} from "../types.ts";
import type { CommandInputs, RecordOptions } from "./inputs.ts";
import {
    initialState,
    reasonOf,
    recordStep,
    type StepTransition,
    stopPlan,
    writePlan,
} from "./transition.ts";

export interface ImplementOptions extends RecordOptions {
    phase: string;
    commitMode?: CommitMode;
    /** A commit-ish to use as the phase base instead of the default rule. */
    base?: string;
}

/** `record implement --phase <id>`: starts or resumes a phase. `--base` sets the base; otherwise it is kept only when resuming the active phase, and HEAD elsewhere. */
export function implementPlan({
    services,
    context,
}: CommandInputs): StepTransition<ImplementOptions> {
    const { workspace, git, clock } = services;

    return {
        plan(state: State | null, options: ImplementOptions) {
            const plan = workspace.plan();
            if (plan === null) {
                return stopPlan([Findings.workspaceIncomplete("plan.md")]);
            }
            if (!plan.rows.some((row) => row.phase === options.phase)) {
                return stopPlan([Findings.phaseNotInPlan(options.phase)]);
            }
            const findings = missingPhaseFileFindings(workspace, options.phase);
            if (findings.length > 0) {
                return stopPlan(findings);
            }
            const base = state ?? initialState(context.feature);
            const fresh = isFreshPhase(state, workspace, options.phase);
            return writePlan({
                ...base,
                currentStep: "implement",
                planPhase: options.phase as PhaseId,
                commitMode: resolveCommitMode({
                    state,
                    fresh,
                    explicit: options.commitMode,
                    explicitWinsWhenKept: true,
                }),
                phaseBaseSha:
                    options.base ??
                    (needsBase(state, options.phase)
                        ? git.head()
                        : base.phaseBaseSha),
            });
        },

        warnings(state: State | null, options: ImplementOptions): Finding[] {
            const rows = workspace.plan()?.rows ?? [];
            const row = rows.find((r) => r.phase === options.phase);
            if (row === undefined) return [];

            const findings: Finding[] = [];
            if (workspace.phaseComplete(row.phase)) {
                findings.push(Findings.phaseComplete(row.phase));
            }
            for (const dependency of row.dependsOn) {
                if (!workspace.phaseComplete(dependency)) {
                    findings.push(
                        Findings.dependencyIncomplete(row.phase, dependency),
                    );
                }
            }
            const { base } = options;
            if (isFreshPhase(state, workspace, options.phase)) {
                findings.push(...dirtyTreeFindings(git));
            } else if (base === undefined && needsBase(state, options.phase)) {
                findings.push(Findings.phaseBaseReset(row.phase));
            }
            const kept =
                base ??
                (needsBase(state, options.phase) ? null : state?.phaseBaseSha);
            findings.push(...baseNotAncestorFindings(git, kept));
            return findings;
        },

        historyEntry(_state: State | null, options: ImplementOptions) {
            return {
                step: "implement",
                timestamp: clock.now(),
                mode: "start",
                phase: options.phase as PhaseId,
                ...reasonOf(options),
            };
        },
    };
}

/** `record implement`: validates the options and resolves `--base` before the transition. */
export function recordImplement(
    inputs: CommandInputs,
    options: ImplementOptions,
): CommandOutcome<StateView> {
    validateImplementOptions(options);
    return recordStep(
        inputs,
        "implement",
        implementPlan(inputs),
        resolveBase(inputs.services.git, options),
    );
}

/** `options` with `--base` resolved to the commit it names. */
function resolveBase(
    git: GitRunner,
    options: ImplementOptions,
): ImplementOptions {
    if (options.base === undefined) return options;
    const resolved = git.resolve(options.base);
    if (resolved === null) {
        throw new UsageError(`--base "${options.base}" does not name a commit`);
    }
    return { ...options, base: resolved };
}

function validateImplementOptions(options: ImplementOptions): void {
    if (!isPhaseId(options.phase)) {
        throw new UsageError(
            `--phase must be a phase id such as 7 or 7a, not "${options.phase}"`,
        );
    }
    validateCommitMode(options.commitMode);
}

/** Rejects a `--commit-mode` that is not one of `commitModes`; absent is fine. */
export function validateCommitMode(commitMode: string | undefined): void {
    if (
        commitMode !== undefined &&
        !commitModes.includes(commitMode as CommitMode)
    ) {
        throw new UsageError(
            `--commit-mode must be ${commitModes.join(" or ")}`,
        );
    }
}

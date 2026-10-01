import {
    DependencyCycleError,
    UnknownPhaseError,
} from "../workspace/PlanTable.ts";
import { NoActivePhaseError, type Step } from "../workspace/Workspace.ts";
import type { CommandHelp } from "./Help.ts";
import { type CommandResult, ok, warn } from "./Result.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

export const help: CommandHelp = {
    name: "status",
    summary: "Read-only: implementation/review/loop facts. Never writes.",
    flags: [...commonOptions],
};

export type StatusOpts = {
    feature: string;
    project: string;
};

/**
 * current.step's derivation order: parked first, then
 * workspace.deriveStep()'s own artifact-presence walk. workspace knows
 * nothing about parked — that's status's own layer on top, read from
 * history.jsonl independently.
 */
export async function run(
    opts: StatusOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { workspace, loopState, history } = resolveServices(
        root,
        opts.project,
        services,
    );

    const parked = await history.isParked();
    const current: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const findings: { code: string; message: string }[] = [];

    let step: Step | "parked";
    if (parked) {
        step = "parked";
    } else {
        step = await workspace.deriveStep();
    }
    current.step = step;

    // DependencyCycleError/UnknownPhaseError mean plan.md's Depends On
    // graph is broken — findActivePhase() needs it to pick the active
    // row, so that's the one place status can't answer current.phase.
    // loopState.status() never touches the graph (it reads phase-file
    // markers directly, not dependenciesSatisfied), so loop.*/next.action
    // stay available even when the graph itself is broken.
    if (step === "implement") {
        try {
            const active = await workspace.findActivePhase();
            current.phase = active.phase;
            current.planProgress = active.planProgress;

            if (active.staleInput) {
                findings.push({
                    code: "stale-input",
                    message: `${active.staleInput.phaseFile} predates spec.md (phase file ${active.staleInput.phaseFileMtime.toISOString()}, spec.md ${active.staleInput.specMtime.toISOString()}).`,
                });
            }
        } catch (err) {
            if (err instanceof NoActivePhaseError) {
                // Every incomplete row is blocked on an unsatisfied
                // dependency: current.phase/planProgress stay absent,
                // same as any other state with no phase in progress.
                findings.push({
                    code: "all-phases-blocked",
                    message: `Every incomplete phase is blocked on an unsatisfied dependency (${err.blockedPhases.join(", ")}).`,
                });
            } else if (
                err instanceof DependencyCycleError ||
                err instanceof UnknownPhaseError
            ) {
                findings.push({
                    code: "plan-unreadable",
                    message: err.message,
                });
            } else {
                throw err;
            }
        }
    }

    const loopStatus = await loopState.status();
    let loop: Record<string, unknown> | undefined;
    if (loopStatus) {
        const { action, label, diff, review, ...rest } = loopStatus;
        loop = rest;
        next.action = action;
        next.label = label;
        next.diff = diff;
        next.review = review;
    } else if (current.phase) {
        next.label = await workspace.nextLabel("review", {
            phase: current.phase as string,
        });
    }

    const fields = {
        current,
        ...(Object.keys(next).length > 0 ? { next } : {}),
        ...(loop ? { loop } : {}),
    };
    return findings.length > 0 ? warn(fields, findings) : ok(fields);
}

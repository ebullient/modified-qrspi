import { blockedSteps, inProgressSteps } from "../../workspace/PhaseFile.ts";
import { isPendingStub, verdictOf } from "../../workspace/ReviewArtifact.ts";
import { reviewPath, type Workspace } from "../../workspace/Workspace.ts";
import {
    baseNotAncestorFindings,
    blockersFindings,
    dirtyTreeFindings,
} from "../checks.ts";
import { Findings } from "../Findings.ts";
import type { GitRunner } from "../ports.ts";
import { ReviewLabels } from "../ReviewLabels.ts";
import type {
    Finding,
    HistoryEntry,
    LoopBlock,
    LoopCycle,
    PhaseId,
    State,
} from "../types.ts";
import { isImplementerLaunch } from "./helpers.ts";

/** An unattended launch: `loop --begin` starts one and `loop --end` records its outcome. */
export const loopLaunches = [
    "implement",
    "review",
    "repair",
    "re-review",
] as const;

export type LoopLaunch = (typeof loopLaunches)[number];

export type LoopAction =
    | {
          action: "acknowledge-required";
          reason: string | null;
          blockers: string[];
      }
    | { action: "done" }
    | { action: "stop"; reason: string }
    | { action: "advance"; phase: PhaseId }
    | { action: "implement" | "repair"; phase: PhaseId }
    | { action: "review" | "re-review"; phase: PhaseId; label: string }
    | { action: "end"; launch: LoopLaunch; phase: PhaseId; label?: string };

export interface LoopNextResult {
    next: LoopAction | null;
    findings: Finding[];
}

/** A launch whose begin entry has no end entry after it. */
export interface PendingLaunch {
    launch: LoopLaunch;
    label?: string;
}

/**
 * Read-only resume dispatch for an existing loop block. Findings include
 * the ones `report`'s cross-checks also make (blockers, base not an
 * ancestor, dirty tree, an unusable review); `report` passes
 * `withChecks: false` to get the loop's own findings only.
 */
export function nextLoopAction(
    state: State,
    workspace: Workspace,
    git: GitRunner,
    { withChecks = true }: { withChecks?: boolean } = {},
): LoopNextResult {
    const checks = (findings: Finding[]): Finding[] =>
        withChecks ? findings : [];
    const { loop } = state;
    if (loop === undefined) return { next: null, findings: [] };
    if (loop.cycle === "done") {
        return { next: { action: "done" }, findings: [] };
    }

    const stoppedFindings =
        loop.stoppedReason !== null
            ? [Findings.loopStopped(loop.stoppedReason)]
            : [];
    const blockers = blockersFindings(state);
    if (stoppedFindings.length + blockers.length > 0) {
        return {
            next: {
                action: "acknowledge-required",
                reason: loop.stoppedReason,
                blockers: [...state.blockers],
            },
            findings: [...stoppedFindings, ...checks(blockers)],
        };
    }

    const [notAncestor] = baseNotAncestorFindings(git, state.phaseBaseSha);
    if (notAncestor !== undefined) {
        return {
            next: stop(notAncestor),
            findings: checks([notAncestor]),
        };
    }
    const dirty = dirtyTreeFindings(git);
    if (dirty.length > 0 && !allowsPartialWork(loop, workspace)) {
        return { next: stop(dirty[0] as Finding), findings: checks(dirty) };
    }

    const pending = pendingLaunch(state.history, loop);
    const result =
        pending === null
            ? dispatchCycle(state, loop, workspace, loop.cycle)
            : dispatchPending(state, pending, loop, workspace, withChecks);
    return { ...result, findings: [...checks(dirty), ...result.findings] };
}

/** The loop's launch and end entries for `phase`, oldest first. */
export function launchEntries(
    history: readonly HistoryEntry[],
    phase: PhaseId,
): HistoryEntry[] {
    return history.filter(
        (entry) =>
            entry.by !== undefined &&
            entry.phase === phase &&
            (entry.step === "implement" || entry.step === "checkpoint"),
    );
}

/** The launch kind encoded by a history begin entry. */
export function launchKind(entry: HistoryEntry): LoopLaunch | null {
    if (entry.step === "checkpoint") {
        return entry.mode === "re-review" ? "re-review" : "review";
    }
    if (entry.step === "implement") {
        return entry.mode === "repair" ? "repair" : "implement";
    }
    return null;
}

/** The loop's latest launch for its phase, when no end entry follows it. */
export function pendingLaunch(
    history: readonly HistoryEntry[],
    loop: LoopBlock,
): PendingLaunch | null {
    const latest = launchEntries(history, loop.phase).at(-1);
    if (latest === undefined || latest.outcome !== undefined) return null;
    const launch = launchKind(latest);
    if (launch === null) return null;
    return {
        launch,
        ...(latest.label !== undefined ? { label: latest.label } : {}),
    };
}

/** Ends a pending launch whose output is on disk, relaunches it, or stops on an unusable review. */
function dispatchPending(
    state: State,
    { launch, label }: PendingLaunch,
    loop: LoopBlock,
    workspace: Workspace,
    withChecks: boolean,
): LoopNextResult {
    const { phase } = loop;
    if (isImplementerLaunch(launch)) {
        const phaseFile = workspace.phaseFile(phase);
        const blocked =
            phaseFile !== null && blockedSteps(phaseFile).length > 0;
        const finished =
            launch === "implement" && workspace.phaseComplete(phase);
        return {
            next:
                blocked || finished
                    ? { action: "end", launch, phase }
                    : { action: launch, phase },
            findings: [],
        };
    }

    const reviewLabel = label ?? pendingLabel(state, phase, workspace);
    const review = workspace.review(reviewLabel);
    if (review === null || isPendingStub(review)) {
        return {
            next: { action: launch, phase, label: reviewLabel },
            findings: [],
        };
    }
    if (review.kind === "complete") {
        return {
            next: { action: "end", launch, phase, label: reviewLabel },
            findings: [Findings.reviewPending(reviewLabel)],
        };
    }
    const file = reviewPath(reviewLabel);
    const finding =
        verdictOf(review) === null
            ? Findings.reviewVerdictUnclear(file)
            : Findings.reviewTableMalformed(file, review.reason);
    return {
        next: { action: "stop", reason: `invalid review artifact: ${file}` },
        findings: withChecks ? [finding] : [],
    };
}

function dispatchCycle(
    state: State,
    loop: LoopBlock,
    workspace: Workspace,
    cycle: Exclude<LoopCycle, "done">,
): LoopNextResult {
    const { phase } = loop;
    switch (cycle) {
        case "implement":
            return {
                next: workspace.phaseComplete(phase)
                    ? {
                          action: "review",
                          phase,
                          label: pendingLabel(state, phase, workspace),
                      }
                    : { action: "implement", phase },
                findings: [],
            };
        case "review":
        case "re-review":
            return {
                next: {
                    action: cycle,
                    phase,
                    label: pendingLabel(state, phase, workspace),
                },
                findings: [],
            };
        case "repair":
            return { next: { action: "repair", phase }, findings: [] };
        case "advance":
            return {
                next: { action: "advance", phase },
                findings: [Findings.advancePending(phase)],
            };
    }
}

/**
 * The checkpoint label a review of `phase` uses next: the label of a review
 * launched and not finished, then the phase's PENDING stub, then the first
 * unused label.
 */
export function pendingLabel(
    state: State,
    phase: PhaseId,
    workspace: Workspace,
): string {
    const unfinished = unfinishedReview(state.history, phase);
    if (unfinished !== null) return unfinished;
    const newest = workspace.newestReview(`phase-${phase}`, "checkpoint");
    if (newest !== null && isPendingStub(workspace.review(newest))) {
        return newest;
    }
    return new ReviewLabels(workspace.reviewLabels(), state.history).checkpoint(
        phase,
    );
}

/** The phase's latest checkpoint label when no verdict was recorded for it. */
export function unfinishedReview(
    history: readonly HistoryEntry[],
    phase: PhaseId,
): string | null {
    const latest = history.findLast(
        (entry) => entry.step === "checkpoint" && entry.phase === phase,
    );
    return latest?.label !== undefined && latest.verdict === undefined
        ? latest.label
        : null;
}

function stop(finding: Finding): LoopAction {
    return { action: "stop", reason: finding.message };
}

function allowsPartialWork(loop: LoopBlock, workspace: Workspace): boolean {
    if (loop.cycle === "implement") {
        const phaseFile = workspace.phaseFile(loop.phase);
        return phaseFile !== null && inProgressSteps(phaseFile).length === 1;
    }
    if (loop.cycle !== "repair") return false;
    const newest = workspace.newestReview(`phase-${loop.phase}`, "checkpoint");
    return newest !== null && verdictOf(workspace.review(newest)) === "FAIL";
}

import { reviewPath, type Workspace } from "../../../workspace/Workspace.ts";
import { Findings } from "../../Findings.ts";
import { isFinalLabel, isPhaseReviewLabel } from "../../ids.ts";
import { conditionsOf, historySinceStop, passes } from "../../loop/helpers.ts";
import {
    pendingLabel,
    pendingLaunch,
    unfinishedReview,
} from "../../loop/LoopNext.ts";
import { reviewerOutcome } from "../../loop/outcomes.ts";
import type {
    CommandOutcome,
    HistoryEntry,
    LoopBlock,
    LoopCondition,
    PhaseId,
    State,
    StateView,
} from "../../types.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "../inputs.ts";
import {
    type LoopDecision,
    loopTransition,
    noChange,
    refuses,
    writes,
} from "./shared.ts";

export interface LoopOkOptions extends TransitionOptions {
    reason?: string;
}

export interface LoopOkResult {
    action: "implement" | "advance" | "review" | "done";
    state: StateView;
    /** The checkpoint label to review, when the action is `review`. */
    label?: string;
}

/** Acknowledges a stop after a human acts, then derives the next cycle from disk. */
export function loopOk(
    inputs: CommandInputs,
    options: LoopOkOptions,
): CommandOutcome<LoopOkResult> {
    if (options.reason !== undefined) requireText(options.reason, "--ok");
    return loopTransition(inputs, options, (state) =>
        decideOk(inputs, options, state),
    );
}

function decideOk(
    inputs: CommandInputs,
    options: LoopOkOptions,
    state: State | null,
): LoopDecision<LoopOkResult> {
    const { workspace, clock } = inputs.services;
    if (state?.loop === undefined) {
        return refuses(Findings.loopRefused("--ok", "no loop has started"));
    }
    const { loop } = state;
    if (
        loop.cycle === "done" ||
        (loop.stoppedReason === null && state.blockers.length === 0)
    ) {
        return noChange({
            action: actionFromCycle(loop, workspace),
        });
    }

    const consumed = consumeReview(state, loop, inputs);
    const history =
        consumed === null ? state.history : [...state.history, consumed.entry];
    const after = historySinceStop(history);
    const action = resolve(loop, after, workspace);
    const label =
        action === "review"
            ? pendingLabel({ ...state, history }, loop.phase, workspace)
            : undefined;
    const reason =
        options.reason ?? loop.stoppedReason ?? "human resolved blockers";
    const blockers = state.blockers.join("; ") || "none";
    const next: State = {
        ...state,
        currentStep: action === "done" ? "review" : "implement",
        blockers: [],
        decisions: [
            ...state.decisions,
            `loop --ok cleared: ${reason}; blockers: ${blockers}`,
        ],
        loop: {
            ...loop,
            cycle: action,
            stoppedReason: null,
            conditions: [...loop.conditions, ...(consumed?.conditions ?? [])],
        },
        history: [
            ...history,
            {
                step: state.currentStep,
                timestamp: clock.now(),
                reason: `ok: ${reason}; ${action}`,
            },
        ],
    };
    return writes(next, {
        action,
        ...(label !== undefined ? { label } : {}),
    });
}

/**
 * A verdict the human wrote into the file of a review that ended without
 * one, recorded as that checkpoint's result.
 */
function consumeReview(
    state: State,
    loop: LoopBlock,
    { services }: CommandInputs,
): { entry: HistoryEntry; conditions: LoopCondition[] } | null {
    if (pendingLaunch(state.history, loop) !== null) return null;
    const label = unfinishedReview(state.history, loop.phase);
    if (label === null) return null;
    const read = reviewerOutcome(services.workspace, label);
    if (read.kind !== "complete") return null;
    return {
        entry: {
            step: "checkpoint",
            timestamp: services.clock.now(),
            phase: loop.phase,
            label,
            artifact: reviewPath(label),
            verdict: read.verdict,
        },
        conditions: conditionsOf(read.conditions, loop.phase, label),
    };
}

/** The next cycle after a stop: the first rule the disk matches since the stop. */
function resolve(
    loop: LoopBlock,
    after: readonly HistoryEntry[],
    workspace: Workspace,
): LoopOkResult["action"] {
    const scopeComplete = loop.phases.every((phase) =>
        workspace.phaseComplete(phase),
    );
    if (scopeComplete && after.some(passingFinal)) return "done";
    if (!workspace.phaseComplete(loop.phase)) return "implement";
    if (after.some((entry) => passedPhase(entry, loop.phase))) return "advance";
    return "review";
}

function actionFromCycle(
    loop: LoopBlock,
    workspace: Workspace,
): LoopOkResult["action"] {
    switch (loop.cycle) {
        case "done":
        case "advance":
            return loop.cycle;
        case "review":
        case "re-review":
            return "review";
        case "repair":
            return "implement";
        case "implement":
            return workspace.phaseComplete(loop.phase) ? "review" : "implement";
    }
}

function passingFinal(entry: HistoryEntry): boolean {
    return (
        entry.step === "review" &&
        entry.label !== undefined &&
        isFinalLabel(entry.label) &&
        passes(entry.verdict)
    );
}

/** A passing checkpoint, or a passing human phase review, for `phase`. */
function passedPhase(entry: HistoryEntry, phase: PhaseId): boolean {
    if (!passes(entry.verdict) || entry.label === undefined) return false;
    if (entry.step === "checkpoint") return entry.phase === phase;
    return entry.step === "review" && isPhaseReviewLabel(entry.label, phase);
}

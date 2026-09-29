import {
    isHumanReviewLabel,
    verdictOf,
} from "../../workspace/ReviewArtifact.ts";
import { reviewPath } from "../../workspace/Workspace.ts";

import { UsageError } from "../errors.ts";
import { Findings } from "../Findings.ts";
import { isKebab, phaseOfLabel } from "../ids.ts";
import { isDiscovered } from "../steps.ts";
import type { CommandOutcome, PhaseId, State, StateView } from "../types.ts";
import type { CommandInputs, RecordOptions } from "./inputs.ts";
import {
    initialState,
    noopPlan,
    reasonOf,
    recordStep,
    type StepTransition,
    stopPlan,
    writePlan,
} from "./transition.ts";

export interface ReviewOptions extends RecordOptions {
    label: string;
}

/** `record review --label`: records a human review's verdict, read from its artifact. Re-recording a label is a no-op. */
export function reviewPlan({
    services,
    context,
}: CommandInputs): StepTransition<ReviewOptions> {
    const { workspace, clock } = services;

    return {
        plan(state: State | null, { label }: ReviewOptions) {
            if (!isHumanReviewLabel(label)) {
                return stopPlan([
                    Findings.notHumanReviewLabel(reviewPath(label)),
                ]);
            }
            const review = workspace.review(label);
            if (review === null) {
                return stopPlan([
                    Findings.workspaceIncomplete(reviewPath(label)),
                ]);
            }
            if (verdictOf(review) === null) {
                return stopPlan([
                    Findings.reviewVerdictUnclear(reviewPath(label)),
                ]);
            }
            const base = state ?? initialState(context.feature);
            if (recorded(state, label) && state?.currentStep === "review") {
                return noopPlan();
            }
            return writePlan({
                ...base,
                // The recorded entry replaces a discovered one.
                history: base.history.filter(
                    (entry) => !(entry.label === label && isDiscovered(entry)),
                ),
                currentStep: "review",
            });
        },

        // A label `record review` already recorded only moves the position.
        recordsHistory(state: State | null, { label }: ReviewOptions): boolean {
            return !recorded(state, label);
        },

        historyEntry(_state: State | null, options: ReviewOptions) {
            const verdict = verdictOf(workspace.review(options.label));
            const phase = phaseOfLabel(options.label);
            return {
                step: "review",
                timestamp: clock.now(),
                label: options.label,
                ...(verdict !== null ? { verdict } : {}),
                artifact: reviewPath(options.label),
                ...(phase !== undefined ? { phase: phase as PhaseId } : {}),
                ...reasonOf(options),
            };
        },
    };
}

function recorded(state: State | null, label: string): boolean {
    return (
        state?.history.some(
            (entry) =>
                entry.step === "review" &&
                entry.label === label &&
                entry.verdict !== undefined &&
                !isDiscovered(entry),
        ) ?? false
    );
}

export function recordReview(
    inputs: CommandInputs,
    options: ReviewOptions,
): CommandOutcome<StateView> {
    return recordStep(
        inputs,
        "review",
        reviewPlan(inputs),
        options,
        validateReviewOptions,
    );
}

function validateReviewOptions(options: ReviewOptions): void {
    if (!isKebab(options.label)) {
        throw new UsageError(
            `--label must be a kebab-case review label, not "${options.label}"`,
        );
    }
}

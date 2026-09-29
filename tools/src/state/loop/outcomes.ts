import { blockedSteps } from "../../workspace/PhaseFile.ts";
import { isPendingStub } from "../../workspace/ReviewArtifact.ts";
import { reviewPath, type Workspace } from "../../workspace/Workspace.ts";
import type { LoopBlock, Outcome, Verdict } from "../types.ts";

export interface ReviewerCompleteOutcome {
    kind: "complete";
    verdict: Verdict;
    conditions: { note: string }[];
}

export interface ReviewerStoppedOutcome {
    kind: "stopped";
    stoppedReason: string;
}

/** The reviewer returned without writing: the file is missing or still a PENDING stub. */
export interface ReviewerIncompleteOutcome {
    kind: "incomplete";
}

export function reviewerOutcome(
    workspace: Workspace,
    label: string,
):
    | ReviewerCompleteOutcome
    | ReviewerStoppedOutcome
    | ReviewerIncompleteOutcome {
    const review = workspace.review(label);
    if (review === null || isPendingStub(review)) return { kind: "incomplete" };
    if (review.kind !== "complete") {
        return {
            kind: "stopped",
            stoppedReason: `invalid review artifact: ${reviewPath(label)}`,
        };
    }
    return {
        kind: "complete",
        verdict: review.verdict,
        conditions: review.findings
            .filter((finding) => finding.blocking.toLowerCase() === "no")
            .map((finding) => ({
                note: `${finding.severity}: ${finding.description}`,
            })),
    };
}

/** What an implementer reports with `loop --end --result`. */
export const implementerResults = ["COMPLETE", "STOPPED"] as const;

export type ImplementerResult = (typeof implementerResults)[number];

export interface ImplementerOutcomeInput {
    action: "implement" | "repair";
    loop: LoopBlock;
    workspace: Workspace;
    result?: ImplementerResult;
}

export function implementerOutcome({
    action,
    loop,
    workspace,
    result,
}: ImplementerOutcomeInput): Outcome {
    const phaseFile = workspace.phaseFile(loop.phase);
    if (
        result === "STOPPED" ||
        (phaseFile !== null && blockedSteps(phaseFile).length > 0)
    ) {
        return "STOPPED";
    }
    if (action === "implement") {
        return workspace.phaseComplete(loop.phase) ? "COMPLETE" : "incomplete";
    }
    return "COMPLETE";
}

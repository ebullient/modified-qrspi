import type { WorkflowStep } from "./types.ts";

/**
 * Each step's own artifact, in workflow order: the file whose existence
 * places the workflow at that step. `Navigation`, `Recovery`, and the loop
 * preconditions all read this one list.
 */
export const stepArtifacts: readonly (readonly [string, WorkflowStep])[] = [
    ["request.md", "init"],
    ["queries.md", "query"],
    ["research.md", "research"],
    ["approach.md", "shape"],
    ["spec.md", "spec"],
    ["plan.md", "plan"],
];

/** The artifact `step` produces, or `undefined` when it produces none. */
export function artifactOfStep(step: WorkflowStep): string | undefined {
    return stepArtifacts.find(([, candidate]) => candidate === step)?.[0];
}

/**
 * History entries written when recovery finds a review the state never
 * recorded carry this reason. Files already on disk hold this text, so
 * writer and reader must keep agreeing on it.
 */
const discoveredPrefix = "discovered ";

/** The `reason` for a history entry recovery discovered from `artifact`. */
export function discoveredReason(artifact: string): string {
    return `${discoveredPrefix}${artifact}`;
}

/** Whether a history entry was discovered by recovery rather than recorded. */
export function isDiscovered(entry: { reason?: string }): boolean {
    return entry.reason?.startsWith(discoveredPrefix) ?? false;
}

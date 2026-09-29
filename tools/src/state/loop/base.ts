import type { Workspace } from "../../workspace/Workspace.ts";
import type { CommitMode, State } from "../types.ts";

/**
 * A phase needs a base of its own when none is recorded or the recorded
 * one belongs to a different phase.
 */
export function needsBase(state: State | null, phase: string): boolean {
    return (state?.phaseBaseSha ?? null) === null || state?.planPhase !== phase;
}

/** A phase is fresh when none of its steps has begun and it needs a base. */
export function isFreshPhase(
    state: State | null,
    workspace: Workspace,
    phase: string,
): boolean {
    return !workspace.phaseBegun(phase) && needsBase(state, phase);
}

export interface CommitModeInput {
    state: State | null;
    fresh: boolean;
    /** The `--commit-mode` the caller passed, if any. */
    explicit: CommitMode | undefined;
    /**
     * Whether an explicit mode applies when the phase is not fresh.
     * `record implement` honors it always; `loop --begin` ignores it
     * once the phase already has a mode of its own.
     */
    explicitWinsWhenKept: boolean;
}

/** The commit mode a phase start records. */
export function resolveCommitMode(input: CommitModeInput): CommitMode {
    const { state, fresh, explicit, explicitWinsWhenKept } = input;
    if (fresh) return explicit ?? "phase";
    if (explicitWinsWhenKept && explicit !== undefined) return explicit;
    return state?.commitMode ?? "phase";
}

import { type Finding, stateFileName } from "./types.ts";

/**
 * Factories for every finding code. A finding is for the caller: each
 * names something the caller or human can act on, and the fix.
 */
export const Findings = {
    /** A repair workspace evidence cannot settle; `action` says what to decide. */
    stateInvalid(field: string, action: string): Finding {
        return {
            code: "state-invalid",
            message: `"${field}" in state.json cannot be recovered: ${action}`,
            file: stateFileName,
        };
    },

    workspaceIncomplete(file: string): Finding {
        return {
            code: "workspace-incomplete",
            message: `${file} is missing; a human must supply it before the workflow can continue`,
            file,
        };
    },

    planNotCurrent(laterStep: string): Finding {
        return {
            code: "plan-not-current",
            message: `The last definition step recorded is "${laterStep}", not "plan"; run plan before continuing`,
        };
    },

    openQuestions(file: string): Finding {
        return {
            code: "open-questions",
            message: `${file} has an open item under Open Questions that has not been resolved`,
            file,
        };
    },

    newQuestions(file: string): Finding {
        return {
            code: "new-questions",
            message: `${file} has an open item under New Questions that has not been resolved`,
            file,
        };
    },

    approachUndecided(file: string): Finding {
        return {
            code: "approach-undecided",
            message: `${file} exists but has no filled-in Decision section yet`,
            file,
        };
    },

    multipleInProgress(file: string): Finding {
        return {
            code: "multiple-in-progress",
            message: `${file} has more than one step marked in progress`,
            file,
        };
    },

    phasesInProgress(phases: string[]): Finding {
        return {
            code: "multiple-in-progress",
            message: `Phases ${phases.join(", ")} each have a step marked in progress; leave only one step [~]`,
        };
    },

    stepBlocked(file: string, step: string): Finding {
        return {
            code: "step-blocked",
            message: `Step ${step} in ${file} is blocked`,
            file,
        };
    },

    phaseRowMismatch(file: string, phase: string): Finding {
        return {
            code: "phase-row-mismatch",
            message: `Phase ${phase}'s Status in ${file} disagrees with its steps; mark it [x] only when every step is [x]`,
            file,
        };
    },

    phaseComplete(phase: string): Finding {
        return {
            code: "phase-complete",
            message: `Every step in phase ${phase} is already [x]`,
            file: "plan.md",
        };
    },

    dependencyIncomplete(phase: string, dependency: string): Finding {
        return {
            code: "dependency-incomplete",
            message: `Phase ${phase} depends on phase ${dependency}, which still has a step that is not [x]`,
            file: "plan.md",
        };
    },

    phaseBaseReset(phase: string): Finding {
        return {
            code: "phase-base-reset",
            message: `Phase ${phase} already has steps begun but no base of its own; its checkpoint diff starts at the current commit and will not include earlier work in the phase`,
        };
    },

    phaseNotInPlan(phase: string): Finding {
        return {
            code: "workspace-incomplete",
            message: `Phase ${phase} is not in plan.md; add its row before starting it`,
            file: "plan.md",
        };
    },

    advancePending(phase: string): Finding {
        return {
            code: "advance-pending",
            message: `Phase ${phase} passed its checkpoint review but the loop has not advanced past it yet; run loop --advance`,
        };
    },

    dirtyTree(paths: string[]): Finding {
        return {
            code: "dirty-tree",
            message: `Uncommitted changes: ${paths.join(", ")}`,
        };
    },

    staleDownstream(step: string): Finding {
        return {
            code: "stale-downstream",
            message: `"${step}" was completed after the current step; earlier work may be out of date`,
        };
    },

    notHumanReviewLabel(file: string): Finding {
        return {
            code: "format-invalid",
            message: `${file} is not named with a human-review label (phase-N, phase-N-step-M, or final, with an optional -rN); checkpoint reviews are recorded by the loop`,
            file,
        };
    },

    reviewVerdictUnclear(file: string): Finding {
        return {
            code: "format-invalid",
            message: `${file} has no clear verdict; fix its "## Verdict: PASS", "PASS WITH CONDITIONS", or "FAIL" line`,
            file,
        };
    },

    reviewTableMalformed(file: string, reason: string): Finding {
        return {
            code: "format-invalid",
            message: `${file}'s findings table is malformed (${reason}); fix the table`,
            file,
        };
    },

    /** A loop selector or dependency names a phase with no row in `plan.md`. */
    planRowMissing(message: string): Finding {
        return { code: "workspace-incomplete", message, file: "plan.md" };
    },

    /** `plan.md` cannot order a loop scope: a reversed range or a dependency cycle. */
    planScopeInvalid(message: string): Finding {
        return { code: "format-invalid", message, file: "plan.md" };
    },

    reviewPending(label: string): Finding {
        return {
            code: "review-pending",
            message: `The checkpoint review "${label}" has a verdict that must be recorded with loop --end before continuing`,
        };
    },

    loopStopped(reason: string): Finding {
        return {
            code: "loop-stopped",
            message: `The loop is stopped: ${reason}`,
        };
    },

    /** A loop action other than the one `report` names; `recommended` is that action, or why none applies. */
    loopRefused(action: string, recommended: string): Finding {
        return {
            code: "loop-refused",
            message: `loop ${action} is not the next loop action (${recommended})`,
        };
    },

    loopActive(launch: string, phase: string): Finding {
        return {
            code: "loop-active",
            message: `A loop ${launch} launch for phase ${phase} is still open; let it finish, or stop or abandon the loop, before recording by hand`,
        };
    },

    baseNotAncestor(base: string): Finding {
        return {
            code: "base-not-ancestor",
            message: `The phase base ${base} is no longer an ancestor of HEAD, so history was rewritten under it; set a new one with record implement --phase <id> --base <commit-ish>, or review with an explicit diff`,
        };
    },

    /**
     * Per-phase plan files still in the workspace root. Advisory: both
     * locations resolve, so the message has to carry the whole contract —
     * no skill documents this code.
     */
    legacyPlanLocation(files: string[]): Finding {
        return {
            code: "legacy-plan-location",
            message: `Per-phase plan files are in the workspace root instead of plans/ (${files.join(", ")}); they still resolve, and moving them into plans/ clears this`,
        };
    },

    /**
     * `plans` exists but is not a directory, so nothing can be read from it.
     * Phase files still resolve from the workspace root, so this is advisory —
     * but the message has to say what to do, since no skill documents it.
     */
    plansNotADirectory(): Finding {
        return {
            code: "plans-not-a-directory",
            message:
                "plans exists but is not a directory, so no phase file can be read from it; rename it (for example to plans.md) and create plans/ as a directory",
            file: "plans",
        };
    },

    blockers(count: number): Finding {
        return {
            code: "blockers",
            message: `${count} blocker${count === 1 ? "" : "s"} must be resolved before continuing`,
        };
    },
};

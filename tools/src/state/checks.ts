import { phaseFilePath, type Workspace } from "../workspace/Workspace.ts";
import { InternalError } from "./errors.ts";
import { Findings } from "./Findings.ts";
import type { ScopeError } from "./loop/dependencyGraph.ts";
import type { SelectorError } from "./loop/selector.ts";
import type { GitRunner } from "./ports.ts";
import type { Finding, State } from "./types.ts";

/**
 * The findings-producing checks the commands share. Each condition's
 * `Findings.*` call lives in exactly one function here; callers decide
 * which checks apply and in what order.
 */

/** `approach.md` exists but has no filled-in Decision section. */
export function approachUndecidedFindings(workspace: Workspace): Finding[] {
    return workspace.hasFile("approach.md") && !workspace.decided()
        ? [Findings.approachUndecided("approach.md")]
        : [];
}

/** `request.md` has an open item under Open Questions. */
export function openQuestionsFindings(workspace: Workspace): Finding[] {
    return workspace.openQuestions().open.length > 0
        ? [Findings.openQuestions("request.md")]
        : [];
}

/** `research.md` has an open item under New Questions. */
export function newQuestionsFindings(workspace: Workspace): Finding[] {
    return workspace.newQuestions().open.length > 0
        ? [Findings.newQuestions("research.md")]
        : [];
}

/** The state records at least one unresolved blocker. */
export function blockersFindings(state: State): Finding[] {
    return state.blockers.length > 0
        ? [Findings.blockers(state.blockers.length)]
        : [];
}

/** True when a recorded blocker note mentions `stepId` (for example `2.3`). */
export function blockerMentions(state: State, stepId: string): boolean {
    return state.blockers.some((blocker) => blocker.includes(stepId));
}

/** The phase file for `phase` cannot be found. */
export function missingPhaseFileFindings(
    workspace: Workspace,
    phase: string,
): Finding[] {
    return workspace.phaseFile(phase) === null
        ? [Findings.workspaceIncomplete(phaseFilePath(phase))]
        : [];
}

/** The recorded phase base is neither `root` nor an ancestor of HEAD. */
export function baseNotAncestorFindings(
    git: GitRunner,
    base: string | null | undefined,
): Finding[] {
    return base !== null &&
        base !== undefined &&
        base !== "root" &&
        !git.isAncestor(base)
        ? [Findings.baseNotAncestor(base)]
        : [];
}

/** The `format-invalid` findings `plan.md` already carries. */
export function planFormatFindings(workspace: Workspace): Finding[] {
    return workspace.plan()?.findings ?? [];
}

/**
 * Which phase files a format check reads: every phase file, the rows of
 * `plan.md`, or an explicit list of phases.
 */
export type FormatScope = "all" | "plan-rows" | readonly string[];

/**
 * The `format-invalid` findings the phase files in `scope` already carry.
 * With `reportMissing`, a listed phase with no file is a
 * `workspace-incomplete` finding at its place in the order.
 */
export function phaseFormatFindings(
    workspace: Workspace,
    scope: FormatScope,
    reportMissing = false,
): Finding[] {
    if (scope === "all") {
        return [...workspace.phaseFiles().values()].flatMap(
            (phaseFile) => phaseFile.findings,
        );
    }
    const phases =
        scope === "plan-rows"
            ? (workspace.plan()?.rows ?? []).map((row) => row.phase)
            : scope;
    return phases.flatMap((phase) => {
        const parsed = workspace.phaseFile(phase);
        if (parsed !== null) return parsed.findings;
        return reportMissing ? missingPhaseFileFindings(workspace, phase) : [];
    });
}

/**
 * The finding for a selector or scope error: a phase `plan.md` has no row
 * for, or a plan that cannot order the scope. `syntax` errors are usage
 * errors, not findings, and are handled by the caller.
 */
export function scopeErrorFinding(error: SelectorError | ScopeError): Finding {
    switch (error.kind) {
        case "missing":
        case "missing-dependency":
            return Findings.planRowMissing(error.message);
        case "plan":
        case "cycle":
            return Findings.planScopeInvalid(error.message);
        case "syntax":
            throw new InternalError(
                "a selector syntax error is a usage error, not a finding",
            );
    }
}

/**
 * A `dirty-tree` finding for every path git reports as changed.
 *
 * No path filtering: what the finding is for is the checkpoint diff, and an
 * uncommitted change pollutes `phaseBaseSha..HEAD` wherever it sits. Location
 * never told us anything the caller needed.
 *
 * This requires `qrspi/` to be gitignored. Without that, git reports the
 * feature's own artifacts — dirty by design — and the finding fires on every
 * command. Ignoring `qrspi/` is the documented setup, not an assumption.
 */
export function dirtyTreeFindings(git: GitRunner): Finding[] {
    const paths = git
        .status()
        .flatMap((entry) =>
            entry.originalPath === undefined
                ? [entry.path]
                : [entry.originalPath, entry.path],
        )
        .filter((path, index, all) => all.indexOf(path) === index)
        .filter((path) => path !== "");

    return paths.length > 0 ? [Findings.dirtyTree(paths)] : [];
}

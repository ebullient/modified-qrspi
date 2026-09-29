import {
    blockedSteps,
    doneSteps,
    inProgressSteps,
    lastDoneStep,
    type PhaseStep,
} from "../../workspace/PhaseFile.ts";
import { isPendingStub, verdictOf } from "../../workspace/ReviewArtifact.ts";
import { reviewPath, type Workspace } from "../../workspace/Workspace.ts";
import {
    approachUndecidedFindings,
    baseNotAncestorFindings,
    blockerMentions,
    blockersFindings,
    dirtyTreeFindings,
    newQuestionsFindings,
    openQuestionsFindings,
    phaseFormatFindings,
    planFormatFindings,
    scopeErrorFinding,
} from "../checks.ts";
import { UsageError } from "../errors.ts";
import { Findings } from "../Findings.ts";
import { resolveScope } from "../loop/dependencyGraph.ts";
import { type LoopAction, nextLoopAction } from "../loop/LoopNext.ts";
import { startOnlyPreconditions } from "../loop/preconditions.ts";
import { type NavigationResult, navigate } from "../Navigation.ts";
import { phaseDiff } from "../phaseDiff.ts";
import type { GitRunner } from "../ports.ts";
import { Recovery } from "../Recovery.ts";
import { ReviewLabels } from "../ReviewLabels.ts";
import type { StateLoad } from "../store/Store.ts";
import type {
    CommandOutcome,
    Finding,
    LoopBlock,
    NextPosition,
    PhaseId,
    PlanProgress,
    State,
    Verdict,
    WorkflowPhase,
} from "../types.ts";
import { phaseOf } from "../types.ts";
import type { CommandInputs } from "./inputs.ts";

export interface ReportServices {
    workspace: Workspace;
    git: GitRunner;
}

export interface ReportOptions {
    /** Narrows `planProgress` and `labels` to this phase instead of `planPhase`. */
    phase?: string;
}

export interface ReportResult {
    current: {
        phase: WorkflowPhase;
        step: State["currentStep"];
        planPhase?: State["planPhase"];
        planProgress?: PlanProgress;
        loop?: LoopSummary;
        completed?: true;
    };
    next:
        | (NextPosition & { alternatives: string[] })
        | { step: null; alternatives: string[] };
    labels: {
        phase?: string;
        step?: string;
        final: string;
    };
    /** The checkpoint diff command for `planPhase`; present once the phase has a base. */
    diff?: string;
    /** The read-only next loop action; present only when a `loop` block exists. */
    loop?: LoopAction | null;
}

/** The persisted loop block as `current` reports it, including its resolved phase list. */
export type LoopSummary = Pick<
    LoopBlock,
    "scope" | "phases" | "cycle" | "phase" | "stoppedReason" | "conditions"
> & {
    /** The `checkpoint` history entries, oldest first. */
    checkpoints: { phase: PhaseId; label: string; verdict: Verdict }[];
};

/**
 * `report`: loads state via `Store`, cross-checks it against the
 * workspace and git, and reports where the workflow is and what would
 * come next. It never writes.
 */
export function reportFeature(
    { services, context }: CommandInputs,
    options: ReportOptions = {},
): CommandOutcome<ReportResult> {
    const { store, workspace, git, clock } = services;
    const loaded = store.load();
    // Neither state.json nor request.md: init creates both.
    if (loaded.kind === "missing" && !workspace.hasFile("request.md")) {
        return report(null, { workspace, git }, options);
    }

    const recovered = new Recovery(workspace, clock, context.feature).recover(
        loaded,
    );
    if (recovered.kind === "ambiguous") {
        return ambiguousReport(
            recovered.finding,
            loaded,
            { workspace, git },
            options,
        );
    }
    return report(recovered.state, { workspace, git }, options);
}

/** Recovery could not settle the state: the finding that says why, and no next step. */
function ambiguousReport(
    finding: Finding,
    loaded: StateLoad,
    services: ReportServices,
    options: ReportOptions,
): CommandOutcome<ReportResult> {
    const outcome = report(null, services, options);
    const values = loaded.kind === "parsed" ? loaded.values : {};
    return {
        ...outcome,
        result: {
            ...(outcome.result as ReportResult),
            current: {
                phase: phaseOf(values.currentStep ?? "init"),
                step: values.currentStep ?? "init",
            },
            next: { step: null, alternatives: [] },
        },
        findings: [finding],
    };
}

/** Builds the report from recovered state (`null` when neither `state.json` nor `request.md` exists). Always exits 0; findings are informational. */
export function report(
    state: State | null,
    services: ReportServices,
    options: ReportOptions = {},
): CommandOutcome<ReportResult> {
    const { workspace, git } = services;
    if (options.phase !== undefined) validatePhase(options.phase, workspace);
    const navigation = navigate({ state, workspace });
    const findings: Finding[] = [...navigation.findings];

    // Advisory only: both layouts resolve, so this changes nothing else
    // about the report. `report` is the only command that says it.
    const legacyPlans = workspace.legacyPhaseFileNames();
    if (legacyPlans.length > 0) {
        findings.push(Findings.legacyPlanLocation([...legacyPlans]));
    }
    if (workspace.plansBlocked()) {
        findings.push(Findings.plansNotADirectory());
    }

    if (state !== null) {
        findings.push(...crossChecks(state, workspace, git));
        findings.push(...startPreconditions(state, navigation, services));
    }
    const loopNext =
        state?.loop !== undefined
            ? nextLoopAction(state, workspace, git, { withChecks: false })
            : null;
    if (loopNext !== null) findings.push(...loopNext.findings);

    const progressPhase =
        options.phase ??
        (state !== null && phaseOf(state.currentStep) === "execution"
            ? (state.planPhase ?? null)
            : null);
    const planProgress =
        progressPhase !== null
            ? phaseProgress(progressPhase, workspace)
            : undefined;

    const current: ReportResult["current"] =
        state === null
            ? {
                  phase: "discovery",
                  step: "init",
                  ...(planProgress !== undefined ? { planProgress } : {}),
              }
            : {
                  phase: phaseOf(state.currentStep),
                  step: state.currentStep,
                  ...(phaseOf(state.currentStep) === "execution"
                      ? { planPhase: state.planPhase ?? null }
                      : {}),
                  ...(planProgress !== undefined ? { planProgress } : {}),
                  ...(state.loop !== undefined
                      ? { loop: loopSummary(state.loop, state.history) }
                      : {}),
                  ...(state.completed === true ? { completed: true } : {}),
              };

    const result: ReportResult = {
        current,
        next:
            navigation.next === null
                ? { step: null, alternatives: navigation.alternatives }
                : { ...navigation.next, alternatives: navigation.alternatives },
        labels: nextLabels(
            new ReviewLabels(workspace.reviewLabels(), state?.history ?? []),
            progressPhase,
            workspace,
        ),
        ...(state?.phaseBaseSha != null
            ? { diff: phaseDiff(state.phaseBaseSha, git) }
            : {}),
        ...(loopNext !== null ? { loop: loopNext.next } : {}),
    };

    return {
        exitCode: 0,
        result,
        findings,
        wrote: false,
    };
}

function loopSummary(loop: LoopBlock, history: State["history"]): LoopSummary {
    const checkpoints: LoopSummary["checkpoints"] = [];
    for (const entry of history) {
        if (
            entry.step === "checkpoint" &&
            entry.phase !== undefined &&
            entry.label !== undefined &&
            entry.verdict !== undefined
        ) {
            checkpoints.push({
                phase: entry.phase,
                label: entry.label,
                verdict: entry.verdict,
            });
        }
    }
    return {
        scope: loop.scope,
        phases: [...loop.phases],
        cycle: loop.cycle,
        phase: loop.phase,
        stoppedReason: loop.stoppedReason,
        checkpoints,
        conditions: loop.conditions.map(({ phase, label, note }) => ({
            phase,
            label,
            note,
        })),
    };
}

/**
 * The loop's entry checks over every incomplete phase, when navigation
 * offers `loop` and no active loop block exists to resume instead.
 */
function startPreconditions(
    state: State,
    navigation: NavigationResult,
    services: ReportServices,
): Finding[] {
    const { workspace } = services;
    const offered =
        navigation.next?.step === "loop" ||
        navigation.alternatives.includes("loop");
    if (!offered) return [];
    if (state.loop !== undefined && state.loop.cycle !== "done") return [];

    const plan = workspace.plan();
    const scope =
        plan === null
            ? ({ kind: "scope", phases: [] } as const)
            : resolveScope(
                  plan.rows.map((row) => row.phase),
                  plan,
                  (phase) => workspace.phaseComplete(phase),
              );
    if (scope.kind !== "scope") return [scopeErrorFinding(scope)];
    return startOnlyPreconditions(state, workspace, scope.phases);
}

function validatePhase(phase: string, workspace: Workspace): void {
    const rows = workspace.plan()?.rows ?? [];
    if (!rows.some((row) => row.phase === phase)) {
        throw new UsageError(`--phase ${phase} is not a phase in plan.md`);
    }
}

function crossChecks(
    state: State,
    workspace: Workspace,
    git: GitRunner,
): Finding[] {
    const findings: Finding[] = [];

    findings.push(
        ...planFormatFindings(workspace),
        ...phaseFormatFindings(workspace, "all"),
    );

    findings.push(
        ...openQuestionsFindings(workspace),
        ...newQuestionsFindings(workspace),
        ...approachUndecidedFindings(workspace),
    );

    if (phaseOf(state.currentStep) === "execution") {
        findings.push(...markerFindings(state, workspace));
        findings.push(...phaseRowMismatchFindings(workspace));
    }

    findings.push(...dirtyTreeFindings(git));
    findings.push(...baseNotAncestorFindings(git, state.phaseBaseSha));
    findings.push(...reviewFindings(state, workspace));

    findings.push(...blockersFindings(state));

    return findings;
}

/** Marker findings across every phase file: more than one `[~]` step, or an untracked `[!]` step. */
function markerFindings(state: State, workspace: Workspace): Finding[] {
    const findings: Finding[] = [];
    const inProgressFiles = new Set<string>();
    let inProgress = 0;

    for (const [phaseId, phaseFile] of workspace.phaseFiles()) {
        for (const _ of inProgressSteps(phaseFile)) {
            inProgress++;
            inProgressFiles.add(phaseFile.file);
        }
        for (const step of blockedSteps(phaseFile)) {
            const stepId = `${phaseId}.${step.step}`;
            if (!blockerMentions(state, stepId)) {
                findings.push(Findings.stepBlocked(phaseFile.file, stepId));
            }
        }
    }

    if (inProgress > 1) {
        for (const file of inProgressFiles) {
            findings.push(Findings.multipleInProgress(file));
        }
    }
    return findings;
}

/**
 * One phase's marker-derived progress. `current` is the phase's single
 * `[~]` step, or `null` when it has none or more than one.
 */
function phaseProgress(phaseId: string, workspace: Workspace): PlanProgress {
    const phaseFile = workspace.phaseFile(phaseId);
    const ids = (steps: PhaseStep[]) =>
        steps.map((step) => `${phaseId}.${step.step}`);
    const inProgress =
        phaseFile === null ? [] : ids(inProgressSteps(phaseFile));
    return {
        current: inProgress.length === 1 ? (inProgress[0] ?? null) : null,
        completed: phaseFile === null ? [] : ids(doneSteps(phaseFile)),
        blocked: phaseFile === null ? [] : ids(blockedSteps(phaseFile)),
    };
}

/** The next human review labels; a mid-phase label follows the phase's last completed step. */
function nextLabels(
    labels: ReviewLabels,
    phase: string | null,
    workspace: Workspace,
): ReportResult["labels"] {
    if (phase === null) return { final: labels.final() };
    const id = phase as PhaseId;
    const phaseFile = workspace.phaseFile(id);
    const lastCompleted =
        phaseFile === null ? undefined : lastDoneStep(phaseFile);
    return {
        phase: labels.phase(id),
        ...(lastCompleted !== undefined
            ? { step: labels.step(id, lastCompleted.step) }
            : {}),
        final: labels.final(),
    };
}

function phaseRowMismatchFindings(workspace: Workspace): Finding[] {
    const plan = workspace.plan();
    if (plan === null) return [];

    const findings: Finding[] = [];
    for (const row of plan.rows) {
        // Flag a Status that disagrees with the steps.
        if (workspace.phaseFile(row.phase) === null) continue;
        if ((row.status === "x") !== workspace.phaseComplete(row.phase)) {
            findings.push(Findings.phaseRowMismatch("plan.md", row.phase));
        }
    }
    return findings;
}

/**
 * The review files that matter now: the review the markers call for
 * (newest round) with an unclear verdict, and the active phase's newest
 * checkpoint, whose findings table the loop reads. Others are not read.
 */
function reviewFindings(state: State, workspace: Workspace): Finding[] {
    const findings: Finding[] = [];
    const phase = state.planPhase ?? null;
    const latest = workspace.latestReview(phase);
    const unclearLatest = latest !== null && workspace.verdict(latest) === null;
    if (unclearLatest) {
        findings.push(Findings.reviewVerdictUnclear(reviewPath(latest)));
    }
    const checkpoint =
        phase === null
            ? null
            : workspace.newestReview(`phase-${phase}`, "checkpoint");
    const review = checkpoint === null ? null : workspace.review(checkpoint);
    if (checkpoint !== null && !isPendingStub(review)) {
        const file = reviewPath(checkpoint);
        if (verdictOf(review) === null) {
            if (!(unclearLatest && checkpoint === latest)) {
                findings.push(Findings.reviewVerdictUnclear(file));
            }
        } else if (review !== null && review.kind === "invalid") {
            findings.push(Findings.reviewTableMalformed(file, review.reason));
        }
    }
    return findings;
}

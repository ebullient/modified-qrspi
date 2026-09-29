import { inProgressSteps } from "../workspace/PhaseFile.ts";
import {
    isCheckpointLabel,
    isHumanReviewLabel,
    isPendingStub,
    verdictOf,
} from "../workspace/ReviewArtifact.ts";
import { reviewPath, type Workspace } from "../workspace/Workspace.ts";
import { planFormatFindings } from "./checks.ts";
import { Findings } from "./Findings.ts";
import { phaseOfLabel } from "./ids.ts";
import { passes } from "./loop/helpers.ts";
import type { Clock } from "./ports.ts";
import { discoveredReason, stepArtifacts } from "./steps.ts";
import type { StateLoad } from "./store/Store.ts";
import {
    type Finding,
    type HistoryEntry,
    type LoopBlock,
    type PhaseId,
    type State,
    stateFileName,
} from "./types.ts";

/**
 * A complete state, the fields rebuilt to make it, and the review labels
 * discovered into history; or the finding that made recovery ambiguous.
 * Rebuilt fields and discoveries are not findings: the caller cannot act
 * on them, so they are noted in history only.
 */
export type RecoveryResult =
    | {
          kind: "recovered";
          state: State;
          reconstructed: string[];
          discovered: string[];
      }
    | { kind: "ambiguous"; finding: Finding };

/** A value the evidence settled, or the finding that says it does not. */
type Settled<T> =
    | { kind: "settled"; value: T }
    | { kind: "ambiguous"; finding: Finding };

function settled<T>(value: T): Settled<T> {
    return { kind: "settled", value };
}

function ambiguous(finding: Finding): { kind: "ambiguous"; finding: Finding } {
    return { kind: "ambiguous", finding };
}

/**
 * Rebuilds the missing and invalid parts of `state.json` from workspace
 * evidence, keeping every valid value. Never invents a phase, step,
 * label, or verdict: when the evidence does not settle one, the result
 * is the finding that says why.
 */
export class Recovery {
    private readonly workspace: Workspace;
    private readonly clock: Clock;
    private readonly feature: string;

    constructor(workspace: Workspace, clock: Clock, feature: string) {
        this.workspace = workspace;
        this.clock = clock;
        this.feature = feature;
    }

    recover(loaded: StateLoad): RecoveryResult {
        const values = loaded.kind === "parsed" ? loaded.values : {};
        const reconstructed =
            loaded.kind === "parsed" ? [...loaded.invalid] : [stateFileName];
        const loopMembers =
            loaded.kind === "parsed" ? (loaded.loopMembers ?? {}) : {};
        const rebuilt = this.rebuild(values, reconstructed, loopMembers);
        if (rebuilt.kind === "ambiguous") return rebuilt;
        const state = rebuilt.value;
        const positionRebuilt = values.currentStep === undefined;
        const restored = this.restoreLastVerdict(state);
        const discovered = this.discover(state, positionRebuilt);
        return {
            kind: "recovered",
            state,
            reconstructed:
                restored === null || reconstructed.includes(restored)
                    ? reconstructed
                    : [...reconstructed, restored],
            discovered,
        };
    }

    private rebuild(
        values: Partial<State>,
        reconstructed: string[],
        loopMembers: Partial<LoopBlock>,
    ): Settled<State> {
        const state: State = {
            currentStep: "init",
            ...values,
            feature: this.feature,
            blockers: values.blockers ?? [],
            decisions: values.decisions ?? [],
            history: values.history ?? [],
        };
        if (reconstructed.length === 0) return settled(state);

        if (reconstructed.includes("phaseBaseSha")) state.phaseBaseSha = null;
        if (reconstructed.includes("commitMode")) state.commitMode = "phase";

        if (values.currentStep !== undefined) {
            state.currentStep = values.currentStep;
            if (reconstructed.includes("planPhase")) {
                const active = this.activePhase();
                if (active.kind === "ambiguous") return active;
                state.planPhase = active.value;
            }
        } else {
            const problem = this.positionFromEvidence(state);
            if (problem !== null) return ambiguous(problem);
        }
        const problem = this.recoverLoop(
            state,
            values,
            reconstructed,
            loopMembers,
        );
        return problem === null ? settled(state) : ambiguous(problem);
    }

    /**
     * An invalid loop block, or a lost one with checkpoint reviews behind
     * it, is rebuilt for the active phase only: its valid members are
     * kept, and the cycle comes from the phase's markers and newest
     * checkpoint. A lost scope becomes the active phase; lost conditions
     * stay lost. Returns the finding when the evidence is ambiguous.
     */
    private recoverLoop(
        state: State,
        values: Partial<State>,
        reconstructed: string[],
        members: Partial<LoopBlock>,
    ): Finding | null {
        const invalidLoop = reconstructed.some((field) =>
            field.startsWith("loop"),
        );
        if (!invalidLoop && values.loop !== undefined) return null;
        if (
            !invalidLoop &&
            !this.workspace.reviewLabels().some(isCheckpointLabel)
        ) {
            return null;
        }

        const active = this.activePhase();
        if (active.kind === "ambiguous") return active.finding;
        const phase = active.value;
        if (!invalidLoop) {
            // Only the active phase's own checkpoints show its loop was interrupted.
            if (
                phase === null ||
                this.phaseCheckpointLabels(phase).length === 0
            ) {
                return null;
            }
            reconstructed.push("loop");
        }
        if (phase === null) {
            return Findings.stateInvalid(
                "loop",
                "no phase in plan.md is active; restore the loop block or remove it",
            );
        }
        const phases = members.phases ?? [phase];
        if (!phases.includes(phase)) {
            return Findings.stateInvalid(
                "loop.phases",
                `the loop's phases do not include active phase ${phase}; fix or remove the loop block`,
            );
        }

        let cycle = members.cycle;
        if (cycle === undefined) {
            const derived = this.loopCycle(phase);
            if (derived.kind === "ambiguous") return derived.finding;
            cycle = derived.value;
        }

        state.loop = {
            scope: members.scope ?? phase,
            phases,
            cycle,
            phase,
            conditions: members.conditions ?? [],
            stoppedReason: members.stoppedReason ?? null,
        };
        if (cycle === "done") return null;
        state.planPhase = phase;
        const reviewing = cycle === "review" || cycle === "re-review";
        if (reviewing !== (state.currentStep === "checkpoint")) {
            state.currentStep = reviewing ? "checkpoint" : "implement";
        }
        return null;
    }

    /**
     * The cycle the evidence supports: a passing newest checkpoint
     * advances once every step is done, a failing one repairs, and a
     * PENDING stub is a review still to run; with no checkpoint, review
     * once every step is done.
     */
    private loopCycle(phase: PhaseId): Settled<LoopBlock["cycle"]> {
        const label = this.workspace.newestReview(
            `phase-${phase}`,
            "checkpoint",
        );
        if (label === null) {
            return settled(
                this.workspace.phaseComplete(phase) ? "review" : "implement",
            );
        }
        const review = this.workspace.review(label);
        if (isPendingStub(review)) {
            const labels = this.phaseCheckpointLabels(phase).sort();
            const previous = labels
                .slice(0, -1)
                .map((candidate) => verdictOf(this.workspace.review(candidate)))
                .at(-1);
            return settled(previous === "FAIL" ? "re-review" : "review");
        }
        const verdict = verdictOf(review);
        if (verdict === null) {
            return ambiguous(Findings.reviewVerdictUnclear(reviewPath(label)));
        }
        if (!passes(verdict)) return settled("repair");
        return settled(
            this.workspace.phaseComplete(phase) ? "advance" : "implement",
        );
    }

    /** The position the artifacts and markers support; discovery may then move `implement` to `review`. */
    private positionFromEvidence(state: State): Finding | null {
        const plan = this.workspace.plan();
        if (plan === null) {
            const latest = stepArtifacts
                .filter(([file]) => this.workspace.hasFile(file))
                .at(-1);
            state.currentStep = latest?.[1] ?? "init";
            return null;
        }
        const [formatProblem] = planFormatFindings(this.workspace);
        if (formatProblem !== undefined) return formatProblem;

        if (state.planPhase === undefined || state.planPhase === null) {
            const active = this.activePhase();
            if (active.kind === "ambiguous") return active.finding;
            state.planPhase = active.value;
        }
        const begun = plan.rows.some((row) =>
            this.workspace.phaseBegun(row.phase),
        );
        state.currentStep = begun ? "implement" : "plan";
        return null;
    }

    /**
     * Works backwards from the position to the one review that matters:
     * the review the markers call for, newest round, read for its verdict
     * only. Unrecorded and clear, it is added to history, and `implement`
     * moves to `review`; a rebuilt `implement` position also moves when
     * history already records it. A step in progress means implementation
     * resumed, so the position never moves then. Older reviews are left
     * alone.
     */
    private discover(state: State, positionRebuilt: boolean): string[] {
        const label = this.workspace.latestReview(state.planPhase ?? null);
        if (label === null) return [];
        const verdict = this.workspace.verdict(label);
        if (verdict === null) return [];

        const recorded = state.history.some((entry) => entry.label === label);
        if (!recorded) {
            state.history = [
                ...state.history,
                this.discoveredEntry(label, verdict),
            ];
        }
        const phase = state.planPhase ?? null;
        const stepInProgress = this.hasInProgressStep(phase);
        if (
            state.currentStep === "implement" &&
            !stepInProgress &&
            (!recorded || positionRebuilt)
        ) {
            state.currentStep = "review";
        }
        return recorded ? [] : [label];
    }

    /** The last recorded human review gets a lost verdict back from its file; returns the restored field. */
    private restoreLastVerdict(state: State): string | null {
        const i = state.history.findLastIndex(
            (entry) =>
                entry.step === "review" &&
                entry.label !== undefined &&
                isHumanReviewLabel(entry.label),
        );
        const entry = state.history[i];
        if (entry?.label === undefined || entry.verdict !== undefined) {
            return null;
        }
        const verdict = this.workspace.verdict(entry.label);
        if (verdict === null) return null;
        state.history = state.history.map((e, j) =>
            j === i ? { ...entry, verdict } : e,
        );
        return `history[${i}].verdict`;
    }

    private discoveredEntry(
        label: string,
        verdict: HistoryEntry["verdict"],
    ): HistoryEntry {
        const phase = phaseOfLabel(label);
        return {
            step: "review",
            timestamp: this.clock.now(),
            label,
            ...(verdict !== undefined ? { verdict } : {}),
            artifact: reviewPath(label),
            ...(phase !== undefined ? { phase: phase as PhaseId } : {}),
            reason: discoveredReason(reviewPath(label)),
        };
    }

    /** Checkpoint review labels that belong to `phase`, in directory order. */
    private phaseCheckpointLabels(phase: PhaseId): string[] {
        const prefix = `phase-${phase}-`;
        return this.workspace
            .reviewLabels()
            .filter(
                (label) => isCheckpointLabel(label) && label.startsWith(prefix),
            );
    }

    private hasInProgressStep(phase: string | null): boolean {
        const phaseFile =
            phase === null ? null : this.workspace.phaseFile(phase);
        return phaseFile !== null && inProgressSteps(phaseFile).length > 0;
    }

    /**
     * The phase with the only `[~]` step; else the only begun, incomplete
     * phase; else the last complete phase, which `planPhase` names until
     * the next phase starts; else the first ready phase.
     */
    private activePhase(): Settled<PhaseId | null> {
        const rows = this.workspace.plan()?.rows ?? [];
        const inProgress = rows.filter((row) =>
            this.hasInProgressStep(row.phase),
        );
        if (inProgress.length > 1) {
            return ambiguous(
                Findings.phasesInProgress(inProgress.map((row) => row.phase)),
            );
        }
        const [onlyInProgress] = inProgress;
        if (onlyInProgress !== undefined) return settled(onlyInProgress.phase);

        const begun = rows.filter(
            (row) =>
                this.workspace.phaseBegun(row.phase) &&
                !this.workspace.phaseComplete(row.phase),
        );
        if (begun.length > 1) {
            return ambiguous(
                Findings.stateInvalid(
                    "planPhase",
                    `phases ${begun.map((row) => row.phase).join(", ")} have all begun; run record implement --phase <id> to choose one`,
                ),
            );
        }
        const complete = rows.filter((row) =>
            this.workspace.phaseComplete(row.phase),
        );
        return settled(
            begun[0]?.phase ??
                complete.at(-1)?.phase ??
                this.workspace.firstReadyPhase(),
        );
    }
}

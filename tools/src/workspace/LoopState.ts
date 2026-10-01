import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reReviewLabel, reviewPath, type Workspace } from "./Workspace.ts";

export type InFlight = {
    task: "implement" | "review" | "repair";
    phaseId: string;
    label?: string;
};

export type Checkpoint = {
    phaseId: string;
    label: string;
    verdict: "PASS" | "PASS WITH CONDITIONS" | "FAIL";
};

/**
 * A pointer, not a copy: which phase passed with conditions and which
 * review label to go read for what they actually said. The condition
 * text itself lives only in history.jsonl (log review writes it there
 * from the real verdict file) — LoopState never parses a review artifact.
 */
export type Condition = {
    phaseId: string;
    label: string;
};

export type LoopStateData = {
    scope: string[];
    phaseIds: string[];
    cycle: number;
    phaseId: string;
    stoppedReason?: string;
    bases: Record<string, string>;
    inFlight?: InFlight;
    checkpoint?: Checkpoint;
    conditions: Condition[];
};

export class LoopAlreadyRunningError extends Error {
    constructor() {
        super(
            "A loop is already running; stop or abandon it before starting another.",
        );
        this.name = "LoopAlreadyRunningError";
    }
}

export class RepairAlreadySpentError extends Error {
    constructor(public readonly phaseId: string) {
        super(`Phase ${phaseId}'s one --loop repair attempt is already spent.`);
        this.name = "RepairAlreadySpentError";
    }
}

export type LoopAction =
    | "implement"
    | "review"
    | "re-review"
    | "advance"
    | "repair"
    | "stop"
    | "acknowledge-required";

export type LoopStatus = {
    scope: string[];
    phaseIds: string[];
    cycle: number;
    phaseId: string;
    stoppedReason?: string;
    checkpoint?: Checkpoint;
    conditions: Condition[];
    action: LoopAction;
    // Alongside action, whichever apply: label + diff for
    // review/re-review, review (a path) for repair. The base SHA itself
    // is never exposed, only the formatted diff command built from it —
    // no caller needs the raw SHA.
    label?: string;
    diff?: string;
    review?: string;
};

export type LoopState = {
    start: (selector: string) => Promise<string[]>;
    advance: () => Promise<void>;
    writeInFlight: (
        task: InFlight["task"],
        phaseId: string,
        opts?: { label?: string; baseSha?: string; resetBase?: boolean },
    ) => Promise<void>;
    clearInFlight: () => Promise<void>;
    updateCheckpoint: (
        phaseId: string,
        label: string,
        verdict: Checkpoint["verdict"],
    ) => Promise<void>;
    stop: (reason: string) => Promise<void>;
    ok: () => Promise<void>;
    abandon: () => Promise<void>;
    read: () => Promise<LoopStateData | undefined>;
    status: () => Promise<LoopStatus | undefined>;
};

function loopStatePath(root: string): string {
    return join(root, "loop-state.json");
}

export function loopStateAt(root: string, workspace: Workspace): LoopState {
    async function readState(): Promise<LoopStateData | undefined> {
        let text: string;
        try {
            text = await readFile(loopStatePath(root), "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw err;
        }
        return JSON.parse(text) as LoopStateData;
    }

    async function writeState(state: LoopStateData): Promise<void> {
        await mkdir(root, { recursive: true });
        await writeFile(loopStatePath(root), JSON.stringify(state, null, 2));
    }

    async function deleteState(): Promise<void> {
        await rm(loopStatePath(root), { force: true });
    }

    // The re-review (phase-<id>-r1) is the one attempt --loop allows; its
    // mere existence on disk means it's already launched (autoloop writes
    // a PENDING stub before the reviewer agent runs — see status()),
    // which is enough to refuse a second repair.
    async function repairSpent(phaseId: string): Promise<boolean> {
        return workspace.reviewExists(reReviewLabel(phaseId));
    }

    async function start(selector: string): Promise<string[]> {
        if (await readState()) {
            throw new LoopAlreadyRunningError();
        }

        // resolveScope() parses the selector, pulls in incomplete
        // dependencies, and orders the result; a DependencyCycleError
        // propagates straight through, unwrapped — turning it into a
        // finding is the command handler's job, not LoopState's.
        const { scope, phaseIds } = await workspace.resolveScope(selector);

        await writeState({
            scope,
            phaseIds,
            cycle: 0,
            phaseId: phaseIds[0],
            bases: {},
            conditions: [],
        });
        return phaseIds;
    }

    async function advance(): Promise<void> {
        const state = await readState();
        if (!state) {
            return;
        }

        // Gated on plan.md's own row, not inFlight/checkpoint: this is
        // what makes a crash-retry of loop --advance safe —
        // calling it again before the phase is actually marked [x], or
        // again after the pointer already moved past it, is a silent
        // no-op either way, never a double-advance.
        if (!(await workspace.isPhaseDone(state.phaseId))) {
            return;
        }

        const nextCycle = state.cycle + 1;
        if (nextCycle >= state.phaseIds.length) {
            await deleteState();
            return;
        }

        await writeState({
            ...state,
            cycle: nextCycle,
            phaseId: state.phaseIds[nextCycle],
            inFlight: undefined,
            checkpoint: undefined,
        });
    }

    async function writeInFlight(
        task: InFlight["task"],
        phaseId: string,
        opts: { label?: string; baseSha?: string; resetBase?: boolean } = {},
    ): Promise<void> {
        const state = await readState();
        if (!state) {
            return;
        }

        if (task === "repair" && (await repairSpent(phaseId))) {
            throw new RepairAlreadySpentError(phaseId);
        }

        const bases = { ...state.bases };
        if (
            (task === "implement" || task === "review") &&
            opts.baseSha !== undefined
        ) {
            // Set once, normally — the phase's base is the SHA recorded
            // the first time this phase's inFlight was written. `start`
            // passes resetBase only when the caller gave an explicit
            // --base <commit-ish> — the one caller-driven way this ever
            // changes after it's first set; nothing resets it
            // automatically.
            if (opts.resetBase) {
                bases[phaseId] = opts.baseSha;
            } else {
                bases[phaseId] ??= opts.baseSha;
            }
        }

        await writeState({
            ...state,
            bases,
            inFlight: { task, phaseId, label: opts.label },
        });
    }

    async function clearInFlight(): Promise<void> {
        const state = await readState();
        if (!state) {
            return;
        }
        await writeState({ ...state, inFlight: undefined });
    }

    async function updateCheckpoint(
        phaseId: string,
        label: string,
        verdict: Checkpoint["verdict"],
    ): Promise<void> {
        const state = await readState();
        if (!state) {
            return;
        }

        // conditions is an accumulating pointer list across the whole
        // run ("accumulated conditions... grouped by phase", per
        // skills/autoloop/SKILL.md's hand-back section) — not reset each
        // checkpoint. A clean PASS resolves this phase's open condition;
        // PASS WITH CONDITIONS (re)opens one; FAIL is unrelated to a
        // condition's lifecycle and leaves it untouched.
        const withoutPhase = state.conditions.filter(
            (c) => c.phaseId !== phaseId,
        );
        const conditions =
            verdict === "PASS WITH CONDITIONS"
                ? [...withoutPhase, { phaseId, label }]
                : verdict === "PASS"
                  ? withoutPhase
                  : state.conditions;

        await writeState({
            ...state,
            checkpoint: { phaseId, label, verdict },
            conditions,
        });
    }

    async function stop(reason: string): Promise<void> {
        const state = await readState();
        if (!state || state.stoppedReason === reason) {
            return;
        }
        await writeState({ ...state, stoppedReason: reason });
    }

    async function ok(): Promise<void> {
        const state = await readState();
        if (!state) {
            return;
        }
        await writeState({ ...state, stoppedReason: undefined });
    }

    async function abandon(): Promise<void> {
        await deleteState();
    }

    /**
     * The loop's own view of what happens next, for status to report
     * verbatim as next.action — status itself has no business picking
     * apart checkpoint/inFlight, since LoopState already holds every fact
     * this decision needs.
     */
    async function status(): Promise<LoopStatus | undefined> {
        const state = await readState();
        if (!state) {
            return undefined;
        }

        const base = {
            scope: state.scope,
            phaseIds: state.phaseIds,
            cycle: state.cycle,
            phaseId: state.phaseId,
            stoppedReason: state.stoppedReason,
            checkpoint: state.checkpoint,
            conditions: state.conditions,
        };

        if (state.stoppedReason !== undefined) {
            return { ...base, action: "acknowledge-required" };
        }

        const baseSha = state.bases[state.phaseId];
        const diff = baseSha ? `git diff ${baseSha}..HEAD` : undefined;

        if (!state.checkpoint) {
            const implemented = await workspace.isPhaseComplete(state.phaseId);
            if (!implemented) {
                return { ...base, action: "implement" };
            }
            const inFlightLabel =
                state.inFlight?.task === "review" &&
                state.inFlight.phaseId === state.phaseId
                    ? state.inFlight.label
                    : undefined;
            const label =
                inFlightLabel ??
                (await workspace.pendingReviewLabel(state.phaseId)) ??
                (await workspace.nextLabel("review", {
                    phase: state.phaseId,
                }));
            return { ...base, action: "review", label, diff };
        }

        if (
            state.checkpoint.verdict === "PASS" ||
            state.checkpoint.verdict === "PASS WITH CONDITIONS"
        ) {
            return { ...base, action: "advance" };
        }

        // FAIL. Three cases, told apart by what's on disk in reviews/ —
        // autoloop (skills/autoloop/SKILL.md) writes a PENDING stub for a
        // review BEFORE its reviewer agent runs, so a file's mere
        // existence means "launched," not "finished":
        //   1. checkpoint.label is the re-review's own (phase-<id>-r1) —
        //      the one --loop attempt already ran and failed again: stop.
        //   2. checkpoint.label is the base review, and phase-<id>-r1
        //      doesn't exist yet — repair hasn't launched: repair.
        //   3. checkpoint.label is the base review, and phase-<id>-r1
        //      already exists (PENDING or real) — repair ran and its
        //      re-review has launched but not yet reported: re-review.
        const reReview = reReviewLabel(state.phaseId);
        if (state.checkpoint.label === reReview) {
            return { ...base, action: "stop" };
        }
        const reReviewLaunched = await workspace.reviewExists(reReview);
        if (!reReviewLaunched) {
            return {
                ...base,
                action: "repair",
                review: reviewPath(state.checkpoint.label),
            };
        }
        return { ...base, action: "re-review", label: reReview, diff };
    }

    return {
        start,
        advance,
        writeInFlight,
        clearInFlight,
        updateCheckpoint,
        stop,
        ok,
        status,
        abandon,
        read: readState,
    };
}

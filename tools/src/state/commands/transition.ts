import { StateInvalidError } from "../errors.ts";
import { Findings } from "../Findings.ts";
import { pendingLaunch } from "../loop/LoopNext.ts";
import { Recovery } from "../Recovery.ts";
import {
    type CommandOutcome,
    type Finding,
    type HistoryEntry,
    type State,
    type StateView,
    viewOf,
} from "../types.ts";
import {
    type CommandInputs,
    type RecordOptions,
    requireText,
    type TransitionOptions,
} from "./inputs.ts";

/** The non-serialized result carried alongside a transition's saved state. */
export type TransitionResult<TResult> = (state: StateView) => TResult;

/** A transition's single decision: refuse, change nothing, or write a state. */
export type TransitionPlan<TResult = StateView> =
    | { kind: "stop"; findings: Finding[] }
    | { kind: "noop"; result?: TransitionResult<TResult> }
    | {
          kind: "write";
          next: State;
          result?: TransitionResult<TResult>;
      };

export function stopPlan(findings: Finding[]): TransitionPlan {
    return { kind: "stop", findings };
}

export function noopPlan<TResult = StateView>(
    result?: TransitionResult<TResult>,
): TransitionPlan<TResult> {
    return { kind: "noop", result };
}

export function writePlan<TResult = StateView>(
    next: State,
    result?: TransitionResult<TResult>,
): TransitionPlan<TResult> {
    return { kind: "write", next, result };
}

/** A command's decision, checks, and optional history entry. */
export interface Transition<TOptions, TResult = StateView> {
    plan(state: State | null, options: TOptions): TransitionPlan<TResult>;
    warnings?(state: State | null, options: TOptions): Finding[];
    /** Whether the transition appends `historyEntry`; absent means it always does. */
    recordsHistory?(state: State | null, options: TOptions): boolean;
    /** The entry to append, built from the state before the transition; absent means the transition records none. */
    historyEntry?(state: State | null, options: TOptions): HistoryEntry;
    /** A missing `state.json` is created by the transition rather than recovered. */
    startsFresh?: boolean;
    /** With no usable state, start it with this step's transition (its state, history entry, and warnings) before this one applies. */
    startsAs?: StepTransition<RecordOptions>;
}

/** A step's transition: it always records a history entry. */
export type StepTransition<TOptions> = Transition<TOptions, StateView> & {
    historyEntry(state: State | null, options: TOptions): HistoryEntry;
};

/**
 * The one write path: loads state (recovering what is missing or
 * invalid), runs the checks, and saves. A hard stop writes nothing; a
 * no-op writes only what recovery rebuilt; a dry run writes nothing.
 */
export function transition<
    TOptions extends TransitionOptions,
    TResult = StateView,
>(
    inputs: CommandInputs,
    options: TOptions,
    plan: Transition<TOptions, TResult>,
): CommandOutcome<TResult> {
    const loaded = loadForWrite(inputs, plan.startsFresh === true);
    const { recovered } = loaded;
    let { state } = loaded;
    let findings: Finding[] = [];
    if (state === null && plan.startsAs !== undefined) {
        const start = plan.startsAs;
        const started = start.plan(null, {});
        if (started.kind !== "write") {
            throw new StateInvalidError({
                code: "state-invalid",
                message: "startsAs transition did not produce a state",
            });
        }
        state = {
            ...started.next,
            history: [start.historyEntry(null, {})],
        };
        findings = start.warnings?.(null, {}) ?? [];
    }

    const decision = plan.plan(state, options);
    if (decision.kind === "stop") {
        return { exitCode: 1, findings: decision.findings, wrote: false };
    }

    findings = [...findings, ...(plan.warnings?.(state, options) ?? [])];
    const proposed = decision.kind === "write" ? decision.next : null;
    // A recovery is written even when the step itself changes nothing.
    if (proposed === null && !recovered) {
        return {
            exitCode: 0,
            result: resultOf(decision.result, state),
            findings,
            wrote: false,
        };
    }

    const entry =
        plan.recordsHistory?.(state, options) === false
            ? undefined
            : plan.historyEntry?.(state, options);
    const next =
        proposed === null
            ? (state as State)
            : entry === undefined
              ? proposed
              : { ...proposed, history: [...proposed.history, entry] };
    const saved = inputs.services.store.save(next, {
        dryRun: options.dryRun,
    });

    return {
        exitCode: 0,
        result: resultOf(decision.result, saved.state),
        findings,
        wrote: saved.wrote,
    };
}

/**
 * `record <step>` on top of `transition`: validates `--reason`, warns of
 * an open loop launch, and treats re-recording `currentStep` with the same
 * mode, phase, label, and reason as a no-op.
 */
export function recordStep<TOptions extends RecordOptions>(
    inputs: CommandInputs,
    step: HistoryEntry["step"],
    plan: StepTransition<TOptions>,
    options: TOptions,
    validate: (options: TOptions) => void = () => {},
): CommandOutcome<StateView> {
    if (options.reason !== undefined) requireText(options.reason, "--reason");
    validate(options);
    return transition(inputs, options, {
        ...plan,
        startsFresh: step === "init",
        warnings(state: State | null, opts: TOptions): Finding[] {
            return [
                ...(plan.warnings?.(state, opts) ?? []),
                ...loopActive(state),
            ];
        },
        plan(state: State | null, opts: TOptions): TransitionPlan<StateView> {
            const stepped = plan.plan(state, opts);
            if (stepped.kind !== "write") return stepped;
            // Resuming work is itself evidence the feature isn't done anymore.
            const proposed =
                stepped.next.completed === true
                    ? withoutCompleted(stepped.next)
                    : stepped.next;
            if (
                state !== null &&
                state.currentStep === step &&
                repeatsLast(state, plan.historyEntry(state, opts)) &&
                sameApartFromDecisions(proposed, state)
            ) {
                return { kind: "noop" };
            }
            return { ...stepped, next: proposed };
        },
    });
}

/** Builds the public result from the saved state and an optional internal payload. */
function resultOf<TResult>(
    result: TransitionResult<TResult> | undefined,
    state: State | null,
): TResult | undefined {
    if (state === null) return undefined;
    const view = viewOf(state);
    return result === undefined ? (view as TResult) : result(view);
}

/** A `loop-active` warning while a launch is open on a running loop: an agent may still be working. */
function loopActive(state: State | null): Finding[] {
    if (state === null) return [];
    const { loop } = state;
    if (
        loop === undefined ||
        loop.cycle === "done" ||
        loop.stoppedReason !== null ||
        state.blockers.length > 0
    ) {
        return [];
    }
    const pending = pendingLaunch(state.history, loop);
    return pending === null
        ? []
        : [Findings.loopActive(pending.launch, loop.phase)];
}

/** Whether two states match, ignoring `decisions`. */
function sameApartFromDecisions(a: State, b: State): boolean {
    return sameState({ ...a, decisions: [] }, { ...b, decisions: [] });
}

/** The state with `completed` removed; it is stored only when true. */
function withoutCompleted({ completed: _, ...rest }: State): State {
    return rest;
}

/** Whether `entry` matches the last history entry for its step in mode, phase, label, and reason. */
function repeatsLast(state: State, entry: HistoryEntry): boolean {
    const last = state.history.filter((h) => h.step === entry.step).at(-1);
    return (
        last !== undefined &&
        last.mode === entry.mode &&
        last.phase === entry.phase &&
        last.label === entry.label &&
        last.reason === entry.reason
    );
}

/** The history-entry `reason` member, present only when one was supplied. */
export function reasonOf(options: RecordOptions): { reason?: string } {
    return options.reason !== undefined ? { reason: options.reason } : {};
}

/** Structural equality: object key order does not matter, array order does, and an `undefined` member reads as absent (as it does once serialized). */
export function sameState(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return (
            Array.isArray(a) &&
            Array.isArray(b) &&
            a.length === b.length &&
            a.every((item, index) => sameState(item, b[index]))
        );
    }
    if (
        typeof a !== "object" ||
        typeof b !== "object" ||
        a === null ||
        b === null
    ) {
        return false;
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (!sameState(left[key], right[key])) return false;
    }
    return true;
}

/** A fresh feature's initial `state.json` values. */
export function initialState(feature: string): State {
    return {
        feature,
        currentStep: "init",
        blockers: [],
        decisions: [],
        history: [],
    };
}

/** State loaded for a write; `recovered` when recovery rebuilt or discovered anything, which is always written. */
interface LoadedState {
    state: State | null;
    recovered: boolean;
}

/**
 * Loads state for a write, rebuilding what is missing or invalid from
 * workspace evidence (noted by one recovery history entry naming the
 * rebuilt fields) and discovering unrecorded reviews. `null` means there
 * is no file and nothing beyond the initial position to recover, or the
 * command creates state itself (`startsFresh`). Ambiguous evidence throws
 * (exit 3); nothing is written.
 */
function loadForWrite(
    { services, context }: CommandInputs,
    startsFresh: boolean,
): LoadedState {
    const { store, workspace, clock } = services;
    const loaded = store.load();
    if (loaded.kind === "missing" && startsFresh) {
        return { state: null, recovered: false };
    }
    const result = new Recovery(workspace, clock, context.feature).recover(
        loaded,
    );
    if (result.kind === "ambiguous")
        throw new StateInvalidError(result.finding);

    const { state, reconstructed, discovered } = result;
    if (reconstructed.length === 0) {
        return { state, recovered: discovered.length > 0 };
    }
    if (loaded.kind === "missing" && state.currentStep === "init") {
        return { state: null, recovered: false };
    }
    return {
        state: {
            ...state,
            history: [
                ...state.history,
                {
                    step: state.currentStep,
                    timestamp: clock.now(),
                    reason: `recovered from workspace evidence: ${reconstructed.join(", ")}`,
                },
            ],
        },
        recovered: true,
    };
}

import { reviewPath } from "../../../workspace/Workspace.ts";
import { UsageError } from "../../errors.ts";
import { Findings } from "../../Findings.ts";
import {
    conditionsOf,
    historySinceStop,
    isImplementerLaunch,
    passes,
} from "../../loop/helpers.ts";
import {
    launchEntries,
    launchKind,
    type PendingLaunch,
    pendingLaunch,
} from "../../loop/LoopNext.ts";
import {
    type ImplementerResult,
    implementerOutcome,
    implementerResults,
    reviewerOutcome,
} from "../../loop/outcomes.ts";
import type {
    CommandOutcome,
    HistoryEntry,
    LoopBlock,
    Outcome,
    PhaseId,
    State,
    StateView,
    Verdict,
} from "../../types.ts";
import {
    type CommandInputs,
    requireText,
    type TransitionOptions,
} from "../inputs.ts";
import {
    actorOf,
    type LoopActor,
    type LoopDecision,
    type LoopLaunch,
    loopTransition,
    noChange,
    refuses,
    validateActor,
    validateLaunch,
    writes,
} from "./shared.ts";

export interface LoopEndOptions extends TransitionOptions {
    action: LoopLaunch;
    result?: ImplementerResult;
    note?: string;
    by?: LoopActor;
}

export interface LoopEndResult {
    action: LoopLaunch;
    phase: PhaseId;
    /** Absent when the loop is done and nothing was recorded. */
    outcome?: Outcome;
    state: StateView;
    verdict?: Verdict;
    /** The loop was already done (finished or abandoned), so the end changed nothing. */
    done?: true;
}

/** An open launch being ended, once the loop and the launch are checked. */
interface Ending {
    inputs: CommandInputs;
    state: State;
    loop: LoopBlock;
    options: LoopEndOptions;
    launch: PendingLaunch;
}

/** What the end records: its outcome, and the loop and history changes it brings. */
interface Recorded {
    outcome: Outcome;
    loop: Partial<LoopBlock>;
    entry: Partial<HistoryEntry>;
    blockers?: string[];
    verdict?: Verdict;
}

/** Records the outcome of an open launch, read from disk. */
export function loopEnd(
    inputs: CommandInputs,
    options: LoopEndOptions,
): CommandOutcome<LoopEndResult> {
    validateOptions(options);
    return loopTransition(inputs, options, (state) =>
        decideEnd(inputs, options, state),
    );
}

function decideEnd(
    inputs: CommandInputs,
    options: LoopEndOptions,
    state: State | null,
): LoopDecision<LoopEndResult> {
    if (state?.loop === undefined) {
        return refuses(Findings.loopRefused("--end", "no loop has started"));
    }
    const { loop } = state;
    if (loop.cycle === "done") {
        return noChange({
            action: options.action,
            phase: loop.phase,
            done: true,
        });
    }
    const launch = pendingLaunch(state.history, loop);
    if (launch?.launch !== options.action) {
        const repeat =
            launch === null
                ? repeatedEnd(state.history, loop, options.action)
                : undefined;
        if (repeat?.outcome !== undefined) {
            return noChange({
                action: options.action,
                phase: loop.phase,
                outcome: repeat.outcome,
            });
        }
        return refuses(
            Findings.loopRefused(
                `--end ${options.action}`,
                `no ${options.action} launch is open`,
            ),
        );
    }
    if (loop.stoppedReason !== null) {
        return refuses(
            Findings.loopRefused(
                `--end ${options.action}`,
                "the loop is stopped; acknowledge it with loop --ok",
            ),
        );
    }

    const ending = { inputs, state, loop, options, launch };
    const recorded = isImplementerLaunch(options.action)
        ? endImplementer(ending, options.action)
        : endReviewer(ending);
    const bounded = incompleteTwice(ending, recorded)
        ? stopped(`${describe(ending)} returned incomplete twice`)
        : recorded;
    const next: State = {
        ...state,
        currentStep: "implement",
        blockers: bounded.blockers ?? state.blockers,
        loop: { ...loop, ...bounded.loop },
        history: [
            ...state.history,
            {
                step: isImplementerLaunch(options.action)
                    ? "implement"
                    : "checkpoint",
                timestamp: inputs.services.clock.now(),
                phase: loop.phase,
                ...(launch.label !== undefined
                    ? {
                          label: launch.label,
                          artifact: reviewPath(launch.label),
                      }
                    : {}),
                by: actorOf(options),
                outcome: bounded.outcome,
                ...bounded.entry,
            },
        ],
    };
    return writes(next, {
        action: options.action,
        phase: loop.phase,
        outcome: bounded.outcome,
        ...(bounded.verdict !== undefined ? { verdict: bounded.verdict } : {}),
    });
}

function endImplementer(
    { inputs, state, loop, options }: Ending,
    action: "implement" | "repair",
): Recorded {
    const outcome = implementerOutcome({
        action,
        loop,
        workspace: inputs.services.workspace,
        result: options.result,
    });
    const { note } = options;
    const entry = note !== undefined ? { reason: note } : {};
    if (outcome === "STOPPED") {
        return {
            ...stopped(
                action === "implement"
                    ? "implementer STOPPED"
                    : "repair STOPPED",
            ),
            entry,
            blockers:
                note !== undefined && !state.blockers.includes(note)
                    ? [...state.blockers, note]
                    : state.blockers,
        };
    }
    if (outcome === "incomplete") return { outcome, loop: {}, entry };
    return {
        outcome,
        loop: { cycle: action === "implement" ? "review" : "re-review" },
        entry,
    };
}

function endReviewer({ inputs, loop, launch }: Ending): Recorded {
    const { workspace } = inputs.services;
    const label = launch.label ?? "";
    const read = reviewerOutcome(workspace, label);
    if (read.kind === "incomplete") {
        return { outcome: "incomplete", loop: {}, entry: {} };
    }
    if (read.kind === "stopped") return stopped(read.stoppedReason);
    if (!passes(read.verdict)) {
        const repairBudgetSpent =
            workspace.review(`phase-${loop.phase}-chk2`) !== null;
        return repairBudgetSpent
            ? {
                  ...stopped(`checkpoint ${label} FAIL after repair`),
                  entry: { verdict: "FAIL" },
                  verdict: "FAIL",
              }
            : {
                  outcome: "COMPLETE",
                  loop: { cycle: "repair" },
                  entry: { verdict: "FAIL" },
                  verdict: "FAIL",
              };
    }
    const conditions = conditionsOf(read.conditions, loop.phase, label);
    return {
        outcome: "COMPLETE",
        loop: {
            cycle: "advance",
            conditions: [...loop.conditions, ...conditions],
        },
        entry: { verdict: read.verdict },
        verdict: read.verdict,
    };
}

function stopped(reason: string): Recorded {
    return {
        outcome: "STOPPED",
        loop: { stoppedReason: reason },
        entry: { reason },
    };
}

/** An `incomplete` end right after another `incomplete` end of the same launch, with no stop between them. */
function incompleteTwice(
    { state, loop, launch }: Ending,
    recorded: Recorded,
): boolean {
    if (recorded.outcome !== "incomplete") return false;
    const entries = launchEntries(historySinceStop(state.history), loop.phase);
    const previous = entries.at(-2);
    return (
        previous?.outcome === "incomplete" &&
        previous.step === entries.at(-1)?.step &&
        previous.label === launch.label
    );
}

/** The phase's latest loop entry, when it ended a launch of `action`'s kind. */
function repeatedEnd(
    history: readonly HistoryEntry[],
    loop: LoopBlock,
    action: LoopLaunch,
): HistoryEntry | undefined {
    const [begin, end] = launchEntries(history, loop.phase).slice(-2);
    if (begin === undefined || end?.outcome === undefined) return undefined;
    const ended = launchKind(begin);
    return ended === action ? end : undefined;
}

function describe({ options, launch }: Ending): string {
    return launch.label !== undefined
        ? `${options.action} ${launch.label}`
        : options.action;
}

function validateOptions(options: LoopEndOptions): void {
    validateLaunch(options.action, "--end");
    if (
        options.result !== undefined &&
        !implementerResults.includes(options.result)
    ) {
        throw new UsageError(
            `--result must be ${implementerResults.join(" or ")}`,
        );
    }
    const implementer = isImplementerLaunch(options.action);
    if (options.result !== undefined && !implementer) {
        throw new UsageError(
            "--result is allowed only when ending implement or repair",
        );
    }
    if (options.note !== undefined && !implementer) {
        throw new UsageError(
            "--note is allowed only when ending implement or repair",
        );
    }
    if (options.note !== undefined) requireText(options.note, "--note");
    validateActor(options.by);
}

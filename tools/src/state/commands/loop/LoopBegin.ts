import { reviewPath } from "../../../workspace/Workspace.ts";
import { UsageError } from "../../errors.ts";
import { Findings } from "../../Findings.ts";
import { isFreshPhase, needsBase, resolveCommitMode } from "../../loop/base.ts";
import { nextLoopAction } from "../../loop/LoopNext.ts";
import { phaseDiff } from "../../phaseDiff.ts";
import type {
    CommandOutcome,
    CommitMode,
    HistoryEntry,
    LoopBlock,
    PhaseId,
    State,
    StateView,
} from "../../types.ts";
import { validateCommitMode } from "../Implement.ts";
import type { CommandInputs, TransitionOptions } from "../inputs.ts";
import {
    actorOf,
    type LoopActor,
    type LoopDecision,
    type LoopLaunch,
    loopTransition,
    refuses,
    validateActor,
    validateLaunch,
    writes,
} from "./shared.ts";

export interface LoopBeginOptions extends TransitionOptions {
    action: LoopLaunch;
    commitMode?: CommitMode;
    by?: LoopActor;
}

export interface LoopBeginResult {
    action: LoopLaunch;
    phase: PhaseId;
    state: StateView;
    commitMode?: CommitMode;
    mode?: "repair";
    review?: string;
    label?: string;
    diff?: string;
}

/** A launch's inputs once the loop and the requested action are checked. */
interface Launch {
    inputs: CommandInputs;
    state: State;
    loop: LoopBlock;
    options: LoopBeginOptions;
}

/** Records launch state before an unattended implementer or reviewer starts. */
export function loopBegin(
    inputs: CommandInputs,
    options: LoopBeginOptions,
): CommandOutcome<LoopBeginResult> {
    validateOptions(options);
    return loopTransition(inputs, options, (state) =>
        decideBegin(inputs, options, state),
    );
}

function decideBegin(
    inputs: CommandInputs,
    options: LoopBeginOptions,
    state: State | null,
): LoopDecision<LoopBeginResult> {
    const { services } = inputs;
    if (state?.loop === undefined) {
        return refuses(
            Findings.loopRefused(
                `--begin ${options.action}`,
                "no loop has started",
            ),
        );
    }

    const expected = nextLoopAction(
        state,
        services.workspace,
        services.git,
    ).next;
    if (expected === null || expected.action !== options.action) {
        return refuses(
            Findings.loopRefused(
                `--begin ${options.action}`,
                `report recommends ${expected?.action ?? "no action"}`,
            ),
        );
    }

    const launch = { inputs, state, loop: state.loop, options };
    if (expected.action === "review" || expected.action === "re-review") {
        return beginReview(launch, expected.label);
    }
    return options.action === "implement"
        ? beginImplement(launch)
        : beginRepair(launch);
}

function beginImplement({
    inputs,
    state,
    loop,
    options,
}: Launch): LoopDecision<LoopBeginResult> {
    const { workspace, git } = inputs.services;
    const fresh = isFreshPhase(state, workspace, loop.phase);
    const commitMode = resolveCommitMode({
        state,
        fresh,
        explicit: options.commitMode,
        explicitWinsWhenKept: false,
    });
    const next: State = {
        ...state,
        currentStep: "implement",
        planPhase: loop.phase,
        phaseBaseSha: needsBase(state, loop.phase)
            ? git.head()
            : state.phaseBaseSha,
        commitMode,
        loop: { ...loop, cycle: "implement" },
        history: [
            ...state.history,
            launchEntry(inputs, loop, options, { mode: commitMode }),
        ],
    };
    return writes(next, {
        action: "implement",
        phase: loop.phase,
        commitMode,
    });
}

function beginRepair({
    inputs,
    state,
    loop,
    options,
}: Launch): LoopDecision<LoopBeginResult> {
    const failed = state.history.findLast(
        (entry) =>
            entry.step === "checkpoint" &&
            entry.phase === loop.phase &&
            entry.verdict === "FAIL" &&
            entry.label !== undefined,
    );
    if (failed?.label === undefined) {
        return refuses(
            Findings.loopRefused(
                "--begin repair",
                "no failed checkpoint is recorded for the phase",
            ),
        );
    }
    const next: State = {
        ...state,
        currentStep: "implement",
        planPhase: loop.phase,
        loop: { ...loop, cycle: "repair" },
        history: [
            ...state.history,
            launchEntry(inputs, loop, options, { mode: "repair" }),
        ],
    };
    return writes(next, {
        action: "repair",
        phase: loop.phase,
        mode: "repair",
        review: reviewPath(failed.label),
    });
}

function beginReview(
    { inputs, state, loop, options }: Launch,
    label: string,
): LoopDecision<LoopBeginResult> {
    const base = state.phaseBaseSha ?? null;
    if (base === null) {
        return refuses(
            Findings.loopRefused(
                `--begin ${options.action}`,
                "the phase has no base; start it with loop --begin implement or record implement --phase",
            ),
        );
    }
    const next: State = {
        ...state,
        currentStep: "checkpoint",
        loop: { ...loop, cycle: options.action },
        history: [
            ...state.history,
            launchEntry(inputs, loop, options, {
                step: "checkpoint",
                label,
                ...(options.action === "re-review"
                    ? { mode: "re-review" }
                    : {}),
            }),
        ],
    };
    return writes(next, {
        action: options.action,
        phase: loop.phase,
        label,
        diff: phaseDiff(base, inputs.services.git),
    });
}

/** The launch's history entry; an implementer launch is recorded as `implement`. */
function launchEntry(
    inputs: CommandInputs,
    loop: LoopBlock,
    options: LoopBeginOptions,
    fields: Partial<HistoryEntry>,
): HistoryEntry {
    return {
        step: "implement",
        timestamp: inputs.services.clock.now(),
        phase: loop.phase,
        by: actorOf(options),
        ...fields,
    };
}

function validateOptions(options: LoopBeginOptions): void {
    validateLaunch(options.action, "--begin");
    if (options.commitMode !== undefined && options.action !== "implement") {
        throw new UsageError(
            "--commit-mode is allowed only with --begin implement",
        );
    }
    validateCommitMode(options.commitMode);
    validateActor(options.by);
}

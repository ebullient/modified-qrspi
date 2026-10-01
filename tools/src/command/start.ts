import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "../workspace/Git.ts";
import type { HistoryEntry, HistoryLog } from "../workspace/History.ts";
import {
    type LoopState,
    RepairAlreadySpentError,
} from "../workspace/LoopState.ts";
import { parseVerdict } from "../workspace/ReviewVerdict.ts";
import { reviewPath } from "../workspace/Workspace.ts";
import type { ActionHelp, CommandHelp } from "./Help.ts";
import { blocked, type CommandResult, ok, warn } from "./Result.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

const phaseFlag = {
    flag: "--phase <id>",
    required: true,
    description: "The phase this unit of work targets.",
};

const loopFlag = {
    flag: "--loop",
    required: false,
    description:
        "Write the pre-spawn crash-safety intent to loop-state.json before the caller spawns its agent.",
};

const baseFlag = {
    flag: "--base <commit-ish>",
    required: false,
    description:
        "Explicitly overwrite loop-state.json's recorded base for this phase. Fixes base-not-ancestor/phase-base-reset; --loop only.",
};

const implementHelp: ActionHelp = {
    name: "implement",
    summary: "Confirm it's clear to implement <phase>, or report why not.",
    flags: [...commonOptions, phaseFlag, loopFlag, baseFlag],
    example:
        "qrspi-x start implement --feature widget --project . --phase 1 --loop",
};

const reviewHelp: ActionHelp = {
    name: "review",
    summary: "Confirm it's clear to review <phase>, or report why not.",
    flags: [...commonOptions, phaseFlag, loopFlag, baseFlag],
    example:
        "qrspi-x start review --feature widget --project . --phase 1 --loop",
};

const repairHelp: ActionHelp = {
    name: "repair",
    summary:
        "Confirm it's clear to repair <phase>'s last FAIL, or report why not.",
    flags: [...commonOptions, phaseFlag, loopFlag],
    example:
        "qrspi-x start repair --feature widget --project . --phase 1 --loop",
};

export const help: CommandHelp = {
    name: "start",
    summary:
        "Begin implement/review/repair: confirm ready, or report blockers.",
    actions: [implementHelp, reviewHelp, repairHelp],
};

export type StartOpts = {
    feature: string;
    project: string;
    phase: string;
    loop?: boolean;
    /**
     * Explicitly overwrites loop-state.json's recorded base for this
     * phase — the one caller-driven way a base ever changes after it's
     * first set. Never inferred automatically.
     */
    base?: string;
};

/**
 * `implement`/`review` share the same --loop base bookkeeping: an
 * explicit --base always wins outright; otherwise, an already-recorded
 * base is checked for ancestry (not equality — forward progress changes
 * HEAD on every commit, which is not a reset) and a missing base despite
 * work already begun is its own, separate finding. Returns the base to
 * record and, when one applies, the finding to report alongside the
 * call's own payload.
 */
async function resolveBase(
    opts: StartOpts,
    git: Git,
    loopState: LoopState,
    hasWorkBegun: () => Promise<boolean>,
): Promise<{
    baseSha: string;
    resetBase: boolean;
    finding?: { code: string; message: string };
}> {
    if (opts.base !== undefined) {
        return { baseSha: opts.base, resetBase: true };
    }

    const state = await loopState.read();
    const recordedBase = state?.bases[opts.phase];

    if (recordedBase === undefined) {
        if (await hasWorkBegun()) {
            return {
                baseSha: await git.headSha(),
                resetBase: false,
                finding: {
                    code: "phase-base-reset",
                    message: `Phase ${opts.phase} has steps begun but no base recorded; its checkpoint diff will start at the current commit. Pass --base <commit-ish> to point at where its work actually began.`,
                },
            };
        }
        return { baseSha: await git.headSha(), resetBase: false };
    }

    if (!(await git.isAncestor(recordedBase))) {
        return {
            baseSha: recordedBase,
            resetBase: false,
            finding: {
                code: "base-not-ancestor",
                message: `Phase ${opts.phase}'s recorded base ${recordedBase} is no longer an ancestor of HEAD; retry with --base <commit-ish>.`,
            },
        };
    }

    return { baseSha: recordedBase, resetBase: false };
}

/**
 * Always appends {kind, action: "begin", ...rest}, closing the loop with
 * `log`'s matching "end" — un-parking falls out of this
 * for free, since a begin is a non-"note", non-"park" kind. Idempotent per
 * filter: skipped if the last matching entry is already an
 * unclosed begin, which is what makes a crash-retry of `start` safe.
 */
async function writeBegin(
    history: HistoryLog,
    kind: string,
    filter: Record<string, string>,
    rest: Record<string, unknown> = {},
): Promise<void> {
    await history.conditionalAppend({ kind, ...filter }, { action: "begin" }, {
        kind,
        action: "begin",
        ...filter,
        ...rest,
    } as HistoryEntry);
}

/**
 * `start <task>` is the same call for a human-gated skill and for
 * autoloop's spawned agent — only `--loop` differs, writing the
 * pre-spawn crash-safety intent to loop-state.json.
 * Services are injectable so tests don't need a real repo/workspace on
 * disk — a test overriding just `history` (the common case) names only
 * that field; everything else still resolves to the real root-backed
 * instance.
 */
export async function implement(
    opts: StartOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { workspace, loopState, history, git } = resolveServices(
        root,
        opts.project,
        services,
    );

    if (!(await git.isClean())) {
        return blocked([
            { code: "dirty-tree", message: "working tree is not clean" },
        ]);
    }

    const progress = await workspace.checkProgress(opts.phase);
    if (!progress.dependenciesSatisfied) {
        return blocked([
            {
                code: "incomplete-dependency",
                message: `Phase ${opts.phase} depends on a phase that isn't done yet.`,
            },
        ]);
    }

    if (!opts.loop) {
        await writeBegin(history, "implement", { phase: opts.phase });
        return ok({ phaseId: opts.phase });
    }

    const { baseSha, resetBase, finding } = await resolveBase(
        opts,
        git,
        loopState,
        async () => progress.complete > 0,
    );
    await loopState.writeInFlight("implement", opts.phase, {
        baseSha,
        resetBase,
    });
    await writeBegin(history, "implement", { phase: opts.phase });

    return finding
        ? warn({ phaseId: opts.phase }, [finding])
        : ok({ phaseId: opts.phase });
}

export async function review(
    opts: StartOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { workspace, loopState, history, git } = resolveServices(
        root,
        opts.project,
        services,
    );

    if (!(await workspace.isPhaseComplete(opts.phase))) {
        return blocked([
            {
                code: "phase-not-complete",
                message: `Phase ${opts.phase}'s steps aren't all [x] yet.`,
            },
        ]);
    }

    const state = opts.loop ? await loopState.read() : undefined;
    const inFlightLabel =
        state?.inFlight?.task === "review" &&
        state.inFlight.phaseId === opts.phase
            ? state.inFlight.label
            : undefined;
    let label = inFlightLabel;

    if (label === undefined) {
        label = await workspace.pendingReviewLabel(opts.phase);
    }

    if (label === undefined) {
        label = await workspace.nextLabel("review", { phase: opts.phase });
    }

    if (!opts.loop) {
        await writeBegin(history, "review", { label }, { phase: opts.phase });
        return ok({ label });
    }

    const progress = await workspace.checkProgress(opts.phase);

    const { baseSha, resetBase, finding } = await resolveBase(
        opts,
        git,
        loopState,
        // review only ever runs after implement has started the phase
        // under --loop, so a missing base here means the same thing as
        // for implement: work is underway with nothing recorded.
        async () => progress.complete > 0,
    );
    await loopState.writeInFlight("review", opts.phase, {
        label,
        baseSha,
        resetBase,
    });
    await writeBegin(history, "review", { label }, { phase: opts.phase });

    const diff = `git diff ${baseSha}..HEAD`;

    return finding ? warn({ label, diff }, [finding]) : ok({ label, diff });
}

/**
 * Under --loop, the FAIL that triggered this repair is loop-state.json's
 * own cached checkpoint — the same source LoopState.status() reads for
 * its "repair" action — not a fresh scan, since a scan would walk past
 * it to the re-review once one exists. Without --loop there's no
 * checkpoint, so the bare case scans reviews/ for the phase's own last
 * entry directly.
 */
export async function repair(
    opts: StartOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { workspace, loopState, history } = resolveServices(
        root,
        opts.project,
        services,
    );

    const state = await loopState.read();
    const path =
        opts.loop && state?.checkpoint
            ? reviewPath(state.checkpoint.label)
            : await workspace.lastFile("review", { phase: opts.phase });

    if (path === undefined) {
        return blocked([
            {
                code: "no-fail-review",
                message: `No review exists yet for phase ${opts.phase}.`,
            },
        ]);
    }
    const text = await readFile(join(root, path), "utf8");
    if (parseVerdict(text) !== "FAIL") {
        return blocked([
            {
                code: "no-fail-review",
                message: `Phase ${opts.phase}'s last review (${path}) isn't a FAIL.`,
            },
        ]);
    }

    if (!opts.loop) {
        await writeBegin(history, "repair", { phase: opts.phase });
        return ok({ review: path });
    }

    try {
        await loopState.writeInFlight("repair", opts.phase);
    } catch (err) {
        if (err instanceof RepairAlreadySpentError) {
            return blocked([
                {
                    code: "repair-already-spent",
                    message: err.message,
                },
            ]);
        }
        throw err;
    }
    await writeBegin(history, "repair", { phase: opts.phase });
    return ok({ review: path });
}

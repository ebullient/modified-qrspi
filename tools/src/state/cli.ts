// Parses argv, dispatches `report`, `record <step>`, and `loop --<action>`, and prints the JSON envelope.

import { Workspace } from "../workspace/Workspace.ts";
import {
    createClock,
    createGitRunner,
    createStateFileSystem,
    createWorkspaceFileSystem,
} from "./adapters.ts";
import { recordImplement } from "./commands/Implement.ts";
import { recordInit } from "./commands/Init.ts";
import type { CommandInputs } from "./commands/inputs.ts";
import { loopAbandon } from "./commands/loop/LoopAbandon.ts";
import { loopAdvance } from "./commands/loop/LoopAdvance.ts";
import { loopBegin } from "./commands/loop/LoopBegin.ts";
import { loopEnd } from "./commands/loop/LoopEnd.ts";
import { loopOk } from "./commands/loop/LoopOk.ts";
import { loopStart } from "./commands/loop/LoopStart.ts";
import { loopStop } from "./commands/loop/LoopStop.ts";
import type { LoopActor, LoopLaunch } from "./commands/loop/shared.ts";
import { recordPlan } from "./commands/Plan.ts";
import { type QueryOptions, recordQuery } from "./commands/Query.ts";
import { recordDecision, recordDone } from "./commands/Record.ts";
import { reportFeature } from "./commands/Report.ts";
import { recordResearch } from "./commands/Research.ts";
import { recordReview } from "./commands/Review.ts";
import { recordShape } from "./commands/Shape.ts";
import { recordSpec } from "./commands/Spec.ts";
import {
    EvidenceInaccessibleError,
    InternalError,
    StateInvalidError,
    UsageError,
} from "./errors.ts";
import {
    commandHelp,
    type OptionHelp,
    renderCommandHelp,
    renderFormHelp,
    renderToolHelp,
} from "./help.ts";
import { isKebab, kebabSource } from "./ids.ts";
import type { ImplementerResult } from "./loop/outcomes.ts";
import { Store } from "./store/Store.ts";
import {
    type CommandOutcome,
    type CommitMode,
    type Finding,
    stateFileName,
    workflowOrder,
} from "./types.ts";

declare const __QRSPI_VERSION__: string;

const commands = ["report", "record", "loop"] as const;
const recordSteps = [...workflowOrder, "decision", "done"] as const;
type RecordStep = (typeof recordSteps)[number];
const loopActions = [
    "--start",
    "--begin",
    "--end",
    "--advance",
    "--stop",
    "--ok",
    "--abandon",
] as const;

export interface Io {
    cwd: string;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
}

/** Runs the CLI against `argv` (excluding `node`/script path) and returns the process exit code. */
export function main(argv: string[], io: Io = processIo()): number {
    if (argv.length === 0) {
        io.stdout(renderToolHelp(version()));
        return 0;
    }

    if (argv[0] === "--version") {
        io.stdout(JSON.stringify({ version: version() }));
        return 0;
    }

    if (argv[0] === "--help" || argv[0] === "-h") {
        // `--help`, `--help <command>`, or `--help <command> <step|action>`.
        return emitHelp(io, argv.slice(1));
    }

    const command = argv[0] as string;
    if (!(commands as readonly string[]).includes(command)) {
        if (argv.includes("--version")) {
            io.stdout(JSON.stringify({ version: version() }));
            return 0;
        }
        return fail(io, new UsageError(`Unknown command "${command}"`));
    }

    // Help and version flags count only where no option is consuming a value.
    const free = freeFlagIndexes(command, argv);
    if (free.some((i) => argv[i] === "--version")) {
        io.stdout(JSON.stringify({ version: version() }));
        return 0;
    }
    const helpAt = new Set(
        free.filter((i) => argv[i] === "--help" || argv[i] === "-h"),
    );
    if (helpAt.size > 0) {
        // `<command> --help` or `<command> <step|action> --help`.
        return emitHelp(
            io,
            argv.filter((_, i) => !helpAt.has(i)),
        );
    }

    let form = command;
    let feature: string | undefined;
    try {
        form = formOf(command, argv.slice(1));
        const rest = argv.slice(command === "record" ? 2 : 1);
        const options = parseOptions(form, rest, io.cwd);
        feature = options.feature;
        const outcome = run(form, options);
        return emit(io, form, options.feature, outcome);
    } catch (error) {
        return fail(io, error, form, feature);
    }
}

/**
 * Prints help at the level the arguments name: the tool, one command, or one
 * form. `args` excludes the help flag itself.
 */
function emitHelp(io: Io, args: string[]): number {
    // Options may trail the help request (`--help --feature x`); only a bare
    // word selects a command.
    const command = args[0]?.startsWith("--") ? undefined : args[0];
    if (command === undefined) {
        io.stdout(renderToolHelp(version()));
        return 0;
    }
    if (!(commands as readonly string[]).includes(command)) {
        return fail(io, new UsageError(`Unknown command "${command}"`));
    }

    // A step or action after the command selects one form.
    const selector = args[1];
    if (selector !== undefined && !selector.startsWith("--")) {
        const form = renderFormHelp(`${command} ${selector}`, version());
        if (form === undefined) {
            return fail(
                io,
                new UsageError(`Unknown ${command} form "${selector}"`),
            );
        }
        io.stdout(form);
        return 0;
    }
    // `loop` names its forms with the action flag itself.
    if (command === "loop" && selector !== undefined) {
        const action = selector.split("=")[0] as string;
        const form = renderFormHelp(`loop ${action}`, version());
        if (form !== undefined) {
            io.stdout(form);
            return 0;
        }
    }

    // command was already validated against `commands` above.
    io.stdout(renderCommandHelp(command, version()) as string);
    return 0;
}

function processIo(): Io {
    return {
        cwd: process.cwd(),
        stdout: (line) => process.stdout.write(`${line}\n`),
        stderr: (line) => process.stderr.write(`${line}\n`),
    };
}

/**
 * Indexes of the tokens after the command that are not the separated value of a
 * preceding option, so `--text --help` is a value error rather than a help request.
 */
function freeFlagIndexes(command: string, argv: string[]): number[] {
    let form: string | undefined;
    try {
        form = formOf(command, argv.slice(1));
    } catch {
        // No form yet (`record --help`): only the common options take values.
    }
    const declared = form === undefined ? undefined : declaredOptions(form);
    const loopAction = form?.startsWith("loop ") ? form.slice(5) : undefined;
    const free: number[] = [];
    for (let i = 1; i < argv.length; i++) {
        const token = argv[i] as string;
        const takesValue =
            token === "--feature" ||
            token === "--project" ||
            (token !== "--dry-run" && declared?.has(token) === true);
        if (takesValue && token !== loopAction) {
            i++;
        } else if (token === loopAction) {
            const next = argv[i + 1];
            if (
                declared?.get(token)?.required === true ||
                (declared?.has(token) === true &&
                    next !== undefined &&
                    !next.startsWith("--"))
            ) {
                i++;
            }
        } else {
            free.push(i);
        }
    }
    return free;
}

/** The command form (`report`, `record <step>`, or `loop --<action>`) the arguments name. */
function formOf(command: string, args: string[]): string {
    if (command === "loop") return loopFormOf(args);
    if (command === "report") return command;
    const step = args[0];
    if (
        step === undefined ||
        !(recordSteps as readonly string[]).includes(step)
    ) {
        throw new UsageError(
            `record requires a step: ${recordSteps.join(", ")}`,
        );
    }
    return `record ${step}`;
}

/** Exactly one loop action flag, attached or separated. */
function loopFormOf(args: string[]): string {
    const actions = new Set(
        args
            .map((token) => token.split("=")[0] as string)
            .filter((arg) => (loopActions as readonly string[]).includes(arg)),
    );
    if (actions.size === 0) {
        throw new UsageError(
            `loop requires one action: ${loopActions.join(", ")}`,
        );
    }
    if (actions.size > 1) {
        throw new UsageError(
            `loop actions are mutually exclusive: ${[...actions].join(", ")}`,
        );
    }
    return `loop ${[...actions][0]}`;
}

interface ParsedOptions {
    feature: string;
    project: string;
    dryRun?: boolean;
    phase?: string;
    mode?: string;
    reason?: string;
    text?: string;
    label?: string;
    "commit-mode"?: string;
    base?: string;
    /** The loop action's value: a selector, launch action, or reason. */
    action?: string;
    result?: string;
    note?: string;
    by?: string;
}

/** The options a form declares in `commandHelp`, beyond `--feature` and `--project`. */
function declaredOptions(form: string): Map<string, OptionHelp> {
    const entry = commandHelp
        .flatMap((c) => c.forms)
        .find((f) => f.form === form);
    return new Map((entry?.options ?? []).map((o) => [o.name, o]));
}

/** Options that carry a value into `ParsedOptions` under their own name. */
type ValueOptionKey = Exclude<
    keyof ParsedOptions,
    "feature" | "project" | "dryRun" | "action"
>;

function parseOptions(
    form: string,
    args: string[],
    cwd: string,
): ParsedOptions {
    const declared = declaredOptions(form);
    const loopAction = form.startsWith("loop ") ? form.slice(5) : undefined;
    let feature: string | undefined;
    let project = cwd;
    const options: Omit<ParsedOptions, "feature" | "project"> = {};
    const rejected: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < args.length; i++) {
        const token = args[i] as string;
        // `--flag=value` lets a value start with `--`; the separated form rejects that.
        const eq = token.startsWith("--") ? token.indexOf("=") : -1;
        const arg = eq < 0 ? token : token.slice(0, eq);
        const value = () =>
            eq < 0
                ? requireValue(args, ++i, arg)
                : requireAttachedValue(token.slice(eq + 1), arg);

        if (arg.startsWith("--") && seen.has(arg)) {
            throw new UsageError(`${arg} was given more than once`);
        }
        seen.add(arg);
        if (arg === "--feature") {
            feature = value();
        } else if (arg === "--project") {
            project = value();
        } else if (arg === loopAction) {
            // An action flag takes a value only when the form declares one;
            // an optional one (`--ok`) may be left off.
            const actionOption = declared.get(arg);
            const next = args[i + 1];
            if (actionOption === undefined) {
                if (eq >= 0)
                    throw new UsageError(`${arg} does not take a value`);
            } else if (
                actionOption.required === true ||
                eq >= 0 ||
                (next !== undefined && !next.startsWith("--"))
            ) {
                options.action = value();
            }
        } else if (!declared.has(arg)) {
            rejected.push(token);
        } else if (arg === "--dry-run") {
            if (eq >= 0) throw new UsageError(`${arg} does not take a value`);
            options.dryRun = true;
        } else {
            options[arg.slice(2) as ValueOptionKey] = value();
        }
    }

    if (rejected.length > 0) {
        throw new UsageError(
            `Unsupported option(s) for ${form}: ${rejected.join(", ")}`,
        );
    }
    if (feature === undefined) {
        throw new UsageError("--feature is required");
    }
    if (!isKebab(feature) || feature === "explore") {
        throw new UsageError(
            `--feature "${feature}" must match ${kebabSource} and cannot be "explore"`,
        );
    }
    for (const option of declared.values()) {
        if (option.required !== true || option.name === loopAction) continue;
        if (options[option.name.slice(2) as ValueOptionKey] === undefined) {
            throw new UsageError(`${form} requires ${option.name}`);
        }
    }
    return { feature, project, ...options };
}

function requireAttachedValue(value: string, flag: string): string {
    if (value.trim() === "") {
        throw new UsageError(`${flag} requires a non-empty value`);
    }
    return value;
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index];
    if (value === undefined || value.trim() === "" || value.startsWith("--")) {
        throw new UsageError(`${flag} requires a non-empty value`);
    }
    return value;
}

function run(form: string, options: ParsedOptions): CommandOutcome<unknown> {
    const featureDir = `${options.project}/qrspi/${options.feature}`;
    const services = {
        store: new Store({
            feature: options.feature,
            path: `${featureDir}/${stateFileName}`,
            fileSystem: createStateFileSystem(),
        }),
        workspace: new Workspace(featureDir, createWorkspaceFileSystem()),
        git: createGitRunner(options.project),
        clock: createClock(),
    };
    const context = { feature: options.feature };
    const dryRun = options.dryRun === true ? { dryRun: true } : {};
    const commitMode =
        options["commit-mode"] !== undefined
            ? { commitMode: options["commit-mode"] as CommitMode }
            : {};

    if (form === "report") {
        return reportFeature(
            { services, context },
            options.phase !== undefined ? { phase: options.phase } : {},
        );
    }
    if (form.startsWith("loop ")) {
        return runLoop(
            form,
            options,
            { services, context },
            dryRun,
            commitMode,
        );
    }

    const inputs = { services, context };
    const common = {
        ...dryRun,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
    };
    // The step and its required options were checked by formOf/parseOptions;
    // each record function validates option values.
    const step = form.slice("record ".length) as RecordStep;
    switch (step) {
        case "init":
            return recordInit(inputs, common);
        case "research":
            return recordResearch(inputs, common);
        case "shape":
            return recordShape(inputs, common);
        case "query":
            return recordQuery(inputs, {
                ...common,
                mode: options.mode as QueryOptions["mode"],
            });
        case "spec":
        case "plan": {
            const revision = {
                ...common,
                ...(options.mode !== undefined
                    ? { mode: options.mode as "revision" }
                    : {}),
            };
            return step === "spec"
                ? recordSpec(inputs, revision)
                : recordPlan(inputs, revision);
        }
        case "implement":
            return recordImplement(inputs, {
                ...common,
                phase: options.phase as string,
                ...(options.base !== undefined ? { base: options.base } : {}),
                ...commitMode,
            });
        case "review":
            return recordReview(inputs, {
                ...common,
                label: options.label as string,
            });
        case "decision":
            return recordDecision(inputs, {
                ...dryRun,
                text: options.text as string,
            });
        case "done":
            return recordDone(inputs, dryRun);
    }
}

function runLoop(
    form: string,
    options: ParsedOptions,
    inputs: CommandInputs,
    dryRun: { dryRun?: boolean },
    commitMode: { commitMode?: CommitMode },
): CommandOutcome<unknown> {
    const by = options.by !== undefined ? { by: options.by as LoopActor } : {};
    // parseOptions guarantees a value for every action but --advance and --ok;
    // each loop action validates its values.
    const value = options.action as string;
    switch (form) {
        case "loop --start":
            return loopStart(inputs, { ...dryRun, selector: value });
        case "loop --begin":
            return loopBegin(inputs, {
                ...dryRun,
                ...by,
                action: value as LoopLaunch,
                ...commitMode,
            });
        case "loop --end":
            return loopEnd(inputs, {
                ...dryRun,
                ...by,
                action: value as LoopLaunch,
                ...(options.result !== undefined
                    ? { result: options.result as ImplementerResult }
                    : {}),
                ...(options.note !== undefined ? { note: options.note } : {}),
            });
        case "loop --advance":
            return loopAdvance(inputs, dryRun);
        case "loop --stop":
            return loopStop(inputs, { ...dryRun, reason: value });
        case "loop --abandon":
            return loopAbandon(inputs, { ...dryRun, reason: value });
        default:
            return loopOk(inputs, {
                ...dryRun,
                ...(options.action !== undefined
                    ? { reason: options.action }
                    : {}),
            });
    }
}

function emit(
    io: Io,
    command: string,
    feature: string,
    outcome: CommandOutcome<unknown>,
): number {
    const envelope = {
        ok: outcome.exitCode === 0,
        command,
        feature,
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        findings: outcome.findings,
        wrote: outcome.wrote,
    };
    io.stdout(JSON.stringify(envelope));
    return outcome.exitCode;
}

function fail(
    io: Io,
    error: unknown,
    command?: string,
    feature?: string,
): number {
    if (error instanceof UsageError) {
        // Usage errors go to stderr only; they are not findings.
        io.stderr(error.message);
        return error.exitCode;
    }
    if (error instanceof StateInvalidError) {
        return printError(io, command, feature, error.exitCode, [
            error.finding,
        ]);
    }
    if (error instanceof EvidenceInaccessibleError) {
        io.stderr(error.message);
        return printError(io, command, feature, error.exitCode, []);
    }
    if (error instanceof InternalError) {
        io.stderr(error.message);
        return error.exitCode;
    }
    io.stderr(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return 4;
}

function printError(
    io: Io,
    command: string | undefined,
    feature: string | undefined,
    exitCode: number,
    findings: Finding[],
): number {
    const envelope = {
        ok: false,
        command: command ?? null,
        ...(feature !== undefined ? { feature } : {}),
        findings,
        wrote: false,
    };
    io.stdout(JSON.stringify(envelope));
    return exitCode;
}

function version(): string {
    return typeof __QRSPI_VERSION__ === "string"
        ? __QRSPI_VERSION__
        : "0.0.0-dev";
}

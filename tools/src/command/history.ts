import type { HistoryEntry } from "../workspace/History.ts";
import type { ActionHelp, CommandHelp } from "./Help.ts";
import { type CommandResult, ok } from "./Result.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

const addHelp: ActionHelp = {
    name: "add",
    summary: "Append a selective 'what happened' entry to history.jsonl.",
    flags: [
        ...commonOptions,
        {
            flag: "--text <what happened>",
            required: true,
            description: "The fact worth recording, verbatim.",
        },
    ],
    example:
        'qrspi-x history add --text "Shape skipped" --feature widget --project .',
};

const readHelp: ActionHelp = {
    name: "read",
    summary: "Print matching history.json entries verbatim, as a JSON array.",
    flags: [
        ...commonOptions,
        {
            flag: "--tail <N>",
            required: false,
            description:
                "The last N matching entries. Default when neither --tail nor --all is given (N=20).",
        },
        {
            flag: "--all",
            required: false,
            description:
                "Every matching entry, no limit. Mutually exclusive with --tail.",
        },
        {
            flag: "--kind <task>",
            required: false,
            description: "Only entries whose kind matches (e.g. review, loop).",
        },
        {
            flag: "--phase <N>",
            required: false,
            description: "Only entries tagged with that phase.",
        },
    ],
    example:
        "qrspi-x history read --kind review --phase 2 --tail 5 --feature widget --project .",
};

export const help: CommandHelp = {
    name: "history",
    summary: "Selective timeline (what happened): add-only, filterable read.",
    actions: [addHelp, readHelp],
};

export type HistoryAddOpts = {
    feature: string;
    project: string;
    text: string;
};

export type HistoryReadOpts = {
    feature: string;
    project: string;
    tail?: number;
    all?: boolean;
    kind?: string;
    phase?: string;
};

export async function add(
    opts: HistoryAddOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { history } = resolveServices(root, opts.project, services);
    await history.append({ kind: "note", text: opts.text });
    return ok();
}

/**
 * Bare, like next-file: a JSON array, no wrapper
 */
export async function read(
    opts: HistoryReadOpts,
    services: Partial<Services> = {},
): Promise<HistoryEntry[]> {
    const root = resolveRoot(opts.project, opts.feature);
    const { history } = resolveServices(root, opts.project, services);
    return history.read({
        tail: opts.tail,
        all: opts.all,
        kind: opts.kind,
        phase: opts.phase,
    });
}

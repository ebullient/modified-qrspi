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
    summary: "Append <why> verbatim as one Markdown bullet to decisions.md.",
    flags: [
        ...commonOptions,
        {
            flag: "--text <why>",
            required: true,
            description: "The decision and its rationale, verbatim.",
        },
    ],
    example:
        'qrspi-x decision add --text "Skipping Shape: this feature is a one-file fix." --feature widget --project .',
};

const readHelp: ActionHelp = {
    name: "read",
    summary: "Print decisions.md verbatim.",
    flags: [...commonOptions],
    example: "qrspi-x decision read --feature widget --project .",
};

export const help: CommandHelp = {
    name: "decision",
    summary: "Durable rationale (why): add-only, read verbatim.",
    actions: [addHelp, readHelp],
};

export type DecisionAddOpts = {
    feature: string;
    project: string;
    text: string;
};

export type DecisionReadOpts = {
    feature: string;
    project: string;
};

export async function add(
    opts: DecisionAddOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { decisions } = resolveServices(root, opts.project, services);
    await decisions.add(opts.text);
    return ok();
}

/**
 * Bare, like next-file: decisions.md printed verbatim, no JSON wrapper
 */
export async function read(
    opts: DecisionReadOpts,
    services: Partial<Services> = {},
): Promise<string> {
    const root = resolveRoot(opts.project, opts.feature);
    const { decisions } = resolveServices(root, opts.project, services);
    return decisions.read();
}

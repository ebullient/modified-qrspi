import type { NextFileType } from "../workspace/Workspace.ts";
import type { CommandHelp } from "./Help.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

export const help: CommandHelp = {
    name: "next-file",
    summary:
        "Print the next artifact path for <type>: query, research, approach, spec, review, or final.",
    usage: "qrspi-x next-file <type> --feature <feature> --project <path> [--phase <id>] [--step <k>]",
    flags: [
        ...commonOptions,
        {
            flag: "--phase <id>",
            required: false,
            description: "The phase id; required for review artifacts.",
        },
        {
            flag: "--step <k>",
            required: false,
            description: "The step number for a step-scoped review.",
        },
    ],
};

const TYPES: NextFileType[] = [
    "query",
    "research",
    "approach",
    "spec",
    "review",
    "final",
];

export type NextFileOpts = {
    feature: string;
    project: string;
    phase?: string;
    step?: number;
};

/**
 * Not a peer of status/start/log/decision/history/loop: no envelope, no
 * CommandResult — just the bare relative path on success. Callers print
 * it to stdout as-is; a bad `<type>` or missing `--phase` for `review`
 * throws, for the caller to print as a one-line stderr message.
 */
export async function run(
    type: string,
    opts: NextFileOpts,
    services: Partial<Services> = {},
): Promise<string> {
    if (!TYPES.includes(type as NextFileType)) {
        throw new Error(
            `Unknown next-file type "${type}" (expected one of: ${TYPES.join(", ")}).`,
        );
    }
    if (type === "review" && opts.phase === undefined) {
        throw new Error("next-file review requires --phase <id>.");
    }

    const root = resolveRoot(opts.project, opts.feature);
    const { workspace } = resolveServices(root, opts.project, services);
    return workspace.nextFile(type as NextFileType, {
        phase: opts.phase,
        step: opts.step,
    });
}

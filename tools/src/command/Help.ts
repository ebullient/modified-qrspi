export type FlagHelp = {
    flag: string;
    required: boolean;
    description: string;
};

export type ActionHelp = {
    name: string;
    summary: string;
    usage?: string;
    flags?: FlagHelp[];
    example?: string;
    examples?: string[];
};

export type CommandHelp = {
    name: string;
    summary: string;
    usage?: string;
    flags?: FlagHelp[];
    actions?: ActionHelp[];
};

/**
 * Three levels of disclosure, each pointing to the next rather than
 * dumping everything at once:
 *   - `renderToolHelp(commands)` — every command, one line each.
 *   - `renderHelp(help)` — one command: its own flags plus its actions
 *     listed (each with a pointer to its own help).
 *   - `renderHelp(help, action)` — one action: full flags and an example.
 */
export function renderHelp(help: CommandHelp, action?: string): string {
    if (action) {
        const found = help.actions?.find((a) => a.name === action);
        if (!found) {
            return `Unknown action "${action}" for "${help.name}".`;
        }
        return renderAction(help.name, found);
    }
    return renderCommand(help);
}

export function renderToolHelp(commands: CommandHelp[]): string {
    const lines = ["Commands:"];
    for (const c of commands) {
        lines.push(`  ${c.name} - ${c.summary} (qrspi-x --help ${c.name})`);
    }
    lines.push(
        "",
        "Output:",
        "  Commands normally print JSON to stdout.",
        "  decision read, history read, next-file, and import print bare content or a path.",
        "",
        "Exit codes:",
        "  0 success, 1 blocked/refused, 2 usage error, 3 usable result with findings, 4 unexpected error.",
    );
    return lines.join("\n");
}

function renderCommand(help: CommandHelp): string {
    const lines = [help.name, "", help.summary];

    if (help.usage) {
        lines.push("", "Usage:", `  ${help.usage}`);
    }

    if (help.flags && help.flags.length > 0) {
        lines.push("", "Flags:", ...renderFlags(help.flags));
    }

    if (help.actions && help.actions.length > 0) {
        lines.push("", "Actions:");
        for (const a of help.actions) {
            lines.push(
                `  ${a.name} - ${a.summary} (qrspi-x --help ${help.name} ${a.name})`,
            );
        }
    }

    return lines.join("\n");
}

function renderAction(commandName: string, action: ActionHelp): string {
    const lines = [`${commandName} ${action.name}`, "", action.summary];

    if (action.usage) {
        lines.push("", "Usage:", `  ${action.usage}`);
    }

    if (action.flags && action.flags.length > 0) {
        lines.push("", "Flags:", ...renderFlags(action.flags));
    }

    const examples =
        action.examples ?? (action.example ? [action.example] : []);
    if (examples.length > 0) {
        lines.push(
            "",
            examples.length === 1 ? "Example:" : "Examples:",
            ...examples.map((example) => `  ${example}`),
        );
    }

    return lines.join("\n");
}

function renderFlags(flags: FlagHelp[]): string[] {
    const lines: string[] = [];
    for (const f of flags) {
        lines.push(`  ${f.flag}`);
        const tag = f.required ? "required" : "optional";
        lines.push(`      (${tag}) ${f.description}`);
    }
    return lines;
}

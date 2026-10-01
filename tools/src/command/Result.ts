export type Finding = {
    code: string;
    message: string;
};

/**
 * `exitCode`, `findings`, and `wrote` are the only reserved keys. Every
 * other key on a `CommandResult` is a command's own field, straight from
 * its own return value — not nested under a wrapper, since that's
 * exactly the shape `toJson()` prints. No envelope: no `ok`, `command`,
 * or `feature` echoed back.
 */
export type CommandResult = {
    exitCode: 0 | 1 | 2 | 3 | 4;
    findings?: Finding[];
    wrote?: string[];
    [field: string]: unknown;
};

/**
 * Builds the exact JSON object `main()` prints to stdout for exit codes
 * 0/1/3 — every field on `result` other than `exitCode` flattened at top
 * level, `findings`/`wrote` only when non-empty. Exit codes 2/4 print
 * nothing on stdout; `main()` doesn't call this for those.
 *
 * 127 (binary not found) never reaches this type at all — it's the shell
 * failing to exec `qrspi-x`, not a result any command handler produces.
 */
export function toJson(result: CommandResult): Record<string, unknown> {
    const { exitCode, findings, wrote, ...fields } = result;
    const json: Record<string, unknown> = { ...fields };
    if (findings && findings.length > 0) {
        json.findings = findings;
    }
    if (wrote && wrote.length > 0) {
        json.wrote = wrote;
    }
    return json;
}

export function ok(fields?: Record<string, unknown>): CommandResult {
    return { exitCode: 0, ...fields };
}

export function warn(
    fields: Record<string, unknown>,
    findings: Finding[],
    wrote?: string[],
): CommandResult {
    return { exitCode: 3, ...fields, findings, wrote };
}

export function blocked(findings: Finding[], wrote?: string[]): CommandResult {
    return { exitCode: 1, findings, wrote };
}

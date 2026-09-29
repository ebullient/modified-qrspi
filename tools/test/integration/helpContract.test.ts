import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/state/cli.ts";
import { commandHelp, type FormHelp } from "../../src/state/help.ts";

// `--help` is the helper's self-description, so an agent that reads it and does
// what it says must not hit a usage error. Every value help enumerates for an
// option is exercised against the CLI here: help advertising a mode the parser
// rejects is a broken contract, not a typo, and only a test catches it.

/** A value that satisfies each option's validation, for filling placeholders. */
const sampleValues: { [option: string]: string } = {
    "--feature": "demo",
    "--project": ".",
    "--phase": "1",
    "--label": "phase-1",
    "--reason": "text",
    "--text": "text",
    "--result": "STOPPED",
    "--start": "all",
    "--begin": "implement",
    "--end": "implement",
};

/** The choices an option's value spells out, or [] when it is freeform. */
function enumeratedValues(value: string | null): string[] {
    if (value === null) return [];
    const match = /^<([^>]+)>$/.exec(value);
    if (match === null) return [];
    const choices = (match[1] as string).split("|");
    return choices.length > 1 ? choices : [];
}

/** The argv for one form, with `option` set to `choice` and the rest sampled. */
function toArgv(form: FormHelp, option: string, choice: string): string[] {
    const tokens = form.form.split(" ");
    for (const candidate of form.options) {
        const isTarget = candidate.name === option;
        if (!isTarget && candidate.required !== true) continue;
        const value = isTarget
            ? choice
            : (enumeratedValues(candidate.value ?? "")[0] ??
              sampleValues[candidate.name] ??
              "text");
        // An action flag (`loop --begin`) is already in the form name, but it
        // still takes a value, which belongs right after the flag.
        const at = tokens.indexOf(candidate.name);
        if (at === -1) {
            tokens.push(candidate.name);
            if (candidate.value !== null) tokens.push(value);
        } else if (candidate.value !== null) {
            tokens.splice(at + 1, 0, value);
        }
    }
    if (!tokens.includes("--feature")) tokens.push("--feature", "demo");
    if (tokens[0] !== "report") tokens.push("--dry-run");
    return tokens;
}

/** Every [form, option, choice] that help enumerates as a valid value. */
function advertisedChoices(): [string, string, string, FormHelp][] {
    const found: [string, string, string, FormHelp][] = [];
    for (const command of commandHelp) {
        for (const form of command.forms) {
            for (const option of form.options) {
                for (const choice of enumeratedValues(option.value)) {
                    found.push([form.form, option.name, choice, form]);
                }
            }
        }
    }
    return found;
}

describe("advertised help options", () => {
    const choices = advertisedChoices();

    it("finds the enumerated option values", () => {
        expect(choices.length).toBeGreaterThanOrEqual(8);
    });

    it.each(choices)(
        "%s %s %s is accepted by the CLI",
        (_form, option, choice, form) => {
            const cwd = mkdtempSync(join(tmpdir(), "qrspi-help-contract-"));
            execFileSync("git", ["init", "-q"], { cwd });
            const argv = toArgv(form, option, choice);
            const err: string[] = [];
            const exitCode = main(argv, {
                cwd,
                stdout: () => {},
                stderr: (line) => err.push(line),
            });
            expect(exitCode, `${argv.join(" ")}\n${err.join("\n")}`).not.toBe(
                2,
            );
        },
    );
});

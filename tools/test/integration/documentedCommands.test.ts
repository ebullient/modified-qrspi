import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../../src/state/cli.ts";

// Every helper command the skills, agents, and README show must parse. A usage
// error (exit 2) means the docs and the CLI disagree, and the agent following
// the docs would fail at runtime. Other outcomes (refusals, hard stops) depend
// on the workspace and are not checked here.

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const documents = [
    "README.md",
    ...readdirSync(join(repo, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `skills/${entry.name}/SKILL.md`),
    ...readdirSync(join(repo, "agents")).map((name) => `agents/${name}`),
];

/** A value that satisfies each option's validation, for filling placeholders. */
const sampleValues: { [option: string]: string } = {
    "--feature": "demo",
    "--phase": "1",
    "--commit-mode": "step",
    "--mode": "revision",
    "--label": "phase-1",
    "--result": "STOPPED",
    "--start": "all",
    "--begin": "implement",
    "--end": "implement",
    "--project": ".",
};

const invocation = /^(?:qrspi-x\s|report(?=\s|$)|record\s+[a-z<]|loop\s+--)/;

/** Code spans and fenced lines that invoke the helper, per document. */
function documentedCommands(): [string, string][] {
    const found: [string, string][] = [];
    for (const path of documents) {
        const text = readFileSync(join(repo, path), "utf8");
        const candidates = [
            ...[...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]),
            ...text.split("\n").map((line) => line.trim()),
        ];
        for (const candidate of candidates) {
            if (candidate === undefined || !invocation.test(candidate))
                continue;
            // Generic forms stand for many commands, each shown elsewhere.
            if (/<(?:command|step)>/.test(candidate)) continue;
            found.push([path, candidate]);
        }
    }
    return [
        ...new Map(found.map((entry) => [entry.join("\0"), entry])).values(),
    ];
}

/** The argv a documented command stands for, with placeholders filled in. */
function toArgv(command: string): string[] {
    const tokens: string[] = [];
    const source = command
        .replace(/\\\|/g, "|") // escaped pipes in Markdown tables
        .replace(/\[[^\]]*\]/g, "") // optional parts
        .replace(/…/g, "<value>")
        .replace(/^qrspi-x\s+/, "");
    for (const match of source.matchAll(/"[^"]*"|<[^>]+>|\S+/g)) {
        const token = match[0];
        if (token.startsWith("<")) {
            const choices = token.slice(1, -1).split("|");
            const option = tokens.at(-1) ?? "";
            const queryMode = option === "--mode" && tokens[1] === "query";
            tokens.push(
                choices.length > 1
                    ? (choices[0] as string)
                    : queryMode
                      ? "initial"
                      : (sampleValues[option] ?? "text"),
            );
        } else if (token.startsWith('"')) {
            tokens.push("text");
        } else {
            tokens.push(token);
        }
    }
    if (!tokens.includes("--feature")) tokens.push("--feature", "demo");
    if (tokens[0] !== "report") tokens.push("--dry-run");
    return tokens;
}

describe("documented helper commands", () => {
    const commands = documentedCommands();

    it("finds the documented commands", () => {
        expect(commands.length).toBeGreaterThanOrEqual(20);
    });

    it.each(commands)("%s: %s parses", (_path, command) => {
        const cwd = mkdtempSync(join(tmpdir(), "qrspi-doc-command-"));
        execFileSync("git", ["init", "-q"], { cwd });
        const err: string[] = [];
        const exitCode = main(toArgv(command), {
            cwd,
            stdout: () => {},
            stderr: (line) => err.push(line),
        });
        expect(
            exitCode,
            `${toArgv(command).join(" ")}\n${err.join("\n")}`,
        ).not.toBe(2);
    });
});

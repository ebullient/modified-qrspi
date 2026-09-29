import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const skillFiles = [
    "workflow",
    "init",
    "query",
    "research",
    "shape",
    "spec",
    "plan",
    "implement",
    "review",
    "autoloop",
];

/** Every Markdown file under skills/ and agents/, for the §6.1 negatives. */
const skillAndAgentDocs = [
    ...readdirSync(join(repo, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `skills/${entry.name}/SKILL.md`),
    ...readdirSync(join(repo, "agents")).map((name) => `agents/${name}`),
];

const forbiddenInvocationPatterns: [string, RegExp][] = [
    ["qrspi-state.mjs", /qrspi-state\.mjs/],
    ["CLAUDE_PLUGIN_ROOT", /CLAUDE_PLUGIN_ROOT/],
    ["../workflow/scripts/", /\.\.\/workflow\/scripts\//],
    ["node <helper>", /node\s+<helper>/],
];

describe("documentation integration contract", () => {
    it("declares Node compatibility and the bare qrspi-x invocation for every workflow skill", () => {
        for (const name of skillFiles) {
            const content = read(`skills/${name}/SKILL.md`);
            expect(content).toContain("compatibility: Node 22+");
            expect(content).toMatch(/qrspi-x .*--project/);
            expect(content).not.toMatch(/write\s+`?state\.json`?/i);
        }
    });

    it("keeps the old helper-path form out of every skill and agent", () => {
        for (const path of skillAndAgentDocs) {
            const content = read(path);
            for (const [label, pattern] of forbiddenInvocationPatterns) {
                expect(content, `${path} still contains: ${label}`).not.toMatch(
                    pattern,
                );
            }
        }
    });

    it("keeps state writes out of agents and documents the checkpoint stub", () => {
        expect(read("agents/implementer.md")).not.toMatch(
            /(?:set|update|append)\s+.*state\.json/i,
        );
        expect(read("agents/reviewer.md")).toContain("## Verdict: PENDING");
        expect(read("AGENTS.md")).toContain("tools/src/state/");
        expect(read("AGENTS.md")).toContain("npm run fullbuild");
    });

    it("documents the registry install and the bare qrspi-x invocation", () => {
        expect(read("README.md")).toContain("npm i -g @ebullient/qrspi-x");
        expect(read("README.md")).toMatch(/qrspi-x .*--project/);
        expect(read("skills/workflow/SKILL.md")).toContain("transition");
    });
});

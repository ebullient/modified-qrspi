import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolsDir = join(import.meta.dirname, "../..");

describe("release package", () => {
    it("contains the distributable plugin files only, no built helper", () => {
        const dir = mkdtempSync(join(tmpdir(), "qrspi-package-test-"));
        const output = join(dir, "qrspi-x-1.2.3.zip");
        try {
            execFileSync(
                "bash",
                ["../.github/scripts/package-release.sh", "1.2.3", output],
                { cwd: toolsDir },
            );
            expect(readFileSync(output).length).toBeGreaterThan(0);
            const names = execFileSync("unzip", ["-Z1", output], {
                encoding: "utf8",
            });
            expect(names).not.toContain("qrspi-state.mjs");
            expect(names).not.toContain("qrspi-x.mjs");
            expect(names).toContain(".claude-plugin/plugin.json");
            expect(names).toContain("agents/reviewer.md");
            expect(names).toContain("README.md");
            expect(names).toContain("LICENSE");
            expect(names).toContain("skills/");
            expect(names).not.toContain("tools/");
            expect(names).not.toContain("AGENTS.md");
            expect(names).not.toContain("qrspi/");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

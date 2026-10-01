import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { add, read } from "../../src/command/decision.ts";

describe("decision", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "decision-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    it("add appends one bullet; read returns the file back verbatim", async () => {
        const addResult = await add({
            feature,
            project,
            text: "Skipping Shape: this feature is a one-file fix.",
        });
        expect(addResult).toEqual({ exitCode: 0 });

        await add({ feature, project, text: "Second decision." });

        const text = await read({ feature, project });
        expect(text).toBe(
            "- Skipping Shape: this feature is a one-file fix.\n- Second decision.\n",
        );
    });

    it("read returns an empty string when decisions.md doesn't exist yet", async () => {
        const text = await read({ feature, project });
        expect(text).toBe("");
    });
});

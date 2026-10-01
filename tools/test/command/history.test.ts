import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { add, read } from "../../src/command/history.ts";

describe("history", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "history-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    it("add appends a note entry; read passes opts through and returns it as a bare array", async () => {
        const addResult = await add({
            feature,
            project,
            text: "Shape skipped",
        });
        expect(addResult).toEqual({ exitCode: 0 });

        const entries = await read({ feature, project });
        expect(entries).toEqual([
            {
                kind: "note",
                text: "Shape skipped",
                timestamp: expect.any(String),
            },
        ]);
    });
});

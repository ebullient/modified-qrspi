import { describe, expect, it } from "vitest";
import {
    type QueryOptions,
    recordQuery,
} from "../../../src/state/commands/Query.ts";
import { UsageError } from "../../../src/state/errors.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { CommandOutcome, State } from "../../../src/state/types.ts";
import type { Workspace } from "../../../src/workspace/Workspace.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

function workspaceWith(hasQueries: boolean): Workspace {
    return fakeWorkspace({ "queries.md": hasQueries ? "# Queries" : null });
}

function queryCommand(
    fs: MemoryStateFileSystem,
    hasQueries: boolean,
): { run: (options: QueryOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(hasQueries),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordQuery({ services, context: { feature: "f" } }, options),
    };
}

describe("Query", () => {
    it.each(["initial", "refinement", "regeneration"] as const)(
        "%s mode succeeds and records mode in history",
        (mode) => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, JSON.stringify(baseState()));

            const outcome = queryCommand(fs, true).run({ mode });

            expect(outcome.exitCode).toBe(0);
            expect(outcome.wrote).toBe(true);
            expect(outcome.result?.currentStep).toBe("query");
            expect(outcome.result?.history).toEqual([
                { step: "query", timestamp: "2026-09-26T00:00:00Z", mode },
            ]);
        },
    );

    it("records reason when given", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));

        const outcome = queryCommand(fs, true).run({
            mode: "refinement",
            reason: "new questions from research",
        });

        expect(outcome.result?.history).toEqual([
            {
                step: "query",
                timestamp: "2026-09-26T00:00:00Z",
                mode: "refinement",
                reason: "new questions from research",
            },
        ]);
    });

    it("warns when queries.md is missing, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));

        const outcome = queryCommand(fs, false).run({ mode: "initial" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "queries.md is missing; a human must supply it before the workflow can continue",
                file: "queries.md",
            },
        ]);
    });

    it("recovers a missing state.json when queries.md already exists", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = queryCommand(fs, true).run({ mode: "initial" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("query");
    });

    it("throws UsageError for an invalid mode", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));

        expect(() =>
            // biome-ignore lint/suspicious/noExplicitAny: constructing a deliberately invalid mode
            queryCommand(fs, true).run({ mode: "bogus" as any }),
        ).toThrow(UsageError);
    });

    it("reports an invalid option before loading corrupt state", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, "{ not json");

        expect(() =>
            // biome-ignore lint/suspicious/noExplicitAny: constructing a deliberately invalid mode
            queryCommand(fs, true).run({ mode: "bogus" as any }),
        ).toThrow(UsageError);
    });
});

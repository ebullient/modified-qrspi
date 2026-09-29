import { describe, expect, it } from "vitest";
import {
    type InitOptions,
    recordInit,
} from "../../../src/state/commands/Init.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { CommandOutcome, State } from "../../../src/state/types.ts";
import type { Workspace } from "../../../src/workspace/Workspace.ts";
import {
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

function workspaceWith(hasRequest: boolean, hasPlan = false): Workspace {
    return fakeWorkspace({
        "request.md": hasRequest ? "# Request" : null,
        "plan.md": hasPlan
            ? "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n"
            : null,
    });
}

function initCommand(
    fs: MemoryStateFileSystem,
    hasRequest: boolean,
    hasPlan = false,
): { run: (options: InitOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(hasRequest, hasPlan),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordInit({ services, context: { feature: "f" } }, options),
    };
}

describe("Init", () => {
    it("a fresh workspace succeeds with the exact documented initial values", () => {
        const fs = new MemoryStateFileSystem();
        const outcome = initCommand(fs, true).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result).toEqual({
            feature: "f",
            currentPhase: "discovery",
            currentStep: "init",
            blockers: [],
            decisions: [],
            history: [{ step: "init", timestamp: "2026-09-26T00:00:00Z" }],
        });
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").feature).toBe("f");
    });

    it("warns when request.md is missing, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        const outcome = initCommand(fs, false).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "request.md is missing; a human must supply it before the workflow can continue",
                file: "request.md",
            },
        ]);
        expect(fs.files.has(statePath)).toBe(true);
    });

    it("recovers from an invalid state.json by writing a fresh one, since no plan exists yet", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, "{ not valid json");

        const outcome = initCommand(fs, true).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("init");
        expect(fs.files.get(statePath)).not.toBe("{ not valid json");
    });
});

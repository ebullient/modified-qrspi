import { describe, expect, it } from "vitest";
import {
    type ResearchOptions,
    recordResearch,
} from "../../../src/state/commands/Research.ts";
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

function workspaceWith(researchMarkdown: string | null): Workspace {
    return fakeWorkspace({ "research.md": researchMarkdown });
}

const testState = (overrides: Partial<State> = {}): State =>
    baseState({ currentStep: "query", ...overrides });

function researchCommand(
    fs: MemoryStateFileSystem,
    researchMarkdown: string | null,
): { run: (options: ResearchOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(researchMarkdown),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordResearch({ services, context: { feature: "f" } }, options),
    };
}

describe("Research", () => {
    it("succeeds and records a history entry", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = researchCommand(fs, "## New Questions\nNone.").run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("research");
        expect(outcome.result?.history).toEqual([
            { step: "research", timestamp: "2026-09-26T00:00:00Z" },
        ]);
    });

    it("warns when research.md is missing, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = researchCommand(fs, null).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "research.md is missing; a human must supply it before the workflow can continue",
                file: "research.md",
            },
        ]);
    });

    it("warns on open New Questions, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = researchCommand(
            fs,
            "## New Questions\n- Still unresolved?",
        ).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "new-questions",
                message:
                    "research.md has an open item under New Questions that has not been resolved",
                file: "research.md",
            },
        ]);
    });

    it("recovers a missing state.json when research.md already exists", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = researchCommand(fs, "## New Questions\nNone.").run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("research");
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.history).toEqual([
            {
                step: "research",
                timestamp: "2026-09-26T00:00:00Z",
                reason: "recovered from workspace evidence: state.json",
            },
            { step: "research", timestamp: "2026-09-26T00:00:00Z" },
        ]);
    });
});

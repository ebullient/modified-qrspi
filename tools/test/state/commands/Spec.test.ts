import { describe, expect, it } from "vitest";
import {
    recordSpec,
    type SpecOptions,
} from "../../../src/state/commands/Spec.ts";
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

interface FixtureFiles {
    specMarkdown?: string | null;
    requestMarkdown?: string | null;
    researchMarkdown?: string | null;
    approachMarkdown?: string | null;
}

function workspaceWith(fixture: FixtureFiles): Workspace {
    const or = (key: keyof FixtureFiles, fallback: string | null) =>
        key in fixture ? (fixture[key] ?? null) : fallback;
    return fakeWorkspace({
        "spec.md": or("specMarkdown", "# Spec"),
        "request.md": or("requestMarkdown", "## Open Questions\nNone."),
        "research.md": or("researchMarkdown", "## New Questions\nNone."),
        "approach.md": or("approachMarkdown", null),
    });
}

const testState = (overrides: Partial<State> = {}): State =>
    baseState({ currentStep: "shape", ...overrides });

function specCommand(
    fs: MemoryStateFileSystem,
    fixture: FixtureFiles,
): { run: (options: SpecOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(fixture),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordSpec({ services, context: { feature: "f" } }, options),
    };
}

describe("Spec", () => {
    it("succeeds on the happy path", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {}).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("spec");
        expect(outcome.result?.history).toEqual([
            { step: "spec", timestamp: "2026-09-26T00:00:00Z" },
        ]);
    });

    it("warns when spec.md is missing, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, { specMarkdown: null }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "spec.md is missing; a human must supply it before the workflow can continue",
                file: "spec.md",
            },
        ]);
    });

    it("warns on open questions in request.md, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {
            requestMarkdown: "## Open Questions\n- Still open?",
        }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "open-questions",
                message:
                    "request.md has an open item under Open Questions that has not been resolved",
                file: "request.md",
            },
        ]);
    });

    it("warns on open New Questions in research.md, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {
            researchMarkdown: "## New Questions\n- Still open?",
        }).run({});

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

    it("warns when approach.md exists with no Decision section, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {
            approachMarkdown: "## Decision\nNone.",
        }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            {
                code: "approach-undecided",
                message:
                    "approach.md exists but has no filled-in Decision section yet",
                file: "approach.md",
            },
        ]);
    });

    it("succeeds when approach.md exists with a Decision section", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {
            approachMarkdown: "## Decision\nWent with option B.",
        }).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
    });

    it("--mode revision --reason records mode: revision in history", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {}).run({
            mode: "revision",
            reason: "Scope narrowed after Plan review.",
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.history).toEqual([
            {
                step: "spec",
                timestamp: "2026-09-26T00:00:00Z",
                mode: "revision",
                reason: "Scope narrowed after Plan review.",
            },
        ]);
    });

    it("records --reason without --mode", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = specCommand(fs, {}).run({
            reason: "Picking this back up.",
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.history.at(-1)).toMatchObject({
            step: "spec",
            reason: "Picking this back up.",
        });
        expect(outcome.result?.history.at(-1)).not.toHaveProperty("mode");
    });

    it("recovers a missing state.json when spec.md already exists", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = specCommand(fs, {}).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("spec");
    });
});

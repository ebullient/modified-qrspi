import { describe, expect, it } from "vitest";
import {
    recordShape,
    type ShapeOptions,
} from "../../../src/state/commands/Shape.ts";
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

function workspaceWith(
    approachMarkdown: string | null,
    researchMarkdown: string | null,
): Workspace {
    return fakeWorkspace({
        "approach.md": approachMarkdown,
        "research.md": researchMarkdown,
    });
}

const testState = (overrides: Partial<State> = {}): State =>
    baseState({ currentStep: "research", ...overrides });

function shapeCommand(
    fs: MemoryStateFileSystem,
    approachMarkdown: string | null,
    researchMarkdown: string | null,
): { run: (options: ShapeOptions) => CommandOutcome<State> } {
    const store = new Store({ feature: "f", path: statePath, fileSystem: fs });
    const services = {
        store,
        workspace: workspaceWith(approachMarkdown, researchMarkdown),
        git: fakeGit(),
        clock: fakeClock(),
    };
    return {
        run: (options) =>
            recordShape({ services, context: { feature: "f" } }, options),
    };
}

describe("Shape", () => {
    it("succeeds when approach.md is missing, recording the skip", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = shapeCommand(fs, null, "## New Questions\nNone.").run(
            {},
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("shape");
        expect(outcome.result?.history).toEqual([
            { step: "shape", timestamp: "2026-09-26T00:00:00Z" },
        ]);
    });

    it("warns when approach.md has no Decision section, and still writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = shapeCommand(
            fs,
            "## Decision\nNone.",
            "## New Questions\nNone.",
        ).run({});

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

    it("open New Questions warn even when approach.md is missing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(testState()));

        const outcome = shapeCommand(
            fs,
            null,
            "## New Questions\n- A brand new one?",
        ).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings.map((f) => f.code)).toEqual(["new-questions"]);
    });

    it("recovers a missing state.json when approach.md already exists", () => {
        const fs = new MemoryStateFileSystem();

        const outcome = shapeCommand(
            fs,
            "## Decision\nWent with option B.",
            "## New Questions\nNone.",
        ).run({});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("shape");
    });
});

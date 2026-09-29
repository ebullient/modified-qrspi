import type {
    Clock,
    GitRunner,
    StateFileSystem,
    WorkspaceFileSystem,
} from "../../src/state/ports.ts";
import type { State } from "../../src/state/types.ts";
import { Workspace } from "../../src/workspace/Workspace.ts";

export const statePath = "qrspi/f/state.json";
export const now = "2026-09-26T00:00:00Z";

/** A valid state at `init` with nothing recorded; `overrides` replace whole fields. */
export function baseState(overrides: Partial<State> = {}): State {
    return {
        feature: "f",
        currentStep: "init",
        blockers: [],
        decisions: [],
        history: [],
        planPhase: null,
        phaseBaseSha: null,
        commitMode: "phase",
        ...overrides,
    };
}

/** An in-memory `state.json` store with atomic-replace semantics; failures and call counts can be driven from tests. */
export class MemoryStateFileSystem implements StateFileSystem {
    readonly files = new Map<string, string>();
    failWrite = false;
    failRename = false;
    failRemove = false;
    writeTempCalls = 0;
    renameCalls = 0;
    removeCalls = 0;

    read(path: string): string | null {
        return this.files.get(path) ?? null;
    }

    writeTemp(path: string, contents: string): string {
        this.writeTempCalls += 1;
        if (this.failWrite) throw new Error("temp write failed");
        const tempPath = `${path}.tmp`;
        this.files.set(tempPath, contents);
        return tempPath;
    }

    rename(from: string, to: string): void {
        this.renameCalls += 1;
        if (this.failRename) throw new Error("rename failed");
        const contents = this.files.get(from);
        if (contents === undefined) throw new Error("missing temp file");
        this.files.set(to, contents);
        this.files.delete(from);
    }

    remove(path: string): void {
        this.removeCalls += 1;
        if (this.failRemove) throw new Error("cleanup failed");
        this.files.delete(path);
    }
}

/** A workspace at `qrspi/f` holding `files`, keyed by path within the workspace; a `null` body is an absent file. */
export function fakeWorkspace(
    files: Record<string, string | null> = {},
): Workspace {
    const paths = new Map<string, string>(
        Object.entries(files).flatMap(([name, body]) =>
            body === null ? [] : [[`qrspi/f/${name}`, body] as const],
        ),
    );
    const fs: WorkspaceFileSystem = {
        read: (path) => paths.get(path) ?? null,
        list: (path) =>
            [...paths.keys()]
                .filter((item) => item.startsWith(`${path}/`))
                .map((item) => item.slice(path.length + 1))
                .filter((name) => !name.includes("/")),
    };
    return new Workspace("qrspi/f", fs);
}

/**
 * The same files with every root `plan-phase-*.md` relocated into `plans/`.
 * Lets one file set be reported in both layouts, which is the only way to
 * assert they resolve identically.
 */
export function inPlansLayout(
    files: Record<string, string | null>,
): Record<string, string | null> {
    return Object.fromEntries(
        Object.entries(files).map(([name, body]) => [
            /^plan-phase-[1-9][0-9]*[a-z]?\.md$/.test(name)
                ? `plans/${name}`
                : name,
            body,
        ]),
    );
}

export function fakeGit(overrides: Partial<GitRunner> = {}): GitRunner {
    return {
        head: () => "abcdef0",
        status: () => [],
        isAncestor: () => true,
        resolve: (rev) => (/^[0-9a-f]{7,40}$/.test(rev) ? rev : null),
        emptyTree: () => "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        ...overrides,
    };
}

export function fakeClock(time = now): Clock {
    return { now: () => time };
}

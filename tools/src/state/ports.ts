export interface StateFileSystem {
    read(path: string): string | null;
    writeTemp(path: string, contents: string): string;
    rename(from: string, to: string): void;
    remove(path: string): void;
}

export interface WorkspaceFileSystem {
    read(path: string): string | null;
    list(path: string): readonly string[];
}

/** One working-tree change; `originalPath` is the source of a rename or copy. */
export interface StatusEntry {
    path: string;
    originalPath?: string;
}

export interface GitRunner {
    /** The `HEAD` commit SHA, or `"root"` when the repository has no commits yet. */
    head(): string;
    status(): readonly StatusEntry[];
    isAncestor(ancestor: string, descendant?: string): boolean;
    /** The full SHA of the commit `rev` names (any commit-ish), or `null` when it names no commit. */
    resolve(rev: string): string | null;
    /** The empty tree's object ID in this repository's hash format; the diff base for a phase begun before the first commit. */
    emptyTree(): string;
}

export interface Clock {
    now(): string;
}

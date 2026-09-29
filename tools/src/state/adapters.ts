// Production implementations of the ports in ports.ts; the only src/state module that touches node:fs or node:child_process.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EvidenceInaccessibleError } from "./errors.ts";
import type {
    Clock,
    GitRunner,
    StateFileSystem,
    StatusEntry,
    WorkspaceFileSystem,
} from "./ports.ts";

export function createStateFileSystem(): StateFileSystem {
    return {
        read(path) {
            try {
                return readFileSync(path, "utf8");
            } catch (error) {
                if (isEnoent(error)) return null;
                throw error;
            }
        },
        writeTemp(path, contents) {
            const tempPath = `${path}.tmp-${randomUUID()}`;
            writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx" });
            return tempPath;
        },
        rename(from, to) {
            renameSync(from, to);
        },
        remove(path) {
            rmSync(path, { force: true });
        },
    };
}

export function createWorkspaceFileSystem(): WorkspaceFileSystem {
    return {
        read(path) {
            try {
                return readFileSync(path, "utf8");
            } catch (error) {
                // A directory where a file is expected, or a path whose
                // parent is a file, reads as absent so callers can fall
                // back. Report names the condition instead.
                if (isEnoent(error) || isNotAFile(error)) return null;
                throw error;
            }
        },
        list(path) {
            try {
                return readdirSync(path).filter((name) => {
                    try {
                        return statSync(join(path, name)).isFile();
                    } catch (error) {
                        if (isEnoent(error) || isNotAFile(error)) return false;
                        throw error;
                    }
                });
            } catch (error) {
                // A path that is not a directory lists as empty, for the
                // same reason read() treats one as absent.
                if (isEnoent(error) || isNotAFile(error)) return [];
                throw error;
            }
        },
    };
}

export function createGitRunner(cwd: string): GitRunner {
    const exec = (args: string[], input?: string): string =>
        execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            ...(input === undefined ? {} : { input }),
        });
    const inaccessible = (args: string[], error: unknown) =>
        new EvidenceInaccessibleError(
            `git ${args.join(" ")} failed in ${cwd}: ${gitMessage(error)}`,
            { cause: error },
        );
    const run = (args: string[]): string => {
        try {
            return exec(args);
        } catch (error) {
            throw inaccessible(args, error);
        }
    };
    // Exit status 1 is a meaningful answer for some commands (no such
    // commit, not an ancestor); it becomes `onStatus1`. Any other failure
    // makes the evidence inaccessible.
    const runOrStatus1 = <T>(
        args: string[],
        onSuccess: (out: string) => T,
        onStatus1: T,
    ): T => {
        try {
            return onSuccess(exec(args));
        } catch (error) {
            if ((error as { status?: unknown }).status === 1) return onStatus1;
            throw inaccessible(args, error);
        }
    };

    return {
        // Exit 1 with --verify --quiet means HEAD names no commit:
        // an unborn branch in a repository with no commits yet.
        head: () =>
            runOrStatus1(
                ["rev-parse", "--verify", "--quiet", "HEAD"],
                (out) => out.trim(),
                "root",
            ),
        status: () =>
            parsePorcelainZ(
                run(["status", "--porcelain", "-z", "--untracked-files=all"]),
            ),
        // Exit 1 means the commits are unrelated.
        isAncestor: (ancestor, descendant = "HEAD") =>
            runOrStatus1(
                ["merge-base", "--is-ancestor", ancestor, descendant],
                () => true,
                false,
            ),
        // Exit 1 with --verify --quiet means `rev` names no commit.
        resolve: (rev) =>
            runOrStatus1<string | null>(
                ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
                (out) => out.trim(),
                null,
            ),
        emptyTree() {
            // Hashing empty input asks git for the ID; nothing is written.
            const args = ["hash-object", "-t", "tree", "--stdin"];
            try {
                return exec(args, "").trim();
            } catch (error) {
                throw inaccessible(args, error);
            }
        },
    };
}

export function createClock(): Clock {
    return { now: () => new Date().toISOString().replace(/\.\d+Z$/, "Z") };
}

/**
 * Entries of `git status --porcelain -z`: `XY path`, NUL-terminated. A rename
 * or copy (X or Y is `R` or `C`) is followed by a second NUL-terminated field
 * holding the original path; git emits the new path first.
 */
function parsePorcelainZ(output: string): StatusEntry[] {
    const fields = output.split("\0");
    const entries: StatusEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i] ?? "";
        if (field === "") continue;
        const path = field.slice(3);
        const code = field.slice(0, 2);
        if (code.includes("R") || code.includes("C")) {
            const originalPath = fields[++i] ?? "";
            entries.push({ path, originalPath });
        } else {
            entries.push({ path });
        }
    }
    return entries;
}

function gitMessage(error: unknown): string {
    const stderr = (error as { stderr?: unknown }).stderr;
    const text = typeof stderr === "string" ? stderr.trim() : "";
    return text !== ""
        ? text
        : error instanceof Error
          ? error.message
          : String(error);
}

function isEnoent(error: unknown): boolean {
    return errorCode(error) === "ENOENT";
}

/**
 * EISDIR is a directory read as a file; ENOTDIR is a path whose parent is a
 * file. Both mean "no readable file here", not a failure worth crashing on.
 */
function isNotAFile(error: unknown): boolean {
    const code = errorCode(error);
    return code === "EISDIR" || code === "ENOTDIR";
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Git = {
    isClean: () => Promise<boolean>;
    headSha: () => Promise<string>;
    isAncestor: (commit: string) => Promise<boolean>;
    originRepo: () => Promise<{ owner: string; repo: string } | undefined>;
};

/**
 * Shells out to the real `git` binary against `cwd` (the user's project
 * root, not the qrspi workspace). Injectable so `start`'s tests can pass
 * a fake instead of needing a real repo on disk.
 */
export function gitAt(cwd: string): Git {
    async function isClean(): Promise<boolean> {
        const { stdout } = await run("git", ["status", "--porcelain"], {
            cwd,
        });
        return stdout.trim().length === 0;
    }

    async function headSha(): Promise<string> {
        const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd });
        return stdout.trim();
    }

    /**
     * Is `commit` still reachable from HEAD? False means history was
     * rewritten under it (squash/rebase/amend) — ancestry, not equality,
     * since equality would misfire on every ordinary new commit.
     */
    async function isAncestor(commit: string): Promise<boolean> {
        try {
            await run("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
                cwd,
            });
            return true;
        } catch {
            return false;
        }
    }

    async function originRepo(): Promise<
        { owner: string; repo: string } | undefined
    > {
        try {
            const { stdout } = await run(
                "git",
                ["remote", "get-url", "origin"],
                {
                    cwd,
                },
            );
            return parseGitHubRepo(stdout);
        } catch {
            return undefined;
        }
    }

    return { isClean, headSha, isAncestor, originRepo };
}

export function parseGitHubRepo(input: string): {
    owner: string;
    repo: string;
} {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("Repository cannot be empty.");
    }

    // SSH URL: git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
    const sshMatch = trimmed.match(
        /^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (sshMatch) {
        const [, host, owner, repo] = sshMatch;
        if (host !== "github.com") {
            throw new Error(
                `Unsupported host "${host}". Only github.com is supported.`,
            );
        }
        return { owner, repo };
    }

    // Full HTTP(S) URL
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        try {
            const url = new URL(trimmed);
            if (url.hostname !== "github.com") {
                throw new Error(
                    `Unsupported host "${url.hostname}". Only github.com is supported.`,
                );
            }
            const match = url.pathname.match(
                /^\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/,
            );
            if (match) {
                return { owner: match[1], repo: match[2] };
            }
        } catch (e) {
            if (
                e instanceof Error &&
                e.message.startsWith("Unsupported host")
            ) {
                throw e;
            }
            throw new Error(
                `Invalid repository URL "${input}". Expected a github.com repository URL.`,
            );
        }
    }

    // Shorthand: owner/repo
    const shorthandMatch = trimmed.match(
        /^([^/#\s:]+)\/([^/#\s:]+?)(?:\.git)?$/,
    );
    if (shorthandMatch) {
        return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
    }

    throw new Error(
        `Invalid repository "${input}". Expected owner/repo shorthand or a github.com repository URL.`,
    );
}

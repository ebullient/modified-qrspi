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

function parseGitHubRepo(
    url: string,
): { owner: string; repo: string } | undefined {
    const trimmed = url.trim();
    // HTTPS or SSH github.com URL:
    // https://github.com/owner/repo.git, https://github.com/owner/repo
    // git@github.com:owner/repo.git, ssh://git@github.com/owner/repo.git
    const httpsMatch = trimmed.match(
        /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    const sshMatch = trimmed.match(
        /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
    }
    return undefined;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Git = {
    isClean: () => Promise<boolean>;
    headSha: () => Promise<string>;
    isAncestor: (commit: string) => Promise<boolean>;
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

    return { isClean, headSha, isAncestor };
}

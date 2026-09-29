import type { GitRunner } from "./ports.ts";

/** The checkpoint diff command for a phase base; `root` diffs from the empty tree. */
export function phaseDiff(base: string, git: GitRunner): string {
    return `git diff ${base === "root" ? git.emptyTree() : base}`;
}

import { describe, expect, it } from "vitest";
import { gitAt } from "../../src/workspace/Git.js";

describe("gitAt", () => {
    it("originRepo returns repo for current workspace if pointing to GitHub", async () => {
        const git = gitAt(process.cwd());
        const repo = await git.originRepo();
        // In this repo, origin is GitHub
        expect(repo).toBeDefined();
        expect(repo?.owner).toBeDefined();
        expect(repo?.repo).toBeDefined();
    });

    it("originRepo returns undefined for non-git directory", async () => {
        const git = gitAt("/tmp");
        const repo = await git.originRepo();
        expect(repo).toBeUndefined();
    });
});

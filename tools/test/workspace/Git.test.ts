import { describe, expect, it } from "vitest";
import { gitAt, parseGitHubRepo } from "../../src/workspace/Git.js";

describe("parseGitHubRepo", () => {
    it("parses owner/repo shorthand", () => {
        expect(parseGitHubRepo("acme/api")).toEqual({
            owner: "acme",
            repo: "api",
        });
    });

    it("parses HTTPS URL with .git", () => {
        expect(parseGitHubRepo("https://github.com/owner/repo.git")).toEqual({
            owner: "owner",
            repo: "repo",
        });
    });

    it("parses HTTPS URL without .git", () => {
        expect(parseGitHubRepo("https://github.com/owner/repo")).toEqual({
            owner: "owner",
            repo: "repo",
        });
    });

    it("parses SSH URL with .git", () => {
        expect(parseGitHubRepo("git@github.com:owner/repo.git")).toEqual({
            owner: "owner",
            repo: "repo",
        });
    });

    it("parses SSH URL without .git", () => {
        expect(parseGitHubRepo("git@github.com:owner/repo")).toEqual({
            owner: "owner",
            repo: "repo",
        });
    });

    it("parses ssh:// URL", () => {
        expect(parseGitHubRepo("ssh://git@github.com/owner/repo.git")).toEqual({
            owner: "owner",
            repo: "repo",
        });
    });

    it("throws for non-GitHub URLs with unsupported host message", () => {
        expect(() =>
            parseGitHubRepo("https://gitlab.com/owner/repo.git"),
        ).toThrow(
            'Unsupported host "gitlab.com". Only github.com is supported.',
        );
        expect(() =>
            parseGitHubRepo("https://github.example.com/owner/repo.git"),
        ).toThrow(
            'Unsupported host "github.example.com". Only github.com is supported.',
        );
    });

    it("throws for malformed or empty strings", () => {
        expect(() => parseGitHubRepo("not-a-url")).toThrow(
            'Invalid repository "not-a-url". Expected owner/repo shorthand or a github.com repository URL.',
        );
        expect(() => parseGitHubRepo("")).toThrow(
            "Repository cannot be empty.",
        );
    });
});

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

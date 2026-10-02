import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runImport } from "../src/command/import.js";
import { fakeGit } from "./fixtures.js";

describe("runImport", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "qrspi-import-test-"));
    });

    it("gh issue view succeeds with number and explicit --repo shorthand", async () => {
        const execFile = vi
            .fn()
            .mockImplementation(async (_file, args, opts) => {
                expect(opts.cwd).toBe(tempDir);
                if (args[0] === "issue" && args[1] === "view") {
                    expect(args).toEqual([
                        "issue",
                        "view",
                        "42",
                        "--repo",
                        "acme/api",
                        "--json",
                        "title,body",
                    ]);
                    return {
                        stdout: JSON.stringify({
                            title: "Add dark mode",
                            body: "Please add dark mode.",
                        }),
                        stderr: "",
                    };
                }
                throw new Error("unexpected call");
            });

        const res = await runImport(
            {
                number: "42",
                repo: "acme/api",
                project: tempDir,
            },
            { execFile },
        );

        expect(res.exitCode).toBe(0);
        expect(res.feature).toBe("gh-api-42");
        expect(res.source).toEqual({
            owner: "acme",
            repo: "api",
            number: 42,
            fetchedVia: "gh",
        });
        expect(res.text).toContain("Imported acme/api#42");
        expect(res.text).toContain("Next: qrspi-x:init gh-api-42");

        const content = await readFile(res.path as string, "utf8");
        expect(content).toBe("# Add dark mode\n\nPlease add dark mode.\n");
    });

    it("gh issue view succeeds with --repo as URL", async () => {
        const execFile = vi
            .fn()
            .mockImplementation(async (_file, args, opts) => {
                expect(opts.cwd).toBe(tempDir);
                if (args[0] === "issue" && args[1] === "view") {
                    expect(args).toEqual([
                        "issue",
                        "view",
                        "42",
                        "--repo",
                        "acme/api",
                        "--json",
                        "title,body",
                    ]);
                    return {
                        stdout: JSON.stringify({
                            title: "Add dark mode",
                            body: "Please add dark mode.",
                        }),
                        stderr: "",
                    };
                }
                throw new Error("unexpected call");
            });

        const res = await runImport(
            {
                number: "#42",
                repo: "https://github.com/acme/api",
                project: tempDir,
            },
            { execFile },
        );

        expect(res.exitCode).toBe(0);
        expect(res.feature).toBe("gh-api-42");
    });

    it("gh issue view not-found, then gh pr view succeeds", async () => {
        const execFile = vi
            .fn()
            .mockImplementation(async (_file, args, opts) => {
                expect(opts.cwd).toBe(tempDir);
                if (args[0] === "issue" && args[1] === "view") {
                    const err = new Error("could not resolve to an issue");
                    throw err;
                }
                if (args[0] === "pr" && args[1] === "view") {
                    return {
                        stdout: JSON.stringify({
                            title: "Fix auth token",
                            body: "Fixes auth token expiration.",
                        }),
                        stderr: "",
                    };
                }
                throw new Error("unexpected call");
            });

        const res = await runImport(
            {
                number: "123",
                repo: "acme/api",
                project: tempDir,
            },
            { execFile },
        );

        expect(res.exitCode).toBe(0);
        expect(res.feature).toBe("gh-api-123");
        expect((res.source as { fetchedVia: string }).fetchedVia).toBe("gh");
        const content = await readFile(res.path as string, "utf8");
        expect(content).toBe(
            "# Fix auth token\n\nFixes auth token expiration.\n",
        );
    });

    it("number with inferred git remote when --repo omitted", async () => {
        const execFile = vi
            .fn()
            .mockImplementation(async (_file, args, opts) => {
                expect(opts.cwd).toBe(tempDir);
                expect(args).toEqual([
                    "issue",
                    "view",
                    "42",
                    "--json",
                    "title,body",
                ]);
                return {
                    stdout: JSON.stringify({
                        title: "Bare number issue",
                        body: "Body text",
                    }),
                    stderr: "",
                };
            });

        const git = fakeGit({
            originRepo: { owner: "acme", repo: "inferred" },
        });

        const res = await runImport(
            {
                number: "42",
                project: tempDir,
            },
            { execFile, git },
        );

        expect(res.exitCode).toBe(0);
        expect(res.feature).toBe("gh-inferred-42");
        expect(res.source).toEqual({
            owner: "acme",
            repo: "inferred",
            number: 42,
            fetchedVia: "gh",
        });
    });

    it("falls back to REST when gh is absent / fails with non-not-found error", async () => {
        const execFile = vi.fn().mockRejectedValue(new Error("ENOENT"));
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                title: "REST Title",
                body: "REST Body",
            }),
        });

        const res = await runImport(
            {
                number: "77",
                repo: "acme/api",
                project: tempDir,
            },
            { execFile, fetch: fetch as unknown as typeof globalThis.fetch },
        );

        expect(res.exitCode).toBe(0);
        expect((res.source as { fetchedVia: string }).fetchedVia).toBe("rest");
        expect(res.feature).toBe("gh-api-77");
        const content = await readFile(res.path as string, "utf8");
        expect(content).toBe("# REST Title\n\nREST Body\n");
    });

    it("blocks on unsupported host in --repo without calling execFile or fetch", async () => {
        const execFile = vi.fn();
        const fetch = vi.fn();

        const res = await runImport(
            {
                number: "42",
                repo: "https://github.example.com/acme/api",
                project: tempDir,
            },
            { execFile, fetch: fetch as unknown as typeof globalThis.fetch },
        );

        expect(res.exitCode).toBe(1);
        expect(res.text).toContain("Unsupported host");
        expect(res.text).toContain(
            "Only github.com repositories are supported",
        );
        expect(execFile).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("blocks with invalid-number for non-numeric input", async () => {
        const res = await runImport({
            number: "not-a-number",
            project: tempDir,
        });

        expect(res.exitCode).toBe(1);
        expect(res.text).toContain("Invalid issue number");
        expect(res.text).toContain(
            "Provide a positive issue or pull request number",
        );
    });

    it("blocks with reference-ambiguous for number when no repo can be inferred", async () => {
        const execFile = vi
            .fn()
            .mockRejectedValue(new Error("not a git repository"));
        const git = fakeGit({ originRepo: undefined });

        const res = await runImport(
            {
                number: "42",
                project: tempDir,
            },
            { execFile, git },
        );

        expect(res.exitCode).toBe(1);
        expect(res.text).toContain(
            "Specify the repository with --repo <owner/repo | url>",
        );
    });

    it("blocks with invalid-feature-name when explicit feature name is invalid", async () => {
        const execFile = vi.fn().mockResolvedValue({
            stdout: JSON.stringify({ title: "T", body: "B" }),
            stderr: "",
        });

        const res = await runImport(
            {
                number: "1",
                repo: "acme/api",
                project: tempDir,
                feature: "Invalid_Name!",
            },
            { execFile },
        );

        expect(res.exitCode).toBe(1);
        expect(res.text).toContain('Feature name "Invalid_Name!" is invalid');
        expect(res.text).toContain(
            "Feature names must match [a-z0-9]+(-[a-z0-9]+)*",
        );
    });

    it("normalizes repo name containing underscores or dots for default feature name", async () => {
        const execFile = vi.fn().mockResolvedValue({
            stdout: JSON.stringify({ title: "T", body: "B" }),
            stderr: "",
        });

        const res = await runImport(
            {
                number: "5",
                repo: "acme/my_repo.v2",
                project: tempDir,
            },
            { execFile },
        );

        expect(res.exitCode).toBe(0);
        expect(res.feature).toBe("gh-my-repo-v2-5");
    });

    it("blocks with feature-exists when feature directory already exists", async () => {
        const execFile = vi.fn().mockResolvedValue({
            stdout: JSON.stringify({ title: "T", body: "B" }),
            stderr: "",
        });

        // 1st run succeeds
        const res1 = await runImport(
            {
                number: "10",
                repo: "acme/api",
                project: tempDir,
            },
            { execFile },
        );
        expect(res1.exitCode).toBe(0);

        // 2nd run detects collision
        const res2 = await runImport(
            {
                number: "10",
                repo: "acme/api",
                project: tempDir,
            },
            { execFile },
        );
        expect(res2.exitCode).toBe(1);
        expect(res2.text).toContain("Feature workspace already exists at");
        expect(res2.text).toContain(
            "Resume work there or specify a distinct name with --feature <name>",
        );
    });
});

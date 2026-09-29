import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return { ...actual, statSync: vi.fn(actual.statSync) };
});

import {
    createGitRunner,
    createStateFileSystem,
    createWorkspaceFileSystem,
} from "../../src/state/adapters.ts";
import { EvidenceInaccessibleError } from "../../src/state/errors.ts";
import { Store } from "../../src/state/store/Store.ts";

describe("createWorkspaceFileSystem.read", () => {
    // The in-memory fakes model read() as a map lookup, so they cannot
    // produce these errors. Only the real filesystem can.
    it("reads a directory as absent rather than throwing EISDIR", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        mkdirSync(join(root, "plan-phase-1.md"));
        expect(
            createWorkspaceFileSystem().read(join(root, "plan-phase-1.md")),
        ).toBeNull();
    });

    it("reads through a file-shaped parent as absent rather than throwing ENOTDIR", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        writeFileSync(join(root, "plans"), "not a directory", "utf8");
        expect(
            createWorkspaceFileSystem().read(
                join(root, "plans", "plan-phase-1.md"),
            ),
        ).toBeNull();
    });

    it("lists a file-shaped directory path as empty rather than throwing ENOTDIR", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        writeFileSync(join(root, "plans"), "not a directory", "utf8");
        expect(createWorkspaceFileSystem().list(join(root, "plans"))).toEqual(
            [],
        );
    });

    it("propagates unexpected stat errors", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        writeFileSync(join(root, "spec.md"), "# spec", "utf8");
        const error = Object.assign(new Error("permission denied"), {
            code: "EACCES",
        });
        const stat = vi.mocked(nodeFs.statSync);
        stat.mockImplementationOnce(() => {
            throw error;
        });

        try {
            expect(() => createWorkspaceFileSystem().list(root)).toThrow(error);
        } finally {
            stat.mockRestore();
        }
    });

    it("still reads a real file", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        writeFileSync(join(root, "spec.md"), "# spec", "utf8");
        expect(createWorkspaceFileSystem().read(join(root, "spec.md"))).toBe(
            "# spec",
        );
    });
});

describe("createStateFileSystem", () => {
    it("uses distinct sibling temp files for concurrent writes", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        const path = join(root, "state.json");
        const fileSystem = createStateFileSystem();

        const first = fileSystem.writeTemp(path, "one");
        const second = fileSystem.writeTemp(path, "two");

        expect(first).not.toBe(second);
        expect(readFileSync(first, "utf8")).toBe("one");
        expect(readFileSync(second, "utf8")).toBe("two");
        fileSystem.remove(first);
        fileSystem.remove(second);
    });

    it("a save leaves state.json alone in its directory: no temp directory, no .tmp file", () => {
        const root = mkdtempSync(join(tmpdir(), "qrspi-fs-test-"));
        const path = join(root, "state.json");
        const store = new Store({
            feature: "f",
            path,
            fileSystem: createStateFileSystem(),
        });

        expect(
            store.save({
                feature: "f",
                currentStep: "init",
                blockers: [],
                decisions: [],
                history: [],
            }).wrote,
        ).toBe(true);

        expect(readdirSync(root)).toEqual(["state.json"]);
        expect(JSON.parse(readFileSync(path, "utf8")).feature).toBe("f");
    });
});

describe("createGitRunner", () => {
    it("does not turn an inaccessible git invocation into a false ancestry result", () => {
        const cwd = mkdtempSync(join(tmpdir(), "qrspi-git-test-"));
        expect(() => createGitRunner(cwd).isAncestor("HEAD")).toThrow(
            EvidenceInaccessibleError,
        );
    });

    it("throws on a missing commit without writing git's stderr to the process", () => {
        const cwd = mkdtempSync(join(tmpdir(), "qrspi-git-test-"));
        execFileSync("git", ["init", "-q"], { cwd });
        const spy = vi.spyOn(process.stderr, "write");
        try {
            expect(() =>
                createGitRunner(cwd).isAncestor("deadbeef".repeat(5)),
            ).toThrow(EvidenceInaccessibleError);
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it.each([
        ["sha1", "4b825dc642cb6eb9a060e54bf8d69288fbee4904"],
        [
            "sha256",
            "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
        ],
    ])("reports the empty tree for a %s repository", (format, expected) => {
        const cwd = mkdtempSync(join(tmpdir(), "qrspi-git-test-"));
        execFileSync("git", ["init", "-q", `--object-format=${format}`], {
            cwd,
        });
        expect(createGitRunner(cwd).emptyTree()).toBe(expected);
    });

    describe("status", () => {
        const git = (cwd: string, ...args: string[]) =>
            execFileSync("git", args, { cwd, stdio: "pipe" });
        const scratch = () => {
            const cwd = mkdtempSync(join(tmpdir(), "qrspi-git-test-"));
            git(cwd, "init", "-q");
            git(cwd, "config", "user.email", "t@example.com");
            git(cwd, "config", "user.name", "t");
            return cwd;
        };

        it("returns unquoted paths for a space and a non-ASCII name", () => {
            const cwd = scratch();
            writeFileSync(join(cwd, "a b.txt"), "x", "utf8");
            writeFileSync(join(cwd, "\u00e9.txt"), "x", "utf8");
            const entries = createGitRunner(cwd).status();
            expect(entries.map((e) => e.path).sort()).toEqual([
                "a b.txt",
                "\u00e9.txt",
            ]);
            expect(entries.every((e) => e.originalPath === undefined)).toBe(
                true,
            );
        });

        it("returns both paths for a rename, new path as path", () => {
            const cwd = scratch();
            writeFileSync(join(cwd, "old.txt"), "same content\n", "utf8");
            git(cwd, "add", "old.txt");
            git(cwd, "commit", "-q", "-m", "init");
            git(cwd, "mv", "old.txt", "new name.txt");
            expect(createGitRunner(cwd).status()).toEqual([
                { path: "new name.txt", originalPath: "old.txt" },
            ]);
        });
    });
});

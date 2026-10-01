import { describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";

describe("cli", () => {
    it("prints a plain version string", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["--version"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(0);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
        expect(stderr).toEqual([]);
    });

    it("prints command help without requiring a feature workspace", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["--help"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Commands:");
        expect(stdout[0]).toContain("status -");
        expect(stdout[0]).toContain(
            "decision read, history read, and next-file print bare content or a path.",
        );
        expect(stdout[0]).toContain(
            "0 success, 1 blocked/refused, 2 usage error, 3 usable result with findings, 4 unexpected error.",
        );
        expect(stderr).toEqual([]);
    });

    it("shows next-file's phase and step parameters in help", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "next-file"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("--phase <id>");
        expect(stdout[0]).toContain("--step <k>");
        expect(stdout[0]).toContain("next-file <type>");
        expect(stdout[0]).toContain(
            "query, research, approach, spec, review, or final",
        );
    });

    it("shows command-level actions progressively", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "start"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Actions:");
        expect(stdout[0]).toContain("implement -");
        expect(stdout[0]).toContain("review -");
        expect(stdout[0]).toContain("repair -");
    });

    it("shows action-level flags and an example progressively", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "start", "implement"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("--phase <id>");
        expect(stdout[0]).toContain("--loop");
        expect(stdout[0]).toContain("--base <commit-ish>");
        expect(stdout[0]).toContain("Example:");
    });

    it("uses executable loop subcommand syntax in help", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "loop", "start"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("loop start");
        expect(stdout[0]).toContain("loop start <selector>");
        expect(stdout[0]).toContain("qrspi-x loop start 2..4");
        expect(stdout[0]).toContain("qrspi-x loop start 1,3");
    });

    it("distinguishes advancing a completed phase from acknowledging a stop", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "loop", "ok"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("acknowledge-required");
        expect(stdout[0]).toContain("without advancing the phase");
    });

    it("rejects mutually exclusive history read limits before touching the workspace", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            [
                "history",
                "read",
                "--all",
                "--tail",
                "2",
                "--feature",
                "widget",
                "--project",
                ".",
            ],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("cannot combine --all and --tail");
    });

    it("rejects a loop flag spelling now that actions are positional", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            ["loop", "--start", "all", "--feature", "widget", "--project", "."],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain('Unknown loop action ""');
    });

    it("rejects loop advance with an extra positional argument", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            [
                "loop",
                "advance",
                "extra",
                "--feature",
                "widget",
                "--project",
                ".",
            ],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("loop advance takes no arguments");
    });
});

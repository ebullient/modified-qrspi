import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/state/cli.ts";
import { commandHelp } from "../../src/state/help.ts";

let dir: string;
let out: string[];
let err: string[];

function io() {
    return {
        cwd: dir,
        stdout: (line: string) => out.push(line),
        stderr: (line: string) => err.push(line),
    };
}

function gitRun(args: string[]) {
    execFileSync("git", args, { cwd: dir });
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qrspi-cli-test-"));
    out = [];
    err = [];
    gitRun(["init", "-q"]);
    gitRun(["config", "user.email", "test@example.com"]);
    gitRun(["config", "user.name", "Test"]);
    writeFileSync(join(dir, "a.txt"), "one\n");
    // QRSPI artifacts are never committed, and a project running the workflow
    // is expected to ignore them; without this every command reports dirty-tree
    // for the workspace's own files.
    writeFileSync(join(dir, ".gitignore"), "qrspi\n");
    gitRun(["add", "a.txt", ".gitignore"]);
    gitRun(["commit", "-q", "-m", "first"]);
});

function writeFeature(feature: string, files: Record<string, string>) {
    const featureDir = join(dir, "qrspi", feature);
    mkdirSync(featureDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        mkdirSync(join(featureDir, ...name.split("/").slice(0, -1)), {
            recursive: true,
        });
        writeFileSync(join(featureDir, name), content);
    }
}

describe("cli main", () => {
    it("report --feature <f> prints the envelope and exits 0 on no findings", () => {
        writeFeature("f", {
            "request.md": "x",
            "state.json": stateJson("query"),
        });

        const exitCode = main(["report", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope).toMatchObject({
            ok: true,
            command: "report",
            feature: "f",
        });
        expect(envelope.findings).toEqual([]);
        expect(envelope.wrote).toBe(false);
    });

    it("accepts --project as a global command option", () => {
        writeFeature("f", {
            "request.md": "x",
            "state.json": stateJson("query"),
        });

        expect(main(["report", "--project", dir, "--feature", "f"], io())).toBe(
            0,
        );
        expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
            ok: true,
            command: "report",
            feature: "f",
        });
    });

    it("report exits 0 when findings are present", () => {
        writeFeature("f", {
            "request.md": "## Open Questions\n- Still open?",
            "state.json": stateJson("query"),
        });

        const exitCode = main(["report", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.ok).toBe(true);
        expect(envelope.findings).toContainEqual(
            expect.objectContaining({ code: "open-questions" }),
        );
    });

    it("report --phase narrows planProgress; an unknown phase exits 2", () => {
        writeFeature("f", {
            "request.md": "x",
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
            "state.json": stateJson("plan", { currentPhase: "definition" }),
        });

        expect(main(["report", "--feature", "f", "--phase", "1"], io())).toBe(
            0,
        );
        expect(JSON.parse(out[0] ?? "{}").result.current.planProgress).toEqual({
            current: null,
            completed: ["1.1"],
            blocked: [],
        });

        expect(main(["report", "--feature", "f", "--phase", "2"], io())).toBe(
            2,
        );
    });

    it.each([
        ["init", [], { "request.md": "x" }, "discovery"],
        ["query", ["--mode", "initial"], { "queries.md": "x" }, "discovery"],
        [
            "research",
            [],
            { "research.md": "## New Questions\nNone." },
            "discovery",
        ],
        ["shape", [], {}, "definition"],
        ["spec", [], { "spec.md": "x" }, "definition"],
        [
            "plan",
            [],
            {
                "plan.md":
                    "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n",
            },
            "definition",
        ],
    ] as const)(
        "record %s round-trips through the envelope",
        (step, args, files, phase) => {
            writeFeature("f", files);

            const exitCode = main(
                ["record", step, "--feature", "f", ...args],
                io(),
            );

            expect(exitCode).toBe(0);
            const envelope = JSON.parse(out[0] ?? "{}");
            expect(envelope).toMatchObject({
                ok: true,
                command: `record ${step}`,
                feature: "f",
                wrote: true,
            });
            expect(envelope.result).toMatchObject({
                currentPhase: phase,
                currentStep: step,
            });
            const state = JSON.parse(
                readFileSync(join(dir, "qrspi", "f", "state.json"), "utf8"),
            );
            expect(state.currentStep).toBe(step);
        },
    );

    it("record writes and returns warnings with exit 0", () => {
        writeFeature("f", {});

        const exitCode = main(["record", "research", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.wrote).toBe(true);
        expect(envelope.findings).toContainEqual(
            expect.objectContaining({ code: "workspace-incomplete" }),
        );
    });

    it("record plan's hard stop exits 1 and writes nothing", () => {
        writeFeature("f", { "state.json": stateJson("spec") });

        const exitCode = main(["record", "plan", "--feature", "f"], io());

        expect(exitCode).toBe(1);
        expect(JSON.parse(out[0] ?? "{}").wrote).toBe(false);
    });

    it("record passes --reason and --mode revision into the history entry", () => {
        writeFeature("f", { "spec.md": "x" });

        const exitCode = main(
            [
                "record",
                "spec",
                "--feature",
                "f",
                "--mode",
                "revision",
                "--reason",
                "Scope changed.",
            ],
            io(),
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").result.history.at(-1)).toMatchObject({
            step: "spec",
            mode: "revision",
            reason: "Scope changed.",
        });
    });

    it("an attached value may begin with --", () => {
        writeFeature("f", { "state.json": stateJson("spec") });

        const exitCode = main(
            ["record", "decision", "--feature=f", "--text=--no-ff is required"],
            io(),
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").result.decisions).toEqual([
            "--no-ff is required",
        ]);
    });

    it("record done sets completed: true, and report surfaces it", () => {
        writeFeature("f", { "state.json": stateJson("review") });

        const exitCode = main(["record", "done", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").result.completed).toBe(true);

        out = [];
        main(["report", "--feature", "f"], io());
        expect(JSON.parse(out[0] ?? "{}").result.current.completed).toBe(true);
    });

    it("record implement --phase starts the phase", () => {
        writeFeature("f", {
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
            "state.json": stateJson("plan", { currentPhase: "definition" }),
        });

        const exitCode = main(
            [
                "record",
                "implement",
                "--feature",
                "f",
                "--phase",
                "1",
                "--commit-mode",
                "step",
            ],
            io(),
        );

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.command).toBe("record implement");
        expect(envelope.result).toMatchObject({
            currentStep: "implement",
            planPhase: "1",
            commitMode: "step",
        });
        expect(envelope.result.phaseBaseSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("record review --label records the verdict from the artifact", () => {
        writeFeature("f", {
            "reviews/final.md":
                "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|\n",
            "state.json": stateJson("implement", { currentPhase: "execution" }),
        });

        const exitCode = main(
            ["record", "review", "--feature", "f", "--label", "final"],
            io(),
        );

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.command).toBe("record review");
        expect(envelope.result.currentStep).toBe("review");
        expect(envelope.result.history.at(-1)).toMatchObject({
            step: "review",
            label: "final",
            verdict: "PASS",
            artifact: "reviews/final.md",
        });
    });

    it('record implement --phase in a repository with no commits uses "root" as the base', () => {
        dir = mkdtempSync(join(tmpdir(), "qrspi-cli-test-"));
        gitRun(["init", "-q"]);
        writeFeature("f", {
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
            "state.json": stateJson("plan", { currentPhase: "definition" }),
        });

        const exitCode = main(
            ["record", "implement", "--feature", "f", "--phase", "1"],
            io(),
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").result.phaseBaseSha).toBe("root");
    });

    it("record plan and record implement leave plan.md and phase files byte-identical", () => {
        const files = {
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [~] Status marker\n",
        };
        writeFeature("f", { ...files, "spec.md": "x" });
        const read = () =>
            Object.keys(files).map((name) =>
                readFileSync(join(dir, "qrspi", "f", name), "utf8"),
            );
        const before = read();

        for (const argv of [
            ["record", "plan", "--feature", "f"],
            ["record", "implement", "--feature", "f", "--phase", "1"],
            [
                "record",
                "plan",
                "--feature",
                "f",
                "--mode",
                "revision",
                "--reason",
                "Split it.",
            ],
        ]) {
            expect(main(argv, io())).toBe(0);
        }

        expect(read()).toEqual(before);
    });

    it("a git failure exits 3 with the JSON envelope", () => {
        dir = mkdtempSync(join(tmpdir(), "qrspi-cli-test-"));
        writeFeature("f", {
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
        });

        const exitCode = main(
            ["record", "implement", "--feature", "f", "--phase", "1"],
            { ...io(), cwd: dir },
        );

        expect(exitCode).toBe(3);
        expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
            ok: false,
            wrote: false,
        });
        expect(err[0]).toContain("git");
    });

    it("record --dry-run writes nothing", () => {
        writeFeature("f", { "request.md": "x" });

        const exitCode = main(
            ["record", "init", "--feature", "f", "--dry-run"],
            io(),
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").wrote).toBe(false);
    });

    it.each([
        [
            "blank --reason",
            ["record", "init", "--feature", "f", "--reason", "  "],
        ],
        [
            "blank --text",
            ["record", "decision", "--feature", "f", "--text", " "],
        ],
        ["missing --text", ["record", "decision", "--feature", "f"]],
        ["query without --mode", ["record", "query", "--feature", "f"]],
        [
            "--mode revision without --reason",
            ["record", "plan", "--feature", "f", "--mode", "revision"],
        ],
        ["record without a step", ["record", "--feature", "f"]],
        ["an unknown record step", ["record", "launch", "--feature", "f"]],
        [
            "record implement without --phase",
            ["record", "implement", "--feature", "f"],
        ],
        [
            "a malformed --phase id",
            ["record", "implement", "--feature", "f", "--phase", "phase-1"],
        ],
        [
            "an invalid --commit-mode",
            [
                "record",
                "implement",
                "--feature",
                "f",
                "--phase",
                "1",
                "--commit-mode",
                "squash",
            ],
        ],
        [
            "record review without --label",
            ["record", "review", "--feature", "f"],
        ],
        [
            "a non-kebab-case --label",
            ["record", "review", "--feature", "f", "--label", "../final"],
        ],
        ["loop without an action", ["loop", "--feature", "f"]],
        [
            "two loop actions",
            ["loop", "--feature", "f", "--advance", "--start", "1"],
        ],
        [
            "two loop actions, one attached",
            ["loop", "--feature", "f", "--ok=done", "--stop", "x"],
        ],
        ["a blank --stop", ["loop", "--feature", "f", "--stop", " "]],
        ["a blank --abandon", ["loop", "--feature", "f", "--abandon", " "]],
        [
            "--base on record plan",
            ["record", "plan", "--feature", "f", "--base", "HEAD"],
        ],
        ["a blank --ok reason", ["loop", "--feature", "f", "--ok", ""]],
        ["a blank attached --ok reason", ["loop", "--feature", "f", "--ok="]],
        ["--advance with a value", ["loop", "--feature", "f", "--advance=1"]],
        ["--start without a selector", ["loop", "--feature", "f", "--start"]],
        [
            "an unknown --begin action",
            ["loop", "--feature", "f", "--begin", "ship"],
        ],
        [
            "an unknown --end action",
            ["loop", "--feature", "f", "--end", "ship"],
        ],
        [
            "an invalid --result",
            [
                "loop",
                "--feature",
                "f",
                "--end",
                "implement",
                "--result",
                "DONE",
            ],
        ],
        [
            "a blank --note",
            ["loop", "--feature", "f", "--end", "implement", "--note", " "],
        ],
        [
            "an invalid --by",
            ["loop", "--feature", "f", "--begin", "implement", "--by", "cron"],
        ],
        [
            "--commit-mode outside --begin implement",
            [
                "loop",
                "--feature",
                "f",
                "--begin",
                "review",
                "--commit-mode",
                "step",
            ],
        ],
        [
            "--note on an action that does not accept it",
            ["loop", "--feature", "f", "--advance", "--note", "x"],
        ],
        [
            "--by on --stop",
            ["loop", "--feature", "f", "--stop", "x", "--by", "runner"],
        ],
        ["--phase on loop", ["loop", "--feature", "f", "--ok", "--phase", "1"]],
        ["an unknown command", ["check", "--feature", "f"]],
        [
            "an option on the wrong command",
            ["report", "--feature", "f", "--dry-run"],
        ],
        [
            "--reason on record decision",
            [
                "record",
                "decision",
                "--feature",
                "f",
                "--text",
                "x",
                "--reason",
                "y",
            ],
        ],
        [
            "--mode on record research",
            ["record", "research", "--feature", "f", "--mode", "revision"],
        ],
        ["missing --feature", ["report"]],
        ["--help with an unknown command", ["--help", "bogus"]],
        [
            "a blank attached value",
            ["record", "init", "--feature", "f", "--reason="],
        ],
        [
            "--dry-run with a value",
            ["record", "init", "--feature=f", "--dry-run=yes"],
        ],
        [
            "a repeated option, attached and separated",
            ["record", "init", "--feature", "f", "--reason=a", "--reason", "b"],
        ],
        [
            "a repeated --feature",
            ["report", "--feature", "f", "--feature", "f"],
        ],
        ["a malformed --feature", ["report", "--feature", "Not_Valid"]],
    ])("%s exits 2 before writing", (_name, argv) => {
        writeFeature("f", {});

        const exitCode = main(argv, io());

        expect(exitCode).toBe(2);
        expect(out).toEqual([]);
        expect(err.length).toBe(1);
    });

    it("record implement --base outside a repository exits 3, not as a usage error", () => {
        writeFeature("f", {
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
        });

        const previous = process.env.GIT_DIR;
        process.env.GIT_DIR = join(dir, "missing-git-dir");
        try {
            expect(
                main(
                    [
                        "record",
                        "implement",
                        "--feature",
                        "f",
                        "--phase",
                        "1",
                        "--base",
                        "HEAD",
                    ],
                    io(),
                ),
            ).toBe(3);
        } finally {
            if (previous === undefined) delete process.env.GIT_DIR;
            else process.env.GIT_DIR = previous;
        }
    });

    it("record implement checks --phase before resolving --base", () => {
        writeFeature("f", { "request.md": "x" });

        expect(
            main(
                [
                    "record",
                    "implement",
                    "--feature",
                    "f",
                    "--phase",
                    "bad",
                    "--base",
                    "no-such-rev",
                ],
                io(),
            ),
        ).toBe(2);
        expect(err[0]).toContain("--phase");
    });

    it("record implement --base resolves a commit-ish to its full SHA", () => {
        writeFeature("f", {
            "request.md": "x",
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
        });
        const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
            .toString()
            .trim();

        expect(
            main(
                [
                    "record",
                    "implement",
                    "--feature",
                    "f",
                    "--phase",
                    "1",
                    "--base",
                    "HEAD",
                ],
                io(),
            ),
        ).toBe(0);
        expect(JSON.parse(out[0] ?? "{}").result.phaseBaseSha).toBe(head);

        out = [];
        err = [];
        expect(
            main(
                [
                    "record",
                    "implement",
                    "--feature",
                    "f",
                    "--phase",
                    "1",
                    "--base",
                    "no-such-rev",
                ],
                io(),
            ),
        ).toBe(2);
        expect(err[0]).toContain("--base");
    });

    describe("loop actions", () => {
        const loopFiles = (marker: string) => ({
            "request.md": "x",
            "spec.md": "x",
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": `### Step 1: A\n- [${marker}] Status marker\n`,
            "state.json": stateJson("plan", {
                currentPhase: "definition",
                history: [{ step: "plan" }],
                planPhase: "1",
            }),
        });
        const loop = (...args: string[]) => {
            out = [];
            const exitCode = main(["loop", "--feature", "f", ...args], io());
            return { exitCode, envelope: JSON.parse(out[0] ?? "{}") };
        };
        const savedState = () =>
            JSON.parse(readFileSync(join(dir, "qrspi/f/state.json"), "utf8"));

        it("each action round-trips through the JSON envelope", () => {
            writeFeature("f", loopFiles(" "));

            let step = loop("--start", "1");
            expect(step.exitCode).toBe(0);
            expect(step.envelope).toMatchObject({
                ok: true,
                command: "loop --start",
                feature: "f",
                result: { action: "implement", phases: ["1"] },
                wrote: true,
            });

            step = loop("--begin", "implement", "--commit-mode", "step");
            expect(step.envelope).toMatchObject({
                command: "loop --begin",
                result: { action: "implement", commitMode: "step" },
                wrote: true,
            });

            writeFeature("f", {
                "plan-phase-1.md": "### Step 1: A\n- [x] Status marker\n",
            });
            step = loop("--end=implement", "--by", "runner");
            expect(step.envelope).toMatchObject({
                command: "loop --end",
                result: { outcome: "COMPLETE" },
            });
            expect(savedState().history.at(-1)).toMatchObject({
                by: "runner",
                outcome: "COMPLETE",
            });

            expect(loop("--advance").exitCode).toBe(1);

            step = loop("--begin", "review");
            expect(step.envelope).toMatchObject({
                command: "loop --begin",
                result: { action: "review", label: "phase-1-chk1" },
            });
            writeFeature("f", {
                "reviews/phase-1-chk1.md": "## Verdict: PENDING\n",
            });
            expect(loop("--end", "review").envelope).toMatchObject({
                result: { outcome: "incomplete" },
            });

            step = loop("--begin", "review");
            expect(step.envelope.result.label).toBe("phase-1-chk1");
            writeFeature("f", {
                "reviews/phase-1-chk1.md":
                    "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|\n",
            });
            expect(loop("--end", "review").envelope).toMatchObject({
                result: { outcome: "COMPLETE", verdict: "PASS" },
            });

            step = loop("--advance");
            expect(step.envelope).toMatchObject({
                ok: true,
                command: "loop --advance",
            });
            expect(savedState().loop.cycle).toBe("done");
        });

        it("each loop form's example result has a real result's keys and action", () => {
            const loopForms = commandHelp
                .filter((c) => c.command === "loop")
                .flatMap((c) => c.forms);
            const pass =
                "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|\n";
            const setups: Record<string, () => void> = {
                "loop --start": () => {},
                "loop --begin": () => {
                    loop("--start", "1");
                },
                "loop --end": () => {
                    loop("--start", "1");
                    loop("--begin", "implement");
                    writeFeature("f", {
                        "plan-phase-1.md":
                            "### Step 1: A\n- [x] Status marker\n",
                    });
                },
                "loop --advance": () => {
                    // Two phases, so advancing moves to the next phase rather than finishing.
                    writeFeature("f", {
                        "plan.md":
                            "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | First | none | [ ] |\n| 2 | Second | 1 | [ ] |\n",
                        "plan-phase-2.md":
                            "### Step 1: B\n- [ ] Status marker\n",
                    });
                    loop("--start", "all");
                    loop("--begin", "implement");
                    writeFeature("f", {
                        "plan-phase-1.md":
                            "### Step 1: A\n- [x] Status marker\n",
                    });
                    loop("--end", "implement");
                    loop("--begin", "review");
                    writeFeature("f", { "reviews/phase-1-chk1.md": pass });
                    loop("--end", "review");
                },
                "loop --stop": () => {
                    loop("--start", "1");
                },
                "loop --ok": () => {
                    loop("--start", "1");
                    loop("--stop", "needs a human");
                },
                "loop --abandon": () => {
                    loop("--start", "1");
                },
            };
            expect(Object.keys(setups).sort()).toEqual(
                loopForms.map((f) => f.form).sort(),
            );
            for (const form of loopForms) {
                writeFeature("f", loopFiles(" "));
                (setups[form.form] as () => void)();
                // Quoted example values are single arguments; the example's feature and scope are this workspace's.
                const argv = (
                    form.example.command.match(/"[^"]*"|\S+/g) as string[]
                )
                    .map((token) => token.replace(/^"|"$/g, ""))
                    .map((token) => (token === "7..9" ? "1" : token));
                argv[argv.indexOf("--feature") + 1] = "f";
                out = [];
                err = [];
                main([...argv, "--project", dir], io());
                const envelope = JSON.parse(out[0] ?? "{}");
                expect(envelope.ok, `${form.form}: ${out[0]}`).toBe(true);
                const example = form.example.result as Record<string, unknown>;
                expect(
                    Object.keys(example).sort(),
                    `${form.form}: ${out[0]}`,
                ).toEqual(Object.keys(envelope.result).sort());
                if ("action" in example) {
                    expect(envelope.result.action, form.form).toBe(
                        example.action,
                    );
                }
            }
        });

        it("the report example has an active loop's real shape", () => {
            const form = commandHelp
                .filter((c) => c.command === "report")
                .flatMap((c) => c.forms)[0];
            const example = (form as { example: { result: unknown } }).example
                .result as {
                next: Record<string, unknown>;
                loop: Record<string, unknown>;
            };
            writeFeature("f", loopFiles(" "));
            loop("--start", "1");
            loop("--begin", "implement");
            out = [];
            main(["report", "--feature", "f", "--project", dir], io());
            const real = JSON.parse(out[0] ?? "{}").result;
            expect(Object.keys(example).sort()).toEqual(
                Object.keys(real).sort(),
            );
            expect(real.next).toEqual(example.next);
            expect(Object.keys(real.loop).sort()).toEqual(
                Object.keys(example.loop).sort(),
            );
            expect(real.loop.action).toBe(example.loop.action);
        });

        it("the report example's current.loop keys are real keys, with checkpoints and conditions", () => {
            const form = commandHelp
                .filter((c) => c.command === "report")
                .flatMap((c) => c.forms)[0];
            writeFeature("f", loopFiles(" "));
            loop("--start", "1");
            out = [];
            main(["report", "--feature", "f", "--project", dir], io());
            const real = JSON.parse(out[0] ?? "{}").result.current.loop;
            const example = (
                (form as { example: { result: unknown } }).example.result as {
                    current: { loop: Record<string, unknown> };
                }
            ).current.loop;
            expect(Object.keys(example).sort()).toEqual(
                Object.keys(real).sort(),
            );
            expect(real.checkpoints).toEqual([]);
            expect(real.conditions).toEqual([]);
        });

        it("accepts an explicit end result and note", () => {
            writeFeature("f", loopFiles(" "));
            loop("--start", "1");
            loop("--begin", "implement");
            out = [];
            err = [];

            const result = main(
                [
                    "loop",
                    "--feature",
                    "f",
                    "--end",
                    "implement",
                    "--result",
                    "STOPPED",
                    "--note",
                    "needs review",
                ],
                io(),
            );
            expect(result).toBe(0);
            expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
                command: "loop --end",
                result: { outcome: "STOPPED" },
            });
        });

        it("--stop, then --ok with a separated or attached reason", () => {
            writeFeature("f", loopFiles(" "));
            loop("--start", "1");

            let step = loop("--stop", "needs a human");
            expect(step.envelope).toMatchObject({
                command: "loop --stop",
                result: { action: "acknowledge-required" },
                wrote: true,
            });

            step = loop("--ok", "--dry-run");
            expect(step.envelope).toMatchObject({
                command: "loop --ok",
                wrote: false,
            });
            expect(savedState().loop.stoppedReason).toBe("needs a human");

            step = loop("--ok=--checked by hand");
            expect(step.envelope).toMatchObject({
                command: "loop --ok",
                result: { action: "implement" },
                wrote: true,
            });
            expect(savedState().decisions.at(-1)).toContain(
                "--checked by hand",
            );

            loop("--stop", "again");
            step = loop("--ok", "fixed");
            expect(step.envelope).toMatchObject({ wrote: true });
            expect(savedState().decisions.at(-1)).toContain("fixed");
        });

        it("--abandon ends a running loop", () => {
            writeFeature("f", loopFiles(" "));
            loop("--start", "1");

            const step = loop("--abandon=finishing by hand");
            expect(step.envelope).toMatchObject({
                ok: true,
                command: "loop --abandon",
                result: { action: "done" },
                wrote: true,
            });
            expect(savedState().loop.cycle).toBe("done");
            expect(loop("--abandon", "again").exitCode).toBe(1);
        });

        it("a loop hard stop prints its findings and exits 1", () => {
            writeFeature("f", loopFiles(" "));

            const step = loop("--advance");

            expect(step.exitCode).toBe(1);
            expect(step.envelope).toMatchObject({
                ok: false,
                command: "loop --advance",
                wrote: false,
            });
        });
    });

    it("--help describes the tool and its commands without --feature", () => {
        const exitCode = main(["--help"], io());
        expect(exitCode).toBe(0);
        const text = out[0] ?? "";
        expect(text).toContain("qrspi-x");
        // Every command is named, with a pointer to its own help.
        for (const command of commandHelp) {
            expect(text).toContain(command.command);
            expect(text).toContain(`qrspi-x --help ${command.command}`);
        }
    });

    it("no arguments prints the same tool help", () => {
        const exitCode = main([], io());
        expect(exitCode).toBe(0);
        const withoutArgs = out[0];
        out.length = 0;
        main(["--help"], io());
        expect(withoutArgs).toEqual(out[0]);
    });

    it.each([[["--help", "record"]], [["record", "--help"]]])(
        "%j lists the record steps without --feature",
        (argv) => {
            const exitCode = main(argv, io());
            expect(exitCode).toBe(0);
            const text = out[0] ?? "";
            const entry = commandHelp.find((c) => c.command === "record");
            for (const form of entry?.forms ?? []) {
                expect(text).toContain(form.form);
            }
        },
    );

    it.each([[["--help", "record", "spec"]], [["record", "spec", "--help"]]])(
        "%j describes the one form, with options and an example",
        (argv) => {
            const exitCode = main(argv, io());
            expect(exitCode).toBe(0);
            const text = out[0] ?? "";
            expect(text).toContain("record spec");
            expect(text).toContain("--feature");
            expect(text).toContain("--mode");
            // Options a different step owns do not leak into this form.
            expect(text).not.toContain("--phase");
            expect(text).not.toContain("--label");
            expect(text).toContain("record spec --feature");
        },
    );

    it("describes a loop action by its flag", () => {
        const exitCode = main(["--help", "loop", "--start"], io());
        expect(exitCode).toBe(0);
        const text = out[0] ?? "";
        expect(text).toContain("loop --start");
    });

    it("every documented step and action has its own help", () => {
        const forms = commandHelp.flatMap((c) => c.forms.map((f) => f.form));
        for (const form of forms) {
            out.length = 0;
            const exitCode = main(["--help", ...form.split(" ")], io());
            expect(exitCode, form).toBe(0);
            expect(out[0] ?? "", form).toContain(form);
        }
    });

    it("an unknown record step is a usage error, not empty help", () => {
        const exitCode = main(["--help", "record", "bogus"], io());
        expect(exitCode).toBe(2);
        expect(err.join("\n")).toContain("bogus");
    });

    it("--version does not require --feature", () => {
        const exitCode = main(["--version"], io());
        expect(exitCode).toBe(0);
        expect(JSON.parse(out[0] ?? "{}")).toHaveProperty("version");
    });

    describe("help and version flags do not hijack values", () => {
        const decision = (...tail: string[]) => [
            "record",
            "decision",
            "--feature",
            "f",
            ...tail,
        ];

        it.each([["--help"], ["--version"]])(
            "--text %s is a usage error",
            (flag) => {
                writeFeature("f", { "request.md": "x" });
                const exitCode = main(decision("--text", flag), io());
                expect(exitCode).toBe(2);
                expect(err[0]).toContain("--text requires a non-empty value");
                expect(out).toEqual([]);
            },
        );

        it("--text -h records the text", () => {
            writeFeature("f", { "request.md": "x" });
            const exitCode = main(decision("--text", "-h"), io());
            expect(exitCode).toBe(0);
            expect(JSON.stringify(JSON.parse(out[0] ?? "{}"))).toContain(
                '"-h"',
            );
        });

        it("--text=--help records the text", () => {
            writeFeature("f", { "request.md": "x" });
            const exitCode = main(decision("--text=--help"), io());
            expect(exitCode).toBe(0);
            expect(JSON.stringify(JSON.parse(out[0] ?? "{}"))).toContain(
                '"--help"',
            );
        });

        it.each([["--help"], ["-h"]])("%s in flag position is help", (flag) => {
            const exitCode = main(decision(flag), io());
            expect(exitCode).toBe(0);
            expect(out[0]).toContain("record decision");
        });

        it("--version in flag position is the version", () => {
            const exitCode = main(decision("--version"), io());
            expect(exitCode).toBe(0);
            expect(JSON.parse(out[0] ?? "{}")).toHaveProperty("version");
        });
    });

    it("each record form's example result keys are real result keys", () => {
        writeFeature("f", {
            "request.md": "x",
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
            "reviews/final.md":
                "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|\n",
        });
        const forms = commandHelp
            .filter((c) => c.command === "record")
            .flatMap((c) => c.forms);
        for (const form of forms) {
            out.length = 0;
            // Quoted example values are single arguments; the example's feature and phase 9 are this workspace's.
            const argv = (
                form.example.command.match(/"[^"]*"|\S+/g) as string[]
            ).map((token) => token.replace(/^"|"$/g, ""));
            argv[argv.indexOf("--feature") + 1] = "f";
            const phaseAt = argv.indexOf("--phase");
            if (phaseAt >= 0) argv[phaseAt + 1] = "1";
            main([...argv, "--project", dir, "--dry-run"], io());
            const real = JSON.parse(out[0] ?? "{}").result ?? {};
            for (const key of Object.keys(
                form.example.result as Record<string, unknown>,
            )) {
                expect(Object.keys(real), `${form.form}: ${key}`).toContain(
                    key,
                );
            }
        }
    });

    it("--feature followed by another flag is a usage error", () => {
        const exitCode = main(["report", "--feature", "--project", "f"], io());
        expect(exitCode).toBe(2);
        expect(err[0]).toContain("--feature requires a non-empty value");
    });

    it("record init with no state.json starts fresh even when later artifacts exist", () => {
        writeFeature("f", { "request.md": "x", "queries.md": "x" });

        const exitCode = main(["record", "init", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.findings).toEqual([]);
        expect(envelope.result.history).toEqual([
            { step: "init", timestamp: expect.any(String) },
        ]);
    });

    it("ambiguous recovery exits 3 with the full command and feature", () => {
        writeFeature("f", {
            "request.md": "x",
            "state.json": JSON.stringify({
                ...JSON.parse(stateJson("query")),
                loop: { scope: "all" },
            }),
        });

        const exitCode = main(["record", "research", "--feature", "f"], io());

        expect(exitCode).toBe(3);
        expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
            ok: false,
            command: "record research",
            feature: "f",
            findings: [expect.objectContaining({ code: "state-invalid" })],
            wrote: false,
        });
    });

    it("state.json invalid JSON before a plan is rebuilt from the artifacts", () => {
        writeFeature("f", { "request.md": "x", "state.json": "{not json" });

        const exitCode = main(["report", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.findings).toEqual([]);
        expect(envelope.result.current).toMatchObject({ step: "init" });
        expect(envelope.result.next).toMatchObject({ step: "query" });
    });

    it("state.json invalid JSON with a plan is rebuilt, and report still exits 0", () => {
        writeFeature("f", {
            "request.md": "x",
            "state.json": "{not json",
            "spec.md": "x",
            "plan.md":
                "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | Only phase | none | [ ] |\n",
            "plans/plan-phase-1.md": "### Step 1: A\n- [ ] Status marker\n",
        });

        const exitCode = main(["report", "--feature", "f"], io());

        expect(exitCode).toBe(0);
        const envelope = JSON.parse(out[0] ?? "{}");
        expect(envelope.findings).toEqual([]);
        expect(envelope.result.current).toMatchObject({ step: "plan" });
        expect(readFileSync(join(dir, "qrspi/f/state.json"), "utf8")).toBe(
            "{not json",
        );
    });

    const declaredSamples: Record<string, string> = {
        "--phase": "1",
        "--mode": "initial",
        "--commit-mode": "phase",
        "--label": "phase-1",
        "--result": "STOPPED",
        "--by": "runner",
        "--start": "all",
        "--begin": "implement",
        "--end": "implement",
    };

    it.each(
        commandHelp.flatMap((c) => c.forms).map((f) => [f.form, f] as const),
    )("%s accepts every option it declares", (_name, form) => {
        const tokens = form.form.split(" ");
        for (const option of form.options) {
            const sample = declaredSamples[option.name] ?? "text";
            const at = tokens.indexOf(option.name);
            if (at === -1) {
                tokens.push(option.name);
                if (option.value !== null) tokens.push(sample);
            } else if (option.value !== null) {
                tokens.splice(at + 1, 0, sample);
            }
        }
        tokens.push("--feature", "f", "--project", dir);

        main(tokens, io());

        // Option values are validated by each command against real state;
        // this test only checks that the parser accepts what help declares.
        const text = `${tokens.join(" ")}\n${err.join("\n")}`;
        expect(text).not.toContain("Unsupported option");
        expect(text).not.toContain(" requires ");
    });

    it("a required option that is missing is a usage error", () => {
        writeFeature("f", { "request.md": "x" });

        expect(main(["record", "query", "--feature", "f"], io())).toBe(2);
        expect(err.join("\n")).toContain("record query requires --mode");
    });

    it("an option no form declares is a usage error", () => {
        expect(
            main(["record", "init", "--feature", "f", "--label", "x"], io()),
        ).toBe(2);
        expect(err.join("\n")).toContain("Unsupported option(s)");
    });
});

function stateJson(
    currentStep: string,
    overrides: Record<string, unknown> = {},
): string {
    return JSON.stringify(
        {
            feature: "f",
            currentPhase: "discovery",
            currentStep,
            blockers: [],
            decisions: [],
            history: [],
            planPhase: null,
            phaseBaseSha: null,
            commitMode: "phase",
            ...overrides,
        },
        null,
        2,
    );
}

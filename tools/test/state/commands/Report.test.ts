import { describe, expect, it } from "vitest";
import { report, reportFeature } from "../../../src/state/commands/Report.ts";
import { UsageError } from "../../../src/state/errors.ts";
import type { StateFileSystem } from "../../../src/state/ports.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { State } from "../../../src/state/types.ts";
import {
    baseState,
    fakeGit,
    fakeWorkspace,
    inPlansLayout,
} from "../fixtures.ts";
import {
    loopBlock,
    loopState,
    phaseId,
    phaseSteps,
    plannedState,
    planTable,
    readyFiles,
    reviewFile,
} from "../loop/fixtures.ts";

const planMarkdown = (rows: string) =>
    [
        "| Phase | Name | Depends On | Status |",
        "|-------|------|------------|--------|",
        rows,
    ].join("\n");

describe("report", () => {
    it("a valid fixture with no findings exits 0 and writes nothing", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit(),
        });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.findings).toEqual([]);
        expect(outcome.wrote).toBe(false);
    });

    it("open-questions", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({
                "request.md": "## Open Questions\n- Still open?",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "open-questions" }),
        );
        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
    });

    it("new-questions", () => {
        const outcome = report(baseState({ currentStep: "research" }), {
            workspace: fakeWorkspace({
                "request.md": "x",
                "research.md": "## New Questions\n- Still open?",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "new-questions" }),
        );
    });

    it("approach-undecided", () => {
        const outcome = report(baseState({ currentStep: "research" }), {
            workspace: fakeWorkspace({
                "request.md": "x",
                "approach.md": "# Approach",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "approach-undecided" }),
        );
    });

    const twoPhaseFiles = {
        "request.md": "x",
        "plan.md": planMarkdown("| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |"),
        "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
        "plan-phase-2.md":
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [!] Status marker\n\n### Step 3: C\n- [~] Status marker",
    };
    const inPhase2 = baseState({
        currentStep: "implement",
        planPhase: phaseId("2"),
        blockers: ["2.2: waiting on a decision"],
    });

    it("planProgress covers only the active phase", () => {
        const outcome = report(inPhase2, {
            workspace: fakeWorkspace(twoPhaseFiles),
            git: fakeGit(),
        });
        expect(outcome.result?.current.planProgress).toEqual({
            current: "2.3",
            completed: ["2.1"],
            blocked: ["2.2"],
        });
    });

    it("--phase naming the active phase matches the default", () => {
        const services = {
            workspace: fakeWorkspace(twoPhaseFiles),
            git: fakeGit(),
        };
        expect(
            report(inPhase2, services, { phase: "2" }).result?.current
                .planProgress,
        ).toEqual(report(inPhase2, services).result?.current.planProgress);
    });

    it("--phase narrows planProgress to another phase instead of planPhase", () => {
        const outcome = report(
            inPhase2,
            { workspace: fakeWorkspace(twoPhaseFiles), git: fakeGit() },
            { phase: "1" },
        );
        expect(outcome.result?.current.planPhase).toBe("2");
        expect(outcome.result?.current.planProgress).toEqual({
            current: null,
            completed: ["1.1"],
            blocked: [],
        });
    });

    it("--phase reports planProgress even with no state.json", () => {
        const outcome = report(
            null,
            { workspace: fakeWorkspace(twoPhaseFiles), git: fakeGit() },
            { phase: "1" },
        );
        expect(outcome.result?.current.planProgress).toEqual({
            current: null,
            completed: ["1.1"],
            blocked: [],
        });
    });

    it("--phase with an id not in plan.md is a usage error", () => {
        expect(() =>
            report(
                inPhase2,
                { workspace: fakeWorkspace(twoPhaseFiles), git: fakeGit() },
                { phase: "9" },
            ),
        ).toThrow(UsageError);
    });

    it("labels name the active phase's next review labels", () => {
        const outcome = report(
            {
                ...inPhase2,
                history: [
                    {
                        step: "review",
                        timestamp: "2026-01-01T00:00:00Z",
                        label: "final",
                    },
                ],
            },
            {
                workspace: fakeWorkspace({
                    ...twoPhaseFiles,
                    "reviews/phase-2.md": "x",
                    "reviews/phase-2-chk1.md": "x",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.result?.labels).toEqual({
            phase: "phase-2-r2",
            step: "phase-2-step-1",
            final: "final-r2",
        });
    });

    it("the mid-phase label follows the last completed step", () => {
        const outcome = report(inPhase2, {
            workspace: fakeWorkspace({
                ...twoPhaseFiles,
                "plan-phase-2.md":
                    "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [x] Status marker\n\n### Step 3: C\n- [ ] Status marker",
            }),
            git: fakeGit(),
        });
        expect(outcome.result?.labels.step).toBe("phase-2-step-2");
    });

    it("--phase narrows labels, and step is absent with no completed step", () => {
        const outcome = report(
            inPhase2,
            {
                workspace: fakeWorkspace({
                    ...twoPhaseFiles,
                    "plan-phase-1.md": "### Step 1: A\n- [ ] Status marker",
                }),
                git: fakeGit(),
            },
            { phase: "1" },
        );
        expect(outcome.result?.labels).toEqual({
            phase: "phase-1",
            final: "final",
        });
    });

    it.each([
        ["abcdef0", "git diff abcdef0"],
        ["root", "git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904"],
    ])("diff for a phase base of %s is %s", (base, diff) => {
        const outcome = report(
            { ...inPhase2, phaseBaseSha: base },
            { workspace: fakeWorkspace(twoPhaseFiles), git: fakeGit() },
        );
        expect(outcome.result?.diff).toBe(diff);
    });

    it("diff is absent before a phase has a base", () => {
        const outcome = report(
            { ...inPhase2, phaseBaseSha: null },
            { workspace: fakeWorkspace(twoPhaseFiles), git: fakeGit() },
        );
        expect(outcome.result).not.toHaveProperty("diff");
    });

    it("labels hold only final with no active phase", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit(),
        });
        expect(outcome.result?.labels).toEqual({ final: "final" });
    });

    it("next for a complete phase carries its human review label", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    ...twoPhaseFiles,
                    "reviews/phase-1-chk1.md": "x",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.result?.next).toMatchObject({
            step: "review",
            phase: "1",
            label: "phase-1",
        });
    });

    it("next for an all-complete plan carries the final label", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan.md": planMarkdown("| 1 | A | none | [x] |"),
                    "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.result?.next).toMatchObject({
            step: "review",
            label: "final",
        });
    });

    it("planProgress is absent before execution (no plan yet)", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit(),
        });
        expect(outcome.result?.current.planProgress).toBeUndefined();
    });

    it("multiple-in-progress", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md":
                        "### Step 1: A\n- [~] Status marker\n\n### Step 2: B\n- [~] Status marker",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "multiple-in-progress" }),
        );
    });

    it("step-blocked (unblocked by any recorded blocker)", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": "### Step 1: A\n- [!] Status marker",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "step-blocked" }),
        );
    });

    it("step-blocked is suppressed when a blocker already names the step", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
                blockers: ["1.1: waiting on a decision"],
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": "### Step 1: A\n- [!] Status marker",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings.some((f) => f.code === "step-blocked")).toBe(
            false,
        );
    });

    it("phase-row-mismatch", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan.md": planMarkdown("| 1 | Phase 1 | none | [x] |"),
                    "plan-phase-1.md":
                        "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "phase-row-mismatch" }),
        );
    });

    it.each([
        ["[~]", true],
        ["[x]", false],
    ])(
        "phase-row-mismatch when every step is [x] but the row is %s: %s",
        (status, expected) => {
            const outcome = report(
                baseState({
                    currentStep: "implement",
                    planPhase: phaseId("1"),
                }),
                {
                    workspace: fakeWorkspace({
                        "request.md": "x",
                        "plan.md": planMarkdown(
                            `| 1 | Phase 1 | none | ${status} |`,
                        ),
                        "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                    }),
                    git: fakeGit(),
                },
            );
            expect(
                outcome.findings.some((f) => f.code === "phase-row-mismatch"),
            ).toBe(expected);
        },
    );

    it("dirty-tree lists every changed path", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit({ status: () => [{ path: "src/app.ts" }] }),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "dirty-tree" }),
        );
    });

    it("dirty-tree names both sides of a rename", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit({
                status: () => [
                    {
                        path: "src/new-name.ts",
                        originalPath: "src/old-name.ts",
                    },
                ],
            }),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({
                code: "dirty-tree",
                message: expect.stringContaining("src/old-name.ts"),
            }),
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({
                code: "dirty-tree",
                message: expect.stringContaining("src/new-name.ts"),
            }),
        );
    });

    it.each([["a b.txt"], ["\u00e9.txt"]])(
        "dirty-tree lists %s unquoted",
        (name) => {
            const outcome = report(baseState({ currentStep: "query" }), {
                workspace: fakeWorkspace({ "request.md": "x" }),
                git: fakeGit({ status: () => [{ path: name }] }),
            });
            expect(outcome.findings).toContainEqual({
                code: "dirty-tree",
                message: `Uncommitted changes: ${name}`,
            });
        },
    );

    it("dirty-tree lists the old path before the new one for a rename", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit({
                status: () => [
                    { path: "new name.txt", originalPath: "old.txt" },
                ],
            }),
        });
        expect(outcome.findings).toContainEqual({
            code: "dirty-tree",
            message: "Uncommitted changes: old.txt, new name.txt",
        });
    });

    it("no dirty-tree finding on a clean tree", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({ "request.md": "x" }),
            git: fakeGit({ status: () => [] }),
        });
        expect(outcome.findings.some((f) => f.code === "dirty-tree")).toBe(
            false,
        );
    });

    it("format-invalid: a malformed plan.md table surfaces the parser's finding", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({
                "request.md": "x",
                "plan.md": "not a table",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "format-invalid" }),
        );
        expect(outcome.exitCode).toBe(0);
    });

    it("format-invalid: a malformed phase file surfaces the parser's finding", () => {
        const outcome = report(
            baseState({
                currentStep: "implement",
                planPhase: phaseId("1"),
            }),
            {
                workspace: fakeWorkspace({
                    "request.md": "x",
                    "plan-phase-1.md": "### Step 1: A\n\nno status marker line",
                }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "format-invalid" }),
        );
        expect(outcome.exitCode).toBe(0);
    });

    it("an unrecorded review is not a finding", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({
                "request.md": "x",
                "reviews/phase-1.md":
                    "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([]);
    });

    const phaseOneDone = {
        "request.md": "x",
        "plan.md": planMarkdown("| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |"),
        "plans/plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
        "plans/plan-phase-2.md": "### Step 1: A\n- [ ] Status marker",
    };
    const atPhaseOne = baseState({
        currentStep: "review",
        planPhase: phaseId("1"),
    });

    it("the review the markers call for with an unclear verdict is format-invalid", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "reviews/phase-1.md": "x\n## Verdict: PASS\n",
                "reviews/phase-1-r2.md": "## Verdict: MAYBE\n",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([
            expect.objectContaining({
                code: "format-invalid",
                file: "reviews/phase-1-r2.md",
                message: expect.stringContaining("Verdict"),
            }),
        ]);
    });

    it("the active phase's newest checkpoint with a malformed table is format-invalid", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "reviews/phase-1-chk1.md": "## Verdict: MAYBE\n",
                "reviews/phase-1-chk2.md": "## Verdict: FAIL\n",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([
            expect.objectContaining({
                code: "format-invalid",
                file: "reviews/phase-1-chk2.md",
                message: expect.stringContaining("table"),
            }),
        ]);
    });

    it("an unclear review both checks reach is reported once", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "reviews/phase-1.md": "## Verdict: MAYBE\n",
            }),
            git: fakeGit(),
        });
        expect(
            outcome.findings.filter(
                (finding) => finding.file === "reviews/phase-1.md",
            ),
        ).toHaveLength(1);
    });

    it("a PENDING checkpoint stub is not format-invalid", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "reviews/phase-1-chk1.md": "## Verdict: PENDING\n",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([]);
    });

    it("older and unrelated review files are not read", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "reviews/phase-1.md": "## Verdict: MAYBE\n",
                "reviews/phase-1-r2.md": "## Verdict: PASS\n",
                "reviews/phase-2.md": "## Verdict: MAYBE\n",
                "reviews/final.md": "## Verdict: PASS\n",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([]);
    });

    it("ignores a review file whose name is not a review label", () => {
        const outcome = report(baseState({ currentStep: "query" }), {
            workspace: fakeWorkspace({
                "request.md": "x",
                "reviews/not-a-real-label.md":
                    "## Verdict: PASS\n\n| Severity | Blocking | Description |\n|---|---|---|",
            }),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([]);
    });

    it("a root-layout workspace gets the advisory legacy-plan-location finding", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "plans/plan-phase-1.md": null,
                "plans/plan-phase-2.md": null,
                "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                "plan-phase-2.md": "### Step 1: A\n- [ ] Status marker",
            }),
            git: fakeGit(),
        });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.findings).toEqual([
            expect.objectContaining({
                code: "legacy-plan-location",
                message: expect.stringContaining("plan-phase-1.md"),
            }),
        ]);
    });

    it("a file named plans is reported, and phase files still resolve from the root", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "plans/plan-phase-1.md": null,
                "plans/plan-phase-2.md": null,
                plans: "not a directory",
                "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                "plan-phase-2.md": "### Step 1: A\n- [ ] Status marker",
            }),
            git: fakeGit(),
        });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "plans-not-a-directory" }),
        );
        expect(outcome.result?.current.phase).toBe("execution");
    });

    it("a plans/ workspace gets no plans-not-a-directory finding", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace(phaseOneDone),
            git: fakeGit(),
        });
        expect(
            outcome.findings.filter((f) => f.code === "plans-not-a-directory"),
        ).toEqual([]);
    });

    it("a plans/ workspace gets no legacy-plan-location finding", () => {
        const outcome = report(atPhaseOne, {
            workspace: fakeWorkspace(phaseOneDone),
            git: fakeGit(),
        });
        expect(outcome.findings).toEqual([]);
    });

    it("the legacy finding leaves position and progress unchanged", () => {
        const inPlans = report(atPhaseOne, {
            workspace: fakeWorkspace(phaseOneDone),
            git: fakeGit(),
        });
        const inRoot = report(atPhaseOne, {
            workspace: fakeWorkspace({
                ...phaseOneDone,
                "plans/plan-phase-1.md": null,
                "plans/plan-phase-2.md": null,
                "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
                "plan-phase-2.md": "### Step 1: A\n- [ ] Status marker",
            }),
            git: fakeGit(),
        });
        expect(inRoot.exitCode).toBe(inPlans.exitCode);
        expect(inRoot.result).toEqual(inPlans.result);
    });

    it("a flat and an equivalent plans/ workspace report identically", () => {
        const flatFiles = {
            "request.md": "x",
            "plan.md": planMarkdown(
                "| 1 | A | none | [x] |\n| 2 | B | 1 | [ ] |",
            ),
            "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
            "plan-phase-2.md":
                "### Step 1: A\n- [~] Status marker\n\n### Step 2: B\n- [ ] Status marker",
        };
        const atPhaseTwo = baseState({
            currentStep: "implement",
            planPhase: phaseId("2"),
        });

        const flat = report(atPhaseTwo, {
            workspace: fakeWorkspace(flatFiles),
            git: fakeGit(),
        });
        const nested = report(atPhaseTwo, {
            workspace: fakeWorkspace(inPlansLayout(flatFiles)),
            git: fakeGit(),
        });

        expect(nested.result).toEqual(flat.result);
        expect(nested.exitCode).toBe(flat.exitCode);
        // The layouts differ by exactly the advisory finding.
        expect(
            flat.findings.filter((f) => f.code !== "legacy-plan-location"),
        ).toEqual(nested.findings);
        expect(flat.findings.map((f) => f.code)).toContain(
            "legacy-plan-location",
        );
        expect(nested.findings.map((f) => f.code)).not.toContain(
            "legacy-plan-location",
        );
    });

    it("both layouts yield the same phase ids and per-phase progress", () => {
        const files = {
            "plan.md": planMarkdown("| 1 | A | none | [x] |"),
            "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
            "plan-phase-3a.md": "### Step 1: A\n- [ ] Status marker",
        };
        const flat = fakeWorkspace(files);
        const nested = fakeWorkspace(inPlansLayout(files));

        expect([...nested.phaseFiles().keys()].sort()).toEqual(
            [...flat.phaseFiles().keys()].sort(),
        );
        expect(nested.phaseFile("3a")?.steps).toEqual(
            flat.phaseFile("3a")?.steps,
        );
        expect(nested.phaseComplete("1")).toBe(flat.phaseComplete("1"));
    });

    it("blockers", () => {
        const outcome = report(
            baseState({ currentStep: "query", blockers: ["1.1: stuck"] }),
            {
                workspace: fakeWorkspace({ "request.md": "x" }),
                git: fakeGit(),
            },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "blockers" }),
        );
    });
});

describe("reportFeature", () => {
    const statePath = "qrspi/f/state.json";

    /** Runs `report` over one in-memory file set holding both state.json and the workspace. */
    function run(files: Record<string, string>) {
        const before = { ...files };
        const fileSystem: StateFileSystem = {
            read: (path) => (path in files ? (files[path] ?? null) : null),
            writeTemp: () => {
                throw new Error("report must not write");
            },
            rename: () => {
                throw new Error("report must not write");
            },
            remove: () => {
                throw new Error("report must not write");
            },
        };
        const outcome = reportFeature({
            services: {
                store: new Store({ feature: "f", path: statePath, fileSystem }),
                workspace: fakeWorkspace(files),
                git: fakeGit(),
                clock: { now: () => "2026-09-27T00:00:00Z" },
            },
            context: { feature: "f" },
        });
        expect(files).toEqual(before);
        return outcome;
    }

    const planFiles = {
        "request.md": "x",
        "plan.md": planMarkdown("| 1 | A | none | [ ] |\n| 2 | B | 1 | [ ] |"),
        "plan-phase-1.md": "### Step 1: A\n- [x] Status marker",
        "plan-phase-2.md":
            "### Step 1: A\n- [~] Status marker\n\n### Step 2: B\n- [ ] Status marker",
    };

    it("with neither state.json nor request.md, recommends init", () => {
        const outcome = run({});
        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.next).toEqual({
            step: "init",
            alternatives: [],
        });
        expect(outcome.findings).toEqual([]);
    });

    it("state.json without request.md has no next", () => {
        const outcome = run({ [statePath]: JSON.stringify(baseState()) });
        expect(outcome.result?.next.step).toBeNull();
        expect(outcome.findings.map((f) => f.code)).toContain(
            "workspace-incomplete",
        );
    });

    it("a missing state.json is rebuilt and navigation continues", () => {
        const outcome = run({ "request.md": "x" });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.current.step).toBe("init");
        expect(outcome.result?.next.step).toBe("query");
    });

    it("derives the phase from currentStep, whatever a stored currentPhase says", () => {
        const outcome = run({
            "request.md": "x",
            [statePath]: JSON.stringify({
                ...baseState({ currentStep: "spec" }),
                currentPhase: "execution",
            }),
        });
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.current).toMatchObject({
            phase: "definition",
            step: "spec",
        });
    });

    it("a partly invalid file is repaired without a finding and navigates from the recovered position", () => {
        const outcome = run({
            "request.md": "x",
            [statePath]: JSON.stringify({
                ...baseState({ currentStep: "spec" }),
                currentPhase: "building",
            }),
        });
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.current).toMatchObject({
            phase: "definition",
            step: "spec",
        });
        expect(outcome.result?.next.step).toBe("plan");
    });

    it("an unparseable file with a begun phase recovers to implement on it", () => {
        const outcome = run({ ...planFiles, [statePath]: "{ not json" });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.current).toMatchObject({
            phase: "execution",
            step: "implement",
            planPhase: "2",
        });
        expect(outcome.result?.next).toMatchObject({
            step: "implement",
            phase: "2",
        });
    });

    it("ambiguous evidence gives its finding and no next", () => {
        const outcome = run({
            ...planFiles,
            "plan-phase-1.md": "### Step 1: A\n- [~] Status marker",
            [statePath]: "{ not json",
        });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.findings.map((f) => f.code)).toEqual([
            "multiple-in-progress",
        ]);
        expect(outcome.result?.next).toEqual({ step: null, alternatives: [] });
    });
});

describe("report's loop part", () => {
    const readyWithRequest = () => ({ ...readyFiles(), "request.md": "x" });

    function cycleState(
        cycle: NonNullable<State["loop"]>["cycle"],
        overrides: Partial<NonNullable<State["loop"]>> = {},
        stateOverrides: Partial<State> = {},
    ): State {
        return loopState({
            currentStep: "implement",
            loop: loopBlock(cycle, overrides),
            ...stateOverrides,
        });
    }

    const run = (
        state: State,
        files: Record<string, string> = readyWithRequest(),
        gitRunner = fakeGit(),
    ) => report(state, { workspace: fakeWorkspace(files), git: gitRunner });
    const codes = (outcome: ReturnType<typeof run>) =>
        outcome.findings.map((finding) => finding.code);

    it("an active loop navigates to loop and reports its next action", () => {
        const outcome = run(cycleState("implement"));
        expect(outcome.result?.next).toEqual({
            step: "loop",
            alternatives: [],
        });
        expect(outcome.result?.loop).toEqual({
            action: "implement",
            phase: "2",
        });
    });

    it("current summarizes the persisted loop block", () => {
        const outcome = run(cycleState("implement"));
        expect(outcome.result?.current.loop).toEqual({
            scope: "2",
            phases: ["2"],
            cycle: "implement",
            phase: "2",
            stoppedReason: null,
            checkpoints: [],
            conditions: [],
        });
    });

    it("current.loop lists checkpoints oldest first and conditions verbatim", () => {
        const outcome = run(
            cycleState(
                "advance",
                {
                    conditions: [
                        { phase: phaseId("1"), label: "phase-1", note: "a" },
                        { phase: phaseId("2"), label: "phase-2", note: "b" },
                    ],
                },
                {
                    history: [
                        {
                            step: "checkpoint",
                            phase: phaseId("1"),
                            label: "phase-1",
                            verdict: "PASS WITH CONDITIONS",
                        },
                        { step: "implement", phase: phaseId("2") },
                        {
                            step: "checkpoint",
                            phase: phaseId("2"),
                            label: "phase-2",
                            verdict: "PASS",
                        },
                    ],
                },
            ),
        );
        expect(outcome.result?.current.loop?.checkpoints).toEqual([
            { phase: "1", label: "phase-1", verdict: "PASS WITH CONDITIONS" },
            { phase: "2", label: "phase-2", verdict: "PASS" },
        ]);
        expect(outcome.result?.current.loop?.conditions).toEqual([
            { phase: "1", label: "phase-1", note: "a" },
            { phase: "2", label: "phase-2", note: "b" },
        ]);
    });

    it("keeps the persisted scope after plan.md gains a phase", () => {
        const outcome = run(cycleState("implement"), {
            ...readyWithRequest(),
            "plan.md": planTable(
                "1 | Foundation | none",
                "2 | Feature | 1",
                "2a | Inserted | 1",
            ),
            "plan-phase-2a.md": phaseSteps(" "),
        });
        expect(outcome.result?.current.loop?.phases).toEqual(["2"]);
        expect(outcome.result?.loop).toEqual({
            action: "implement",
            phase: "2",
        });
    });

    it("no loop part when no loop block exists", () => {
        const outcome = run(plannedState());
        expect(outcome.result).not.toHaveProperty("loop");
        expect(outcome.result?.current).not.toHaveProperty("loop");
    });

    it("advance-pending when the loop phase passed its checkpoint", () => {
        const outcome = run(cycleState("advance"), {
            ...readyWithRequest(),
            "plan-phase-2.md": phaseSteps("x"),
        });
        expect(codes(outcome)).toContain("advance-pending");
        expect(outcome.result?.loop).toEqual({ action: "advance", phase: "2" });
    });

    it("review-pending when the pending checkpoint already exists", () => {
        const outcome = run(
            cycleState(
                "review",
                {},
                {
                    currentStep: "checkpoint",
                    history: [
                        { step: "plan" },
                        {
                            step: "checkpoint",
                            phase: phaseId("2"),
                            label: "phase-2-chk1",
                            by: "autoloop",
                        },
                    ],
                },
            ),
            {
                ...readyWithRequest(),
                "plan-phase-2.md": phaseSteps("x"),
                "reviews/phase-2-chk1.md": reviewFile("PASS"),
            },
        );
        expect(codes(outcome)).toContain("review-pending");
        expect(outcome.result?.loop).toEqual({
            action: "end",
            launch: "review",
            phase: "2",
            label: "phase-2-chk1",
        });
    });

    it("loop-stopped and blockers require acknowledgement, each reported once", () => {
        const outcome = run(
            cycleState(
                "implement",
                { stoppedReason: "implementer STOPPED" },
                { blockers: ["2.1: needs a human"] },
            ),
        );
        expect(codes(outcome)).toContain("loop-stopped");
        expect(
            codes(outcome).filter((code) => code === "blockers"),
        ).toHaveLength(1);
        expect(outcome.result?.loop).toEqual({
            action: "acknowledge-required",
            reason: "implementer STOPPED",
            blockers: ["2.1: needs a human"],
        });
    });

    it("an unusable pending review stops the loop, its finding reported once", () => {
        const outcome = run(
            cycleState(
                "review",
                {},
                {
                    currentStep: "checkpoint",
                    history: [
                        { step: "plan" },
                        {
                            step: "checkpoint",
                            phase: phaseId("2"),
                            label: "phase-2-chk1",
                            by: "autoloop",
                        },
                    ],
                },
            ),
            {
                ...readyWithRequest(),
                "plan-phase-2.md": phaseSteps("x"),
                "reviews/phase-2-chk1.md": "## Verdict: MAYBE",
            },
        );
        expect(outcome.result?.loop).toMatchObject({ action: "stop" });
        expect(
            outcome.findings.filter(
                (finding) => finding.file === "reviews/phase-2-chk1.md",
            ),
        ).toHaveLength(1);
    });

    it("a dirty tree outside partial work stops the loop, reported once", () => {
        const outcome = run(
            cycleState("implement"),
            readyWithRequest(),
            fakeGit({ status: () => [{ path: "src/product.ts" }] }),
        );
        expect(
            codes(outcome).filter((code) => code === "dirty-tree"),
        ).toHaveLength(1);
        expect(outcome.result?.loop).toMatchObject({ action: "stop" });
    });

    it("a done loop reports done and navigates by step", () => {
        const outcome = run(cycleState("done"));
        expect(outcome.result?.loop).toEqual({ action: "done" });
        expect(outcome.result?.next.step).toBe("implement");
    });
});

describe("report's loop preconditions before start", () => {
    const planState = (overrides: Partial<State> = {}) =>
        plannedState({
            currentStep: "plan",
            planPhase: phaseId("2"),
            phaseBaseSha: null,
            ...overrides,
        });
    const run = (
        state: State,
        files: Record<string, string>,
        gitRunner = fakeGit(),
    ) => report(state, { workspace: fakeWorkspace(files), git: gitRunner });

    it("offering loop with every precondition met adds no finding", () => {
        const outcome = run(planState(), {
            ...(inPlansLayout(readyFiles()) as Record<string, string>),
            "request.md": "x",
        });
        expect(outcome.result?.next.alternatives).toContain("loop");
        expect(outcome.findings).toEqual([]);
    });

    it("offering loop reports a failed precondition", () => {
        const { "spec.md": _spec, ...files } = readyFiles();
        const outcome = run(planState(), { ...files, "request.md": "x" });
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({
                code: "workspace-incomplete",
                file: "spec.md",
            }),
        );
    });

    it("offering loop reports a stale plan", () => {
        const outcome = run(
            planState({ history: [{ step: "plan" }, { step: "spec" }] }),
            { ...readyFiles(), "request.md": "x" },
        );
        expect(outcome.findings).toContainEqual(
            expect.objectContaining({ code: "plan-not-current" }),
        );
    });

    it("a precondition finding already reported is not repeated", () => {
        const outcome = run(
            planState(),
            { ...readyFiles(), "request.md": "x" },
            fakeGit({ status: () => [{ path: "src/product.ts" }] }),
        );
        expect(
            outcome.findings.filter((finding) => finding.code === "dirty-tree"),
        ).toHaveLength(1);
    });

    it("preconditions are not checked where loop is not offered", () => {
        const { "spec.md": _spec, ...files } = readyFiles();
        const outcome = run(plannedState({ currentStep: "implement" }), {
            ...files,
            "request.md": "x",
        });
        expect(outcome.findings).not.toContainEqual(
            expect.objectContaining({ file: "spec.md" }),
        );
    });
});

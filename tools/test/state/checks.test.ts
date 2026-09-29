import { describe, expect, it } from "vitest";
import {
    approachUndecidedFindings,
    baseNotAncestorFindings,
    blockersFindings,
    dirtyTreeFindings,
    missingPhaseFileFindings,
    newQuestionsFindings,
    openQuestionsFindings,
    phaseFormatFindings,
    planFormatFindings,
    scopeErrorFinding,
} from "../../src/state/checks.ts";
import type { State } from "../../src/state/types.ts";
import { fakeGit, fakeWorkspace } from "./fixtures.ts";
import { planTable } from "./loop/fixtures.ts";

const state = (blockers: string[]): State => ({
    feature: "f",
    currentStep: "plan",
    blockers,
    decisions: [],
    history: [],
    planPhase: null,
    phaseBaseSha: null,
    commitMode: "phase",
});

describe("checks", () => {
    it("approach-undecided fires only when approach.md exists without a Decision", () => {
        expect(approachUndecidedFindings(fakeWorkspace())).toEqual([]);
        expect(
            approachUndecidedFindings(
                fakeWorkspace({ "approach.md": "## Decision\nB." }),
            ),
        ).toEqual([]);
        expect(
            approachUndecidedFindings(
                fakeWorkspace({ "approach.md": "## Decision\nNone." }),
            ),
        ).toEqual([
            {
                code: "approach-undecided",
                message:
                    "approach.md exists but has no filled-in Decision section yet",
                file: "approach.md",
            },
        ]);
    });

    it("open-questions names request.md", () => {
        expect(
            openQuestionsFindings(
                fakeWorkspace({ "request.md": "## Open Questions\nNone." }),
            ),
        ).toEqual([]);
        expect(
            openQuestionsFindings(
                fakeWorkspace({ "request.md": "## Open Questions\n- Why?" }),
            ),
        ).toEqual([
            {
                code: "open-questions",
                message:
                    "request.md has an open item under Open Questions that has not been resolved",
                file: "request.md",
            },
        ]);
    });

    it("new-questions names research.md", () => {
        expect(
            newQuestionsFindings(
                fakeWorkspace({ "research.md": "## New Questions\nNone." }),
            ),
        ).toEqual([]);
        expect(
            newQuestionsFindings(
                fakeWorkspace({ "research.md": "## New Questions\n- Why?" }),
            ),
        ).toEqual([
            {
                code: "new-questions",
                message:
                    "research.md has an open item under New Questions that has not been resolved",
                file: "research.md",
            },
        ]);
    });

    it("blockers counts the recorded blockers", () => {
        expect(blockersFindings(state([]))).toEqual([]);
        expect(blockersFindings(state(["a"]))[0]?.message).toBe(
            "1 blocker must be resolved before continuing",
        );
        expect(blockersFindings(state(["a", "b"]))[0]?.message).toBe(
            "2 blockers must be resolved before continuing",
        );
    });

    it("dirty-tree lists each changed path once, rename originals first", () => {
        expect(dirtyTreeFindings(fakeGit())).toEqual([]);
        const git = fakeGit({
            status: () => [
                { path: "a.txt" },
                { path: "new.txt", originalPath: "old.txt" },
                { path: "a.txt" },
            ],
        });
        expect(dirtyTreeFindings(git)).toEqual([
            {
                code: "dirty-tree",
                message: "Uncommitted changes: a.txt, old.txt, new.txt",
            },
        ]);
    });

    it("missing phase file names the plans/ path", () => {
        expect(
            missingPhaseFileFindings(
                fakeWorkspace({ "plans/plan-phase-2.md": "### Step 1: X\n" }),
                "2",
            ),
        ).toEqual([]);
        expect(missingPhaseFileFindings(fakeWorkspace(), "2")).toEqual([
            {
                code: "workspace-incomplete",
                message:
                    "plans/plan-phase-2.md is missing; a human must supply it before the workflow can continue",
                file: "plans/plan-phase-2.md",
            },
        ]);
    });

    it("scope errors map missing rows and ordering failures", () => {
        for (const kind of ["missing", "missing-dependency"] as const) {
            expect(scopeErrorFinding({ kind, message: "m" })).toEqual({
                code: "workspace-incomplete",
                message: "m",
                file: "plan.md",
            });
        }
        for (const kind of ["plan", "cycle"] as const) {
            expect(scopeErrorFinding({ kind, message: "m" })).toEqual({
                code: "format-invalid",
                message: "m",
                file: "plan.md",
            });
        }
    });

    it("base-not-ancestor skips a missing base and root, and asks git otherwise", () => {
        const git = fakeGit({ isAncestor: () => false });
        expect(baseNotAncestorFindings(git, null)).toEqual([]);
        expect(baseNotAncestorFindings(git, undefined)).toEqual([]);
        expect(baseNotAncestorFindings(git, "root")).toEqual([]);
        expect(baseNotAncestorFindings(fakeGit(), "abc1234")).toEqual([]);
        expect(baseNotAncestorFindings(git, "abc1234")).toEqual([
            {
                code: "base-not-ancestor",
                message: expect.stringContaining("abc1234"),
            },
        ]);
    });

    describe("format findings by scope", () => {
        const badPhase = "### Step 1: Bad\n- [?] Status marker\n";
        const files = {
            "plan.md": planTable("1 | Base | none", "2 | Next | 1"),
            "plans/plan-phase-1.md": badPhase,
            "plans/plan-phase-2.md": badPhase,
        };
        const workspace = fakeWorkspace(files);
        const filesOf = (findings: { file?: string }[]) =>
            findings.map((finding) => finding.file);

        it("plan.md has none when well formed", () => {
            expect(planFormatFindings(workspace)).toEqual([]);
        });

        it("reads every phase file, the plan rows, or the listed phases", () => {
            const both = ["plans/plan-phase-1.md", "plans/plan-phase-2.md"];
            expect(filesOf(phaseFormatFindings(workspace, "all"))).toEqual(
                both,
            );
            expect(
                filesOf(phaseFormatFindings(workspace, "plan-rows")),
            ).toEqual(both);
            expect(filesOf(phaseFormatFindings(workspace, ["2"]))).toEqual([
                "plans/plan-phase-2.md",
            ]);
        });

        it("reports a listed phase with no file only when asked", () => {
            expect(phaseFormatFindings(workspace, ["3"])).toEqual([]);
            expect(
                phaseFormatFindings(workspace, ["3", "1"], true).map(
                    (finding) => finding.code,
                ),
            ).toEqual(["workspace-incomplete", "format-invalid"]);
        });
    });
});

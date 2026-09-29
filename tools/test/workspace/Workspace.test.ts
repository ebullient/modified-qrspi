import { describe, expect, it } from "vitest";
import type { WorkspaceFileSystem } from "../../src/state/ports.ts";
import type { PhaseId } from "../../src/state/types.ts";
import {
    phaseFilePath,
    reviewPath,
    Workspace,
} from "../../src/workspace/Workspace.ts";

function fakeFileSystem(
    files: Record<string, string>,
): WorkspaceFileSystem & { readCounts: Record<string, number> } {
    const readCounts: Record<string, number> = {};
    return {
        readCounts,
        read(path: string) {
            readCounts[path] = (readCounts[path] ?? 0) + 1;
            return path in files ? files[path] : null;
        },
        list(path: string) {
            const prefix = `${path}/`;
            return Object.keys(files)
                .filter(
                    (p) =>
                        p.startsWith(prefix) &&
                        !p.slice(prefix.length).includes("/"),
                )
                .map((p) => p.slice(prefix.length));
        },
    };
}

const planMarkdown = [
    "| Phase | Name | Depends On | Status |",
    "|-------|------|------------|--------|",
    "| 1 | Store | none | [x] |",
].join("\n");

const phase1Markdown = ["### Step 1: First", "- [x] Status marker"].join("\n");

const requestMarkdown = ["## Open Questions", "- Still open?"].join("\n");

const researchMarkdown = ["## New Questions", "- ~~Resolved already.~~"].join(
    "\n",
);

const reviewMarkdown = [
    "## Verdict: PASS",
    "",
    "| Severity | Blocking | Description |",
    "|----------|----------|-------------|",
].join("\n");

describe("Workspace", () => {
    it("returns the parsed PlanTable", () => {
        const fs = fakeFileSystem({ "qrspi/f/plan.md": planMarkdown });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.plan()?.rows).toEqual([
            { phase: "1", name: "Store", dependsOn: [], status: "x" },
        ]);
    });

    it("returns null for plan() when plan.md is absent", () => {
        const workspace = new Workspace("qrspi/f", fakeFileSystem({}));
        expect(workspace.plan()).toBeNull();
    });

    it("returns a single phase file by id", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plan-phase-1.md": phase1Markdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.phaseFile("1")?.steps).toEqual([
            { step: 1, title: "First", marker: "x" },
        ]);
        expect(workspace.phaseFile("99")).toBeNull();
    });

    it("returns a phase file from plans/", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plans/plan-phase-1.md": phase1Markdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.phaseFile("1")?.steps).toEqual([
            { step: 1, title: "First", marker: "x" },
        ]);
    });

    it("prefers plans/ over the workspace root for the same phase id", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plans/plan-phase-1.md": phase1Markdown,
            "qrspi/f/plan-phase-1.md": "### Step 1: Root\n- [ ] Status marker",
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.phaseFile("1")?.steps).toEqual([
            { step: 1, title: "First", marker: "x" },
        ]);
    });

    it("caches a phase file resolved from either location", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plan-phase-1.md": phase1Markdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        workspace.phaseFile("1");
        workspace.phaseFile("1");

        expect(fs.readCounts["qrspi/f/plan-phase-1.md"]).toBe(1);
        expect(fs.readCounts["qrspi/f/plans/plan-phase-1.md"]).toBe(1);
    });

    it("discovers and returns every phase file present", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plan-phase-1.md": phase1Markdown,
            "qrspi/f/plan-phase-7a.md": phase1Markdown,
            "qrspi/f/plan.md": planMarkdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        const files = workspace.phaseFiles();
        expect([...files.keys()].sort()).toEqual(["1", "7a"]);
    });

    it("discovers phase files in plans/ and in the root together", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plans/plan-phase-1.md": phase1Markdown,
            "qrspi/f/plan-phase-7a.md": phase1Markdown,
            "qrspi/f/plan.md": planMarkdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect([...workspace.phaseFiles().keys()].sort()).toEqual(["1", "7a"]);
    });

    it("counts a phase present in both locations once", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plans/plan-phase-1.md": phase1Markdown,
            "qrspi/f/plan-phase-1.md": phase1Markdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect([...workspace.phaseFiles().keys()]).toEqual(["1"]);
    });

    it("parses open and new questions from request.md and research.md", () => {
        const fs = fakeFileSystem({
            "qrspi/f/request.md": requestMarkdown,
            "qrspi/f/research.md": researchMarkdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.openQuestions()).toEqual({
            open: ["Still open?"],
            resolved: [],
        });
        expect(workspace.newQuestions()).toEqual({
            open: [],
            resolved: ["~~Resolved already.~~"],
        });
    });

    it("returns empty question sections when the file is absent", () => {
        const workspace = new Workspace("qrspi/f", fakeFileSystem({}));
        expect(workspace.openQuestions()).toEqual({ open: [], resolved: [] });
        expect(workspace.newQuestions()).toEqual({ open: [], resolved: [] });
    });

    it("returns a review artifact by label", () => {
        const fs = fakeFileSystem({
            "qrspi/f/reviews/phase-1.md": reviewMarkdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.review("phase-1")).toEqual({
            kind: "complete",
            verdict: "PASS",
            findings: [],
        });
        expect(workspace.review("missing")).toBeNull();
    });

    it("discovers every review label present under reviews/", () => {
        const fs = fakeFileSystem({
            "qrspi/f/reviews/phase-1.md": reviewMarkdown,
            "qrspi/f/reviews/phase-2-chk1.md": reviewMarkdown,
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect([...workspace.reviewLabels()].sort()).toEqual([
            "phase-1",
            "phase-2-chk1",
        ]);
    });

    it("returns no review labels when reviews/ is absent", () => {
        const workspace = new Workspace("qrspi/f", fakeFileSystem({}));
        expect(workspace.reviewLabels()).toEqual([]);
    });

    it("hasFile reports existence", () => {
        const fs = fakeFileSystem({ "qrspi/f/approach.md": "# Approach" });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.hasFile("approach.md")).toBe(true);
        expect(workspace.hasFile("spec.md")).toBe(false);
    });

    it("decided() is true when approach.md's Decision section has content", () => {
        const fs = fakeFileSystem({
            "qrspi/f/approach.md": [
                "# Approaches",
                "",
                "## Decision",
                "",
                "Approach B, because it needs no new dependency.",
            ].join("\n"),
        });
        const workspace = new Workspace("qrspi/f", fs);

        workspace.decided();
        expect(workspace.decided()).toBe(true);
        expect(fs.readCounts["qrspi/f/approach.md"]).toBe(1);
    });

    it("decided() is false when approach.md is absent", () => {
        const workspace = new Workspace("qrspi/f", fakeFileSystem({}));
        expect(workspace.decided()).toBe(false);
    });

    it("firstReadyPhase skips excluded phases", () => {
        const fs = fakeFileSystem({
            "qrspi/f/plan.md": [
                "| Phase | Name | Depends On | Status |",
                "|---|---|---|---|",
                "| 1 | A | none | [ ] |",
                "| 2 | B | 1 | [ ] |",
                "| 3 | C | none | [ ] |",
            ].join("\n"),
            "qrspi/f/plan-phase-1.md": "### Step 1: A\n- [ ] Status marker",
            "qrspi/f/plan-phase-2.md": "### Step 1: B\n- [ ] Status marker",
            "qrspi/f/plan-phase-3.md": "### Step 1: C\n- [ ] Status marker",
        });
        const workspace = new Workspace("qrspi/f", fs);

        expect(workspace.firstReadyPhase()).toBe("1");
        expect(workspace.firstReadyPhase(["1" as PhaseId])).toBe("3");
    });

    it("memoizes repeated access instead of re-reading the filesystem", () => {
        const fs = fakeFileSystem({ "qrspi/f/plan.md": planMarkdown });
        const workspace = new Workspace("qrspi/f", fs);

        workspace.plan();
        workspace.plan();
        workspace.plan();

        expect(fs.readCounts["qrspi/f/plan.md"]).toBe(1);
    });
});

describe("path builders", () => {
    it("builds review and phase file paths in the plans/ layout", () => {
        expect(reviewPath("phase-2-r2")).toBe("reviews/phase-2-r2.md");
        expect(phaseFilePath("2b")).toBe("plans/plan-phase-2b.md");
    });
});

describe("review file reads", () => {
    it("reads a review file once for review() and verdict()", () => {
        const fs = fakeFileSystem({
            "/ws/reviews/phase-1.md": [
                "## Verdict: PASS",
                "",
                "| Severity | Blocking | Description |",
                "|----------|----------|-------------|",
            ].join("\n"),
        });
        const workspace = new Workspace("/ws", fs);
        expect(workspace.review("phase-1")).not.toBeNull();
        expect(workspace.verdict("phase-1")).toBe("PASS");
        expect(workspace.verdict("phase-1")).toBe("PASS");
        expect(fs.readCounts["/ws/reviews/phase-1.md"]).toBe(1);
    });
});

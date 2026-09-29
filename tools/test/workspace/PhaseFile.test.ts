import { describe, expect, it } from "vitest";
import {
    blockedSteps,
    inProgressSteps,
    lastDoneStep,
    parsePhaseFile,
} from "../../src/workspace/PhaseFile.ts";

describe("parsePhaseFile", () => {
    it("parses steps in all four marker states", () => {
        const markdown = [
            "### Step 1: Done step",
            "- [x] Status marker",
            "",
            "### Step 2: In progress step",
            "- [~] Status marker",
            "",
            "### Step 3: Blocked step",
            "- [!] Status marker",
            "",
            "### Step 4: Not started step",
            "- [ ] Status marker",
        ].join("\n");

        expect(parsePhaseFile(markdown, "plan-phase-1.md")).toEqual({
            steps: [
                { step: 1, title: "Done step", marker: "x" },
                { step: 2, title: "In progress step", marker: "~" },
                { step: 3, title: "Blocked step", marker: "!" },
                { step: 4, title: "Not started step", marker: " " },
            ],
            findings: [],
            file: "plan-phase-1.md",
        });
    });

    it("reports format-invalid with file and line for a malformed marker character", () => {
        const markdown = [
            "### Step 1: Good step",
            "- [x] Status marker",
            "",
            "### Step 2: Bad step",
            "- [?] Status marker",
        ].join("\n");

        const result = parsePhaseFile(markdown, "plan-phase-2.md");

        expect(result.steps).toEqual([
            { step: 1, title: "Good step", marker: "x" },
        ]);
        expect(result.findings).toEqual([
            {
                code: "format-invalid",
                message:
                    "Step 2 heading is not followed by a status marker line",
                file: "plan-phase-2.md",
                line: 5,
            },
        ]);
    });

    it("reports format-invalid for a duplicate step number", () => {
        const markdown = [
            "### Step 1: First",
            "- [x] Status marker",
            "",
            "### Step 1: First again",
            "- [ ] Status marker",
        ].join("\n");

        const result = parsePhaseFile(markdown, "plan-phase-2.md");

        expect(result.steps).toEqual([
            { step: 1, title: "First", marker: "x" },
        ]);
        expect(result.findings).toEqual([
            {
                code: "format-invalid",
                message: "Step 1 is declared more than once",
                file: "plan-phase-2.md",
                line: 4,
            },
        ]);
    });

    it("handles an empty file without crashing", () => {
        const result = parsePhaseFile("", "plan-phase-1.md");
        expect(result).toEqual({
            steps: [],
            findings: [],
            file: "plan-phase-1.md",
        });
    });
});

describe("marker queries", () => {
    const file = parsePhaseFile(
        [
            "### Step 1: A",
            "- [x] Status marker",
            "### Step 2: B",
            "- [x] Status marker",
            "### Step 3: C",
            "- [~] Status marker",
            "### Step 4: D",
            "- [!] Status marker",
            "### Step 5: E",
            "- [ ] Status marker",
        ].join("\n"),
        "plan-phase-1.md",
    );
    const empty = parsePhaseFile("", "plan-phase-1.md");

    it("lists in-progress steps", () => {
        expect(inProgressSteps(file).map((s) => s.step)).toEqual([3]);
        expect(inProgressSteps(empty)).toEqual([]);
    });

    it("lists blocked steps", () => {
        expect(blockedSteps(file).map((s) => s.step)).toEqual([4]);
        expect(blockedSteps(empty)).toEqual([]);
    });

    it("finds the last done step", () => {
        expect(lastDoneStep(file)?.step).toBe(2);
        expect(lastDoneStep(empty)).toBeUndefined();
    });
});

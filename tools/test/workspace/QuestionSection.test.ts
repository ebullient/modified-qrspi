import { describe, expect, it } from "vitest";
import { parseQuestionSection } from "../../src/workspace/QuestionSection.ts";

describe("parseQuestionSection", () => {
    it("parses questions under a counted heading", () => {
        const markdown = [
            "# Request",
            "",
            "## Open Questions (2)",
            "",
            "- Which command owns the transition?",
            "- Should old files remain readable?",
            "",
            "## Clarifications",
            "",
            "- This belongs to another section.",
        ].join("\n");

        expect(parseQuestionSection(markdown, "Open Questions")).toEqual({
            open: [
                "Which command owns the transition?",
                "Should old files remain readable?",
            ],
            resolved: [],
        });
    });

    it("parses questions under an uncounted heading", () => {
        const markdown = [
            "## New Questions",
            "",
            "- Does the runner share state code?",
        ].join("\n");

        expect(parseQuestionSection(markdown, "New Questions")).toEqual({
            open: ["Does the runner share state code?"],
            resolved: [],
        });
    });

    it("classifies an item beginning with a struck-through span as resolved", () => {
        const markdown = [
            "## Open Questions",
            "",
            "- ~~Who owns loop state?~~ Resolved by the human.",
            "- What remains open?",
        ].join("\n");

        expect(parseQuestionSection(markdown, "Open Questions")).toEqual({
            open: ["What remains open?"],
            resolved: ["~~Who owns loop state?~~ Resolved by the human."],
        });
    });

    it("accepts list-item indentation from zero through three spaces", () => {
        const markdown = [
            "## Open Questions",
            "- zero",
            " - one",
            "  - two",
            "   - three",
            "    - four",
        ].join("\n");

        expect(parseQuestionSection(markdown, "Open Questions")).toEqual({
            open: ["zero", "one", "two", "three"],
            resolved: [],
        });
    });

    it("ignores blank lines, None, italics, subheadings, and prose", () => {
        const markdown = [
            "## New Questions (0)",
            "",
            "None.",
            "",
            "_No new questions surfaced._",
            "",
            "### Notes",
            "Incidental prose is not a question.",
        ].join("\n");

        expect(parseQuestionSection(markdown, "New Questions")).toEqual({
            open: [],
            resolved: [],
        });
    });

    it("treats a heading count as advisory", () => {
        const markdown = [
            "## Open Questions (7)",
            "",
            "- Only one actual question?",
        ].join("\n");

        expect(parseQuestionSection(markdown, "Open Questions")).toEqual({
            open: ["Only one actual question?"],
            resolved: [],
        });
    });
});

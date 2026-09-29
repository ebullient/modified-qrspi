import { describe, expect, it } from "vitest";
import { parseDecision } from "../../src/workspace/Decision.ts";

describe("parseDecision", () => {
    it("is true when the Decision section has prose content", () => {
        const markdown = [
            "# Approaches",
            "",
            "## Decision",
            "",
            "Approach B, because it needs no new dependency.",
        ].join("\n");

        expect(parseDecision(markdown)).toBe(true);
    });

    it("is false when there is no recognized decision heading", () => {
        const markdown = ["# Approaches", "", "## Options", "- A", "- B"].join(
            "\n",
        );

        expect(parseDecision(markdown)).toBe(false);
    });

    it.each(["## Chosen Approach", "## Approach Decision"])(
        "accepts %s as a decision heading",
        (heading) => {
            const markdown = [heading, "", "Approach B."].join("\n");
            expect(parseDecision(markdown)).toBe(true);
        },
    );

    it.each(["## DECISION", "## decision", "## ChOsEn ApPrOaCh"])(
        "matches the heading case-insensitively (%s)",
        (heading) => {
            const markdown = [heading, "", "Approach B."].join("\n");
            expect(parseDecision(markdown)).toBe(true);
        },
    );

    it("is false when the Decision section is blank", () => {
        const markdown = ["## Decision", ""].join("\n");
        expect(parseDecision(markdown)).toBe(false);
    });

    it("is false when the Decision section is only None.", () => {
        const markdown = ["## Decision", "", "None."].join("\n");
        expect(parseDecision(markdown)).toBe(false);
    });

    it("treats italicized prose as content", () => {
        expect(
            parseDecision(["## Decision", "*Approach B, clearly.*"].join("\n")),
        ).toBe(true);
        expect(
            parseDecision(["## Decision", "_Approach B, clearly._"].join("\n")),
        ).toBe(true);
    });

    it("stops at the next heading without reading past the section", () => {
        const markdown = [
            "## Decision",
            "",
            "## Notes",
            "Approach B was actually chosen, but this is the wrong section.",
        ].join("\n");

        expect(parseDecision(markdown)).toBe(false);
    });

    it("does not require the Decision section to be first", () => {
        const markdown = [
            "# Approaches",
            "",
            "## Options",
            "- A",
            "- B",
            "",
            "## Decision",
            "",
            "A, for its simplicity.",
        ].join("\n");

        expect(parseDecision(markdown)).toBe(true);
    });
});

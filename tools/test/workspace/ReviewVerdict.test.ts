import { describe, expect, it } from "vitest";
import {
    parseVerdict,
    parseVerdictSummary,
} from "../../src/workspace/ReviewVerdict.ts";

describe("parseVerdict", () => {
    it("reads the Verdict line and ignores everything else", () => {
        const pass = `# Review: phase-2\n\n## Verdict: PASS\n\nLooks good.\n`;
        expect(parseVerdict(pass)).toBe("PASS");

        const fail = `# Review: phase-2\n\n## Verdict: FAIL\n\nMissing tests.\n`;
        expect(parseVerdict(fail)).toBe("FAIL");

        const conditions = `# Review: phase-2\n\n## Verdict: PASS WITH CONDITIONS\n\nAdd a test for the timeout edge case.\n`;
        expect(parseVerdict(conditions)).toBe("PASS WITH CONDITIONS");

        const missing = `# Review: phase-2\n\nNo verdict yet.\n`;
        expect(parseVerdict(missing)).toBeUndefined();
    });
});

describe("parseVerdictSummary", () => {
    it("reads the sentence on the line after the Verdict heading", () => {
        const conditions = `# Review: phase-2\n\n## Verdict: PASS WITH CONDITIONS\n\nAdd a test for the timeout edge case.\n`;
        expect(parseVerdictSummary(conditions)).toBe(
            "Add a test for the timeout edge case.",
        );
    });

    it("is undefined when there's no Verdict heading", () => {
        expect(parseVerdictSummary("No verdict yet.\n")).toBeUndefined();
    });
});

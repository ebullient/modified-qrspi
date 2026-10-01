import { describe, expect, it } from "vitest";
import { isDecided } from "../../src/workspace/ApproachDecision.ts";

describe("isDecided", () => {
    it("is false for the None. placeholder and true once replaced", () => {
        const undecided = `## Decision\nNone.\n\n## Open Questions\n...\n`;
        expect(isDecided(undecided)).toBe(false);

        const decided = `## Decision\nGo with option B because it's simpler.\n\n## Open Questions\n...\n`;
        expect(isDecided(decided)).toBe(true);

        const missingSection = `## Open Questions\n...\n`;
        expect(isDecided(missingSection)).toBe(false);
    });
});

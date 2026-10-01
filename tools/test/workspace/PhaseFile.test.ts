import { describe, expect, it } from "vitest";
import { isPhaseComplete, parseSteps } from "../../src/workspace/PhaseFile.ts";

describe("PhaseFile", () => {
    it("parses step markers in order and derives completeness", () => {
        const inProgress = `### Step 1: First
- [x] Status marker
- Files: a.ts

### Step 2: Second
- [~] Status marker
- Files: b.ts
`;
        expect(parseSteps(inProgress)).toEqual(["[x]", "[~]"]);
        expect(isPhaseComplete(inProgress)).toBe(false);

        const done = `### Step 1: First
- [x] Status marker

### Step 2: Second
- [x] Status marker
`;
        expect(parseSteps(done)).toEqual(["[x]", "[x]"]);
        expect(isPhaseComplete(done)).toBe(true);

        expect(isPhaseComplete("")).toBe(false);
    });
});

import { describe, expect, it } from "vitest";
import { type CurrentStep, phaseOf } from "../../src/state/types.ts";

describe("phaseOf", () => {
    it.each<[CurrentStep, string]>([
        ["init", "discovery"],
        ["query", "discovery"],
        ["research", "discovery"],
        ["shape", "definition"],
        ["spec", "definition"],
        ["plan", "definition"],
        ["implement", "execution"],
        ["review", "execution"],
        ["checkpoint", "execution"],
    ])("%s is in %s", (step, phase) => {
        expect(phaseOf(step)).toBe(phase);
    });
});

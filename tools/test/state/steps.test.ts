import { describe, expect, it } from "vitest";
import {
    artifactOfStep,
    discoveredReason,
    isDiscovered,
    stepArtifacts,
} from "../../src/state/steps.ts";

describe("stepArtifacts", () => {
    it("lists each step's artifact in workflow order", () => {
        expect(stepArtifacts).toEqual([
            ["request.md", "init"],
            ["queries.md", "query"],
            ["research.md", "research"],
            ["approach.md", "shape"],
            ["spec.md", "spec"],
            ["plan.md", "plan"],
        ]);
    });

    it("finds the artifact of a step, none for an execution step", () => {
        expect(artifactOfStep("shape")).toBe("approach.md");
        expect(artifactOfStep("implement")).toBeUndefined();
    });
});

describe("discovered reason", () => {
    it("writes the text files on disk already hold", () => {
        expect(discoveredReason("reviews/phase-1.md")).toBe(
            "discovered reviews/phase-1.md",
        );
    });

    it("recognizes what it writes and the old text, and nothing else", () => {
        expect(isDiscovered({ reason: discoveredReason("reviews/x.md") })).toBe(
            true,
        );
        expect(isDiscovered({ reason: "discovered reviews/final.md" })).toBe(
            true,
        );
        expect(isDiscovered({ reason: "done" })).toBe(false);
        expect(isDiscovered({})).toBe(false);
    });
});

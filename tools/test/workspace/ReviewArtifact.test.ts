import { describe, expect, it } from "vitest";
import {
    isCheckpointLabel,
    isHumanReviewLabel,
    isPendingStub,
    parseReviewArtifact,
    verdictOf,
} from "../../src/workspace/ReviewArtifact.ts";

describe("parseReviewArtifact", () => {
    it("parses the first valid verdict and findings table by column name", () => {
        const markdown = [
            "# Review",
            "",
            "## Verdict: PASS WITH CONDITIONS",
            "",
            "## Findings",
            "",
            "| Description | Category | Blocking | Severity |",
            "|-------------|----------|----------|----------|",
            "| Clarify the error. | Correctness | yes | HIGH |",
            "| Rename the helper. | Style | no | LOW |",
            "",
            "## Verdict: FAIL",
        ].join("\n");

        expect(parseReviewArtifact(markdown)).toEqual({
            kind: "complete",
            verdict: "PASS WITH CONDITIONS",
            findings: [
                {
                    severity: "HIGH",
                    blocking: "yes",
                    description: "Clarify the error.",
                },
                {
                    severity: "LOW",
                    blocking: "no",
                    description: "Rename the helper.",
                },
            ],
        });
    });

    it("unescapes a markdown-escaped pipe inside a cell instead of mis-splitting the row", () => {
        const markdown = [
            "## Verdict: PASS",
            "",
            "| Severity | Blocking | Description |",
            "|----------|----------|-------------|",
            "| LOW | no | Rename \\| clarify the helper. |",
        ].join("\n");

        expect(parseReviewArtifact(markdown)).toEqual({
            kind: "complete",
            verdict: "PASS",
            findings: [
                {
                    severity: "LOW",
                    blocking: "no",
                    description: "Rename | clarify the helper.",
                },
            ],
        });
    });

    it("reads a PENDING verdict line as a stub with no verdict", () => {
        const stub = parseReviewArtifact("## Verdict: PENDING\n");

        expect(stub).toEqual({ kind: "pending" });
        expect(isPendingStub(stub)).toBe(true);
        expect(verdictOf(stub)).toBeNull();
    });

    it("reads the first verdict line, so a later PENDING line is not a stub", () => {
        const review = parseReviewArtifact(
            [
                "## Verdict: PASS",
                "",
                "| Severity | Blocking | Description |",
                "|---|---|---|",
                "",
                "```",
                "## Verdict: PENDING",
                "```",
            ].join("\n"),
        );

        expect(review).toEqual({
            kind: "complete",
            verdict: "PASS",
            findings: [],
        });
    });

    it("returns invalid when the verdict line is missing", () => {
        const result = parseReviewArtifact(
            [
                "## Findings",
                "",
                "| Severity | Blocking | Description |",
                "|----------|----------|-------------|",
            ].join("\n"),
        );

        expect(result).toMatchObject({ kind: "invalid" });
        expect("reason" in result && result.reason).toMatch(/verdict/i);
    });

    it("returns invalid instead of throwing for a malformed findings table", () => {
        const result = parseReviewArtifact(
            [
                "## Verdict: PASS",
                "",
                "## Findings",
                "",
                "| Severity | Blocking |",
                "|----------|----------|",
                "| LOW | no |",
            ].join("\n"),
        );

        expect(result).toMatchObject({ kind: "invalid" });
        expect("reason" in result && result.reason).toMatch(/findings table/i);
    });
});

describe("review label namespaces", () => {
    it.each([
        "phase-2",
        "phase-2-r2",
        "phase-7a-step-3",
        "phase-7a-step-3-r12",
        "final",
        "final-r2",
    ])("recognizes human review label %s", (label) => {
        expect(isHumanReviewLabel(label)).toBe(true);
        expect(isCheckpointLabel(label)).toBe(false);
    });

    it.each([
        "phase-2-r1",
        "phase-2-chk1",
        "final-chk1",
        "phase-7aa",
        "plan-review",
    ])("rejects invalid human review label %s", (label) => {
        expect(isHumanReviewLabel(label)).toBe(false);
    });

    it.each(["phase-2-chk1", "phase-2-chk12", "phase-7a-step-3-chk2"])(
        "recognizes checkpoint label %s",
        (label) => {
            expect(isCheckpointLabel(label)).toBe(true);
            expect(isHumanReviewLabel(label)).toBe(false);
        },
    );

    it.each([
        "phase-2",
        "phase-2-r2",
        "phase-2-chk0",
        "final-chk1",
        "phase-7aa-chk1",
    ])("rejects invalid checkpoint label %s", (label) => {
        expect(isCheckpointLabel(label)).toBe(false);
    });
});

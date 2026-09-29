import { humanRoundSource, phaseIdSource } from "../state/ids.ts";
import { type Verdict, verdicts } from "../state/types.ts";
import { findTableHeader, isTableSeparator, tableCells } from "./markdown.ts";

export interface ReviewFinding {
    severity: string;
    blocking: string;
    description: string;
}

/** A review file: a finished review, a malformed one, or a checkpoint stub whose review was launched and has not finished. */
export type ReviewArtifact =
    | { kind: "complete"; verdict: Verdict; findings: ReviewFinding[] }
    | { kind: "invalid"; reason: string; verdict?: Verdict }
    | { kind: "pending" };

const verdictPattern = new RegExp(`^## Verdict: (${verdicts.join("|")})$`);
const pendingPattern = /^## Verdict: PENDING$/;
const stepPattern = "[1-9][0-9]*";
const humanReviewPattern = new RegExp(
    `^(?:final|phase-${phaseIdSource}(?:-step-${stepPattern})?)(?:${humanRoundSource})?$`,
);
const checkpointPattern = new RegExp(
    `^phase-${phaseIdSource}(?:-step-${stepPattern})?-chk[1-9][0-9]*$`,
);

/** The first `## Verdict:` line's verdict; stops reading there. */
export function parseVerdict(markdown: string): Verdict | null {
    for (const line of markdown.split(/\r?\n/)) {
        const verdict = verdictPattern.exec(line)?.[1];
        if (verdict !== undefined) return verdict as Verdict;
    }
    return null;
}

export function parseReviewArtifact(markdown: string): ReviewArtifact {
    const lines = markdown.split(/\r?\n/);
    const first = lines.find(
        (line) => pendingPattern.test(line) || verdictPattern.test(line),
    );
    if (first === undefined) {
        return { kind: "invalid", reason: "Missing valid verdict line" };
    }
    if (pendingPattern.test(first)) {
        return { kind: "pending" };
    }
    const verdict = verdictPattern.exec(first)?.[1] as Verdict;

    const requiredColumns = ["Severity", "Blocking", "Description"];
    const tableHeaderIndex = findTableHeader(lines, requiredColumns);
    if (tableHeaderIndex < 0) {
        return {
            kind: "invalid",
            verdict,
            reason: "Findings table must include Severity, Blocking, and Description columns",
        };
    }

    const headers = tableCells(lines[tableHeaderIndex] ?? "") ?? [];
    if (!isTableSeparator(lines[tableHeaderIndex + 1] ?? "", headers.length)) {
        return {
            kind: "invalid",
            verdict,
            reason: "Findings table separator is malformed",
        };
    }

    const severityIndex = headers.indexOf("Severity");
    const blockingIndex = headers.indexOf("Blocking");
    const descriptionIndex = headers.indexOf("Description");
    const findings: ReviewFinding[] = [];

    for (const line of lines.slice(tableHeaderIndex + 2)) {
        if (line.trim() === "") break;
        const cells = tableCells(line);
        if (cells === null || cells.length !== headers.length) {
            return {
                kind: "invalid",
                verdict,
                reason: "Findings table row is malformed",
            };
        }
        findings.push({
            severity: cells[severityIndex] ?? "",
            blocking: cells[blockingIndex] ?? "",
            description: cells[descriptionIndex] ?? "",
        });
    }

    return { kind: "complete", verdict, findings };
}

/** The artifact's verdict line, which stands even when its findings table is malformed. */
export function verdictOf(review: ReviewArtifact | null): Verdict | null {
    return review !== null && review.kind !== "pending"
        ? (review.verdict ?? null)
        : null;
}

export function isPendingStub(
    review: ReviewArtifact | null,
): review is { kind: "pending" } {
    return review !== null && review.kind === "pending";
}

export function isHumanReviewLabel(label: string): boolean {
    return humanReviewPattern.test(label);
}

export function isCheckpointLabel(label: string): boolean {
    return checkpointPattern.test(label);
}

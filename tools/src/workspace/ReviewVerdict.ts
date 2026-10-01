export type Verdict = "PASS" | "PASS WITH CONDITIONS" | "FAIL";

/**
 * Reads a review artifact's `## Verdict: ...` line. Nothing else in the
 * file is parsed here.
 */
export function parseVerdict(text: string): Verdict | undefined {
    const match = /^## Verdict:\s*(PASS WITH CONDITIONS|PASS|FAIL)\s*$/m.exec(
        text,
    );
    return match?.[1] as Verdict | undefined;
}

export function isPending(text: string): boolean {
    return /^## Verdict:\s*PENDING\s*$/m.test(text);
}

/**
 * The one-sentence line under `## Verdict: ...`, which doubles as the
 * condition note on a PASS WITH CONDITIONS verdict (agents/reviewer.md's
 * artifact contract) — no table-cell reconstruction needed.
 */
export function parseVerdictSummary(text: string): string | undefined {
    const match = /^## Verdict:.*\n+(.+)$/m.exec(text);
    return match?.[1]?.trim();
}

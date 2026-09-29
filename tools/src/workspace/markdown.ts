/** Cells of a Markdown table row, or null when `line` is not a row. `\|` is an escaped pipe. */
export function tableCells(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
    return trimmed
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/** Index of the first table row whose cells include every column name, or -1. */
export function findTableHeader(
    lines: readonly string[],
    columns: readonly string[],
): number {
    return lines.findIndex((line) => {
        const cells = tableCells(line);
        return cells !== null && columns.every((c) => cells.includes(c));
    });
}

/** Whether `line` is a table separator row (`|---|:--:|`) with `width` cells. */
export function isTableSeparator(line: string, width: number): boolean {
    const cells = tableCells(line);
    return (
        cells !== null &&
        cells.length === width &&
        cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    );
}

/**
 * The lines after the first line `isHeading` accepts, up to the next `##`
 * heading or the end. Empty when no heading matches. Heading matching is
 * the caller's; only the reading is shared.
 */
export function sectionLines(
    markdown: string,
    isHeading: (line: string) => boolean,
): string[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex(isHeading);
    if (start < 0) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^##(?:\s|$)/.test(line));
    return end < 0 ? rest : rest.slice(0, end);
}

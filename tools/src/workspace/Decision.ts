import { sectionLines } from "./markdown.ts";

/** Accepted decision headings, matched case-insensitively. */
const decisionHeadings = new Set(
    ["Decision", "Chosen Approach", "Approach Decision"].map((text) =>
        text.toLowerCase(),
    ),
);

/** Whether `approach.md` has a filled-in decision section. */
export function parseDecision(markdown: string): boolean {
    return sectionLines(markdown, matchesHeading).some(isContent);
}

function matchesHeading(line: string): boolean {
    const match = /^##\s+(.+)$/.exec(line);
    if (!match) return false;
    return decisionHeadings.has(match[1].trim().toLowerCase());
}

/** Content is anything but a blank line or the literal `None.`. */
function isContent(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed === "") return false;
    if (trimmed === "None.") return false;
    return true;
}

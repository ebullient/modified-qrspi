/**
 * Is approach.md's `## Decision` section decided? Undecided is the
 * literal placeholder text `None.`; any other non-blank content,
 * including a comment, reads as decided.
 */
export function isDecided(text: string): boolean {
    const match = /^## Decision\s*\n([\s\S]*?)(?=\n## |\s*$)/m.exec(text);
    if (!match) {
        return false;
    }

    const body = match[1].trim();
    return body !== "" && body !== "None.";
}

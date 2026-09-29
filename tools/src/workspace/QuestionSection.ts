import { sectionLines } from "./markdown.ts";

export interface QuestionSection {
    open: string[];
    resolved: string[];
}

export function parseQuestionSection(
    markdown: string,
    headingText: string,
): QuestionSection {
    const result: QuestionSection = { open: [], resolved: [] };
    const heading = `## ${headingText}`;

    for (const line of sectionLines(markdown, (l) =>
        matchesHeading(l, heading),
    )) {
        const item = /^ {0,3}[-+*][ \t]+(.+)$/.exec(line)?.[1]?.trimEnd();
        if (!item) continue;

        if (/^~~.+?~~/.test(item)) {
            result.resolved.push(item);
        } else {
            result.open.push(item);
        }
    }

    return result;
}

function matchesHeading(line: string, heading: string): boolean {
    if (line === heading) return true;
    if (!line.startsWith(`${heading} (`) || !line.endsWith(")")) return false;

    const count = line.slice(heading.length + 2, -1);
    return /^\d+$/.test(count);
}

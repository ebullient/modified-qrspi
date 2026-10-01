import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type HistoryEntry = {
    kind: string;
    [key: string]: unknown;
};

export type HistoryFilters = {
    tail?: number;
    all?: boolean;
    [key: string]: string | number | boolean | undefined;
};

const DEFAULT_TAIL = 20;

export type HistoryLog = {
    append: (entry: HistoryEntry) => Promise<void>;
    conditionalAppend: (
        filter: Record<string, string>,
        unless: Record<string, unknown>,
        entry: HistoryEntry,
    ) => Promise<boolean>;
    read: (filters?: HistoryFilters) => Promise<HistoryEntry[]>;
    isParked: () => Promise<boolean>;
};

function historyPath(root: string): string {
    return join(root, "history.jsonl");
}

export function historyAt(root: string): HistoryLog {
    async function readAll(): Promise<HistoryEntry[]> {
        let text: string;
        try {
            text = await readFile(historyPath(root), "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return [];
            }
            throw err;
        }
        return text
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as HistoryEntry);
    }

    /**
     * Appends one entry to history.jsonl as a single line, stamping
     * `timestamp` — every entry carries one, so callers never pass their
     * own. A real append (no read-modify-write of the whole file), so
     * concurrent writers (e.g. autoloop and implement) can't clobber each
     * other's entries. Not idempotent — a blind retry double-writes.
     */
    async function append(entry: HistoryEntry): Promise<void> {
        await appendLine(entry);
    }

    async function appendLine(entry: HistoryEntry): Promise<void> {
        const line = `${JSON.stringify({ ...entry, timestamp: new Date().toISOString() })}\n`;
        await mkdir(root, { recursive: true });
        await appendFile(historyPath(root), line);
    }

    /**
     * Appends `entry` unless the most recent entry matching `filter`
     * (equality on each key, same as `read`'s field filters) already
     * satisfies `unless` (equality on each key there too):
     * `start` calls this with `unless: {action: "begin"}` so a retry before
     * the matching `log` finds its own still-open begin and skips; `log`
     * calls it with `unless: {action: "end"}` so a retry after it already
     * closed the same unit of work skips too. Returns whether it wrote.
     */
    async function conditionalAppend(
        filter: Record<string, string>,
        unless: Record<string, unknown>,
        entry: HistoryEntry,
    ): Promise<boolean> {
        const entries = await readAll();
        const matches = entries.filter((candidate) =>
            Object.entries(filter).every(
                ([key, value]) => candidate[key] === value,
            ),
        );
        const last = matches[matches.length - 1];
        if (
            last &&
            Object.entries(unless).every(([key, value]) => last[key] === value)
        ) {
            return false;
        }
        await appendLine(entry);
        return true;
    }

    /**
     * Returns matching entries in file order (append order, already
     * chronological regardless of any entry's own timestamp). `tail`/`all`
     * are handled specially; every other filter key is an equality match
     * against the same-named field on each entry.
     */
    async function read(filters: HistoryFilters = {}): Promise<HistoryEntry[]> {
        const { tail, all, ...fieldFilters } = filters;
        let entries = await readAll();

        for (const [key, value] of Object.entries(fieldFilters)) {
            if (value === undefined) {
                continue;
            }
            entries = entries.filter((entry) => entry[key] === value);
        }

        if (all) {
            return entries;
        }
        const limit = tail ?? DEFAULT_TAIL;
        return entries.slice(Math.max(entries.length - limit, 0));
    }

    /**
     * Walks backward from the end, skipping "note" entries. The first
     * non-"note" entry found decides it: true only if its kind is "park".
     */
    async function isParked(): Promise<boolean> {
        const entries = await readAll();
        for (let i = entries.length - 1; i >= 0; i--) {
            const kind = entries[i].kind;
            if (kind === "note") {
                continue;
            }
            return kind === "park";
        }
        return false;
    }

    return { append, conditionalAppend, read, isParked };
}

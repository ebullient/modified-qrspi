import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Decisions = {
    add: (text: string) => Promise<void>;
    read: () => Promise<string>;
};

function decisionsPath(root: string): string {
    return join(root, "decisions.md");
}

export function decisionsAt(root: string): Decisions {
    /**
     * Appends `text` verbatim as one Markdown bullet. Not idempotent — a
     * blind retry double-writes.
     */
    async function add(text: string): Promise<void> {
        let existing = "";
        try {
            existing = await readFile(decisionsPath(root), "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                throw err;
            }
        }
        await mkdir(root, { recursive: true });
        await writeFile(decisionsPath(root), `${existing}- ${text}\n`);
    }

    /**
     * Returns decisions.md verbatim, or "" if it doesn't exist yet — no
     * filtering, no truncation.
     */
    async function read(): Promise<string> {
        try {
            return await readFile(decisionsPath(root), "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return "";
            }
            throw err;
        }
    }

    return { add, read };
}

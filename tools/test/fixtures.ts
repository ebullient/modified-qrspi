import { vi } from "vitest";
import type { Git } from "../src/workspace/Git.ts";
import type { HistoryLog } from "../src/workspace/History.ts";

export function fakeGit(
    opts: { clean?: boolean; sha?: string; ancestors?: string[] } = {},
): Git {
    return {
        isClean: async () => opts.clean ?? true,
        headSha: async () => opts.sha ?? "abc123",
        isAncestor: async (commit) => opts.ancestors?.includes(commit) ?? true,
    };
}

/**
 * Records calls without touching disk — enough for tests that only need
 * to prove a caller passed the right filter/entry/args, not re-verify
 * History's own matching logic (that's test/workspace/History.test.ts's
 * job).
 */
export function fakeHistory(): HistoryLog & {
    append: ReturnType<typeof vi.fn>;
    conditionalAppend: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    isParked: ReturnType<typeof vi.fn>;
} {
    return {
        append: vi.fn(async () => {}),
        conditionalAppend: vi.fn(async () => true),
        read: vi.fn(async () => []),
        isParked: vi.fn(async () => false),
    };
}

import type {
    HistoryEntry,
    LoopCondition,
    PhaseId,
    Verdict,
} from "../types.ts";

/** Whether a launch or action name is an implementer's: `implement` or `repair`. */
export function isImplementerLaunch(
    action: string,
): action is "implement" | "repair" {
    return action === "implement" || action === "repair";
}

/** The history after the loop's latest `STOPPED` entry; all of it when none stopped. */
export function historySinceStop(
    history: readonly HistoryEntry[],
): HistoryEntry[] {
    return history.slice(
        history.findLastIndex((entry) => entry.outcome === "STOPPED") + 1,
    );
}

/** The loop conditions one checkpoint's non-blocking findings leave behind. */
export function conditionsOf(
    findings: readonly { note: string }[],
    phase: PhaseId,
    label: string,
): LoopCondition[] {
    return findings.map(({ note }) => ({ phase, label, note }));
}

/** A verdict that lets the phase proceed: `PASS` or `PASS WITH CONDITIONS`. */
export function passes(verdict: Verdict | null | undefined): boolean {
    return verdict === "PASS" || verdict === "PASS WITH CONDITIONS";
}

/** A verdict with nothing left to do: `PASS` only. */
export function clean(verdict: Verdict | null | undefined): boolean {
    return verdict === "PASS";
}

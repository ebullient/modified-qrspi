import { describe, expect, it } from "vitest";
import { recordDecision } from "../../../src/state/commands/Record.ts";
import { recordReview } from "../../../src/state/commands/Review.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type { PhaseId, State } from "../../../src/state/types.ts";
import { reviewPath } from "../../../src/workspace/Workspace.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

const table =
    "\n| Severity | Blocking | Description |\n|---|---|---|\n| LOW | no | Tidy |\n";
const pass = `## Verdict: PASS\n${table}`;
const conditions = `## Verdict: PASS WITH CONDITIONS\n${table}`;

const testState = (overrides: Partial<State> = {}): State =>
    baseState({
        currentStep: "implement",
        history: [{ step: "plan", timestamp: "2026-09-25T00:00:00Z" }],
        planPhase: "1" as State["planPhase"],
        phaseBaseSha: "abcdef0",
        ...overrides,
    });

function setup(
    reviews: { [label: string]: string },
    state: State | null = testState(),
) {
    const files: { [path: string]: string } = {};
    for (const [label, body] of Object.entries(reviews)) {
        files[reviewPath(label)] = body;
    }
    const fs = new MemoryStateFileSystem();
    if (state !== null) fs.files.set(statePath, JSON.stringify(state));
    const services = {
        store: new Store({ feature: "f", path: statePath, fileSystem: fs }),
        workspace: fakeWorkspace(files),
        git: fakeGit(),
        clock: fakeClock(),
    };
    const context = { feature: "f" };
    const inputs = { services, context };
    return {
        fs,
        record: {
            review: (options: Parameters<typeof recordReview>[1]) =>
                recordReview(inputs, options),
            decision: (options: Parameters<typeof recordDecision>[1]) =>
                recordDecision(inputs, options),
        },
    };
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe("record review --label", () => {
    it("records a phase review's verdict and moves to review", () => {
        const { record } = setup({ "phase-1": conditions });

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result).toMatchObject({
            currentPhase: "execution",
            currentStep: "review",
            planPhase: "1",
            phaseBaseSha: "abcdef0",
        });
        expect(outcome.result?.history.at(-1)).toEqual({
            step: "review",
            timestamp: "2026-09-26T00:00:00Z",
            label: "phase-1",
            verdict: "PASS WITH CONDITIONS",
            artifact: "reviews/phase-1.md",
            phase: "1",
        });
    });

    it("records a mid-phase review with its phase", () => {
        const { record } = setup({ "phase-7a-step-2-r2": pass });

        const outcome = record.review({ label: "phase-7a-step-2-r2" });

        expect(outcome.result?.history.at(-1)).toMatchObject({
            label: "phase-7a-step-2-r2",
            verdict: "PASS",
            phase: "7a",
        });
    });

    it("records a final review with no phase, and --reason", () => {
        const { record } = setup({ final: pass });

        const outcome = record.review({ label: "final", reason: "all done" });

        const entry = outcome.result?.history.at(-1);
        expect(entry).toMatchObject({
            label: "final",
            verdict: "PASS",
            reason: "all done",
        });
        expect(entry).not.toHaveProperty("phase");
    });

    it("records a second review of the same phase", () => {
        const { record } = setup(
            { "phase-1": pass, "phase-1-r2": pass },
            testState({
                currentStep: "review",
                history: [
                    {
                        step: "review",
                        timestamp: "2026-09-25T00:00:00Z",
                        label: "phase-1",
                        verdict: "FAIL",
                        artifact: "reviews/phase-1.md",
                        phase: "1" as PhaseId,
                    },
                ],
            }),
        );

        const outcome = record.review({ label: "phase-1-r2" });

        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.history.at(-1)?.label).toBe("phase-1-r2");
    });

    it("re-recording a recorded label is a no-op", () => {
        const { fs, record } = setup({ "phase-1": pass, "phase-1-r2": pass });
        record.review({ label: "phase-1" });
        record.review({ label: "phase-1-r2" });
        const before = fs.files.get(statePath);

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("starts state when none exists", () => {
        const { record } = setup({ final: pass }, null);

        const outcome = record.review({ label: "final" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result).toMatchObject({
            feature: "f",
            currentPhase: "execution",
            currentStep: "review",
        });
    });

    it("a missing artifact is a hard stop", () => {
        const { fs, record } = setup({});
        const before = fs.files.get(statePath);

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(codes(outcome.findings)).toEqual(["workspace-incomplete"]);
        expect(outcome.findings[0]?.file).toBe("reviews/phase-1.md");
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("an artifact without a valid verdict line is a hard stop", () => {
        const { fs, record } = setup({
            "phase-1": `## Verdict: MAYBE\n${table}`,
        });
        const before = fs.files.get(statePath);

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.exitCode).toBe(1);
        expect(codes(outcome.findings)).toEqual(["format-invalid"]);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("a verdict line without a findings table is recorded", () => {
        const { record } = setup({ "phase-1": "## Verdict: PASS\n" });

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.result?.history.at(-1)).toMatchObject({
            label: "phase-1",
            verdict: "PASS",
        });
        expect(outcome.findings).toEqual([]);
    });

    it("the recorded entry replaces the one the load just discovered", () => {
        const { record } = setup({ "phase-1": pass });

        const outcome = record.review({ label: "phase-1", reason: "done" });

        const reviews = outcome.result?.history.filter(
            (entry) => entry.label === "phase-1",
        );
        expect(reviews).toEqual([
            expect.objectContaining({ verdict: "PASS", reason: "done" }),
        ]);
    });

    it("a persisted discovered entry is replaced by the recorded one", () => {
        const { record } = setup({ "phase-1": pass });
        record.decision({ text: "persists the discovery" });

        const outcome = record.review({ label: "phase-1" });

        const reviews = outcome.result?.history.filter(
            (entry) => entry.label === "phase-1",
        );
        expect(reviews).toHaveLength(1);
        expect(reviews?.[0]).not.toHaveProperty("reason");
        expect(outcome.result?.currentStep).toBe("review");
    });

    it("an entry discovered by the old text is replaced by the recorded one", () => {
        const { record } = setup(
            { "phase-1": pass },
            testState({
                currentStep: "review",
                history: [
                    { step: "plan", timestamp: "2026-09-25T00:00:00Z" },
                    {
                        step: "review",
                        timestamp: "2026-09-25T01:00:00Z",
                        label: "phase-1",
                        verdict: "PASS",
                        artifact: "reviews/phase-1.md",
                        phase: "1" as PhaseId,
                        reason: "discovered reviews/phase-1.md",
                    },
                ],
            }),
        );

        const outcome = record.review({ label: "phase-1" });

        const reviews = outcome.result?.history.filter(
            (entry) => entry.label === "phase-1",
        );
        expect(reviews).toHaveLength(1);
        expect(reviews?.[0]).not.toHaveProperty("reason");
    });

    it("re-recording a recorded label away from review only moves the position", () => {
        const { fs, record } = setup({ "phase-1": pass });
        record.review({ label: "phase-1" });
        const saved = JSON.parse(fs.files.get(statePath) ?? "{}");
        fs.files.set(
            statePath,
            JSON.stringify({ ...saved, currentStep: "implement" }),
        );

        const outcome = record.review({ label: "phase-1" });

        expect(outcome.wrote).toBe(true);
        expect(outcome.result?.currentStep).toBe("review");
        expect(outcome.result?.history).toEqual(saved.history);
    });

    it("a checkpoint label is a hard stop, even with a valid artifact", () => {
        const { fs, record } = setup({ "phase-1-chk1": pass });
        const before = fs.files.get(statePath);

        const outcome = record.review({ label: "phase-1-chk1" });

        expect(outcome.exitCode).toBe(1);
        expect(codes(outcome.findings)).toEqual(["format-invalid"]);
        expect(fs.files.get(statePath)).toBe(before);
    });

    it("a label outside every review namespace is a hard stop", () => {
        const { record } = setup({ "plan-review": pass });

        const outcome = record.review({ label: "plan-review" });

        expect(outcome.exitCode).toBe(1);
        expect(codes(outcome.findings)).toEqual(["format-invalid"]);
    });

    it("--dry-run returns the would-be state and writes nothing", () => {
        const { fs, record } = setup({ "phase-1": pass });
        const before = fs.files.get(statePath);

        const outcome = record.review({ label: "phase-1", dryRun: true });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(outcome.result?.history.at(-1)?.label).toBe("phase-1");
        expect(fs.files.get(statePath)).toBe(before);
    });
});

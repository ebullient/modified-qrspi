import { describe, expect, it } from "vitest";
import type { LoopCondition } from "../../../../src/state/types.ts";
import { statePath } from "../../fixtures.ts";
import {
    loopBlock,
    loopFixture,
    phaseId,
    phaseSteps,
    plannedState,
    planTable,
} from "../../loop/fixtures.ts";

function files(
    plan = planTable(
        "1 | Base | none",
        "2 | Feature | 1",
        "2a | Inserted | 2",
        "3 | Finish | 2a",
    ),
    markers: Record<string, string> = {
        "1": phaseSteps("x"),
        "2": phaseSteps(" "),
        "2a": phaseSteps(" "),
        "3": phaseSteps(" "),
    },
) {
    return {
        "spec.md": "spec",
        "approach.md": "## Decision\n\nChosen.",
        "plan.md": plan,
        ...Object.fromEntries(
            Object.entries(markers).map(([id, body]) => [
                `plan-phase-${id}.md`,
                body,
            ]),
        ),
    };
}

const setup = (
    state = plannedState({ planPhase: phaseId("1") }),
    workspaceFiles: Record<string, string> = files(),
) => loopFixture({ state, files: workspaceFiles });

describe("loop --start", () => {
    it("resolves all targets with dependencies in deterministic order", () => {
        const outcome = setup().loop.start({ selector: "all" });
        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: true,
            result: {
                action: "implement",
                selector: "all",
                phases: ["2", "2a", "3"],
                state: {
                    loop: {
                        scope: "all",
                        phases: ["2", "2a", "3"],
                        phase: "2",
                        cycle: "implement",
                    },
                },
            },
        });
    });

    it("resolves a single target through incomplete dependencies", () => {
        const custom = files(planTable("1 | Base | none", "2 | Feature | 1"), {
            "1": phaseSteps(" "),
            "2": phaseSteps(" "),
        });
        expect(
            setup(plannedState(), custom).loop.start({ selector: "2" }).result,
        ).toMatchObject({
            selector: "2",
            phases: ["1", "2"],
        });
    });

    it("resolves ranges by row order across an inserted phase", () => {
        expect(setup().loop.start({ selector: "2..3" }).result).toMatchObject({
            phases: ["2", "2a", "3"],
        });
    });

    it("returns a no-op done outcome when the resolved scope is empty", () => {
        const complete = files(undefined, {
            "1": phaseSteps("x"),
            "2": phaseSteps("x"),
            "2a": phaseSteps("x"),
            "3": phaseSteps("x"),
        });
        const { loop, stateFs } = setup(
            plannedState({ planPhase: phaseId("1") }),
            complete,
        );
        const before = stateFs.files.get(statePath);
        const outcome = loop.start({ selector: "all" });
        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: { action: "done", selector: "all", phases: [] },
        });
        expect(stateFs.files.get(statePath)).toBe(before);
    });

    it("refuses to replace an active loop", () => {
        const active = plannedState({
            planPhase: phaseId("1"),
            loop: loopBlock(),
        });
        expect(setup(active).loop.start({ selector: "3" })).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [expect.objectContaining({ code: "loop-refused" })],
        });
    });

    it("replaces a done block and carries its conditions forward", () => {
        const condition: LoopCondition = {
            phase: phaseId("1"),
            label: "phase-1-chk1",
            note: "LOW: follow up",
        };
        const done = plannedState({
            planPhase: phaseId("1"),
            loop: loopBlock("done", {
                scope: "1",
                phases: [phaseId("1")],
                phase: phaseId("1"),
                conditions: [condition],
            }),
        });
        expect(setup(done).loop.start({ selector: "2" }).result).toMatchObject({
            state: { loop: { scope: "2", conditions: [condition] } },
        });
    });

    it("refuses on a failed precondition, writing nothing", () => {
        const { "spec.md": _spec, ...noSpec } = files();
        const { loop, stateFs } = setup(undefined, noSpec);
        const before = stateFs.files.get(statePath);
        expect(loop.start({ selector: "all" })).toMatchObject({
            exitCode: 1,
            wrote: false,
            findings: [
                expect.objectContaining({
                    code: "workspace-incomplete",
                    file: "spec.md",
                }),
            ],
        });
        expect(stateFs.files.get(statePath)).toBe(before);
    });

    it.each([
        [
            "a selected phase missing from plan.md",
            "9",
            files(),
            "workspace-incomplete",
        ],
        [
            "a dependency row missing from plan.md",
            "2",
            files(planTable("1 | Base | none", "2 | Feature | 5")),
            "workspace-incomplete",
        ],
        [
            "a dependency cycle",
            "2",
            files(planTable("1 | Base | 2", "2 | Feature | 1"), {
                "1": phaseSteps(" "),
                "2": phaseSteps(" "),
            }),
            "format-invalid",
        ],
    ])("%s refuses with %s", (_what, selector, workspaceFiles, code) => {
        expect(
            setup(undefined, workspaceFiles).loop.start({ selector }),
        ).toMatchObject({
            exitCode: 1,
            findings: [expect.objectContaining({ code, file: "plan.md" })],
        });
    });

    it("dry-run returns the would-be state without writing", () => {
        const { loop, stateFs } = setup();
        const before = stateFs.files.get(statePath);
        const outcome = loop.start({ selector: "2", dryRun: true });
        expect(outcome).toMatchObject({
            exitCode: 0,
            wrote: false,
            result: { state: { loop: { scope: "2" } } },
        });
        expect(stateFs.files.get(statePath)).toBe(before);
    });
});

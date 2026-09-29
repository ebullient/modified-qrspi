import { describe, expect, it } from "vitest";
import { loopPreconditions } from "../../../src/state/loop/preconditions.ts";
import { fakeGit, fakeWorkspace } from "../fixtures.ts";
import {
    loopState,
    phaseId,
    phaseSteps,
    planTable,
    readyFiles,
} from "./fixtures.ts";

const evaluate = (
    overrides: Parameters<typeof loopPreconditions>[0] extends infer T
        ? Partial<T>
        : never = {},
) =>
    loopPreconditions({
        state: loopState(),
        workspace: fakeWorkspace(readyFiles()),
        git: fakeGit(),
        phases: [phaseId("2")],
        ...overrides,
    });

describe("loop preconditions", () => {
    it("reports invalid state", () => {
        expect(evaluate({ state: null })).toContainEqual(
            expect.objectContaining({ code: "state-invalid" }),
        );
    });

    it("requires a current spec", () => {
        const files = readyFiles();
        delete (files as Partial<typeof files>)["spec.md"];
        expect(evaluate({ workspace: fakeWorkspace(files) })).toContainEqual(
            expect.objectContaining({
                code: "workspace-incomplete",
                file: "spec.md",
            }),
        );
        expect(
            evaluate({ state: loopState({ currentStep: "query" }) }),
        ).toContainEqual(expect.objectContaining({ code: "stale-downstream" }));
    });

    it("requires the plan and every scoped phase file", () => {
        const files = readyFiles();
        delete (files as Partial<typeof files>)["plan-phase-2.md"];
        expect(evaluate({ workspace: fakeWorkspace(files) })).toContainEqual(
            expect.objectContaining({
                code: "workspace-incomplete",
                file: "plans/plan-phase-2.md",
            }),
        );
    });

    it("requires a decision when approach.md exists", () => {
        expect(
            evaluate({
                workspace: fakeWorkspace({
                    ...readyFiles(),
                    "approach.md": "## Decision\n\nNone.",
                }),
            }),
        ).toContainEqual(
            expect.objectContaining({ code: "approach-undecided" }),
        );
    });

    it("requires a clean product tree", () => {
        expect(
            evaluate({
                git: fakeGit({ status: () => [{ path: "src/product.ts" }] }),
            }),
        ).toContainEqual(expect.objectContaining({ code: "dirty-tree" }));
    });

    it("requires blockers to be empty", () => {
        expect(
            evaluate({ state: loopState({ blockers: ["fix it"] }) }),
        ).toContainEqual(expect.objectContaining({ code: "blockers" }));
    });

    it("requires plan to be the last definition step", () => {
        expect(
            evaluate({
                state: loopState({
                    history: [{ step: "plan" }, { step: "spec" }],
                }),
            }),
        ).toContainEqual(expect.objectContaining({ code: "plan-not-current" }));
    });

    it("requires every incomplete dependency to precede its dependent", () => {
        const files = {
            ...readyFiles(),
            "plan.md": planTable("1 | Foundation | none", "2 | Feature | 1"),
            "plan-phase-1.md": phaseSteps(" "),
        };
        expect(
            evaluate({
                workspace: fakeWorkspace(files),
                phases: [phaseId("2")],
            }),
        ).toContainEqual(
            expect.objectContaining({ code: "dependency-incomplete" }),
        );
        expect(
            evaluate({
                workspace: fakeWorkspace(files),
                phases: [phaseId("2"), phaseId("1")],
            }),
        ).toContainEqual(
            expect.objectContaining({ code: "dependency-incomplete" }),
        );
    });

    it("accepts a valid dependency-first scope", () => {
        const files = {
            ...readyFiles(),
            "plan-phase-1.md": phaseSteps(" "),
        };
        expect(
            evaluate({
                workspace: fakeWorkspace(files),
                phases: [phaseId("1"), phaseId("2")],
            }),
        ).toEqual([]);
    });
});

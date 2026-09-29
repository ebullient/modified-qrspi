import { describe, expect, it } from "vitest";
import { resolveScope } from "../../../src/state/loop/dependencyGraph.ts";
import type { PhaseId } from "../../../src/state/types.ts";
import { parsePlanTable } from "../../../src/workspace/PlanTable.ts";

/** A plan table from `[phase, dependsOn]` rows, in row order. */
function table(...rows: [string, string][]) {
    return parsePlanTable(
        [
            "| Phase | Name | Depends On | Status |",
            "|-------|------|------------|--------|",
            ...rows.map(
                ([phase, deps]) => `| ${phase} | Name | ${deps} | [ ] |`,
            ),
        ].join("\n"),
        "plan.md",
    );
}

function complete(...phases: string[]) {
    const done = new Set(phases);
    return (phase: PhaseId) => done.has(phase);
}

function resolve(
    targets: string[],
    plan: ReturnType<typeof table>,
    isComplete = complete(),
) {
    const result = resolveScope(targets as PhaseId[], plan, isComplete);
    return result.kind === "scope" ? result.phases : result;
}

describe("resolveScope", () => {
    it("tags a resolved scope with its kind", () => {
        const plan = table(["1", "none"]);
        expect(resolveScope(["1"] as PhaseId[], plan, complete())).toEqual({
            kind: "scope",
            phases: ["1"],
        });
    });

    it("adds an incomplete dependency ahead of its target", () => {
        const plan = table(["1", "none"], ["2", "1"]);
        expect(resolve(["2"], plan)).toEqual(["1", "2"]);
    });

    it("does not add a complete dependency", () => {
        const plan = table(["1", "none"], ["2", "1"]);
        expect(resolve(["2"], plan, complete("1"))).toEqual(["2"]);
    });

    it("adds incomplete dependencies transitively", () => {
        const plan = table(["1", "none"], ["2", "1"], ["3", "2"]);
        expect(resolve(["3"], plan)).toEqual(["1", "2", "3"]);
    });

    it("walks through a complete dependency to an incomplete one", () => {
        const plan = table(["1", "none"], ["2", "1"], ["3", "2"]);
        expect(resolve(["3"], plan, complete("2"))).toEqual(["1", "3"]);
    });

    it("leaves an unrelated incomplete phase out", () => {
        const plan = table(["1", "none"], ["2", "none"], ["3", "1"]);
        expect(resolve(["3"], plan)).toEqual(["1", "3"]);
    });

    it("omits a complete target", () => {
        const plan = table(["1", "none"], ["2", "none"]);
        expect(resolve(["1", "2"], plan, complete("1"))).toEqual(["2"]);
    });

    it("is empty when every target and dependency is complete", () => {
        const plan = table(["1", "none"], ["2", "1"]);
        expect(resolve(["2"], plan, complete("1", "2"))).toEqual([]);
    });

    it("adds a shared dependency once in a diamond", () => {
        const plan = table(
            ["1", "none"],
            ["2", "1"],
            ["3", "1"],
            ["4", "2, 3"],
        );
        expect(resolve(["2", "3", "4"], plan)).toEqual(["1", "2", "3", "4"]);
        expect(resolve(["4"], plan)).toEqual(["1", "2", "3", "4"]);
    });

    it("breaks ties between independent phases by row order", () => {
        const plan = table(["3", "none"], ["1", "none"], ["2", "none"]);
        expect(resolve(["2", "1", "3"], plan)).toEqual(["3", "1", "2"]);
    });

    it("places a dependency before a dependent that precedes it in the table", () => {
        const plan = table(["1", "none"], ["2", "3"], ["3", "none"]);
        expect(resolve(["2"], plan)).toEqual(["3", "2"]);
    });

    it("orders inserted phases by their explicit dependencies", () => {
        const plan = table(
            ["7", "none"],
            ["7a", "7"],
            ["7b", "7a"],
            ["8", "7b"],
        );
        expect(resolve(["8"], plan)).toEqual(["7", "7a", "7b", "8"]);
    });

    it("a missing dependency row is an error with no partial scope", () => {
        const plan = table(["1", "none"], ["2", "1, 9"]);
        expect(resolve(["2"], plan)).toMatchObject({
            kind: "missing-dependency",
        });
    });

    it("a missing row behind a complete dependency is still an error", () => {
        const plan = table(["1", "9"], ["2", "1"]);
        expect(resolve(["2"], plan, complete("1"))).toMatchObject({
            kind: "missing-dependency",
        });
    });

    it("a dependency cycle is an error with no partial scope", () => {
        const plan = table(["1", "3"], ["2", "1"], ["3", "2"], ["4", "3"]);
        expect(resolve(["4"], plan)).toMatchObject({ kind: "cycle" });
    });

    it("a self-dependency is a cycle", () => {
        const plan = table(["1", "1"]);
        expect(resolve(["1"], plan)).toMatchObject({ kind: "cycle" });
    });

    it("ignores a cycle among unreachable phases", () => {
        const plan = table(["1", "none"], ["2", "3"], ["3", "2"]);
        expect(resolve(["1"], plan)).toEqual(["1"]);
    });
});

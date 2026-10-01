import { describe, expect, it } from "vitest";
import {
    DependencyCycleError,
    type PlanRow,
    parsePlanTable,
    phaseGraphAt,
} from "../../src/workspace/PlanTable.ts";

describe("parsePlanTable", () => {
    it("parses rows, dependsOn lists, none, and skips header/separator", () => {
        const text = `
## QRSPI Plan: widget

| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | Does a thing | 3 | [x] |
| 2 | Second | 1 | Builds on first | 4 | [~] |
| 2a | Inserted | 1, 2 | Fills a gap | 2 | [ ] |
| 3 | Third | 2 | Wraps up | 1 | [!] |
| 4 | Empty cell |  | Also no deps | 1 | [ ] |
`;

        const rows = parsePlanTable(text);

        expect(rows).toHaveLength(5);
        expect(rows[0]).toEqual({
            phase: "1",
            name: "First",
            dependsOn: [],
            status: "[x]",
        });
        expect(rows[1].dependsOn).toEqual(["1"]);
        expect(rows[2]).toEqual({
            phase: "2a",
            name: "Inserted",
            dependsOn: ["1", "2"],
            status: "[ ]",
        });
        expect(rows[3].status).toBe("[!]");
        expect(rows[4].dependsOn).toEqual([]);
    });
});

function row(
    phase: string,
    dependsOn: string[],
    status: PlanRow["status"],
): PlanRow {
    return { phase, name: phase, dependsOn, status };
}

describe("phaseGraphAt", () => {
    it("answers isSatisfied transitively and resolves every selector form", () => {
        const rows = [
            row("1", [], "[x]"),
            row("2", ["1"], "[x]"),
            row("2a", ["1", "2"], "[ ]"),
            row("3", ["2"], "[ ]"),
            row("4", ["2a"], "[ ]"),
        ];
        const graph = phaseGraphAt(rows);

        // satisfied: dependency chain (1 -> 2) all [x]
        expect(graph.isSatisfied("3")).toBe(true);
        // not satisfied: 2a's own row isn't [x]
        expect(graph.isSatisfied("4")).toBe(false);

        expect(graph.resolveScope("all")).toEqual({
            scope: ["1", "2", "2a", "3", "4"],
            phaseIds: ["2a", "3", "4"],
        });

        // range 2..4 includes the inserted phase 2a sitting between them
        // in row order; 2 itself is [x], so it's dropped from scope
        expect(graph.resolveScope("2..4")).toEqual({
            scope: ["2", "2a", "3", "4"],
            phaseIds: ["2a", "3", "4"],
        });

        expect(graph.resolveScope("1,3")).toEqual({
            scope: ["1", "3"],
            phaseIds: ["3"],
        });

        expect(graph.resolveScope("3")).toEqual({
            scope: ["3"],
            phaseIds: ["3"],
        });

        // 4 depends on 2a, which isn't done yet -- pulled in ahead of 4
        expect(graph.resolveScope("4")).toEqual({
            scope: ["4"],
            phaseIds: ["2a", "4"],
        });
    });

    it("walks through a complete phase to reach an incomplete dependency behind it", () => {
        // 1 -> 2 -> 2a: 2a is complete, but 1 (behind it) is not. The
        // walk must not stop just because 2a's own row is [x].
        const rows = [
            row("1", [], "[ ]"),
            row("2a", ["1"], "[x]"),
            row("3", ["2a"], "[ ]"),
        ];
        const graph = phaseGraphAt(rows);

        expect(graph.resolveScope("3")).toEqual({
            scope: ["3"],
            phaseIds: ["1", "3"],
        });
    });

    it("adds a shared dependency once in a diamond, ordered before every dependent", () => {
        const rows = [
            row("1", [], "[ ]"),
            row("2", ["1"], "[ ]"),
            row("2a", ["1"], "[ ]"),
            row("3", ["2", "2a"], "[ ]"),
        ];
        const graph = phaseGraphAt(rows);

        expect(graph.resolveScope("3")).toEqual({
            scope: ["3"],
            phaseIds: ["1", "2", "2a", "3"],
        });
        expect(graph.resolveScope("2,2a,3")).toEqual({
            scope: ["2", "2a", "3"],
            phaseIds: ["1", "2", "2a", "3"],
        });
    });

    it("orders a dependency before a dependent that precedes it in row order", () => {
        // 2 is listed before 2a in the table, but 2 depends on 2a, so
        // 2a must still come first in the resolved scope.
        const rows = [
            row("1", [], "[ ]"),
            row("2", ["2a"], "[ ]"),
            row("2a", [], "[ ]"),
        ];
        const graph = phaseGraphAt(rows);

        expect(graph.resolveScope("2")).toEqual({
            scope: ["2"],
            phaseIds: ["2a", "2"],
        });
    });

    it("throws on a dependency cycle, including one behind a complete phase", () => {
        // both marked [x] so isSatisfied() actually walks the cycle,
        // rather than short-circuiting on a plain "not done" answer
        const doneRows = [row("1", ["2"], "[x]"), row("2", ["1"], "[x]")];
        expect(() => phaseGraphAt(doneRows).isSatisfied("1")).toThrow(
            DependencyCycleError,
        );

        const incompleteRows = [row("1", ["2"], "[ ]"), row("2", ["1"], "[ ]")];
        expect(() => phaseGraphAt(incompleteRows).resolveScope("1")).toThrow(
            DependencyCycleError,
        );

        // the cycle (2a <-> 3) sits behind 2a, which is itself [x] --
        // resolveScope() must still walk into it rather than stopping at
        // 2a's own completeness
        const cycleBehindComplete = [
            row("1", ["2a"], "[ ]"),
            row("2a", ["3"], "[x]"),
            row("3", ["2a"], "[ ]"),
        ];
        expect(() =>
            phaseGraphAt(cycleBehindComplete).resolveScope("1"),
        ).toThrow(DependencyCycleError);
    });

    it("ignores a cycle among phases unreachable from the requested selector", () => {
        const rows = [
            row("1", [], "[ ]"),
            row("2a", ["3"], "[ ]"),
            row("3", ["2a"], "[ ]"),
        ];
        const graph = phaseGraphAt(rows);

        expect(graph.resolveScope("1")).toEqual({
            scope: ["1"],
            phaseIds: ["1"],
        });
    });
});

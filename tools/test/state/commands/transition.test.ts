import { describe, expect, it } from "vitest";
import { initPlan } from "../../../src/state/commands/Init.ts";
import type {
    CommandContext,
    CommandServices,
    TransitionOptions,
} from "../../../src/state/commands/inputs.ts";
import {
    sameState,
    type Transition,
    type TransitionPlan,
    transition,
} from "../../../src/state/commands/transition.ts";
import { InternalError, StateInvalidError } from "../../../src/state/errors.ts";
import type { StateFileSystem } from "../../../src/state/ports.ts";
import { Store } from "../../../src/state/store/Store.ts";
import type {
    Finding,
    HistoryEntry,
    State,
    StateView,
} from "../../../src/state/types.ts";
import {
    baseState,
    fakeClock,
    fakeGit,
    fakeWorkspace,
    MemoryStateFileSystem,
    statePath,
} from "../fixtures.ts";

/** A state file system whose reads or writes fail. */
class FailingStateFileSystem extends MemoryStateFileSystem {
    constructor(
        private readonly failRead: boolean,
        failWrite = false,
    ) {
        super();
        this.failWrite = failWrite;
    }

    override read(path: string): string | null {
        if (this.failRead) throw new Error("read denied");
        return super.read(path);
    }
}

function servicesWith(
    fileSystem: StateFileSystem,
    hasPlan = false,
): {
    services: CommandServices;
    context: CommandContext;
} {
    const store = new Store({ feature: "f", path: statePath, fileSystem });
    const workspace = fakeWorkspace({
        "plan.md": hasPlan
            ? "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n"
            : null,
    });
    return {
        services: {
            store,
            workspace,
            git: fakeGit(),
            clock: fakeClock("2026-09-25T00:00:00Z"),
        },
        context: { feature: "f" },
    };
}

interface FakeOptions extends TransitionOptions {
    hardStop?: boolean;
    warn?: boolean;
    noop?: boolean;
    invalidResult?: boolean;
}

/** A transition whose plan is driven by the options. */
const fakePlan: Transition<FakeOptions> = {
    plan(state: State | null, options: FakeOptions): TransitionPlan<StateView> {
        if (options.hardStop) {
            return {
                kind: "stop",
                findings: [
                    { code: "workspace-incomplete", message: "stopped" },
                ],
            };
        }
        if (options.noop) return { kind: "noop" };
        if (options.invalidResult) {
            return {
                kind: "write",
                next: {
                    ...(state ?? baseState()),
                    currentStep: "invalid",
                } as never,
            };
        }
        return {
            kind: "write",
            next: { ...(state ?? baseState()), currentStep: "query" },
        };
    },
    warnings(_state: State | null, options: FakeOptions): Finding[] {
        return options.warn
            ? [{ code: "new-questions", message: "warned" }]
            : [];
    },
    historyEntry(): HistoryEntry {
        return { step: "query", timestamp: "2026-09-25T00:00:00Z" };
    },
};

function run(
    { services, context }: ReturnType<typeof servicesWith>,
    options: FakeOptions,
    plan: Transition<FakeOptions> = fakePlan,
) {
    return transition({ services, context }, options, plan);
}

describe("transition", () => {
    it("a hard stop writes nothing and exits 1", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = run(
            { services, context },
            {
                hardStop: true,
                warn: true,
            },
        );

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            { code: "workspace-incomplete", message: "stopped" },
        ]);
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").currentStep).toBe(
            "init",
        );
    });

    it("succeeds, persists, and appends one history entry", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = run({ services, context }, {});

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.currentStep).toBe("query");
        expect(outcome.result?.history).toEqual([
            { step: "query", timestamp: "2026-09-25T00:00:00Z" },
        ]);

        const written = JSON.parse(fs.files.get(statePath) ?? "{}");
        expect(written.currentStep).toBe("query");
        expect(written.history).toHaveLength(1);
    });

    it("a warning-only transition writes, exits 0, and returns the warnings", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = run({ services, context }, { warn: true });

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([
            { code: "new-questions", message: "warned" },
        ]);
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").currentStep).toBe(
            "query",
        );
    });

    it("a dry run returns the would-be state and writes nothing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = run(
            { services, context },
            {
                dryRun: true,
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(outcome.result?.currentStep).toBe("query");
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").currentStep).toBe(
            "init",
        );
    });

    it("a no-op writes nothing and adds no history entry", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = run(
            { services, context },
            {
                noop: true,
                warn: true,
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            { code: "new-questions", message: "warned" },
        ]);
        expect(outcome.result?.history).toEqual([]);
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").history).toEqual([]);
    });

    it("an old-shape file (currentPhase, completed: false) is not rewritten by a no-op, and the next change writes the new shape", () => {
        const fs = new MemoryStateFileSystem();
        const old = JSON.stringify({
            ...baseState(),
            currentPhase: "execution",
            completed: false,
        });
        fs.files.set(statePath, old);
        const { services, context } = servicesWith(fs);

        const noop = run({ services, context }, { noop: true });

        expect(noop.wrote).toBe(false);
        expect(fs.files.get(statePath)).toBe(old);

        const changed = run({ services, context }, {});

        expect(changed.wrote).toBe(true);
        const written = JSON.parse(fs.files.get(statePath) ?? "{}");
        expect(written).not.toHaveProperty("currentPhase");
        expect(written).not.toHaveProperty("completed");
    });

    describe("recovery", () => {
        const recoveryEntry = (fields: string) => ({
            step: "init",
            timestamp: "2026-09-25T00:00:00Z",
            reason: `recovered from workspace evidence: ${fields}`,
        });

        it("a valid file appends no recovery entry", () => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, JSON.stringify(baseState()));
            const { services, context } = servicesWith(fs);

            const outcome = run({ services, context }, {});

            expect(outcome.result?.history).toHaveLength(1);
            expect(outcome.findings).toEqual([]);
        });

        it("rebuilds one invalid field, keeps the rest, and appends one recovery entry before its own", () => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(
                statePath,
                JSON.stringify(
                    baseState({
                        decisions: ["kept"],
                        commitMode: "squash" as never,
                    }),
                ),
            );
            const { services, context } = servicesWith(fs);

            const outcome = run({ services, context }, {});

            expect(outcome.exitCode).toBe(0);
            expect(outcome.findings).toEqual([]);
            expect(outcome.result).toMatchObject({
                decisions: ["kept"],
                commitMode: "phase",
                history: [
                    recoveryEntry("commitMode"),
                    { step: "query", timestamp: "2026-09-25T00:00:00Z" },
                ],
            });
        });

        it("an unparseable file is rebuilt from workspace evidence", () => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, "{ not json");
            const { services, context } = servicesWith(fs, true);

            const outcome = run({ services, context }, {});

            expect(outcome.exitCode).toBe(0);
            expect(outcome.findings).toEqual([]);
            expect(outcome.result?.history).toEqual([
                { ...recoveryEntry("state.json"), step: "plan" },
                { step: "query", timestamp: "2026-09-25T00:00:00Z" },
            ]);
        });

        it("a recovery is written even when the step itself is a no-op", () => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(
                statePath,
                JSON.stringify(baseState({ commitMode: "squash" as never })),
            );
            const { services, context } = servicesWith(fs);

            const outcome = run(
                { services, context },
                {
                    noop: true,
                },
            );

            expect(outcome.wrote).toBe(true);
            expect(JSON.parse(fs.files.get(statePath) ?? "{}").history).toEqual(
                [recoveryEntry("commitMode")],
            );
        });

        it("a write discovers an unrecorded review, with no finding", () => {
            const fs = new MemoryStateFileSystem();
            fs.files.set(statePath, JSON.stringify(baseState()));
            const { store, clock, git } = servicesWith(fs).services;
            const services = {
                store,
                clock,
                git,
                workspace: fakeWorkspace({
                    "plan.md":
                        "| Phase | Name | Depends On | Status |\n|---|---|---|---|\n| 1 | A | none | [x] |\n",
                    "plan-phase-1.md": "### Step 1: A\n- [x] Status marker\n",
                    "reviews/final.md": "## Verdict: PASS\n",
                }),
            };

            const outcome = run(
                { services, context: { feature: "f" } },
                {
                    noop: true,
                },
            );

            expect(outcome.wrote).toBe(true);
            expect(outcome.findings).toEqual([]);
            expect(JSON.parse(fs.files.get(statePath) ?? "{}").history).toEqual(
                [
                    expect.objectContaining({
                        label: "final",
                        verdict: "PASS",
                        reason: "discovered reviews/final.md",
                    }),
                ],
            );
        });

        it("--dry-run returns the recovered state and writes nothing", () => {
            const fs = new MemoryStateFileSystem();
            const corrupt = JSON.stringify(
                baseState({ commitMode: "squash" as never }),
            );
            fs.files.set(statePath, corrupt);
            const { services, context } = servicesWith(fs);

            const outcome = run(
                { services, context },
                {
                    dryRun: true,
                },
            );

            expect(outcome.wrote).toBe(false);
            expect(outcome.result?.history).toHaveLength(2);
            expect(fs.files.get(statePath)).toBe(corrupt);
        });

        it("ambiguous evidence exits 3 and leaves the file byte-identical", () => {
            const fs = new MemoryStateFileSystem();
            const corrupt = JSON.stringify({
                ...baseState(),
                loop: { scope: "all" },
            });
            fs.files.set(statePath, corrupt);
            const { services, context } = servicesWith(fs);

            expect(() => run({ services, context }, {})).toThrow(
                StateInvalidError,
            );
            expect(fs.files.get(statePath)).toBe(corrupt);
        });

        it("an absent optional field stays absent across an unrelated write", () => {
            const fs = new MemoryStateFileSystem();
            const {
                planPhase: _p,
                phaseBaseSha: _b,
                commitMode: _c,
                ...required
            } = baseState();
            fs.files.set(statePath, JSON.stringify(required));
            const { services, context } = servicesWith(fs);

            run({ services, context }, {});

            const written = JSON.parse(fs.files.get(statePath) ?? "{}");
            expect(written).not.toHaveProperty("planPhase");
            expect(written).not.toHaveProperty("phaseBaseSha");
            expect(written).not.toHaveProperty("commitMode");
        });
    });

    it("an unreadable existing state is an internal error", () => {
        const fs = new FailingStateFileSystem(true);
        const { services, context } = servicesWith(fs);

        expect(() => run({ services, context }, {})).toThrow(InternalError);
    });

    it("an inaccessible state write is an internal error", () => {
        const fs = new FailingStateFileSystem(false, true);
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        expect(() => run({ services, context }, {})).toThrow(InternalError);
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").history).toEqual([]);
    });

    it("a schema-invalid proposed state is never written", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        expect(() =>
            run({ services, context }, { invalidResult: true }),
        ).toThrow(StateInvalidError);
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").history).toEqual([]);
    });
});

describe("transition plans", () => {
    it("uses the unified plan result to refuse before warnings or writes", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);
        let planCalled = 0;

        const outcome = transition(
            { services, context },
            {},
            {
                plan: () => {
                    planCalled += 1;
                    return {
                        kind: "stop",
                        findings: [
                            { code: "dirty-tree", message: "planned stop" },
                        ],
                    };
                },
            },
        );

        expect(outcome.exitCode).toBe(1);
        expect(outcome.wrote).toBe(false);
        expect(outcome.findings).toEqual([
            { code: "dirty-tree", message: "planned stop" },
        ]);
        expect(planCalled).toBe(1);
    });

    it("uses a write plan and carries its non-serialized result", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = transition(
            { services, context },
            {},
            {
                plan: () => ({
                    kind: "write",
                    next: { ...baseState(), currentStep: "query" },
                    result: (state: StateView) => ({
                        state,
                        marker: "planned-write",
                    }),
                }),
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.result).toMatchObject({
            marker: "planned-write",
            state: { currentStep: "query" },
        });
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").currentStep).toBe(
            "query",
        );
    });

    it("uses a no-op plan and carries its result without writing", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = transition(
            { services, context },
            {},
            {
                plan: () => ({
                    kind: "noop",
                    result: (state: StateView) => ({
                        state,
                        marker: "planned-noop",
                    }),
                }),
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(false);
        expect(outcome.result).toMatchObject({
            marker: "planned-noop",
            state: { currentStep: "init" },
        });
        expect(JSON.parse(fs.files.get(statePath) ?? "{}").currentStep).toBe(
            "init",
        );
    });

    it("warnings are optional", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = transition(
            { services, context },
            {},
            {
                plan: (state) => ({
                    kind: "write",
                    next: { ...(state as State), currentStep: "query" },
                }),
            },
        );

        expect(outcome.exitCode).toBe(0);
        expect(outcome.wrote).toBe(true);
        expect(outcome.findings).toEqual([]);
        expect(outcome.result?.history).toEqual([]);
    });

    it("recordsHistory false moves the position without an entry", () => {
        const fs = new MemoryStateFileSystem();
        fs.files.set(statePath, JSON.stringify(baseState()));
        const { services, context } = servicesWith(fs);

        const outcome = transition(
            { services, context },
            {},
            {
                ...fakePlan,
                recordsHistory: () => false,
            },
        );

        expect(outcome.result?.currentStep).toBe("query");
        expect(outcome.result?.history).toEqual([]);
    });

    it("startsAs initPlan creates state as record init does, with its warning", () => {
        const fs = new MemoryStateFileSystem();
        const { services, context } = servicesWith(fs);

        const outcome = transition(
            { services, context },
            {},
            {
                startsAs: initPlan({ services, context }),
                plan: (state) => ({
                    kind: "write",
                    next: { ...(state as State), completed: true },
                }),
            },
        );

        expect(outcome.wrote).toBe(true);
        expect(outcome.findings.map((f) => f.code)).toEqual([
            "workspace-incomplete",
        ]);
        expect(outcome.result).toMatchObject({
            feature: "f",
            currentStep: "init",
            completed: true,
            history: [{ step: "init", timestamp: "2026-09-25T00:00:00Z" }],
        });
    });

    it("startsFresh creates state instead of recovering a missing file", () => {
        const fs = new MemoryStateFileSystem();
        const { services, context } = servicesWith(fs, true);

        const outcome = transition(
            { services, context },
            {},
            {
                ...fakePlan,
                startsFresh: true,
            },
        );

        expect(outcome.result?.history).toEqual([
            { step: "query", timestamp: "2026-09-25T00:00:00Z" },
        ]);
    });
});

describe("sameState", () => {
    it("ignores object key order at every depth", () => {
        expect(
            sameState(
                { a: 1, b: { c: [1, { x: 1, y: 2 }], d: null } },
                { b: { d: null, c: [1, { y: 2, x: 1 }] }, a: 1 },
            ),
        ).toBe(true);
    });

    it("treats an undefined member as absent", () => {
        expect(sameState({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    });

    it("distinguishes values, array order, and missing members", () => {
        expect(sameState({ a: 1 }, { a: 2 })).toBe(false);
        expect(sameState([1, 2], [2, 1])).toBe(false);
        expect(sameState({ a: 1 }, { a: 1, b: 0 })).toBe(false);
        expect(sameState({ a: null }, { a: {} })).toBe(false);
        expect(sameState([], {})).toBe(false);
    });
});

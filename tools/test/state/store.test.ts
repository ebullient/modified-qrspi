import { describe, expect, it } from "vitest";
import { InternalError, StateInvalidError } from "../../src/state/errors.ts";
import { Store } from "../../src/state/store/Store.ts";
import { validateState } from "../../src/state/store/schema.ts";
import { MemoryStateFileSystem } from "./fixtures.ts";

const path = "/project/qrspi/example-feature/state.json";

function storeFor(fileSystem: MemoryStateFileSystem): Store {
    return new Store({ feature: "example-feature", path, fileSystem });
}

const stateFixture = () =>
    validateState({
        feature: "example-feature",
        currentStep: "implement",
        blockers: [],
        decisions: [],
        history: [{ step: "plan", timestamp: "2026-09-25T21:05:11Z" }],
    });

describe("Store", () => {
    it("writes atomically in schema order", () => {
        const fileSystem = new MemoryStateFileSystem();
        const store = storeFor(fileSystem);
        const state = {
            ...stateFixture(),
            commitMode: "step" as const,
            phaseBaseSha: null,
            planPhase: null,
        };

        expect(store.save(state)).toEqual({ state, wrote: true });
        expect(store.load()).toEqual({
            kind: "parsed",
            values: state,
            invalid: [],
        });

        const written = fileSystem.files.get(path);
        expect(written?.endsWith("\n")).toBe(true);
        expect(Object.keys(JSON.parse(written ?? "{}"))).toEqual([
            "feature",
            "currentStep",
            "blockers",
            "decisions",
            "history",
            "planPhase",
            "phaseBaseSha",
            "commitMode",
        ]);
    });

    it("reports a missing state file", () => {
        const store = storeFor(new MemoryStateFileSystem());

        expect(store.load()).toEqual({ kind: "missing" });
    });

    it("reports malformed JSON as unparseable", () => {
        const fileSystem = new MemoryStateFileSystem();
        fileSystem.files.set(path, "{not-json");
        const store = storeFor(fileSystem);

        expect(store.load()).toMatchObject({ kind: "unparseable" });
    });

    it("reports a feature mismatch as an invalid field, keeping the rest", () => {
        const fileSystem = new MemoryStateFileSystem();
        const { feature: _, ...rest } = stateFixture();
        fileSystem.files.set(
            path,
            `${JSON.stringify({ ...rest, feature: "other-feature" })}\n`,
        );
        const store = storeFor(fileSystem);

        expect(store.load()).toEqual({
            kind: "parsed",
            values: rest,
            invalid: ["feature"],
        });
    });

    it("reports invalid fields and keeps the valid ones", () => {
        const fileSystem = new MemoryStateFileSystem();
        fileSystem.files.set(
            path,
            JSON.stringify({ ...stateFixture(), currentStep: "launch" }),
        );
        const store = storeFor(fileSystem);

        const loaded = store.load();
        expect(loaded).toMatchObject({
            kind: "parsed",
            invalid: ["currentStep"],
        });
        expect(loaded.kind === "parsed" && loaded.values).not.toHaveProperty(
            "currentStep",
        );
    });

    it("saves a history entry with no timestamp without inventing one", () => {
        const fileSystem = new MemoryStateFileSystem();
        const store = storeFor(fileSystem);
        const state = {
            ...stateFixture(),
            history: [{ step: "plan" as const }],
        };

        store.save(state);

        expect(JSON.parse(fileSystem.files.get(path) ?? "{}").history).toEqual([
            { step: "plan" },
        ]);
    });

    it("save rejects an invalid state", () => {
        const fileSystem = new MemoryStateFileSystem();
        const store = storeFor(fileSystem);

        expect(() =>
            store.save({
                ...stateFixture(),
                currentStep: "launch" as never,
            }),
        ).toThrow(StateInvalidError);
        expect(fileSystem.files.has(path)).toBe(false);
    });

    it.each([
        ["temp-write", { failWrite: true }],
        ["rename", { failRename: true }],
        ["cleanup", { failRename: true, failRemove: true }],
    ])("leaves the original untouched on %s failure", (_name, failures) => {
        const fileSystem = new MemoryStateFileSystem();
        const original = '{"original":true}\n';
        fileSystem.files.set(path, original);
        Object.assign(fileSystem, failures);
        const store = storeFor(fileSystem);

        expect(() => store.save(stateFixture())).toThrow(InternalError);
        expect(fileSystem.files.get(path)).toBe(original);
    });

    it("validates a dry run without touching the filesystem", () => {
        const fileSystem = new MemoryStateFileSystem();
        const original = '{"original":true}\n';
        fileSystem.files.set(path, original);
        fileSystem.failWrite = true;
        fileSystem.failRename = true;
        fileSystem.failRemove = true;
        const store = storeFor(fileSystem);
        const state = stateFixture();

        expect(store.save(state, { dryRun: true })).toEqual({
            state,
            wrote: false,
        });
        const current = fileSystem.files.get(path) ?? "";
        expect(current).toBe(original);
        expect({
            writeTempCalls: fileSystem.writeTempCalls,
            renameCalls: fileSystem.renameCalls,
            removeCalls: fileSystem.removeCalls,
        }).toEqual({ writeTempCalls: 0, renameCalls: 0, removeCalls: 0 });
    });
});

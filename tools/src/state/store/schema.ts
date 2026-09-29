import {
    isCheckpointLabel,
    isHumanReviewLabel,
} from "../../workspace/ReviewArtifact.ts";
import { StateInvalidError } from "../errors.ts";
import { isKebab, isPhaseId } from "../ids.ts";
import {
    type CommitMode,
    type CurrentStep,
    commitModes,
    type HistoryEntry,
    type LoopBlock,
    type LoopCondition,
    type LoopCycle,
    loopCycles,
    type Outcome,
    outcomes,
    type PhaseId,
    type State,
    stateFileName,
    type Verdict,
    verdicts,
    workflowOrder,
} from "../types.ts";

const shaPattern = /^[0-9a-fA-F]{7,40}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const currentSteps = new Set<CurrentStep>([...workflowOrder, "checkpoint"]);

/** A list's members as an error message's choices: `"a" or "b"`, `"a", "b", or "c"`. */
function choices(values: readonly string[]): string {
    const quoted = values.map((value) => `"${value}"`);
    const last = quoted.pop();
    if (quoted.length === 0) return last ?? "";
    const separator = quoted.length > 1 ? ", or " : " or ";
    return `${quoted.join(", ")}${separator}${last}`;
}

type UnknownRecord = Record<string, unknown>;

/**
 * What a parseable `state.json` holds: every valid value, and the path of
 * each missing or invalid one. An invalid loop block's valid members are
 * kept apart in `loopMembers`, since the block itself is not valid.
 */
export interface StateRead {
    values: Partial<State>;
    invalid: string[];
    loopMembers?: Partial<LoopBlock>;
}

/** The path of an invalid field and what was wrong with it. */
interface FieldError {
    field: string;
    message: string;
}

/** A value that read cleanly, or the field error that says it did not. */
type Read<T> = { ok: true; value: T } | { ok: false; error: FieldError };

function ok<T>(value: T): Read<T> {
    return { ok: true, value };
}

function fail(
    field: string,
    expected: string,
): { ok: false; error: FieldError } {
    return {
        ok: false,
        error: {
            field,
            message: `state.json field ${field} must be ${expected}`,
        },
    };
}

/** The read's value; an invalid read is recorded in `errors` and gives `undefined`. */
function collect<T>(errors: FieldError[], result: Read<T>): T | undefined {
    if (result.ok) return result.value;
    errors.push(result.error);
    return undefined;
}

/** Reads each array entry on its own, dropping the invalid ones. */
function entries<T>(
    value: unknown,
    field: string,
    errors: FieldError[],
    read: (entry: unknown, entryField: string) => Read<T>,
): T[] | undefined {
    if (!Array.isArray(value)) {
        errors.push(fail(field, "an array").error);
        return undefined;
    }
    return value.flatMap((entry, index) => {
        const result = collect(errors, read(entry, `${field}[${index}]`));
        return result === undefined ? [] : [result];
    });
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Read<UnknownRecord> {
    return isRecord(value) ? ok(value) : fail(field, "an object");
}

function string(value: unknown, field: string, nonEmpty = false): Read<string> {
    if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
        return fail(field, nonEmpty ? "a non-empty string" : "a string");
    }
    return ok(value);
}

function nullableString(
    value: unknown,
    field: string,
    nonEmpty = false,
): Read<string | null> {
    if (value === null) return ok(null);
    return string(value, field, nonEmpty);
}

function phaseId(value: unknown, field: string): Read<PhaseId> {
    const candidate = string(value, field, true);
    if (!candidate.ok) return candidate;
    if (!isPhaseId(candidate.value)) return fail(field, "a valid phase id");
    return ok(candidate.value as PhaseId);
}

/** A history entry; an invalid member other than `step` is dropped and the entry kept. */
function historyEntry(
    value: unknown,
    field: string,
    errors: FieldError[],
): Read<HistoryEntry> {
    const record_ = record(value, field);
    if (!record_.ok) return record_;
    const entry = record_.value;
    const step = string(entry.step, `${field}.step`);
    if (!step.ok) return step;
    if (!currentSteps.has(step.value as CurrentStep)) {
        return fail(`${field}.step`, "a workflow step or checkpoint");
    }
    const optional = <T>(key: string, read: (value: unknown) => Read<T>) => {
        if (entry[key] === undefined) return {};
        const result = collect(errors, read(entry[key]));
        return result === undefined ? {} : { [key]: result };
    };

    return ok({
        step: step.value as CurrentStep,
        ...optional("timestamp", (v) => {
            const timestamp = string(v, `${field}.timestamp`);
            if (!timestamp.ok) return timestamp;
            if (
                !timestampPattern.test(timestamp.value) ||
                Number.isNaN(Date.parse(timestamp.value))
            ) {
                return fail(`${field}.timestamp`, "an ISO 8601 UTC timestamp");
            }
            return timestamp;
        }),
        ...optional("mode", (v) => string(v, `${field}.mode`)),
        ...optional("reason", (v) => string(v, `${field}.reason`)),
        ...optional("label", (v) => {
            const label = string(v, `${field}.label`, true);
            if (!label.ok) return label;
            if (
                !isHumanReviewLabel(label.value) &&
                !isCheckpointLabel(label.value)
            ) {
                return fail(
                    `${field}.label`,
                    "a human-review or checkpoint label",
                );
            }
            return label;
        }),
        ...optional("verdict", (v) => {
            if (!verdicts.includes(v as Verdict)) {
                return fail(`${field}.verdict`, choices(verdicts));
            }
            return ok(v as Verdict);
        }),
        ...optional("artifact", (v) => {
            const artifact = string(v, `${field}.artifact`, true);
            if (!artifact.ok) return artifact;
            if (
                artifact.value.startsWith("/") ||
                artifact.value.split("/").includes("..")
            ) {
                return fail(`${field}.artifact`, "a workspace-relative path");
            }
            return artifact;
        }),
        ...optional("phase", (v) => phaseId(v, `${field}.phase`)),
        ...optional("by", (v) => string(v, `${field}.by`, true)),
        ...optional("outcome", (v) => {
            if (!outcomes.includes(v as Outcome)) {
                return fail(`${field}.outcome`, choices(outcomes));
            }
            return ok(v);
        }),
    });
}

function loopCondition(value: unknown, field: string): Read<LoopCondition> {
    const condition = record(value, field);
    if (!condition.ok) return condition;
    const label = string(condition.value.label, `${field}.label`, true);
    if (!label.ok) return label;
    if (!isCheckpointLabel(label.value)) {
        return fail(`${field}.label`, "a checkpoint label");
    }
    const phase = phaseId(condition.value.phase, `${field}.phase`);
    if (!phase.ok) return phase;
    const note = string(condition.value.note, `${field}.note`);
    if (!note.ok) return note;
    return ok({ phase: phase.value, label: label.value, note: note.value });
}

/** Each loop block member's reader; a member is valid or invalid on its own. */
const loopMemberReaders: {
    [K in keyof LoopBlock]-?: (loop: UnknownRecord) => Read<LoopBlock[K]>;
} = {
    scope: (loop) => string(loop.scope, "loop.scope", true),
    phases: (loop) => {
        if (!Array.isArray(loop.phases)) {
            return fail("loop.phases", "an array of phase ids");
        }
        const phases: PhaseId[] = [];
        for (const [index, entry] of loop.phases.entries()) {
            const id = phaseId(entry, `loop.phases[${index}]`);
            if (!id.ok) return id;
            phases.push(id.value);
        }
        if (new Set(phases).size !== phases.length) {
            return fail("loop.phases", "a de-duplicated array of phase ids");
        }
        return ok(phases);
    },
    cycle: (loop) => {
        const cycle = loop.cycle;
        if (!loopCycles.includes(cycle as LoopCycle)) {
            return fail("loop.cycle", choices(loopCycles));
        }
        return ok(cycle as LoopCycle);
    },
    phase: (loop) => phaseId(loop.phase, "loop.phase"),
    conditions: (loop) => {
        if (!Array.isArray(loop.conditions)) {
            return fail("loop.conditions", "an array");
        }
        const conditions: LoopCondition[] = [];
        for (const [index, entry] of loop.conditions.entries()) {
            const condition = loopCondition(entry, `loop.conditions[${index}]`);
            if (!condition.ok) return condition;
            conditions.push(condition.value);
        }
        return ok(conditions);
    },
    stoppedReason: (loop) =>
        nullableString(loop.stoppedReason, "loop.stoppedReason"),
};

const loopMemberKeys = Object.keys(loopMemberReaders) as (keyof LoopBlock)[];

/** The loop block is valid or invalid as a whole; the first invalid member is its error. */
function loopBlock(value: unknown): Read<LoopBlock> {
    const loop = record(value, "loop");
    if (!loop.ok) return loop;
    const block: Partial<LoopBlock> = {};
    for (const key of loopMemberKeys) {
        const member = loopMemberReaders[key](loop.value);
        if (!member.ok) return member;
        Object.assign(block, { [key]: member.value });
    }
    return ok(block as LoopBlock);
}

/** The valid members of an invalid loop block, each read on its own; valid conditions survive an invalid one. */
function loopMembers(value: unknown): Partial<LoopBlock> {
    if (!isRecord(value)) return {};
    const ignored: FieldError[] = [];
    const members: Partial<LoopBlock> = {};
    for (const key of loopMemberKeys) {
        if (key === "conditions") continue;
        const member = loopMemberReaders[key](value);
        if (member.ok) Object.assign(members, { [key]: member.value });
    }
    const conditions = entries(
        value.conditions,
        "loop.conditions",
        ignored,
        (entry, field) => loopCondition(entry, field),
    );
    if (conditions !== undefined) members.conditions = conditions;
    return members;
}

function read(raw: unknown): { values: Partial<State>; errors: FieldError[] } {
    const errors: FieldError[] = [];
    if (!isRecord(raw)) {
        return { values: {}, errors: [fail("state", "an object").error] };
    }
    const input = raw;
    const values: Partial<State> = {};
    const set = <K extends keyof State>(key: K, result: Read<State[K]>) => {
        const value = collect(errors, result);
        if (value !== undefined) values[key] = value;
    };

    set(
        "feature",
        (() => {
            const feature = string(input.feature, "feature", true);
            if (!feature.ok) return feature;
            return isKebab(feature.value)
                ? feature
                : fail("feature", "a valid feature name");
        })(),
    );
    set(
        "currentStep",
        (() => {
            const step = string(input.currentStep, "currentStep");
            if (!step.ok) return step;
            return currentSteps.has(step.value as CurrentStep)
                ? ok(step.value as CurrentStep)
                : fail("currentStep", "a workflow step or checkpoint");
        })(),
    );
    for (const key of ["blockers", "decisions"] as const) {
        const list = entries(input[key], key, errors, (entry, field) =>
            string(entry, field),
        );
        if (list !== undefined) values[key] = list;
    }
    const history = entries(input.history, "history", errors, (entry, field) =>
        historyEntry(entry, field, errors),
    );
    if (history !== undefined) values.history = history;

    if (input.planPhase !== undefined) {
        set(
            "planPhase",
            input.planPhase === null
                ? ok(null)
                : phaseId(input.planPhase, "planPhase"),
        );
    }
    if (input.phaseBaseSha !== undefined) {
        set(
            "phaseBaseSha",
            (() => {
                const sha = nullableString(input.phaseBaseSha, "phaseBaseSha");
                if (!sha.ok) return sha;
                if (
                    sha.value !== null &&
                    sha.value !== "root" &&
                    !shaPattern.test(sha.value)
                ) {
                    return fail(
                        "phaseBaseSha",
                        'a commit SHA, "root", or null',
                    );
                }
                return sha;
            })(),
        );
    }
    if (input.commitMode !== undefined) {
        set(
            "commitMode",
            commitModes.includes(input.commitMode as CommitMode)
                ? ok(input.commitMode as CommitMode)
                : fail("commitMode", choices(commitModes)),
        );
    }
    if (input.loop !== undefined) set("loop", loopBlock(input.loop));
    if (input.completed !== undefined) {
        // Stored only when true; a stored `false` reads as absent.
        const completed =
            typeof input.completed === "boolean"
                ? ok(input.completed)
                : fail("completed", "a boolean");
        if (collect(errors, completed) === true) values.completed = true;
    }

    return { values, errors };
}

/** Reads a parsed `state.json`, keeping every valid value; nothing throws on an invalid field. */
export function readState(raw: unknown): StateRead {
    const { values, errors } = read(raw);
    const invalid = errors.map((error) => error.field);
    const loop = isRecord(raw) ? raw.loop : undefined;
    return loop !== undefined && values.loop === undefined
        ? { values, invalid, loopMembers: loopMembers(loop) }
        : { values, invalid };
}

/** Validates a complete state strictly; absent optional fields stay absent. */
export function validateState(raw: unknown): State {
    const { values, errors } = read(raw);
    const [first] = errors;
    if (first !== undefined) {
        throw new StateInvalidError({
            code: "state-invalid",
            message: first.message,
            file: stateFileName,
        });
    }
    // With no errors, every required field is present.
    return values as State;
}

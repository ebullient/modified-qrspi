import { InternalError, StateInvalidError } from "../errors.ts";
import type { StateFileSystem } from "../ports.ts";
import type { LoopBlock, State } from "../types.ts";
import { readState, validateState } from "./schema.ts";

const keyOrder = [
    "feature",
    "currentStep",
    "blockers",
    "decisions",
    "history",
    "planPhase",
    "phaseBaseSha",
    "commitMode",
    "loop",
    "completed",
] as const;

/** What reading `state.json` found: no file, a file that is not JSON, or its valid values and invalid field paths. */
export type StateLoad =
    | { kind: "missing" }
    | { kind: "unparseable"; reason: string }
    | {
          kind: "parsed";
          values: Partial<State>;
          invalid: string[];
          loopMembers?: Partial<LoopBlock>;
      };

export interface SaveResult {
    state: State;
    wrote: boolean;
}

export interface SaveOptions {
    dryRun?: boolean;
}

export class Store {
    private readonly feature: string;
    private readonly path: string;
    private readonly fileSystem: StateFileSystem;

    constructor(options: {
        feature: string;
        path: string;
        fileSystem: StateFileSystem;
    }) {
        this.feature = options.feature;
        this.path = options.path;
        this.fileSystem = options.fileSystem;
    }

    load(): StateLoad {
        let contents: string | null;
        try {
            contents = this.fileSystem.read(this.path);
        } catch (error) {
            throw new InternalError(`Could not read ${this.path}`, {
                cause: error,
            });
        }
        if (contents === null) return { kind: "missing" };

        let raw: unknown;
        try {
            raw = JSON.parse(contents);
        } catch (error) {
            return {
                kind: "unparseable",
                reason: `${this.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        const read = readState(raw);
        if (
            read.values.feature !== undefined &&
            read.values.feature !== this.feature
        ) {
            delete read.values.feature;
            read.invalid.push("feature");
        }
        return { kind: "parsed", ...read };
    }

    save(state: State, options: SaveOptions = {}): SaveResult {
        const validated = validateState(state);
        this.assertFeature(validated);
        if (options.dryRun) return { state: validated, wrote: false };

        const contents = `${JSON.stringify(this.orderKeys(validated), null, 2)}\n`;

        let tempPath: string;
        try {
            tempPath = this.fileSystem.writeTemp(this.path, contents);
        } catch (error) {
            throw new InternalError(
                `Could not write a temporary state file for ${this.path}`,
                {
                    cause: error,
                },
            );
        }

        try {
            this.fileSystem.rename(tempPath, this.path);
        } catch (renameError) {
            try {
                this.fileSystem.remove(tempPath);
            } catch (cleanupError) {
                throw new InternalError(
                    `Could not replace ${this.path}; cleanup of ${tempPath} also failed`,
                    { cause: cleanupError },
                );
            }
            throw new InternalError(`Could not replace ${this.path}`, {
                cause: renameError,
            });
        }

        return { state: validated, wrote: true };
    }

    private assertFeature(state: State): void {
        if (state.feature !== this.feature) {
            throw new StateInvalidError({
                code: "state-invalid",
                message: `${this.path} feature must be ${this.feature}, received ${state.feature}`,
                file: this.path,
            });
        }
    }

    /** Writes only schema fields, in schema order. */
    private orderKeys(state: State): Record<string, unknown> {
        const ordered: Record<string, unknown> = {};
        for (const key of keyOrder) {
            const value = state[key];
            if (value !== undefined) ordered[key] = value;
        }
        return ordered;
    }
}

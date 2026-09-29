import type { Workspace } from "../../workspace/Workspace.ts";
import { UsageError } from "../errors.ts";
import type { Clock, GitRunner } from "../ports.ts";
import type { Store } from "../store/Store.ts";

/** Injected dependencies; commands never build these themselves. */
export interface CommandServices {
    store: Store;
    workspace: Workspace;
    git: GitRunner;
    clock: Clock;
}

/** The feature a command works on; `Store` knows where its state lives. */
export interface CommandContext {
    feature: string;
}

/** Options shared by every writing transition. */
export interface TransitionOptions {
    dryRun?: boolean;
}

/** Options every `record <step>` accepts. */
export interface RecordOptions extends TransitionOptions {
    reason?: string;
}

/** Throws a usage error for a blank explanatory value. */
export function requireText(value: string, flag: string): void {
    if (value.trim() === "") {
        throw new UsageError(`${flag} requires a non-empty value`);
    }
}

/** Services and context every command reads from. */
export interface CommandInputs {
    services: CommandServices;
    context: CommandContext;
}

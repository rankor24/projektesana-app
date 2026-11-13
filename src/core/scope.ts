// Which agent tool call is running (task 8.7). The tools server runs each call inside a scope, so everything the call writes
// through the store — a log entry, a checkpoint — carries the run and the tool without any tool having to say so.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ToolScope {
	/** the agent run (the name of its run folder); null when the server was started without one */
	run: string | null;
	tool: string;
}

const als = new AsyncLocalStorage<ToolScope>();

export const inToolScope = <T>(scope: ToolScope, fn: () => T): T => als.run(scope, fn);
export const currentScope = (): ToolScope | undefined => als.getStore();

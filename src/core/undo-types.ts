// The shape of one change an agent run made, for the run card (task 8.7). Types only, no node imports: the renderer imports it
// through shared/api.ts. The computing is in undo.ts.
export interface UndoRow {
	/** "log:<seq>" for a collection write, "cp:<id>" for a file */
	key: string;
	kind: "collection" | "file";
	label: string;
	at: string;
	tool: string | null;
	undone: boolean;
	undoable: boolean;
	/** why it cannot be undone (when it cannot and is not already undone) */
	why?: string;
}

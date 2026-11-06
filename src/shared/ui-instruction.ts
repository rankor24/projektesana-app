// What an agent tool asks the window to do (open a panel, show a source, highlight model elements). The tools server is its
// own process; its tool result carries the instruction and the chat dock carries it out.

export const PANEL_NAMES = ["projekts", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas"] as const;

export interface UiInstruction {
	open_panel?: { name: (typeof PANEL_NAMES)[number]; filter?: string };
	highlight?: { guids: string[]; note?: string };
	show_source?: { sourceId: string; page?: number };
}

/** The tool result: a short text for the model plus the instruction. */
export const uiResult = (text: string, ui: UiInstruction) => JSON.stringify({ ok: true, note: text, __ui: ui });

export function readUi(output: string | undefined): UiInstruction | null {
	if (!output || !output.includes("__ui")) return null;
	try {
		return (JSON.parse(output) as { __ui?: UiInstruction }).__ui ?? null;
	} catch {
		return null;
	}
}

// The OS windows a popped-out layout window lives in (task 9.11). Electron-free: the window is made by an injected factory, so
// the tests give it a fake and main gives it a BrowserWindow. One OS window per layout window; closing it (by the user, or by
// popIn) tells main, which tells the main window to dock the layout window back where it was.
import { isWindowId } from "../shared/layout.js";

export interface PopHandle {
	focus(): void;
	close(): void;
	send(channel: string, payload: unknown): void;
	/** called once, when the OS window is gone (closed by the user or by close()) */
	onClosed(cb: () => void): void;
}
export type PopFactory = (id: string) => PopHandle;

export class PopoutManager {
	private open = new Map<string, PopHandle>();

	/** `closed` is told about each window that goes away, by whoever closed it */
	constructor(
		private factory: PopFactory,
		private closed: (id: string) => void = () => {},
	) {}

	/** Opens the OS window of a layout window, or brings the one that is open to the front. */
	popOut(id: string): "opened" | "focused" {
		if (!isWindowId(id)) throw new Error(`Nezināms logs: ${id}`);
		const have = this.open.get(id);
		if (have) {
			have.focus();
			return "focused";
		}
		const h = this.factory(id);
		this.open.set(id, h);
		h.onClosed(() => {
			// closed by the user or by popIn: forget it once, and say so once
			if (this.open.get(id) !== h) return;
			this.open.delete(id);
			this.closed(id);
		});
		return "opened";
	}

	/** Closes the OS window (it was docked back from the main window). Its close is reported like any other. */
	popIn(id: string): boolean {
		const h = this.open.get(id);
		if (!h) return false;
		h.close();
		return true;
	}

	has = (id: string): boolean => this.open.has(id);
	list = (): string[] => [...this.open.keys()];

	/** Sends an event to every pop-out window (the main window gets it from main's own emit). */
	broadcast(channel: string, payload: unknown): void {
		for (const h of this.open.values()) h.send(channel, payload);
	}

	closeAll(): void {
		for (const id of this.list()) this.popIn(id);
	}
}

// A watchdog for a model turn that shows no sign of life: a stalled connection, a call the provider never answers, a quota backoff retried silently. Without one a run stays
// "working" for ever (the chat cannot tell a long thought from a dead call, and a message he writes meanwhile waits behind it). Signs of life: any event of the engine, and a tool that
// is running (a Revit batch, a question waiting for his click) keeps the run alive however long it takes. Used by the pi and the Claude engines (the Antigravity engine has its own in
// antigravity/run.ts, which also owns the cancel handshake of its server).

/** Silence after which a model turn counts as stuck: a model that thinks without streaming is quiet for a minute or two, ten minutes of nothing is not thinking. */
export const STALL_MS = 5 * 60_000;

/** What the chat says when a stuck step is stopped and repeated. */
export const STALL_NOTE = "[lietotne] Modelis ilgi neatbildēja: solis pārtraukts un tiek atkārtots.\n\n";

/** What the model is asked after a stuck step of a session that holds the whole task (the Claude engine): the same task, the same tools. */
export const STALL_RESUME = "Pēdējais solis ilgi nedeva atbildi un tika pārtraukts. Turpini darbu no vietas, kur apstājies: tas pats uzdevums, tie paši rīki.";

/** The error when the repeated step is silent again too. */
export const stallError = (ms: number) => `Modelis ilgi (vairāk nekā ${Math.max(1, Math.round(ms / 60_000))} min) neko nedarīja, arī pēc atkārtošanas. Spied «Sūtīt» vēlreiz vai izvēlies citu modeli.`;

export class StallWatch {
	private lastAt = Date.now();
	private going = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	/** true from the moment the silence was noticed until `reset` */
	stalled = false;

	constructor(
		private readonly ms: number,
		private readonly onStall: () => void,
	) {}

	/** Starts watching (again). */
	start(): void {
		this.stop();
		this.lastAt = Date.now();
		this.stalled = false;
		this.timer = setInterval(() => {
			if (this.going === 0 && !this.stalled && Date.now() - this.lastAt > this.ms) {
				this.stalled = true;
				this.onStall();
			}
		}, Math.max(20, Math.min(5_000, Math.floor(this.ms / 4))));
		this.timer.unref?.();
	}

	/** Something happened: the run is alive. */
	alive(): void {
		this.lastAt = Date.now();
	}

	/** A tool call started (+1) or ended (-1). */
	tool(delta: 1 | -1): void {
		this.going = Math.max(0, this.going + delta);
		this.alive();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}

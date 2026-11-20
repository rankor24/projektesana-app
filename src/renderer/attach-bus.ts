// A way for the rest of the window to hand files to the chat's attachment strip (the screen grab of the comment tools sends its
// picture this way): the chat listens, reads each File as a pasted or dropped one (attach.ts) and puts it above the input.
const subs = new Set<(files: File[]) => void>();

export const attachBus = {
	send(files: File[]) {
		for (const s of subs) s(files);
	},
	/** the chat subscribes; returns the way to stop */
	on(fn: (files: File[]) => void): () => void {
		subs.add(fn);
		return () => subs.delete(fn);
	},
};

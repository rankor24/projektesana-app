// App-level list of projects (roots only). Forgetting a project never touches its folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class Registry {
	constructor(private file: string) {}
	list(): string[] {
		if (!existsSync(this.file)) return [];
		try {
			return JSON.parse(readFileSync(this.file, "utf8")) as string[];
		} catch {
			return [];
		}
	}
	private save(l: string[]) {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(l, null, 2), "utf8");
	}
	add(root: string) {
		const r = resolve(root);
		const l = this.list();
		if (!l.includes(r)) this.save([...l, r]);
	}
	forget(root: string) {
		const r = resolve(root);
		this.save(this.list().filter((x) => x !== r));
	}
}

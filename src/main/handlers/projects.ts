// Projects and sources: registry, scan with progress, role confirmation for free folders, source text and bytes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { checkRead } from "../../core/guard.js";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { EventName, EventSpec, Handlers, ProjectRow, ScanSummaryRow } from "../../shared/api.js";
import { scanProject, type PipelineHooks } from "../../sources/pipeline.js";
import { FREE_ROLES } from "../../sources/roles.js";

export interface ProjectDeps {
	registry: Registry;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	openPath(p: string): Promise<string>;
	hooks: () => PipelineHooks;
	/** runs after a scan or a role change (checks subscribe in phase 2) */
	afterChange?: (store: ProjectStore, what: string) => void | Promise<void>;
}

type K = "projects.list" | "projects.add" | "projects.forget" | "projects.scan" | "projects.scanSummary" | "projects.roleQuestions" | "projects.confirmRole" | "sources.list" | "sources.text" | "sources.bytes" | "sources.openOriginal";

/** Bytes of a source's latest file: a loose file through the guard, a file inside a container from its zip. */
export function sourceBytes(store: ProjectStore, sourceId: string): Uint8Array {
	const s = store.read("sources").find((x) => x.id === sourceId);
	if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const loose = s.paths.find((p) => !p.includes("::"));
	if (loose) {
		const g = checkRead(store.guard, loose);
		if (!g.ok) throw new Error(g.reason);
		return new Uint8Array(readFileSync(g.path));
	}
	const ref = s.container ? { path: s.container.path, inner: s.container.inner } : s.paths[0] ? { path: s.paths[0].split("::")[0], inner: s.paths[0].split("::")[1] } : null;
	if (!ref) throw new Error("Avotam vairs nav faila mapē.");
	const g = checkRead(store.guard, ref.path);
	if (!g.ok) throw new Error(g.reason);
	const inner = unzipSync(new Uint8Array(readFileSync(g.path)), { filter: (f) => f.name === ref.inner })[ref.inner];
	if (!inner) throw new Error(`Konteinerā nav ${ref.inner}`);
	return inner;
}

export function projectHandlers(d: ProjectDeps): Pick<Handlers, K> {
	const scanning = new Set<string>();
	const row = (id: string): ProjectRow => {
		const p = d.registry.get(id);
		const store = d.registry.store(id);
		const openFindings = store.read("findings").filter((f) => f.state === "open").length;
		const deliveries = store.read("deliveries");
		const lastSent = deliveries.filter((x) => x.submittedDate).sort((a, b) => (a.submittedDate! < b.submittedDate! ? 1 : -1))[0];
		return { ...p, missing: !existsSync(p.root), stage: lastSent?.stage ?? null, openFindings };
	};
	return {
		"projects.list": () => d.registry.list().map((p) => row(p.id)),
		"projects.add": (root) => {
			const p = d.registry.add(root);
			d.emit("data.changed", { projectId: p.id, what: ["projects"] });
			return row(p.id);
		},
		"projects.forget": (id) => {
			d.registry.forget(id);
			d.emit("data.changed", { projectId: id, what: ["projects"] });
		},
		"projects.scan": (id) => {
			if (scanning.has(id)) throw new Error("Šis projekts jau tiek nolasīts.");
			const store = d.registry.store(id);
			if (!existsSync(store.project.root)) throw new Error(`Projekta mape nav pieejama: ${store.project.root}`);
			scanning.add(id);
			void scanProject(store, (p) => d.emit("scan.progress", { projectId: id, ...p }), d.hooks())
				.then(async () => {
					await d.afterChange?.(store, "sources");
				})
				.catch((e: Error) => d.emit("scan.progress", { projectId: id, phase: "error", done: 0, total: 0, message: e.message }))
				.finally(() => {
					scanning.delete(id);
					d.emit("data.changed", { projectId: id, what: ["sources", "projects"] });
				});
		},
		"projects.scanSummary": (id) => d.registry.store(id).readMeta<ScanSummaryRow | null>("scan", null),
		"projects.roleQuestions": (id) => {
			const s = d.registry.store(id).readMeta<ScanSummaryRow | null>("scan", null);
			return (s?.folders ?? []).filter((f) => f.roleFrom === "unconfirmed").map((f) => ({ folderKey: f.folderKey, folderName: f.name, proposed: f.role, files: f.files, options: FREE_ROLES }));
		},
		"projects.confirmRole": async (id, folderKey, role) => {
			if (!(FREE_ROLES as readonly string[]).includes(role)) throw new Error(`Nezināma loma: ${role}`);
			const store = d.registry.store(id);
			const roles = store.readMeta<Record<string, string>>("roles", {});
			store.writeMeta("roles", { ...roles, [folderKey]: role }, { kind: "role.confirmed", by: "boris", data: { folderKey, role } });
			store.update("sources", (all) => all.map((s) => (s.folderKey === folderKey ? { ...s, role, roleFrom: "confirmed" as const } : s)), { kind: "sources.role", by: "boris", data: { folderKey, role } });
			const summary = store.readMeta<ScanSummaryRow | null>("scan", null);
			if (summary) store.writeMeta("scan", { ...summary, folders: summary.folders.map((f) => (f.folderKey === folderKey ? { ...f, role, roleFrom: "confirmed" } : f)) });
			await d.afterChange?.(store, "roles");
			d.emit("data.changed", { projectId: id, what: ["sources"] });
		},
		"sources.list": (id) => d.registry.store(id).read("sources"),
		"sources.text": (id, sourceId) => {
			const store = d.registry.store(id);
			const s = store.read("sources").find((x) => x.id === sourceId);
			const v = s?.versions[s.versions.length - 1];
			return v?.sha256 ? store.readText(v.sha256) : null;
		},
		"sources.bytes": (id, sourceId) => sourceBytes(d.registry.store(id), sourceId),
		"sources.openOriginal": async (id, sourceId) => {
			const store = d.registry.store(id);
			const s = store.read("sources").find((x) => x.id === sourceId);
			if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
			const rel = s.paths.find((p) => !p.includes("::")) ?? s.container?.path ?? s.paths[0]?.split("::")[0];
			if (!rel) throw new Error("Avotam vairs nav faila mapē.");
			const g = checkRead(store.guard, rel);
			if (!g.ok) throw new Error(g.reason);
			const err = await d.openPath(join(g.path));
			if (err) throw new Error(err);
		},
	};
}

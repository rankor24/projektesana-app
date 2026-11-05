// The project folder contract (spec §8): <root>/.bv/{project.json, brief.json, log.jsonl, revisions/, files.json}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLog } from "./log.js";

export interface ProjectMeta {
	id: string;
	name: string;
	createdAt: string;
	/** contract version of .bv so other family apps can check compatibility */
	bvVersion: 1;
}

export const bvDir = (root: string) => join(root, ".bv");

export function createProject(root: string, name: string, now = new Date()): ProjectMeta {
	if (!name.trim()) throw new Error("Projekta nosaukums ir tukšs.");
	if (existsSync(join(bvDir(root), "project.json"))) throw new Error("Šajā mapē projekts jau ir.");
	mkdirSync(join(bvDir(root), "revisions"), { recursive: true });
	const meta: ProjectMeta = { id: `p${now.getTime().toString(36)}`, name: name.trim(), createdAt: now.toISOString(), bvVersion: 1 };
	writeFileSync(join(bvDir(root), "project.json"), JSON.stringify(meta, null, 2), "utf8");
	writeFileSync(join(bvDir(root), "files.json"), JSON.stringify({ files: [] }, null, 2), "utf8");
	appendLog(root, { kind: "project.created", by: "app", data: { name: meta.name } }, now);
	return meta;
}

export function loadProject(root: string): ProjectMeta | null {
	const p = join(bvDir(root), "project.json");
	if (!existsSync(p)) return null;
	return JSON.parse(readFileSync(p, "utf8")) as ProjectMeta;
}

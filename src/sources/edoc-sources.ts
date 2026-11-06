// Containers into Sources: each file inside an .edoc becomes a Source with `container`, the container gets its signers.
// A file inside the container with the same bytes as a loose file is the same document: the loose Source gains the
// container path (`<edoc>::<inner>`) instead of a second Source. A container already read (same sha) is not opened again.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Source } from "../core/model.js";
import { CONTAINER_EXT, readEdoc } from "./text/edoc.js";

const latest = (s: Source) => s.versions[s.versions.length - 1];
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function expandContainers(sources: Source[], root: string): Promise<Source[]> {
	const out = [...sources];
	for (const c of sources) {
		if (c.kind !== "document" || c.container || !c.paths.length || !CONTAINER_EXT.has(extname(c.paths[0]).toLowerCase())) continue;
		const v = latest(c);
		if (!v?.sha256) continue;
		const already = out.some((s) => s.container?.containerSha === v.sha256);
		if (already) continue;
		let ed;
		try {
			ed = readEdoc(new Uint8Array(await readFile(join(root, c.paths[0]))));
		} catch (e) {
			v.textState = "error";
			v.textReason = `Konteineru nevar atvērt: ${(e as Error).message}`;
			continue;
		}
		const ci = out.indexOf(c);
		out[ci] = { ...c, signers: ed.signers.map((s) => ({ name: s.name, at: s.at, file: s.file })) };
		// inner sources of an older version of this container are replaced
		for (let i = out.length - 1; i >= 0; i--) if (out[i].container && out[i].container!.path.toLowerCase() === c.paths[0].toLowerCase()) out.splice(i, 1);
		for (const f of ed.files) {
			const sha = sha256(f.bytes);
			const ref = `${c.paths[0]}::${f.name}`;
			const twin = out.find((s) => s.kind === "document" && !s.container && latest(s)?.sha256 === sha);
			if (twin) {
				if (!twin.paths.includes(ref)) twin.paths = [...twin.paths, ref];
				continue;
			}
			out.push({
				id: `s_${sha.slice(0, 12)}`,
				kind: "document",
				folderKey: c.folderKey,
				paths: [ref],
				title: basename(f.name, extname(f.name)),
				role: c.role,
				roleFrom: c.roleFrom,
				versions: [{ sha256: sha, size: f.bytes.length, mtime: v.mtime, seenAt: v.seenAt, textState: "pending" }],
				signers: [],
				container: { path: c.paths[0], inner: f.name, containerSha: v.sha256 },
			});
		}
	}
	return out;
}

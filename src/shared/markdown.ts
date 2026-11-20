// Markdown as the agent writes it, parsed without a library: headings, paragraphs, bullet and numbered lists, pipe tables,
// horizontal rules, and **bold** / *italic* / `code` inside them. Pure: the Word export (sources/export/docx-md.ts) and the
// chat (renderer/shell/Markdown.tsx) use the same parser, so a table looks like a table in both.

export interface Run {
	text: string;
	b?: boolean;
	i?: boolean;
	code?: boolean;
}

/** **bold**, *italic* (or _italic_), `code`; everything else is text. Unclosed markers stay as written. */
export function inlineRuns(s: string): Run[] {
	const out: Run[] = [];
	const re = /(\*\*([^*]+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w]))/g;
	let last = 0;
	for (let m = re.exec(s); m; m = re.exec(s)) {
		if (m.index > last) out.push({ text: s.slice(last, m.index) });
		if (m[2] !== undefined) out.push(...inlineRuns(m[2]).map((r) => ({ ...r, b: true })));
		else if (m[3] !== undefined) out.push({ text: m[3], code: true });
		else out.push(...inlineRuns(m[4] ?? m[5]).map((r) => ({ ...r, i: true })));
		last = m.index + m[0].length;
	}
	if (last < s.length) out.push({ text: s.slice(last) });
	return out;
}

export type Block =
	| { k: "h"; level: number; text: string }
	| { k: "p"; text: string }
	| { k: "ul"; items: string[] }
	| { k: "ol"; items: string[] }
	| { k: "table"; rows: string[][] }
	| { k: "hr" };

const splitRow = (l: string) =>
	l
		.trim()
		.replace(/^\||\|$/g, "")
		.split(/(?<!\\)\|/)
		.map((c) => c.trim().replace(/\\\|/g, "|"));
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");

export function parseMarkdown(md: string): Block[] {
	const lines = md.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let para: string[] = [];
	const flush = () => {
		if (para.length) blocks.push({ k: "p", text: para.join(" ") });
		para = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!l.trim()) {
			flush();
			continue;
		}
		const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(l);
		if (h) {
			flush();
			blocks.push({ k: "h", level: h[1].length, text: h[2] });
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
			flush();
			blocks.push({ k: "hr" });
			continue;
		}
		if (l.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
			flush();
			const rows = [splitRow(l)];
			i += 2;
			for (; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(splitRow(lines[i]));
			i--;
			blocks.push({ k: "table", rows });
			continue;
		}
		const ul = /^\s*[-*+]\s+(.*)$/.exec(l);
		const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l);
		if (ul || ol) {
			flush();
			const kind = ul ? "ul" : "ol";
			const items: string[] = [];
			for (; i < lines.length; i++) {
				const m = (kind === "ul" ? /^\s*[-*+]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/).exec(lines[i]);
				if (m) items.push(m[1]);
				else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
				else break;
			}
			i--;
			blocks.push({ k: kind, items });
			continue;
		}
		para.push(l.trim().replace(/^>\s?/, ""));
	}
	flush();
	return blocks;
}

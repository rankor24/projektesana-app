// Wraps user-visible Latvian text in renderer files with tr() (src/shared/i18n.ts) and lists what it wrapped.
//   node scripts/i18n-wrap.mjs <file|dir> ... [--list out.json] [--dry]
// Handles: JSX text, string attributes (placeholder, title, aria-label, alt, label), string literals in conditional / && / || branches
// inside JSX expressions and attribute values, and template literals there ({name} placeholders from the ${} parts).
// Does not touch: className and other attributes, strings outside JSX (constants, handlers, thrown errors): those are done by hand.
// Idempotent: text already inside tr() is skipped. Adds `import { tr } from ".../i18n"` when it wrapped something.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const BS = String.fromCharCode(92);
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const li = args.indexOf("--list");
const listOut = li >= 0 ? args[li + 1] : null;
const targets = args.filter((a, i) => !a.startsWith("--") && !(li >= 0 && i === li + 1));
const rendererDir = resolve("src/renderer");
const ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);
const hasLetter = (s) => /\p{L}/u.test(s);

function files(p) {
	const st = statSync(p);
	if (st.isFile()) return /\.tsx$/.test(p) ? [p] : [];
	return readdirSync(p).flatMap((n) => (n === "i18n" ? [] : files(join(p, n))));
}

const listed = {};
for (const file of targets.flatMap(files)) {
	const src = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const edits = [];
	const found = [];
	const q = (s) => JSON.stringify(s);
	const inTr = (n) => {
		for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && p.expression.getText(sf) === "tr") return true;
		return false;
	};
	const wrapLiteral = (n) => {
		if (inTr(n)) return;
		const text = n.text;
		if (!hasLetter(text)) return;
		found.push(text);
		edits.push([n.getStart(sf), n.getEnd(), `tr(${q(text)})`]);
	};
	const wrapTemplate = (n) => {
		if (inTr(n)) return;
		const parts = [n.head.text];
		const vars = [];
		const names = new Set();
		for (const sp of n.templateSpans) {
			let name = sp.expression.getText(sf).match(/([A-Za-z_]\w*)\s*(\)|\?\?.*)?$/)?.[1] ?? "v";
			if (/^(length|name|id|n)$/.test(name) === false && name.length > 14) name = "v";
			let base = name;
			for (let i = 2; names.has(name); i++) name = base + i;
			names.add(name);
			vars.push(`${name}: ${sp.expression.getText(sf)}`);
			parts.push(`{${name}}`, sp.literal.text);
		}
		const key = parts.join("");
		if (!hasLetter(key.replace(/\{\w+\}/g, ""))) return;
		found.push(key);
		edits.push([n.getStart(sf), n.getEnd(), `tr(${q(key)}, { ${vars.join(", ")} })`]);
	};
	const visitExprForStrings = (e) => {
		if (!e) return;
		if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return wrapLiteral(e);
		if (ts.isTemplateExpression(e)) return wrapTemplate(e);
		if (ts.isParenthesizedExpression(e)) return visitExprForStrings(e.expression);
		if (ts.isConditionalExpression(e)) {
			visitExprForStrings(e.whenTrue);
			visitExprForStrings(e.whenFalse);
		} else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
			visitExprForStrings(e.right);
		}
	};
	// a run of JSX children made of text and plain expressions ({a.b}, {f(x)}, {" "}) is ONE sentence: one key with {placeholders},
	// so the English can reorder it. Runs with elements, conditionals or functions in them are left to the per-node rules.
	const plainExpr = (e) => {
		if (!e) return false;
		let ok = !ts.isConditionalExpression(e) && !ts.isBinaryExpression(e) && !ts.isStringLiteral(e) && !ts.isTemplateExpression(e);
		const scan = (x) => {
			if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x) || ts.isArrowFunction(x) || ts.isFunctionExpression(x) || ts.isConditionalExpression(x)) ok = false;
			else ts.forEachChild(x, scan);
		};
		scan(e);
		return ok;
	};
	const placeholderName = (e, used) => {
		let name = e.getText(sf).match(/([A-Za-z_]\w*)\s*(\)|\[\w*\])?$/)?.[1] ?? "v";
		if (name.length > 14 || /^(length|id)$/.test(name)) name = "v";
		const base = name;
		for (let i = 2; used.has(name); i++) name = base + i;
		used.add(name);
		return name;
	};
	const mergeRuns = (n) => {
		const kids = n.children;
		const done = new Set();
		let i = 0;
		while (i < kids.length) {
			const run = [];
			let j = i;
			while (j < kids.length) {
				const k = kids[j];
				const spaceExpr = ts.isJsxExpression(k) && k.expression && ts.isStringLiteral(k.expression) && /^\s*$/.test(k.expression.text);
				if (ts.isJsxText(k) || spaceExpr || (ts.isJsxExpression(k) && plainExpr(k.expression))) {
					run.push(k);
					j++;
				} else break;
			}
			const exprs = run.filter((k) => ts.isJsxExpression(k) && !(k.expression && ts.isStringLiteral(k.expression)));
			const hasText = run.some((k) => ts.isJsxText(k) && hasLetter(k.getText(sf)) && !k.getText(sf).includes("&"));
			if (hasText && exprs.length) {
				const used = new Set();
				const vars = [];
				let key = "";
				for (const k of run) {
					if (ts.isJsxText(k)) key += src.slice(k.pos, k.end).replace(/\s+/g, " ");
					else if (k.expression && ts.isStringLiteral(k.expression)) key += k.expression.text;
					else {
						const name = placeholderName(k.expression, used);
						vars.push(`${name}: ${k.expression.getText(sf)}`);
						key += `{${name}}`;
					}
				}
				const trimmed = key.replace(/\s+/g, " ").trim();
				if (hasLetter(trimmed.replace(/\{\w+\}/g, ""))) {
					const raw = src.slice(run[0].getStart(sf), run[run.length - 1].getEnd());
					const lead = /^\s/.test(raw) && !/^\s*\n/.test(raw) ? " " : "";
					const trail = /\s$/.test(raw) && !/\n\s*$/.test(raw) ? " " : "";
					found.push(trimmed);
					const first = run[0].getStart(sf);
					const last = run[run.length - 1].getEnd();
					edits.push([first, last, `${lead}{tr(${q(trimmed)}, { ${vars.join(", ")} })}${trail}`]);
					run.forEach((k) => done.add(k));
				}
			}
			i = Math.max(j, i + 1);
		}
		return done;
	};
	const visit = (n) => {
		if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
			const done = mergeRuns(n);
			const mark = (x) => {
				if (done.has(x)) return;
				visit(x);
			};
			ts.forEachChild(n, (c) => {
				if (c === n.openingElement || c === n.closingElement || c === n.openingFragment || c === n.closingFragment) return visit(c);
				// the element's children list node
			});
			n.children.forEach(mark);
			return;
		}
		if (ts.isJsxText(n)) {
			const raw = n.getText(sf);
			const t = raw.replace(/\s+/g, " ").trim();
			if (t && hasLetter(t) && !t.includes("&") && !raw.includes("{") ) {
				const lead = /^\s/.test(raw) ? (raw.match(/^\s*\n\s*/) ? "" : " ") : "";
				const trail = /\s$/.test(raw) ? (raw.match(/\s*\n\s*$/) ? "" : " ") : "";
				found.push(t);
				edits.push([n.getStart(sf), n.getEnd(), `${lead}{tr(${q(t)})}${trail}`]);
			}
		} else if (ts.isJsxAttribute(n) && n.initializer) {
			const name = n.name.getText(sf);
			if (ATTRS.has(name)) {
				if (ts.isStringLiteral(n.initializer)) {
					if (hasLetter(n.initializer.text) && !inTr(n)) {
						found.push(n.initializer.text);
						edits.push([n.initializer.getStart(sf), n.initializer.getEnd(), `{tr(${q(n.initializer.text)})}`]);
					}
				} else if (ts.isJsxExpression(n.initializer)) visitExprForStrings(n.initializer.expression);
			}
			return;
		} else if (ts.isJsxExpression(n) && ts.isJsxElement(n.parent) || (ts.isJsxExpression(n) && ts.isJsxFragment(n.parent))) {
			visitExprForStrings(n.expression);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	if (!edits.length) continue;
	let out = src;
	for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
	if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from/.test(out)) {
		let rel = relative(dirname(resolve(file)), join(rendererDir, "i18n")).replaceAll(BS, "/");
		if (!rel.startsWith(".")) rel = "./" + rel;
		const imports = [...sf.statements].filter(ts.isImportDeclaration);
		const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
		const shift = out.length - src.length;
		const pos = at + (edits.filter(([s]) => s < at).length ? 0 : 0);
		// the import goes after the last existing import (edits never touch imports, so the offset in `out` equals `at`)
		out = out.slice(0, pos) + `\nimport { tr } from "${rel}";` + out.slice(pos);
		void shift;
	}
	listed[relative(process.cwd(), file).replaceAll(BS, "/")] = found;
	if (!dry) writeFileSync(file, out, "utf8");
	console.log(`${dry ? "would wrap" : "wrapped"} ${found.length} in ${file}`);
}
if (listOut) writeFileSync(listOut, JSON.stringify(listed, null, 1), "utf8");

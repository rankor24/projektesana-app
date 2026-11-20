// Lists the i18n keys of the renderer: every literal given to tr(), which of them have an English entry, and the Latvian
// string literals that are still outside tr() (the ones to wrap by hand).
//   node scripts/i18n-keys.mjs [--missing] [--loose] [--json out.json]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const walk = (d) =>
	readdirSync(d).flatMap((n) => {
		const p = join(d, n);
		return statSync(p).isDirectory() ? (n === "i18n" ? [] : walk(p)) : /\.tsx?$/.test(p) ? [p] : [];
	});
const dictFiles = readdirSync("src/renderer/i18n/en").map((n) => join("src/renderer/i18n/en", n));
const have = new Set();
for (const f of dictFiles) {
	const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
	const visit = (n) => {
		if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isNoSubstitutionTemplateLiteral(n.name))) have.add(n.name.text);
		ts.forEachChild(n, visit);
	};
	visit(sf);
}
const keys = new Map(); // key -> files
const loose = []; // [file, line, text]
const LV = /[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/;
for (const f of walk("src/renderer")) {
	const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const inTr = (n) => {
		for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && p.expression.getText(sf) === "tr") return p.arguments[0] === n || p.arguments.includes(n);
		return false;
	};
	const visit = (n) => {
		if (ts.isCallExpression(n) && n.expression.getText(sf) === "tr" && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
			const k = n.arguments[0].text;
			keys.set(k, [...(keys.get(k) ?? []), f]);
		} else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && LV.test(n.text) && !inTr(n) && !ts.isImportDeclaration(n.parent) && !ts.isJsxAttribute(n.parent)) {
			loose.push([f, sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, n.text.slice(0, 70)]);
		} else if (ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
			if (LV.test(n.text) && !inTr(n)) loose.push([f, sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, n.text.slice(0, 70)]);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
}
const missing = [...keys.keys()].filter((k) => !have.has(k));
if (process.argv.includes("--missing")) for (const k of missing) console.log(JSON.stringify(k));
else if (process.argv.includes("--lines")) {
	const seen = new Set();
	for (const [f, l] of loose) {
		if (seen.has(f + l)) continue;
		seen.add(f + l);
		const line = readFileSync(f, "utf8").split("\n")[l - 1].trim().slice(0, 190);
		console.log(`${f.split("\\").join("/").replace("src/renderer/", "")}:${l}: ${line}`);
	}
}
else if (process.argv.includes("--loose")) for (const [f, l, t] of loose) console.log(`${f}:${l}: ${t}`);
else console.log(`keys ${keys.size}, translated ${keys.size - missing.length}, missing ${missing.length}, unwrapped Latvian literals ${loose.length}`);
const ji = process.argv.indexOf("--json");
if (ji >= 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ missing, loose }, null, 1), "utf8");

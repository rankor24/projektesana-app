// Wraps the plain string literals on the named lines of renderer files in tr(): the constants and messages outside JSX that i18n-wrap.mjs
// does not reach. Property names, import paths, JSX attribute strings and literals already in tr() are left alone; template literals are
// left to hand edits. Also adds the tr import. Usage: node scripts/i18n-wrap-lines.mjs <spec.json>   spec = { "src/renderer/x.tsx": [41, "166-170"], ... }
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const BS = String.fromCharCode(92);
const SKIP = new Set(["ok", "warn", "bad", "dim", "info", "ifc", "primary", "ghost", "small"]);
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const hasLetter = (s) => /\p{L}/u.test(s);
const lines = (list) => new Set(list.flatMap((x) => (typeof x === "number" ? [x] : (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(x.split("-").map(Number)))));
const wrapped = new Set();
for (const [file, list] of Object.entries(spec)) {
	const src = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const want = lines(list);
	const edits = [];
	const inTr = (n) => {
		for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && p.expression.getText(sf) === "tr") return true;
		return false;
	};
	const visit = (n) => {
		if (ts.isStringLiteral(n) && want.has(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)) {
			const p = n.parent;
			const isName = (ts.isPropertyAssignment(p) && p.name === n) || ts.isImportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isJsxAttribute(p) || (ts.isElementAccessExpression(p) && p.argumentExpression === n) || ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind);
			if (!isName && !inTr(n) && hasLetter(n.text) && !SKIP.has(n.text)) {
				edits.push([n.getStart(sf), n.getEnd(), `tr(${JSON.stringify(n.text)})`]);
				wrapped.add(n.text);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	if (!edits.length) continue;
	let out = src;
	for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
	if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from/.test(out)) {
		const dir = resolve("src/renderer");
		let rel = relative(dirname(resolve(file)), join(dir, "i18n")).split(BS).join("/");
		if (!rel.startsWith(".")) rel = "./" + rel;
		const imports = sf.statements.filter(ts.isImportDeclaration);
		const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
		out = out.slice(0, at) + `\nimport { tr } from "${rel}";` + out.slice(at);
	}
	writeFileSync(file, out, "utf8");
	console.log(`${file}: ${edits.length}`);
}
console.log("wrapped keys:", wrapped.size);

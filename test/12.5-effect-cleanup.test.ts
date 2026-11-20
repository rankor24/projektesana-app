// 12.5 fix: whatever a React effect returns, React keeps as its cleanup and calls on the next run or on unmount. Electron 43's Chromium returns a
// Promise from scrollIntoView, so `useEffect(() => el.scrollIntoView(...), [x])` crashed the window ("l is not a function") when Telpa opened.
// This reads every effect in the renderer and allows only returns that are a cleanup: nothing, a function, a variable that holds one
// (`const off = on(...); return off;`), or `on(...)` from the bridge.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = join(import.meta.dirname, "..");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
	});
}

const isFn = (e: ts.Node) => ts.isArrowFunction(e) || ts.isFunctionExpression(e);

/** A return value that is a cleanup or nothing. */
function okReturn(e: ts.Expression): boolean {
	if (isFn(e) || ts.isIdentifier(e)) return true;
	if (ts.isParenthesizedExpression(e)) return okReturn(e.expression);
	return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "on";
}

/** "file:line  text" for each effect return that is not a cleanup. */
export function badEffectReturns(file: string): string[] {
	const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const out: string[] = [];
	const report = (e: ts.Node) => out.push(`${relative(root, file)}:${sf.getLineAndCharacterOfPosition(e.getStart()).line + 1}  ${e.getText().slice(0, 80)}`);
	const visit = (n: ts.Node): void => {
		if (ts.isCallExpression(n) && /(^|\.)use(Layout|Insertion)?Effect$/.test(n.expression.getText())) {
			const fn = n.arguments[0];
			if (fn && isFn(fn)) {
				const body = (fn as ts.ArrowFunction | ts.FunctionExpression).body;
				if (!ts.isBlock(body)) {
					if (!okReturn(body)) report(body);
				} else {
					const walk = (m: ts.Node): void => {
						if (m !== body && (isFn(m) || ts.isFunctionDeclaration(m))) return; // a nested function's return is its own
						if (ts.isReturnStatement(m) && m.expression && !okReturn(m.expression)) report(m.expression);
						ts.forEachChild(m, walk);
					};
					walk(body);
				}
			} else if (fn) {
				// a named or async function: its return value cannot be seen here, so it is not allowed
				report(fn);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

test("12.5 fix: no renderer effect returns anything but a cleanup (scrollIntoView's Promise crashed Telpa)", () => {
	const bad = files(join(root, "src", "renderer")).flatMap(badEffectReturns);
	assert.deepEqual(bad, []);
});

test("12.5 fix: the check catches the shape that crashed", () => {
	const sf = join(root, "test", "fixtures", "effect-cleanup.tsx");
	assert.deepEqual(
		badEffectReturns(sf).map((l) => l.replace(/^.*?:(\d+)\s+/, "$1 ")),
		["4 endRef.current?.scrollIntoView?.({ block: \"end\" })", "6 setRow(null)", "10 load"],
	);
});

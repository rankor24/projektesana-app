// A small spreadsheet formula evaluator for the .xlsx writer (xlsx.ts): the cached value written beside each formula, and the check the agent's
// write_spreadsheet tool reports ("B12 = 18 450.30"), so a total can not be wrong without anyone seeing it. Excel recalculates everything on opening
// (the workbook says fullCalcOnLoad), so this is a check and a cache, not the authority.
// Supported: numbers, "text", cell refs (A1, $A$1, Sheet2!A1, 'My sheet'!A1), ranges (A1:B5), + - * / ^ & % comparison operators, parentheses, and
// SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT ROUND ROUNDUP ROUNDDOWN INT ABS SQRT POWER MOD IF AND OR NOT SUMPRODUCT IFERROR.
// Anything else is reported as unsupported (no cached value; Excel still computes it on opening).
export type FormulaCell = { f: string };
export type AnyCell = string | number | null | FormulaCell;
export interface Sheet {
	name: string;
	rows: AnyCell[][];
}
export type Value = number | string | boolean | null;

const isFormula = (c: AnyCell): c is FormulaCell => typeof c === "object" && c !== null && "f" in c;

export const colIndex = (s: string): number => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

class Err extends Error {}

type Tok = { t: "num" | "str" | "ref" | "range" | "fn" | "op" | "(" | ")" | "," ; v: string };

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const ref = /^(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/u;
	while (i < src.length) {
		const ch = src[i]!;
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			let s = "";
			while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) {
				if (src[j] === '"') j++;
				s += src[j++];
			}
			if (j >= src.length) throw new Err("unclosed text");
			out.push({ t: "str", v: s });
			i = j + 1;
			continue;
		}
		const rest = src.slice(i);
		const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
		const m = ref.exec(rest);
		// a name followed by "(" is a function, not a cell (LOG10(...) must not read as the cell LOG10)
		const fn = /^([A-Za-z_][A-Za-z0-9_.]*)\(/.exec(rest);
		if (fn) {
			out.push({ t: "fn", v: fn[1]!.toUpperCase() });
			out.push({ t: "(", v: "(" });
			i += fn[0].length;
			continue;
		}
		if (m && !/^[A-Za-z0-9_]/.test(rest.slice(m[0].length))) {
			out.push({ t: m[5] ? "range" : "ref", v: m[0] });
			i += m[0].length;
			continue;
		}
		if (num) {
			out.push({ t: "num", v: num[0] });
			i += num[0].length;
			continue;
		}
		const two = src.slice(i, i + 2);
		if (["<=", ">=", "<>"].includes(two)) {
			out.push({ t: "op", v: two });
			i += 2;
			continue;
		}
		if ("+-*/^&%=<>".includes(ch)) out.push({ t: "op", v: ch });
		else if (ch === "(") out.push({ t: "(", v: ch });
		else if (ch === ")") out.push({ t: ")", v: ch });
		else if (ch === "," || ch === ";") out.push({ t: ",", v: "," });
		else throw new Err(`unexpected "${ch}"`);
		i++;
	}
	return out;
}

/** Evaluates every formula of the workbook. `values` holds the value of every cell by "Sheet!A1"; `errors` the formulas that could not be computed. */
export function evaluateWorkbook(sheets: Sheet[]): { values: Map<string, Value>; errors: { cell: string; reason: string }[]; formulas: number } {
	const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s]));
	const values = new Map<string, Value>();
	const errors: { cell: string; reason: string }[] = [];
	const busy = new Set<string>();
	let formulas = 0;
	const addr = (c: number, r: number) => {
		let s = "";
		for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
		return `${s}${r + 1}`;
	};

	const cellValue = (sheet: Sheet, c: number, r: number): Value => {
		const key = `${sheet.name}!${addr(c, r)}`;
		if (values.has(key)) return values.get(key)!;
		const raw = sheet.rows[r]?.[c] ?? null;
		if (!isFormula(raw)) {
			const v = raw === "" ? null : (raw as Value);
			values.set(key, v);
			return v;
		}
		if (busy.has(key)) throw new Err("circular reference");
		busy.add(key);
		try {
			formulas++;
			let v = run(raw.f.replace(/^=/, ""), sheet);
			// Excel keeps 15 significant digits: 12.5 * 18.4 is 230, not 229.99999999999997
			if (typeof v === "number" && Number.isFinite(v)) v = Number(v.toPrecision(15));
			values.set(key, v);
			return v;
		} catch (e) {
			const reason = e instanceof Err ? e.message : String(e);
			errors.push({ cell: key, reason });
			values.set(key, `#ERR ${reason}`);
			throw new Err(reason);
		} finally {
			busy.delete(key);
		}
	};

	const num = (v: Value): number => {
		if (v === null || v === "") return 0;
		if (typeof v === "boolean") return v ? 1 : 0;
		if (typeof v === "number") return v;
		const n = Number(String(v).replace(",", "."));
		if (!Number.isFinite(n)) throw new Err(`not a number: ${String(v).slice(0, 20)}`);
		return n;
	};
	const flat = (args: (Value | Value[])[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
	const nums = (args: (Value | Value[])[]): number[] => {
		// in a range only numbers count (text and blanks are skipped, as in Excel); a direct argument must read as a number
		const out: number[] = [];
		for (const a of args) {
			if (Array.isArray(a)) a.forEach((v) => typeof v === "number" && out.push(v));
			else out.push(num(a));
		}
		return out;
	};
	const round = (x: number, d: number, how: "r" | "u" | "d") => {
		const k = 10 ** d;
		const y = x * k;
		const r = how === "r" ? Math.sign(y) * Math.round(Math.abs(y) + 1e-9) : how === "u" ? Math.sign(y) * Math.ceil(Math.abs(y) - 1e-9) : Math.sign(y) * Math.floor(Math.abs(y) + 1e-9);
		return r / k;
	};

	function run(src: string, sheet: Sheet): Value {
		const toks = tokenize(src);
		let p = 0;
		const peek = () => toks[p];
		const take = () => toks[p++];
		const resolveSheet = (m: string): Sheet => {
			const name = /^(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!/u.exec(m);
			if (!name) return sheet;
			const n = (name[1] ?? name[2]!).replace(/''/g, "'").toLowerCase();
			const s = byName.get(n);
			if (!s) throw new Err(`no sheet ${n}`);
			return s;
		};
		const parseRef = (t: Tok): Value | Value[] => {
			const m = /(\$?[A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(t.v)!;
			const sh = resolveSheet(t.v);
			const c1 = colIndex(m[1]!.replace("$", ""));
			const r1 = Number(m[2]) - 1;
			if (t.t === "ref") return cellValue(sh, c1, r1);
			const c2 = colIndex(m[3]!);
			const r2 = Number(m[4]) - 1;
			const out: Value[] = [];
			for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(cellValue(sh, c, r));
			return out;
		};
		const scalar = (v: Value | Value[]): Value => (Array.isArray(v) ? (v.length === 1 ? v[0]! : (() => { throw new Err("a range where one value is needed"); })()) : v);

		const expr = (): Value | Value[] => cmp();
		const cmp = (): Value | Value[] => {
			let l = concat();
			while (peek() && peek()!.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek()!.v)) {
				const op = take()!.v;
				const r = scalar(concat());
				const a = scalar(l);
				const both = typeof a === "number" && typeof r === "number";
				const x = both ? a : String(a ?? "").toLowerCase();
				const y = both ? r : String(r ?? "").toLowerCase();
				l = op === "=" ? x === y : op === "<>" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
			}
			return l;
		};
		const concat = (): Value | Value[] => {
			let l = add();
			while (peek()?.t === "op" && peek()!.v === "&") {
				take();
				l = `${scalar(l) ?? ""}${scalar(add()) ?? ""}`;
			}
			return l;
		};
		const add = (): Value | Value[] => {
			let l = mul();
			while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
				const op = take()!.v;
				const r = num(scalar(mul()));
				l = op === "+" ? num(scalar(l)) + r : num(scalar(l)) - r;
			}
			return l;
		};
		const mul = (): Value | Value[] => {
			let l = pow();
			while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
				const op = take()!.v;
				const r = num(scalar(pow()));
				if (op === "/" && r === 0) throw new Err("division by zero");
				l = op === "*" ? num(scalar(l)) * r : num(scalar(l)) / r;
			}
			return l;
		};
		const pow = (): Value | Value[] => {
			let l = unary();
			while (peek()?.t === "op" && peek()!.v === "^") {
				take();
				l = num(scalar(l)) ** num(scalar(unary()));
			}
			return l;
		};
		const unary = (): Value | Value[] => {
			if (peek()?.t === "op" && (peek()!.v === "-" || peek()!.v === "+")) {
				const neg = take()!.v === "-";
				const v = num(scalar(unary()));
				return neg ? -v : v;
			}
			return postfix();
		};
		const postfix = (): Value | Value[] => {
			let v = primary();
			while (peek()?.t === "op" && peek()!.v === "%") {
				take();
				v = num(scalar(v)) / 100;
			}
			return v;
		};
		const primary = (): Value | Value[] => {
			const t = take();
			if (!t) throw new Err("incomplete formula");
			if (t.t === "num") return Number(t.v);
			if (t.t === "str") return t.v;
			if (t.t === "ref" || t.t === "range") return parseRef(t);
			if (t.t === "(") {
				const v = expr();
				if (take()?.t !== ")") throw new Err("missing )");
				return v;
			}
			if (t.t === "fn") {
				take; // the "(" token follows the function name
				if (take()?.t !== "(") throw new Err("missing (");
				const args: (Value | Value[])[] = [];
				// IF and IFERROR evaluate lazily enough for errors in the unused branch not to count: arguments are parsed once, errors inside are caught by IFERROR
				if (peek()?.t !== ")") {
					for (;;) {
						if (t.v === "IFERROR" && args.length === 0) {
							try {
								args.push(expr());
							} catch {
								args.push("#ERR");
								skipArg();
							}
						} else args.push(expr());
						if (peek()?.t === ",") {
							take();
							continue;
						}
						break;
					}
				}
				if (take()?.t !== ")") throw new Err("missing )");
				return call(t.v, args);
			}
			throw new Err(`unexpected ${t.v}`);
		};
		/** after an argument that failed inside IFERROR: skips to the next top-level "," or ")" */
		const skipArg = () => {
			let depth = 0;
			while (p < toks.length) {
				const k = peek()!;
				if (k.t === "(") depth++;
				else if (k.t === ")") {
					if (depth === 0) return;
					depth--;
				} else if (k.t === "," && depth === 0) return;
				p++;
			}
		};
		const call = (name: string, a: (Value | Value[])[]): Value => {
			const n1 = () => num(scalar(a[0]!));
			switch (name) {
				case "SUM": return nums(a).reduce((x, y) => x + y, 0);
				case "AVERAGE": { const v = nums(a); if (!v.length) throw new Err("average of nothing"); return v.reduce((x, y) => x + y, 0) / v.length; }
				case "MIN": { const v = nums(a); return v.length ? Math.min(...v) : 0; }
				case "MAX": { const v = nums(a); return v.length ? Math.max(...v) : 0; }
				case "COUNT": return flat(a).filter((v) => typeof v === "number").length;
				case "COUNTA": return flat(a).filter((v) => v !== null && v !== "").length;
				case "PRODUCT": return nums(a).reduce((x, y) => x * y, 1);
				case "ROUND": return round(n1(), a[1] === undefined ? 0 : num(scalar(a[1])), "r");
				case "ROUNDUP": return round(n1(), a[1] === undefined ? 0 : num(scalar(a[1])), "u");
				case "ROUNDDOWN": return round(n1(), a[1] === undefined ? 0 : num(scalar(a[1])), "d");
				case "INT": return Math.floor(n1());
				case "ABS": return Math.abs(n1());
				case "SQRT": { const x = n1(); if (x < 0) throw new Err("square root of a negative number"); return Math.sqrt(x); }
				case "POWER": return n1() ** num(scalar(a[1]!));
				case "MOD": { const d = num(scalar(a[1]!)); if (d === 0) throw new Err("division by zero"); const x = n1(); return x - d * Math.floor(x / d); }
				case "IF": { const c = scalar(a[0]!); const yes = c !== 0 && c !== false && c !== null && c !== ""; return scalar((yes ? a[1] : a[2]) ?? false); }
				case "AND": return flat(a).every((v) => v !== 0 && v !== false && v !== null);
				case "OR": return flat(a).some((v) => v !== 0 && v !== false && v !== null);
				case "NOT": { const c = scalar(a[0]!); return c === 0 || c === false || c === null; }
				case "IFERROR": return scalar(a[0] === "#ERR" ? (a[1] ?? "") : a[0]!);
				case "SUMPRODUCT": {
					const lists = a.map((x) => (Array.isArray(x) ? x : [x]));
					const len = lists[0]!.length;
					if (lists.some((l) => l.length !== len)) throw new Err("ranges of different size");
					let s = 0;
					for (let k = 0; k < len; k++) s += lists.reduce((m, l) => m * (typeof l[k] === "number" ? (l[k] as number) : 0), 1);
					return s;
				}
				default: throw new Err(`unsupported function ${name}`);
			}
		};
		const v = expr();
		if (p < toks.length) throw new Err(`unexpected ${toks[p]!.v}`);
		return scalar(v);
	}

	for (const s of sheets) {
		s.rows.forEach((row, r) =>
			row.forEach((cell, c) => {
				if (!isFormula(cell)) return;
				try {
					cellValue(s, c, r);
				} catch {
					/* recorded in errors */
				}
			}),
		);
	}
	// a formula that failed because one it reads failed is counted once per cell: keep the first reason per cell
	const seen = new Set<string>();
	return { values, errors: errors.filter((e) => (seen.has(e.cell) ? false : (seen.add(e.cell), true))), formulas };
}

// UI language: every string given to tr() has an English entry with the same {placeholders}; tr() / trDyn() behave; the setting is kept.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { getLang, registerEn, setLang, tr, trDyn } from "../src/shared/i18n.ts";
import { AppSettings } from "../src/main/settings.ts";
import { core } from "../src/renderer/i18n/en/core.ts";
import { part1 } from "../src/renderer/i18n/en/part1.ts";
import { part2 } from "../src/renderer/i18n/en/part2.ts";
import { part3 } from "../src/renderer/i18n/en/part3.ts";
import { part4 } from "../src/renderer/i18n/en/part4.ts";
import { part5 } from "../src/renderer/i18n/en/part5.ts";
import { part6 } from "../src/renderer/i18n/en/part6.ts";
import { part7 } from "../src/renderer/i18n/en/part7.ts";
import { settings } from "../src/renderer/i18n/en/settings.ts";

// the same parts src/renderer/i18n/index.ts registers: part7 (windows menu, compare, comment column) and settings were
// registered by the app but never read here, so their strings were reported missing although the app has them
const dict: Record<string, string> = { ...core, ...settings, ...part1, ...part2, ...part3, ...part4, ...part5, ...part6, ...part7 };
for (const d of [core, settings, part1, part2, part3, part4, part5, part6, part7]) registerEn(d);

const walk = (d: string): string[] =>
	readdirSync(d).flatMap((n) => {
		const p = join(d, n);
		return statSync(p).isDirectory() ? (n === "i18n" ? [] : walk(p)) : /\.tsx?$/.test(p) ? [p] : [];
	});
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

/** Every tr("…") literal of the renderer with the file it is in. */
function trKeys(): { key: string; file: string }[] {
	const out: { key: string; file: string }[] = [];
	for (const file of walk("src/renderer")) {
		const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
		const visit = (n: ts.Node) => {
			if (ts.isCallExpression(n) && n.expression.getText(sf) === "tr" && n.arguments[0]) {
				const a = n.arguments[0];
				if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) out.push({ key: a.text, file });
				else if (ts.isTemplateExpression(a)) assert.fail(`${file}: tr() takes a plain string with {placeholders}, not a template with \${}`);
			}
			ts.forEachChild(n, visit);
		};
		visit(sf);
	}
	return out;
}

test("every tr() string has an English entry with the same placeholders", () => {
	const missing = trKeys().filter((k) => !Object.prototype.hasOwnProperty.call(dict, k.key));
	assert.deepEqual(missing.map((m) => `${m.file}: ${m.key}`), [], "add these to src/renderer/i18n/en/*.ts");
	const bad = Object.entries(dict).filter(([lv, en]) => placeholders(lv).join() !== placeholders(en).join());
	assert.deepEqual(bad.map(([lv]) => lv), [], "the English text must keep the {placeholders} of its key");
});

test("tr(): English with placeholders, Latvian when the language is Latvian, the key itself when there is no entry", () => {
	const was = getLang();
	setLang("en");
	assert.equal(tr("Saglabāt"), "Save");
	assert.equal(tr("Atrasti {models} modeļi mapēs 1.2_Projekta dalas.", { models: 3 }), "Found 3 models in the 1.2_Projekta dalas folders.");
	assert.equal(tr("Nav tulkojuma šim tekstam"), "Nav tulkojuma šim tekstam");
	assert.equal(tr("Pārbaudīts: {open} atvērti atradumi", { open: undefined }), "Checked:  open findings");
	setLang("lv");
	assert.equal(tr("Saglabāt"), "Saglabāt");
	assert.equal(tr("Pabeigti ({v})", { v: 2 }), "Pabeigti (2)");
	setLang(was);
});

test("trDyn(): text built elsewhere is translated whole, per ' · ' part, and by placeholder pattern", () => {
	const was = getLang();
	setLang("en");
	assert.equal(trDyn("Atradumi"), "Findings");
	assert.equal(trDyn("3 kļūdas · 2 brīdinājumi"), "3 errors · 2 warnings");
	assert.equal(trDyn("3 kļūdas · 2 brīdinājumi · 1 info"), "3 errors · 2 warnings · 1 info");
	assert.equal(trDyn("kavē 4 d."), "4 d. overdue");
	assert.equal(trDyn("Vilnis apturēts: skrējienu limits"), "Wave stopped: run limit");
	assert.equal(trDyn("Kaut kas pavisam cits"), "Kaut kas pavisam cits");
	setLang("lv");
	assert.equal(trDyn("3 kļūdas · 2 brīdinājumi"), "3 kļūdas · 2 brīdinājumi");
	setLang(was);
});

test("the language setting defaults to English, is kept, and refuses other values", () => {
	const dir = mkdtempSync(join(tmpdir(), "pj-lang-"));
	const crypto = { available: () => true, encrypt: (x: string) => Buffer.from(x), decrypt: (b: Buffer) => b.toString() };
	const store = new AppSettings(dir, crypto);
	assert.equal(store.get().language, "en");
	assert.equal(store.set({ language: "lv" }).language, "lv");
	assert.equal(new AppSettings(dir, crypto).get().language, "lv");
	assert.equal(store.set({ language: "xx" as never }).language, "lv");
});

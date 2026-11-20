// UI language. The interface is written in Latvian in the source; that text is the key: tr("Saglabāt") answers "Save" when the
// language is English and the Latvian text itself otherwise (and for anything not translated yet, so a gap shows Latvian, never
// a blank or a key). {name} placeholders are filled from `vars`: tr("Atrasti {n} faili", { n: 3 }).
// What the AI writes stays Latvian whatever this is set to: agent prompts, tool results and documents never go through tr().
// The language is kept in settings (language) and mirrored in localStorage so every window starts in it without a flash;
// changing it reloads the window. Node-free: no storage access when there is no window.
export type Lang = "lv" | "en";
export const LANGS: { id: Lang; name: string }[] = [
	{ id: "en", name: "English" },
	{ id: "lv", name: "Latviešu" },
];
export const DEFAULT_LANG: Lang = "en";
export const LANG_KEY = "projektesana:lang";

const en: Record<string, string> = {};

/** Adds English texts (Latvian source → English). Later calls win. */
export function registerEn(dict: Record<string, string>): void {
	Object.assign(en, dict);
}
export const hasEn = (lv: string): boolean => Object.prototype.hasOwnProperty.call(en, lv);

export const isLang = (x: unknown): x is Lang => x === "lv" || x === "en";

function storedLang(): Lang | null {
	try {
		const v = typeof localStorage === "undefined" ? null : localStorage.getItem(LANG_KEY);
		return isLang(v) ? v : null;
	} catch {
		return null;
	}
}

let current: Lang = storedLang() ?? DEFAULT_LANG;
export const getLang = (): Lang => current;
/** Sets and remembers the language (no reload; the caller reloads). */
export function setLang(l: Lang): void {
	current = l;
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem(LANG_KEY, l);
	} catch {
		/* private window or blocked storage: the setting in settings.json still decides on the next start */
	}
}

export function tr(lv: string, vars?: Record<string, string | number | null | undefined>): string {
	const base = current === "en" && hasEn(lv) ? en[lv]! : lv;
	return vars ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : base;
}

const PLACEHOLDER = /\{(\w+)\}/;
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let templates: { re: RegExp; names: string[]; en: string }[] | null = null;
let templatesFor = 0;
/** The {placeholder} keys as patterns, rebuilt when the dictionary has grown. */
function templateList() {
	const n = Object.keys(en).length;
	if (!templates || templatesFor !== n) {
		templatesFor = n;
		templates = Object.keys(en)
			.filter((k) => PLACEHOLDER.test(k))
			.map((k) => {
				const names: string[] = [];
				const src = k
					.split(/(\{\w+\})/)
					.map((part) => {
						const m = part.match(/^\{(\w+)\}$/);
						if (m) {
							names.push(m[1]!);
							return "(.+?)";
						}
						return escapeRe(part);
					})
					.join("");
				return { re: new RegExp("^" + src + "$"), names, en: en[k]! };
			});
	}
	return templates;
}

/** Translates text that was built elsewhere in Latvian (shared code, main): the whole text, or each " · " part of it, is looked up as
 *  a key, then matched against the {placeholder} keys. Anything it does not know stays as it is. */
export function trDyn(text: string): string {
	if (current !== "en" || !text) return text;
	const one = (seg: string): string => {
		if (hasEn(seg)) return en[seg]!;
		const trimmed = seg.trim();
		if (trimmed !== seg && hasEn(trimmed)) return seg.replace(trimmed, en[trimmed]!);
		for (const t of templateList()) {
			const m = t.re.exec(trimmed);
			if (m) return seg.replace(trimmed, t.en.replace(/\{(\w+)\}/g, (_, k: string) => trDyn(m[t.names.indexOf(k) + 1] ?? "")));
		}
		return seg;
	};
	const whole = one(text);
	return whole !== text ? whole : text.split(" · ").map(one).join(" · ");
}

/** The locale for dates and numbers. */
export const locale = (): string => (current === "en" ? "en-GB" : "lv-LV");

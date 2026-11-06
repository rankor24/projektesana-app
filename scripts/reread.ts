// Re-read every act on likumi.lv and report which rule quotes are no longer in the live text. GET requests only; the
// snapshots in data/ are not overwritten: a changed rule is re-read by a person and its snapshot replaced on purpose.
//   node --import tsx scripts/reread.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { amendmentDates } from "../src/rules/citations.ts";
import { htmlToText, loadRules, rereadRules } from "../src/rules/rules.ts";

const data = join(import.meta.dirname, "..", "data");
const rules = loadRules(data);
const pages = new Map<string, string>();
const r = await rereadRules(rules, async (url) => {
	const res = await fetch(url, { headers: { "User-Agent": "Projektesana-App reread (likumi.lv citations check)" } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const html = await res.text();
	pages.set(url, html);
	return html;
});
const versions = Object.fromEntries([...pages].map(([url, html]) => [url, amendmentDates(htmlToText(html)).slice(-3)]));
const report = { at: new Date().toISOString(), ...r, latestAmendments: versions };
writeFileSync(join(data, "reread-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ checked: r.checked, changed: r.changed, failed: r.failed }, null, 1));
process.exit(r.changed.length || r.failed.length ? 1 : 0);

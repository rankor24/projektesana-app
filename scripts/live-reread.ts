// One-off check: fetch the live likumi.lv pages and confirm every rule quote is still there. Network GETs only.
//   node --import tsx scripts/live-reread.ts
import { join } from "node:path";
import { loadRules, rereadRules } from "../src/main/rules/verify.ts";

const rules = loadRules(join(import.meta.dirname, "..", "data"));
const r = await rereadRules(rules, async (url) => {
	const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Projektesana-App" } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.text();
});
console.log(JSON.stringify(r, null, 1));
process.exit(r.changed.length || r.failed.length ? 1 : 0);

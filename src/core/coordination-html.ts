// The coordination report as one self-contained HTML file (task 8.9): what each model has now and what it must become, grouped
// Novietne / Hierarhija / Stāvi, one section per model because one person fixes one model. No scripts, no outside files, prints
// cleanly; the person ticking lines off does it on paper or in a copy. Ported in spirit from BIM Crew ito/report-html.ts.
import { formatCoordinate } from "./coordination.js";
import type { AuditReport } from "./coordination-types.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderAuditHtml(a: AuditReport, opts: { title: string; project: string }): string {
	const r = a.reference;
	const base = `E ${formatCoordinate(r.basePoint.x)} · N ${formatCoordinate(r.basePoint.y)} · Z ${formatCoordinate(r.basePoint.z)} mm`;
	const models = a.models
		.map((m) => {
			const lines = m.groups
				.map(
					(g) => `<h4>${esc(g.g)}</h4><table>${g.lines
						.map((l) => `<tr class="${l.wide ? "wide" : ""}"><td class="w">${esc(l.w)}</td><td class="now">${esc(l.now)}</td><td class="arrow">→</td><td class="to">${esc(l.to)}${l.ask ? `<div class="ask">${esc(l.ask)}</div>` : ""}</td></tr>`)
						.join("")}</table>`,
				)
				.join("");
			return `<section><h3>${esc(m.code)} <span class="file">${esc(m.file)}</span></h3><p class="meta">${m.source === "revit" ? "atvērtais Revit dokuments" : esc([m.app, m.ts].filter(Boolean).join(" · "))}</p>${lines || '<p class="ok">Visi pārbaudītie lielumi sakrīt ar atsauci.</p>'}</section>`;
		})
		.join("");
	return `<!doctype html><html lang="lv"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
body{font:14px/1.45 system-ui,Segoe UI,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1d1d1b}
h1{font-size:22px;margin:0}h3{margin:1.6rem 0 0}h4{margin:.8rem 0 .2rem;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666}
.file{font-weight:400;color:#666;font-size:13px}.meta{margin:.1rem 0;color:#888;font-size:12px}
table{border-collapse:collapse;width:100%}td{padding:4px 8px;border-bottom:1px solid #e4e2dc;vertical-align:top}
.w{width:26%;font-weight:600}.arrow{width:2rem;color:#999;text-align:center}.now{color:#a33}.to{color:#176b3a}
.ask{color:#a06000;font-size:12px;margin-top:2px}.ok{color:#176b3a}.ref{background:#f6f5f1;padding:.6rem .8rem;border-radius:6px;margin:1rem 0}
@media print{body{margin:0}section{break-inside:avoid}}
</style></head><body><h1>${esc(opts.title)}</h1><p class="meta">${esc(opts.project)} · ${esc(a.date)} · ${a.totalLines} ${a.totalLines === 1 ? "labojums" : "labojumi"} ${a.models.length} modeļos</p>
<div class="ref"><b>Atsauce</b><br>Pamatpunkts: ${esc(base)} (pielaide ${r.tolerance} mm)<br>IFC: ${esc([r.hierarchy.project, r.hierarchy.site, r.hierarchy.building].filter(Boolean).join(" / ") || "nosaukumi nav norādīti")}${r.hierarchy.schema ? ` · ${esc(r.hierarchy.schema)}` : ""}</div>
${models || "<p>Nav neviena modeļa.</p>"}</body></html>`;
}

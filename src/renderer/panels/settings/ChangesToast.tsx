// The notice that tells the user an agent changed a setting, with an Undo button, wherever the user is in the app (mounted once in App.tsx).
// Two kinds: a change the agent made (safe tier: already applied, Undo puts it back) and a request the agent cannot do itself (secret and
// owner-only tiers: an API key, a sign-in, a path to a program), with a button that opens Settings at that very setting.
// The language is the one setting that needs the window to reload; it does so here, so a change by the agent (or its Undo) shows at once.
// Idea from OpenMausBot's applied-change card with Undo and its secret card (docs/superpowers/specs/2026-11-12-app-settings-tool-design.md); here a
// notice instead of a chat card, because this app's agents work in several threads and the user may be on any page.
import { useEffect, useRef, useState } from "react";
import type { AppSettingChange, AppSettingEvent } from "../../../shared/app-settings";
import { entryById } from "../../../shared/settings-index";
import { call, errText, on } from "../../bridge";
import { getLang, setLang, tr, trDyn } from "../../i18n";
import { windows } from "../../windows";
import { requestSettings } from "./settings-jump";

type Toast = { key: string; kind: "change"; change: AppSettingChange; err?: string } | { key: string; kind: "ask"; ev: Extract<AppSettingEvent, { kind: "ask" }> };

const SHOW_MS = 40_000;

/** A setting's place in Settings: its own index entry (an API key of one provider is the "keys" entry). */
export function openSetting(settingId: string): void {
	const e = entryById(settingId.startsWith("keys.") ? "keys" : settingId);
	if (e?.jump) return windows.open(e.jump);
	if (e) requestSettings({ page: e.page, anchor: e.anchor });
	windows.go("iestatijumi");
}

export function ChangesToast() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timers = useRef(new Map<string, number>());
	const drop = (key: string) => {
		window.clearTimeout(timers.current.get(key));
		timers.current.delete(key);
		setToasts((t) => t.filter((x) => x.key !== key));
	};
	const add = (t: Toast) => {
		setToasts((list) => [...list.filter((x) => x.key !== t.key), t].slice(-4));
		window.clearTimeout(timers.current.get(t.key));
		timers.current.set(t.key, window.setTimeout(() => drop(t.key), SHOW_MS));
	};
	const syncLanguage = () =>
		void call("settings.get").then((s) => {
			if (s.language && s.language !== getLang()) {
				setLang(s.language);
				location.reload();
			}
		});
	useEffect(
		() =>
			on("appSettings.changed", (ev) => {
				if (ev.kind === "change") {
					add({ key: ev.change.id, kind: "change", change: ev.change });
					if (ev.change.settingId === "app.language") syncLanguage();
				} else if (ev.kind === "undone") {
					drop(ev.change.id);
					if (ev.change.settingId === "app.language") syncLanguage();
				} else add({ key: `ask:${ev.settingId}`, kind: "ask", ev });
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);
	const undo = (t: Extract<Toast, { kind: "change" }>) =>
		call("appSettings.undo", t.change.id)
			.then(() => drop(t.key))
			.catch((e) => setToasts((list) => list.map((x) => (x.key === t.key ? { ...x, err: errText(e) } : x))));
	if (toasts.length === 0) return null;
	return (
		<div className="st-toasts" role="status" aria-live="polite">
			{toasts.map((t) =>
				t.kind === "change" ? (
					<div key={t.key} className="st-toast">
						<div>
							<b>{t.change.by}</b> {tr("nomainīja iestatījumu")}: <b>{trDyn(t.change.label)}</b>
							<div className="dim small">
								{t.change.before} → {t.change.after}
							</div>
							{t.err && <div className="err small">{t.err}</div>}
						</div>
						<div className="row">
							<button className="small" onClick={() => undo(t)}>
								{tr("Atsaukt")}
							</button>
							<button className="small ghost" onClick={() => (drop(t.key), openSetting(t.change.settingId))}>
								{tr("Atvērt")}
							</button>
							<button className="small ghost" aria-label={tr("Aizvērt")} onClick={() => drop(t.key)}>
								×
							</button>
						</div>
					</div>
				) : (
					<div key={t.key} className="st-toast ask">
						<div>
							<b>{t.ev.by}</b>: {t.ev.note}
							<div className="dim small">{t.ev.where}</div>
						</div>
						<div className="row">
							<button className="small primary" onClick={() => (drop(t.key), openSetting(t.ev.settingId))}>
								{tr("Atvērt iestatījumu")}
							</button>
							<button className="small ghost" aria-label={tr("Aizvērt")} onClick={() => drop(t.key)}>
								×
							</button>
						</div>
					</div>
				),
			)}
		</div>
	);
}

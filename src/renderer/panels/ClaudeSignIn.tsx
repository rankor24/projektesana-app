// Sign in for the Claude subscription (Settings → AI): the person signs in at Anthropic's own page, the app runs the unmodified
// `claude auth login` underneath (src/agent/claude/login.ts) and never sees a Claude credential. This shows whether a login exists
// (`claude auth status --json`, with the account's e-mail), the link while it waits, the field for the code the page shows, and Sign out.
// A pasted setup-token still works and wins in a run; this component only says so, it does not touch the token field.
//
// The sign-in runs through the same agent.login / agent.loginAnswer / agent.logout calls and agent.login notices as the other providers,
// so Settings' own sign-in box also reacts to it; this one keeps the link visible while the code is asked, which that box does not.
import { useEffect, useState } from "react";
import { call, errText, on } from "../bridge";
import { Badge, useLoad } from "../ui";
import { tr } from "../i18n";

const PROVIDER = "claude-sub";

type Step = { kind: "idle" } | { kind: "starting" } | { kind: "waiting"; url: string | null; codeSent: boolean } | { kind: "error"; message: string };

export function ClaudeSignIn() {
	const status = useLoad(() => call("claude.authStatus"), []);
	const [step, setStep] = useState<Step>({ kind: "idle" });
	const [code, setCode] = useState("");
	const [err, setErr] = useState<string | null>(null);

	// the notices of this provider's sign-in: link, then the question for the code, then the end
	useEffect(
		() =>
			on("agent.login", (n) => {
				if (n.provider !== PROVIDER) return;
				if (n.type === "url") setStep((s) => ({ kind: "waiting", url: n.url, codeSent: s.kind === "waiting" ? s.codeSent : false }));
				else if (n.type === "ask") setStep((s) => (s.kind === "waiting" ? s : { kind: "waiting", url: null, codeSent: false }));
				else if (n.type === "done") (setStep({ kind: "idle" }), setCode(""), status.reload());
				else if (n.type === "info") (setStep({ kind: "idle" }), setCode(""));
				else if (n.type === "error") (setStep({ kind: "error", message: n.message }), setCode(""), status.reload());
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);
	// the app re-reads the status in the background (first check, a sign-in finished): show it
	useEffect(() => on("data.changed", (e) => e.what.includes("agent") && status.reload()), []); // eslint-disable-line react-hooks/exhaustive-deps

	const run = async (fn: () => Promise<unknown>) => {
		setErr(null);
		try {
			await fn();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const s = status.data;
	const who = s?.account?.email ?? s?.account?.organization;
	const signedIn = s?.login === "in";
	const signingIn = step.kind === "starting" || step.kind === "waiting";

	return (
		<div className="pane">
			<div className="section-title">{tr("Claude abonements: pieteikšanās")}</div>
			<div className="row" style={{ flexWrap: "wrap" }}>
				{s == null ? (
					<Badge tone="dim">{tr("statuss nav nolasīts")}</Badge>
				) : signedIn ? (
					<Badge tone="ok">{tr("pieteicies")}</Badge>
				) : s.login === "out" ? (
					<Badge tone="dim">{tr("nav pieteicies")}</Badge>
				) : (
					<Badge tone="warn" title={tr("Claude Code neatbildēja uz statusa pārbaudi; tas nenozīmē, ka pieteikšanās nav.")}>
						{tr("statuss nav zināms")}
					</Badge>
				)}
				{signedIn && who && <span className="mono">{who}</span>}
				{signedIn && s?.account?.email && s.account.organization && <span className="dim small">{s.account.organization}</span>}
				{!signedIn && !signingIn && (
					<button className="primary" onClick={() => run(async () => (setStep({ kind: "starting" }), setErr(null), await call("agent.login", PROVIDER)))}>
						{tr("Pieteikties ar Claude")}
					</button>
				)}
				{signedIn && !signingIn && <button onClick={() => run(async () => (await call("agent.logout", PROVIDER), status.reload()))}>{tr("Atteikties")}</button>}
				{!signingIn && <button className="ghost small" onClick={() => run(async () => (await call("claude.authStatus", true), status.reload()))}>{tr("Pārbaudīt")}</button>}
			</div>
			{s?.token && <div className="dim small">{tr("Ielīmēta setup-token atslēga ir spēkā un ir svarīgāka par pieteikšanos. Lai izmantotu pieteikšanos, izdzēs atslēgu.")}</div>}

			{step.kind === "starting" && <div className="dim">{tr("Palaiž Claude Code…")}</div>}
			{step.kind === "waiting" && (
				<div className="confirm">
					<div>
						{tr("Atver Anthropic lapu, piesakies ar savu Claude abonementu un ielīmē šeit kodu, ko lapa parāda. Ja pārlūks pats pabeidza pieteikšanos, kods nav vajadzīgs.")}
					</div>
					{step.url ? (
						<div>
							<a href={step.url} target="_blank" rel="noreferrer">
								{tr("Atvērt pieteikšanās lapu")}
							</a>{" "}
							<span className="dim small mono">{step.url}</span>
						</div>
					) : (
						<div className="dim">{tr("Gaida saiti no Claude Code…")}</div>
					)}
					<div className="row">
						<input className="grow" placeholder={tr("Kods no Anthropic lapas")} value={code} disabled={step.codeSent} onChange={(e) => setCode(e.target.value)} />
						<button
							className="primary"
							disabled={!code.trim() || step.codeSent}
							onClick={() => run(async () => (await call("agent.loginAnswer", code.trim()), setStep({ ...step, codeSent: true })))}
						>
							{tr("Nosūtīt")}
						</button>
						<button onClick={() => run(async () => (await call("agent.loginCancel", PROVIDER), setStep({ kind: "idle" }), setCode("")))}>{tr("Atcelt")}</button>
					</div>
					{step.codeSent && <div className="dim small">{tr("Kods nosūtīts, gaida apstiprinājumu…")}</div>}
				</div>
			)}
			{step.kind === "error" && <div className="err">{step.message}</div>}
			{err && <div className="err">{err}</div>}
		</div>
	);
}

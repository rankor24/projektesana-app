import { useCallback, useEffect, useState, type ReactNode } from "react";
import { errText } from "./api";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
	const [data, setData] = useState<T | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const reload = useCallback(() => {
		setLoading(true);
		fn()
			.then((d) => {
				setData(d);
				setErr(null);
			})
			.catch((e) => setErr(errText(e)))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	useEffect(reload, [reload]);
	return { data, err, loading, reload };
}

export const Err = ({ text }: { text: string | null }) => (text ? <div className="err">{text}</div> : null);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Badge = ({ kind, children }: { kind?: "ok" | "warn" | "bad"; children: ReactNode }) => <span className={`badge ${kind ?? ""}`}>{children}</span>;

/** Runs an async action and keeps its error visible. */
export function useAction() {
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
		setBusy(true);
		setErr(null);
		try {
			return await fn();
		} catch (e) {
			setErr(errText(e));
			return undefined;
		} finally {
			setBusy(false);
		}
	}, []);
	return { run, err, busy, setErr };
}

export const fmtDate = (iso: string) => iso.slice(0, 10);

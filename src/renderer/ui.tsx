// Small shared UI pieces. Empty states say exactly what is missing (AGENTS.md): nav projekta, nav avota, nav savienojuma,
// no data, run scan — never a sample.
import { useEffect, useState, type ReactNode } from "react";
import { errText } from "./bridge";
import { useUi } from "./state";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			<div className="empty-title">{title}</div>
			{children && <div className="empty-body">{children}</div>}
		</div>
	);
}

export function Err({ error }: { error: unknown }) {
	return <div className="err">{errText(error)}</div>;
}

/** Loads data for a panel; reloads when the project or main's data.changed tick moves. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
	const { tick } = useUi();
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [loading, setLoading] = useState(true);
	const [n, setN] = useState(0);
	useEffect(() => {
		let live = true;
		setLoading(true);
		fn()
			.then((d) => live && (setData(d), setError(null)))
			.catch((e) => live && setError(e))
			.finally(() => live && setLoading(false));
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick, n]);
	return { data, error, loading, reload: () => setN((x) => x + 1) };
}

export function Badge({ tone, children, title }: { tone?: "ok" | "warn" | "bad" | "dim" | "info"; children: ReactNode; title?: string }) {
	return (
		<span className={`badge ${tone ?? ""}`} title={title}>
			{children}
		</span>
	);
}

// What every Settings page reads: the settings file, the providers with their sign-in state, the provider holds, and the sign-in notice that
// is going on. Loaded once by the window and passed down, so a change made on one page (the provider) is seen at once on another (the backup).
// `act` is the one way a page changes something: it runs the call, shows its error at the top of the window, and reloads everything.
import { useEffect, useState } from "react";
import type { HoldRow, ProviderRow } from "../../../shared/api";
import type { LoginNotice, Settings } from "../../../shared/types";
import { call, errText, on } from "../../bridge";
import { useLoad } from "../../ui";

export interface SettingsCtx {
	s: Settings | undefined;
	providers: ProviderRow[];
	holds: HoldRow[];
	loadError: unknown;
	notice: LoginNotice | null;
	/** how many times a path changed, so the component table asks Revit again */
	rv: number;
	bumpRv(): void;
	act(fn: () => Promise<unknown>): Promise<void>;
}

export function useSettingsData(setErr: (e: string | null) => void): SettingsCtx {
	const settings = useLoad(() => call("settings.get"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const holds = useLoad<HoldRow[]>(() => call("agent.holds"), []);
	const [notice, setNotice] = useState<LoginNotice | null>(null);
	const [rv, setRv] = useState(0);
	useEffect(() => on("agent.login", (n) => setNotice(n)), []);
	return {
		s: settings.data ?? undefined,
		providers: providers.data ?? [],
		holds: holds.data ?? [],
		loadError: settings.error ?? providers.error ?? null,
		notice,
		rv,
		bumpRv: () => setRv((v) => v + 1),
		act: async (fn) => {
			setErr(null);
			try {
				await fn();
				settings.reload();
				providers.reload();
				holds.reload();
			} catch (e) {
				setErr(errText(e));
			}
		},
	};
}

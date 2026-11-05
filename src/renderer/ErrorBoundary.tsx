// A screen that throws while rendering shows its error here; the sidebar stays, so there is always a way out.
// Without this, React unmounts the whole window and leaves it black.
import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	onHome: () => void;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error) {
		// goes to the app log through the main process console listener
		console.error(`screen crashed: ${error.stack ?? error.message}`);
	}

	render() {
		const e = this.state.error;
		if (!e) return this.props.children;
		return (
			<div className="card">
				<h2>Šis ekrāns avarēja</h2>
				<div className="err">{e.message}</div>
				<pre className="mono muted" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
					{e.stack}
				</pre>
				<div className="row">
					<button className="btn primary" onClick={() => (this.setState({ error: null }), this.props.onHome())}>
						Atpakaļ uz pārskatu
					</button>
					<button className="btn" onClick={() => this.setState({ error: null })}>
						Mēģināt vēlreiz
					</button>
					<span className="muted">Kļūda ierakstīta žurnālā (Iestatījumi → Žurnāla fails). F5 pārlādē logu.</span>
				</div>
			</div>
		);
	}
}

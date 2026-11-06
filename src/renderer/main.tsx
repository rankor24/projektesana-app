import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** A render error shows its message and a reload, never a black window. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	// the stack and the component path go to the app log through the console (main logs renderer errors)
	componentDidCatch(error: Error, info: { componentStack?: string | null }) {
		console.error(`render error: ${error.stack ?? error.message}
${info.componentStack ?? ""}`);
	}
	render() {
		if (this.state.error)
			return (
				<div className="crash">
					<h2>Kļūda ekrānā</h2>
					<pre>{this.state.error.stack ?? this.state.error.message}</pre>
					<button onClick={() => location.reload()}>Pārlādēt (F5)</button>
				</div>
			);
		return this.props.children;
	}
}

createRoot(document.getElementById("root")!).render(
	<Boundary>
		<App />
	</Boundary>,
);

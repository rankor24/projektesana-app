// The agent dock: right half of the split view. Task 0.5 connects it to the pi harness.
import { Empty } from "../ui";

export function AgentDock() {
	return (
		<aside className="agent-dock">
			<Empty title="nav savienojuma">Aģents vēl nav pieslēgts.</Empty>
		</aside>
	);
}

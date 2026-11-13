// Pārskats: the project's own page (it replaces the Profils panel, decision 8 of v2-design). For now the stage timeline
// and the profile; 9.6 turns it into the dashboard (tiles, Jāizdara, Fakti, recent changes).
import { useUi } from "../state";
import { Empty } from "../ui";
import { Timeline } from "../shell/Timeline";
import { Profile } from "./Profile";

export function Parskats() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title="nav projekta">Atver vai pievieno projektu (augšā: projekta nosaukums).</Empty>;
	return (
		<div className="fill-col">
			<Timeline />
			<Profile projectId={projectId} />
		</div>
	);
}

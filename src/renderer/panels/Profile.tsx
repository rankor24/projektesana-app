// The open project's profile: one row per profile key, each value a Fact with its source (task 1.11 fills it).
import { useUi } from "../state";
import { Empty } from "../ui";

export function Profile({ projectId }: { projectId: string }) {
	useUi();
	return <Empty title="no data">{projectId}: profila fakti vēl nav iegūti.</Empty>;
}

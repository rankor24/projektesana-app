// The header of a Settings page: its title and one line saying what the page is for, so a person who landed here from a search result
// knows where they are. Ported from OpenMausBot src/components/settings/SettingsPageHeader.tsx (title + intro line); the place / account
// scope line is left out, this app has one place.
import { trDyn } from "../../i18n";
import { groupLabel, type SettingsPageDef } from "../../../shared/settings-index";

export function SettingsPageHeader({ page }: { page: SettingsPageDef }) {
	return (
		<header className="st-header" data-settings-header="">
			<div className="st-crumb dim small">{trDyn(groupLabel(page.group))}</div>
			<h2 className="st-title" id="settings-page-title">
				{trDyn(page.label)}
			</h2>
			<p className="st-intro dim">{trDyn(page.intro)}</p>
		</header>
	);
}

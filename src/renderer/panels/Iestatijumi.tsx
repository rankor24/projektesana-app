// Settings. The window itself is panels/settings/SettingsWindow.tsx: a grouped left navigation (Projekts · AI · Aģenti · Lietotne) with a search
// box over every setting, and one page at a time. This file stays the panel App.tsx mounts under the id "iestatijumi".
// The four tabs it used to hold (Vispārīgi · Aģents · Integrācijas · Ceļi) are gone; every setting they had is on a page of the new window
// (panels/settings/pages.tsx), and the agent can read and change the same settings through its app_settings tool (main/app-settings).
import { SettingsWindow } from "./settings/SettingsWindow";

export function Iestatijumi() {
	return <SettingsWindow />;
}

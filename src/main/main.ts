import { app, BrowserWindow } from "electron";
import { join } from "node:path";
const here = import.meta.dirname;
app.whenReady().then(() => {
	const win = new BrowserWindow({ width: 1440, height: 900, title: "Projektēšanas App", backgroundColor: "#161615", webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true } });
	void win.loadFile(join(here, "..", "renderer", "index.html"));
});
app.on("window-all-closed", () => app.quit());

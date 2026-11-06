// Live check that the BimCraft copy runs from bimcraft:// inside Electron and that the bridge add-on is active.
// Prints BIMCRAFT_RESULT {…}. Uses the app's built protocol module (dist/main/bimcraft-protocol.js).
//   npx electron scripts/bimcraft-check.mjs
import { app, BrowserWindow, net, protocol } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const { BIMCRAFT_SCHEME, bimcraftResponse, bimcraftSite } = await import(pathToFileURL(join(root, "dist", "main", "bimcraft-protocol.js")).href);
protocol.registerSchemesAsPrivileged([{ scheme: BIMCRAFT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setPath("userData", join(root, ".bimcraft-check"));
app.whenReady().then(async () => {
	const site = bimcraftSite(join(root, "resources", "bimcraft"));
	const missing = [];
	protocol.handle(BIMCRAFT_SCHEME, async (req) => {
		const r = bimcraftResponse(site, req.url);
		if (!r.file) {
			missing.push(new URL(req.url).pathname);
			return new Response("not found", { status: 404 });
		}
		const res = await net.fetch(pathToFileURL(r.file).href);
		return new Response(res.body, { status: 200, headers: r.headers });
	});
	const errors = [];
	const w = new BrowserWindow({ show: false, width: 1400, height: 900 });
	w.webContents.on("console-message", (e) => e.level === "error" && errors.push(e.message.slice(0, 300)));
	await w.loadURL("bimcraft://app/");
	let state = null;
	for (let i = 0; i < 60 && !state; i++) {
		await new Promise((r) => setTimeout(r, 500));
		state = await w.webContents.executeJavaScript("(window.ccAddons && window.ccAddons.list().map(a => [a.id, a.state])) || null").catch(() => null);
	}
	process.stdout.write(`BIMCRAFT_RESULT ${JSON.stringify({ addons: state, errors: errors.slice(0, 8), missing: [...new Set(missing)].slice(0, 20) })}\n`);
	app.quit();
});

// Builds the app and leaves exactly ONE setup exe and ONE launcher exe in release/, same layout as Konkursu App and BIM Crew:
//   release/Projektesana App Setup <version>.exe          installer (NSIS)
//   release/win-unpacked/Projektesana App.exe             launcher, runs without installing
// Older setup exes and blockmaps in release/ are removed (files only; no folder is ever deleted).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const release = join(root, "release");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

run("npm", ["run", "build"]);
run("npx", ["electron-builder", "--win", "dir"]);
run("npx", ["electron-builder", "--win", "nsis"]);

const keep = `Projektesana App Setup ${version}.exe`;
for (const f of readdirSync(release)) {
	if (/ Setup .*\.exe(\.blockmap)?$/.test(f) && f !== keep && f !== `${keep}.blockmap`) {
		rmSync(join(release, f));
		console.log("removed old", f);
	}
}
const setup = join(release, keep);
const launcher = join(release, "win-unpacked", "Projektesana App.exe");
for (const p of [setup, launcher]) {
	if (!existsSync(p)) throw new Error(`missing ${p}`);
	console.log(`${p}  ${(statSync(p).size / 1048576).toFixed(1)} MB  ${statSync(p).mtime.toISOString()}`);
}

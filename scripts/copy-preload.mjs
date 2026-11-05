// tsc does not compile .cts into dist for ESM projects the way Electron needs it; build it to dist/main/preload.cjs.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
mkdirSync(join(root, "dist", "main"), { recursive: true });
execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--module", "commonjs", "--moduleResolution", "node10", "--target", "ES2023", "--esModuleInterop", "--skipLibCheck", "--types", "node", "--outDir", join(root, "dist", "main"), join(root, "src", "main", "preload.cts")], { stdio: "inherit" });
console.log("preload.cjs built");

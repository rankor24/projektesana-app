// Registers the app's checks once. Import this module before running checks.
import { citationCheck } from "./checks/citations.js";
import { completenessCheck } from "./checks/completeness.js";
import { filenameCheck } from "./checks/filenames.js";
import { oneTruthCheck } from "./checks/one-truth.js";
import { allChecks, registerCheck, type Check } from "./registry.js";

export const APP_CHECKS: Check[] = [completenessCheck, oneTruthCheck, citationCheck, filenameCheck];

let done = false;
export function registerAppChecks(extra: Check[] = []): void {
	if (done) return;
	done = true;
	for (const c of [...APP_CHECKS, ...extra]) if (!allChecks().some((x) => x.id === c.id)) registerCheck(c);
}

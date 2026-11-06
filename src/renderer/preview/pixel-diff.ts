// Pixel diff of two rendered sheets: ported from BIM Crew apps/client/src/features/blueprint-diff/services/diffService.ts
// (branch feat/agent-harness-v2): content in both = grey, only in A = red (removed), only in B = blue (added); changed
// pixels counted on a 40 px grid and clustered into zones. Changed: the colour constants are named; B is drawn onto A's
// frame before the compare (see SheetCompare), so a re-plotted sheet does not light up everywhere.

export interface DiffZone {
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

const GRID = 40;
const ACTIVE = 5;
const BOTH = [80, 80, 80];
const REMOVED = [239, 68, 68];
const ADDED = [59, 130, 246];

export function computeDiff(a: ImageData, b: ImageData, threshold = 240): { diff: ImageData; zones: DiffZone[] } {
	if (a.width !== b.width || a.height !== b.height) throw new Error(`Izmēri nesakrīt: ${a.width}×${a.height} pret ${b.width}×${b.height}`);
	const { width, height } = a;
	const out = new ImageData(width, height);
	const gw = Math.ceil(width / GRID);
	const gh = Math.ceil(height / GRID);
	const grid = new Int32Array(gw * gh);
	const d1 = a.data;
	const d2 = b.data;
	const r = out.data;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const c1 = (d1[i] + d1[i + 1] + d1[i + 2]) / 3 < threshold && d1[i + 3] > 0;
			const c2 = (d2[i] + d2[i + 1] + d2[i + 2]) / 3 < threshold && d2[i + 3] > 0;
			const col = c1 && c2 ? BOTH : c1 ? REMOVED : c2 ? ADDED : null;
			if (!col) continue;
			r[i] = col[0];
			r[i + 1] = col[1];
			r[i + 2] = col[2];
			r[i + 3] = 255;
			if (c1 !== c2) grid[Math.floor(y / GRID) * gw + Math.floor(x / GRID)]++;
		}
	}
	// zones: 8-connected clusters of active grid cells (BIM Crew clusterZones)
	const zones: DiffZone[] = [];
	const seen = new Int8Array(gw * gh);
	let id = 1;
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++) {
			const idx = gy * gw + gx;
			if (grid[idx] <= ACTIVE || seen[idx]) continue;
			let [x0, x1, y0, y1] = [gx, gx, gy, gy];
			const stack = [[gx, gy]];
			seen[idx] = 1;
			while (stack.length) {
				const [cx, cy] = stack.pop()!;
				x0 = Math.min(x0, cx);
				x1 = Math.max(x1, cx);
				y0 = Math.min(y0, cy);
				y1 = Math.max(y1, cy);
				for (let dx = -1; dx <= 1; dx++)
					for (let dy = -1; dy <= 1; dy++) {
						const nx = cx + dx;
						const ny = cy + dy;
						if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
						const n = ny * gw + nx;
						if (seen[n] || grid[n] <= ACTIVE) continue;
						seen[n] = 1;
						stack.push([nx, ny]);
					}
			}
			zones.push({ id: id++, x: x0 * GRID, y: y0 * GRID, width: (x1 - x0 + 1) * GRID, height: (y1 - y0 + 1) * GRID });
		}
	return { diff: out, zones };
}

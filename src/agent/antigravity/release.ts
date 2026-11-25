// The pinned release of Google's Antigravity ACP server this app installs. The size and SHA-256 are checked before anything is unpacked.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/antigravity-release.ts: URLs and hashes are from Google's official ACP registry entry
// (agentclientprotocol/registry@06229c691d24d039e2363ba12abe5c9dfae5bc66); OpenMausBot read the sizes from Google's servers on 2026-10-25 and
// checked the win32-x64 archive independently. Only the Windows builds are kept here: this is a Windows application.
export const ANTIGRAVITY_RELEASE_VERSION = "1.4.3";

export interface AntigravityReleaseAsset {
	version: string;
	url: string;
	sha256: string;
	archiveBytes: number;
	executable: { name: string; bytes: number };
	harness: { name: string; bytes: number };
}

const RELEASES = new Map<string, AntigravityReleaseAsset>([
	[
		"win32-x64",
		{
			version: ANTIGRAVITY_RELEASE_VERSION,
			url: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.3-windows-x86_64.zip",
			sha256: "54c2e16378d9a4952e1da70e355f3c33c4f284308d6de48ab3e6e34a127bd325",
			archiveBytes: 131_267_135,
			executable: { name: "agy_acp_server.exe", bytes: 87_022_872 },
			harness: { name: "localharness_external.exe", bytes: 147_843_736 },
		},
	],
	[
		"win32-arm64",
		{
			version: ANTIGRAVITY_RELEASE_VERSION,
			url: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.3-windows-arm64.zip",
			sha256: "fcd46431ad33d3b510ce0b98fe7b43d095bd8b3f1c363ee2d57faa7ee981c7bb",
			archiveBytes: 134_301_870,
			executable: { name: "agy_acp_server.exe", bytes: 94_238_816 },
			harness: { name: "localharness_external.exe", bytes: 139_322_008 },
		},
	],
]);

export function resolveAntigravityReleaseAsset(platform: NodeJS.Platform = process.platform, arch: string = process.arch): AntigravityReleaseAsset | null {
	return RELEASES.get(`${platform}-${arch}`) ?? null;
}

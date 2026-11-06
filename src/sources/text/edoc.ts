// Latvian eDoc (.edoc, ASiC-E with XAdES signatures; also .asice / .bdoc): a zip of the signed files plus META-INF.
// Inner files are listed so each becomes a Source; signers come from META-INF/*signatures*.xml: the signing time from
// xades:SigningTime, the name from the certificate subject CN (X509SubjectName when present, else the certificate itself).
// Only the name is kept: the personal code in the certificate (serialNumber) is never read out.
import { strFromU8, unzipSync } from "fflate";
import { unxml } from "./xml.js";

export interface EdocEntry {
	name: string;
	bytes: Uint8Array;
}

export interface EdocSigner {
	name: string;
	at: string | null;
	file: string;
}

export interface Edoc {
	files: EdocEntry[];
	signers: EdocSigner[];
}

export const CONTAINER_EXT = new Set([".edoc", ".asice", ".bdoc", ".sce"]);

/** DER: the value of every attribute with OID 2.5.4.3 (commonName). In a certificate the issuer comes before the subject. */
function commonNames(der: Uint8Array): string[] {
	const out: string[] = [];
	for (let i = 0; i + 7 < der.length; i++) {
		// 06 03 55 04 03 = OID 2.5.4.3
		if (der[i] === 0x06 && der[i + 1] === 0x03 && der[i + 2] === 0x55 && der[i + 3] === 0x04 && der[i + 4] === 0x03) {
			const tag = der[i + 5];
			let len = der[i + 6];
			let start = i + 7;
			if (len & 0x80) {
				const n = len & 0x7f;
				len = 0;
				for (let k = 0; k < n; k++) len = (len << 8) | der[start + k];
				start += n;
			}
			const bytes = der.subarray(start, start + len);
			// UTF8String 0x0c, PrintableString 0x13, BMPString 0x1e
			const s = tag === 0x1e ? new TextDecoder("utf-16be").decode(bytes) : new TextDecoder("utf-8").decode(bytes);
			out.push(s);
			i = start + len - 1;
		}
	}
	return out;
}

function signerOf(xml: string, file: string): EdocSigner[] {
	const out: EdocSigner[] = [];
	// one file can hold several <ds:Signature> elements
	const sigs = xml.split(/<(?:\w+:)?Signature\b(?=[\s>])/).slice(1);
	for (const sig of sigs.length ? sigs : [xml]) {
		const at = /<(?:\w+:)?SigningTime>([^<]+)</.exec(sig)?.[1]?.trim() ?? null;
		let name = "";
		const subject = /<(?:\w+:)?X509SubjectName>([^<]+)</.exec(sig)?.[1];
		if (subject) name = /CN=([^,]+)/.exec(unxml(subject))?.[1]?.trim() ?? "";
		if (!name) {
			const cert = /<(?:\w+:)?X509Certificate>([\s\S]*?)</.exec(sig)?.[1];
			if (cert) {
				const cns = commonNames(new Uint8Array(Buffer.from(cert.replace(/\s+/g, ""), "base64")));
				name = cns[cns.length - 1] ?? "";
			}
		}
		// "UZVĀRDS,VĀRDS,PNOLV-…" style CNs: keep the name parts only
		name = name
			.split(",")
			.filter((p) => !/\d{4}/.test(p))
			.join(" ")
			.trim();
		if (name || at) out.push({ name: name || "nav nolasāms", at, file });
	}
	return out;
}

export function readEdoc(bytes: Uint8Array): Edoc {
	const all = unzipSync(bytes);
	const files: EdocEntry[] = [];
	const signers: EdocSigner[] = [];
	for (const [name, data] of Object.entries(all)) {
		if (name.endsWith("/")) continue;
		if (name === "mimetype") continue;
		if (name.startsWith("META-INF/")) {
			if (/signatures.*\.xml$/i.test(name)) signers.push(...signerOf(strFromU8(data), name));
			continue;
		}
		files.push({ name, bytes: data });
	}
	return { files: files.sort((a, b) => a.name.localeCompare(b.name, "lv", { numeric: true })), signers };
}

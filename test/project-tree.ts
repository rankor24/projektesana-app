// An invented office project folder for the scan tests: the office standard's 1.1 layout with made-up content.
// Every name, number and person here is invented.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { FIX, makeDocx } from "./helpers.ts";

/** 1x1 transparent PNG. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** A DER fragment with two commonName attributes (issuer first, subject second), as in a certificate. */
function fakeCertDer(issuer: string, subject: string): Uint8Array {
	const cn = (s: string) => {
		const b = Buffer.from(s, "utf8");
		return Buffer.concat([Buffer.from([0x30, b.length + 9, 0x31, b.length + 7, 0x30, b.length + 5, 0x06, 0x03, 0x55, 0x04, 0x03, 0x0c, b.length]), b].map((x) => x)).subarray(0);
	};
	return Buffer.concat([Buffer.from([0x30, 0x00]), cn(issuer), cn(subject)]);
}

export function makeEdoc(files: Record<string, Uint8Array>, signatures: { name?: string; cert?: [string, string]; at: string }[]): Uint8Array {
	const z: Record<string, Uint8Array> = { mimetype: strToU8("application/vnd.etsi.asic-e+zip"), ...files };
	signatures.forEach((s, i) => {
		const x509 = s.name ? `<ds:X509SubjectName>CN=${s.name},SERIALNUMBER=PNOLV-000000-00000,C=LV</ds:X509SubjectName>` : `<ds:X509Certificate>${Buffer.from(fakeCertDer(s.cert![0], s.cert![1])).toString("base64")}</ds:X509Certificate>`;
		z[`META-INF/edoc-signatures-S${i}.xml`] = strToU8(
			`<?xml version="1.0"?><asic:XAdESSignatures xmlns:asic="http://uri.etsi.org/02918/v1.2.1#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"><ds:Signature Id="S${i}"><ds:KeyInfo><ds:X509Data>${x509}</ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties><xades:SignedProperties><xades:SignedSignatureProperties><xades:SigningTime>${s.at}</xades:SigningTime></xades:SignedSignatureProperties></xades:SignedProperties></xades:QualifyingProperties></ds:Object></ds:Signature></asic:XAdESSignatures>`,
		);
	});
	z["META-INF/manifest.xml"] = strToU8("<manifest/>");
	return zipSync(z);
}

export interface Tree {
	root: string;
	inputs: string;
}

export function makeProjectTree(base: string, opts: { photos?: number } = {}): Tree {
	const root = join(base, "BD999 Testa iela 1");
	const inputs = join(root, "01_Projektesana", "1.1_Izejas dati");
	const d = (...p: string[]) => {
		const full = join(inputs, ...p);
		mkdirSync(full, { recursive: true });
		return full;
	};
	writeFileSync(join(d("1.1.1_Iepirkums"), "Nolikums.docx"), makeDocx(["Iepirkuma nolikums Nr. TEST/2026/1", "Pasūtītājs: Izdomātā pašvaldība"]));
	const prop = d("1.1.2_Ipasuma dok");
	copyFileSync(join(FIX, "text-lv.pdf"), join(prop, "Kadastrala lieta.pdf"));
	copyFileSync(join(FIX, "text-lv.pdf"), join(prop, "Pielikums Nr.1.pdf"));
	const ff = d("1.1.03_FF", "261001_FF");
	for (let i = 1; i <= (opts.photos ?? 30); i++) writeFileSync(join(ff, `IMG_${String(i).padStart(4, "0")}.png`), PNG);
	const pu = d("1.1.4_PU");
	writeFileSync(join(pu, "PU.docx"), makeDocx(["Projektēšanas uzdevums", "1. Objekta adrese: Testa iela 1"]));
	writeFileSync(join(pu, "~$PU.docx"), "lock");
	writeFileSync(join(d("1.1.5_Tehniskie not"), "TN Izdomatais tikls.pdf"), Buffer.from("%PDF-1.4 broken"));
	writeFileSync(join(d("1.1.6_TOPO"), "topo.dwg"), "AC1032 invented");
	d("1.1.7_GI");
	writeFileSync(join(d("1.1.08_TAA"), "TAA.docx"), makeDocx(["Tehniskās apsekošanas atzinums"]));
	const arch = d("1.1.12_arhivs");
	writeFileSync(join(arch, "vecs1.pdf"), "x");
	writeFileSync(join(arch, "vecs2.pdf"), "y");
	// outside 1.1: must never be read
	const sec = join(root, "01_Projektesana", "1.2_Projekta dalas", "1.2.01_AR", "01_RVT");
	mkdirSync(sec, { recursive: true });
	writeFileSync(join(sec, "261001_AR.rvt"), "not read");
	return { root, inputs };
}

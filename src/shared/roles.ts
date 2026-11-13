// Role lists of input documents, shared by the scan (main) and the Avoti panel (renderer). Pure data.
// Role of a document = its office folder (design doc 2); see src/sources/roles.ts for how a scan applies them.

export const FIXED_ROLES: Record<string, string> = {
	"1.1.1": "Iepirkums",
	"1.1.2": "Īpašuma dokumenti",
	"1.1.3": "Fotofiksācija",
	"1.1.4": "PU",
	"1.1.5": "Tehniskie noteikumi",
	"1.1.6": "Topogrāfija",
	"1.1.7": "Ģeoloģija",
};

/** Roles a free folder can have. "Arhīvs" folders are not read: their files are counted, never listed one by one. */
export const FREE_ROLES = ["TAA", "BIP / BIM prasības", "Grafiks", "Info no pasūtītāja", "Būvatļauja / nosacījumi", "Saskaņojumi", "Ekspertīzes atzinums", "Punktu mākonis", "Arhīvs", "Cits"] as const;

/** Roles one document can be given in Avoti. A folder role is a guess for every file in it; a client often sends the
 *  property documents as attachments of the PU (BD427: "Kadastrālā lieta" inside 1.1.04_PU), so the user can say what one
 *  document is. Not "Arhīvs" (a folder that is not read) or "Fotofiksācija" (photo surveys are folders, not documents). */
export const DOC_ROLES: readonly string[] = [...new Set<string>([...Object.values(FIXED_ROLES), ...FREE_ROLES])].filter((r) => r !== "Arhīvs" && r !== "Fotofiksācija");

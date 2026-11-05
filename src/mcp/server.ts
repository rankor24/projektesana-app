// projektesana-tools — stdio MCP server. Configured by the main process through environment variables:
//   PROJEKTESANA_ROOT      project folder
//   PROJEKTESANA_ENGINE    which engine launched this (audit)
//   PROJEKTESANA_MODE      setup | model — which tools exist
//   PROJEKTESANA_REVISION  current revision id (model mode)
//   PROJEKTESANA_DATA      data folder with rules.json
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, join } from "node:path";
import * as t from "./tools.js";
import { ROLES } from "../main/files/roles.js";

const env = process.env;
const ctx: t.ToolCtx = {
	root: env.PROJEKTESANA_ROOT ?? "",
	engine: env.PROJEKTESANA_ENGINE ?? "unknown",
	dataDir: env.PROJEKTESANA_DATA ?? join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..", "data"),
	revision: env.PROJEKTESANA_REVISION,
	libraryDir: env.PROJEKTESANA_LIBRARY,
};
const mode = env.PROJEKTESANA_MODE === "setup" ? "setup" : env.PROJEKTESANA_MODE === "gather" ? "gather" : "model";

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (v: unknown): Out => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
async function run(fn: () => Promise<unknown> | unknown): Promise<Out> {
	try {
		return text(await fn());
	} catch (e) {
		return { content: [{ type: "text", text: (e as Error).message }], isError: true };
	}
}

const server = new McpServer({ name: "projektesana-tools", version: "0.1.0" });
const stage = z.enum(["koncepcija", "skice", "mbp", "bp"]);
const source = z.union([
	z.object({ kind: z.literal("file"), path: z.string(), quote: z.string().describe("Verbatim text from the file") }),
	z.object({ kind: z.literal("boris"), quote: z.string().describe("Verbatim text Boris wrote in the chat"), at: z.string() }),
]);

server.registerTool("list_files", { description: "Registered project files (PU, site data, ...) with role and status.", inputSchema: {} }, () => run(() => t.listFiles(ctx)));
server.registerTool("read_doc", { description: "Read the text of a registered project file (txt, md, json, csv, pdf).", inputSchema: { path: z.string() } }, ({ path }) => run(() => t.readDoc(ctx, path)));
server.registerTool("project_brief", { description: "The project brief so far: facts with their sources.", inputSchema: {} }, () => run(() => t.projectBrief(ctx)));
server.registerTool("rules_for_stage", { description: "Group, procedure and required AR/GP content for a stage, each with article, URL and verbatim quote.", inputSchema: { stage } }, ({ stage: s }) => run(() => t.rulesForStage(ctx, s)));
server.registerTool(
	"search_sources",
	{
		description: "Search the law library (likumi.lv acts, LBN, LVS standards and EU acts Boris added) for paragraphs containing all the words. Returns verbatim paragraphs with title, URL and read date — cite them, never paraphrase as law.",
		inputSchema: { query: z.string(), category: z.enum(["likums", "mk", "lvs", "es"]).optional() },
	},
	({ query, category }) => run(() => t.searchSources(ctx, query, category)),
);
server.registerTool("add_note", { description: "Add a note to the project log.", inputSchema: { text: z.string() } }, ({ text: x }) => run(() => t.addNote(ctx, x)));

if (mode === "setup" || mode === "gather") {
	server.registerTool(
		"set_fact",
		{ description: "Record a brief fact. Needs a verbatim quote from a registered file or from Boris's chat messages; code checks it. Ids: checklist ids or engine.<key>.", inputSchema: { id: z.string(), value: z.string(), source } },
		({ id, value, source: s }) => run(() => t.setFactTool(ctx, id, value, s as never)),
	);
}
if (mode === "gather") {
	server.registerTool(
		"set_file_role",
		{
			description: "Propose a role for a registered file. The quote is the words in the file (or its name) that show the role. Boris confirms.",
			inputSchema: { path: z.string(), role: z.enum(ROLES), quote: z.string() },
		},
		({ path, role, quote }) => run(() => t.setFileRoleTool(ctx, path, role, quote)),
	);
	server.registerTool(
		"add_tr",
		{
			description: "Record a technical-rules request or document found in a project file. The file and a verbatim quote prove it; Boris confirms.",
			inputSchema: {
				who: z.string().describe("Who issues the rules: Rīgas dome, Sadales tīkls, Latvijas Gāze, ..."),
				issuer: z.enum(["state_municipal", "network_owner"]),
				status: z.enum(["pieprasīts", "saņemts"]),
				requested_on: z.string().nullable().describe("YYYY-MM-DD from the document, or null"),
				received_on: z.string().nullable().describe("YYYY-MM-DD from the document, or null"),
				file: z.string(),
				quote: z.string(),
				note: z.string().optional(),
			},
		},
		(a) => run(() => t.addTrTool(ctx, a as never)),
	);
	server.registerTool(
		"cite_law",
		{
			description: "Cite a library paragraph that applies to this project. source_id and quote come from search_sources; code checks the quote against the library.",
			inputSchema: { category: z.enum(["likums", "mk", "lvs", "es"]), source_id: z.string(), quote: z.string(), why: z.string().describe("Why it applies to this project") },
		},
		(a) => run(() => t.citeLawTool(ctx, a)),
	);
}
if (mode === "setup") {
	server.registerTool(
		"mark_unknown",
		{ description: "Mark a checklist item unknown. Needs a verbatim quote of Boris saying so.", inputSchema: { id: z.string(), boris_quote: z.string() } },
		({ id, boris_quote }) => run(() => t.markUnknownTool(ctx, id, boris_quote)),
	);
} else {
	server.registerTool("list_open_pins", { description: "Boris's open pins and comments: this is your task list.", inputSchema: {} }, () => run(() => t.listOpenPins(ctx)));
	server.registerTool("resolve_pin", { description: "Mark a pin addressed, with what you changed. Boris closes it.", inputSchema: { pin_id: z.string(), note: z.string() } }, ({ pin_id, note }) => run(() => t.resolvePin(ctx, pin_id, note)));
	server.registerTool("finish_revision", { description: "Hand the batch to Boris. The app exports PDFs and IFC. You cannot approve.", inputSchema: { summary: z.string() } }, ({ summary }) => run(() => t.finishRevision(ctx, summary)));
}

await server.connect(new StdioServerTransport());

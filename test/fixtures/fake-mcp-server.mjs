// A tiny stdio MCP server for the tests of an agent's own MCP servers (test/17.2-agent-mcp.test.ts): two tools, and the value of the environment variable SECRET_NAME
// reported by `whoami`, so a test can see the saved secret reached the program. Invented content only.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "1.0.0" });
server.registerTool("lookup", { description: "Looks a word up. Reads only.", inputSchema: { word: z.string() } }, async ({ word }) => ({ content: [{ type: "text", text: `found ${word}` }] }));
server.registerTool("write_note", { description: "Writes a note." , inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text: `wrote ${text}` }] }));
server.registerTool("whoami", { description: "Tells the secret it was started with.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: `secret=${process.env.SECRET_NAME ?? ""}` }] }));
await server.connect(new StdioServerTransport());

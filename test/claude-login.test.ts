// Claude sign-in (src/agent/claude/login.ts): the link filter, the code check, `auth status --json`, the environment, and the flow with a fake claude.exe.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { claudeEnv } from "../src/agent/claude/run.ts";
import { ClaudeAccount, claudeAuthStatus, claudeBaseEnv, claudeLoginCode, claudeLoginPrompt, claudeSignInLink, parseClaudeAuthStatus, type ClaudeAuthInfo, type ClaudeLoginResult } from "../src/agent/claude/login.ts";

test("link filter: only Anthropic's https links, no credentials; the unfinished last line is not taken", () => {
	assert.equal(claudeSignInLink("https://claude.ai/oauth/authorize?code=true&state=x"), "https://claude.ai/oauth/authorize?code=true&state=x");
	assert.equal(claudeSignInLink("https://platform.claude.com/x"), "https://platform.claude.com/x");
	assert.equal(claudeSignInLink("http://claude.ai/x"), null);
	assert.equal(claudeSignInLink("https://claude.ai.evil.com/x"), null);
	assert.equal(claudeSignInLink("https://user:pw@claude.ai/x"), null);
	assert.equal(claudeSignInLink("not a url"), null);
	const out = "Opening browser to sign in…\nIf the browser did not open, visit: https://claude.ai/oauth/authorize?x=1.\nPaste code here if prompted > ";
	assert.deepEqual(claudeLoginPrompt(out), { url: "https://claude.ai/oauth/authorize?x=1" });
	assert.equal(claudeLoginPrompt("visit https://claude.ai/oauth/authorize?x=1"), null, "no newline yet: the link may still be arriving");
	assert.equal(claudeLoginPrompt("see https://example.com/phish\n"), null);
	assert.deepEqual(claudeLoginPrompt("\u001b[1mvisit\u001b[0m https://claude.ai/a\nnext"), { url: "https://claude.ai/a" });
});

test("pasted code: Anthropic's code shape, nothing else reaches stdin", () => {
	assert.equal(claudeLoginCode("  abcDEF123456#state_1  "), "abcDEF123456#state_1");
	assert.equal(claudeLoginCode("short"), null);
	assert.equal(claudeLoginCode("two words here 12345"), null);
	assert.equal(claudeLoginCode("abc123456\nrm -rf"), null);
});

test("auth status: only loggedIn true/false count; account fields are bounded", () => {
	assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":false}'), { state: "out" });
	assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":true,"email":"a@b.lv","orgName":"BD"}'), { state: "in", account: { email: "a@b.lv", organization: "BD" } });
	assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":true,"email":"not an email"}'), { state: "in" });
	assert.deepEqual(parseClaudeAuthStatus("garbage"), { state: "unknown" });
	assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":"yes"}'), { state: "unknown" });
});

test("auth status run: exit 1 with loggedIn false is out; a timeout (killed) says nothing", async () => {
	const out = await claudeAuthStatus("claude", {}, ((_f: string, _a: string[], _o: unknown, cb: (e: Error | null, s: string) => void) => cb(Object.assign(new Error("exit 1"), { code: 1 }), '{"loggedIn":false}')) as never);
	assert.deepEqual(out, { state: "out" });
	const timeout = await claudeAuthStatus("claude", {}, ((_f: string, _a: string[], _o: unknown, cb: (e: Error | null, s: string) => void) => cb(Object.assign(new Error("timeout"), { killed: true }), "")) as never);
	assert.deepEqual(timeout, { state: "unknown" });
});

test("environment: no account variables from the shell reach the program; the setup-token only when there is one", () => {
	const shell = { PATH: "p", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "u", CLAUDE_CODE_OAUTH_TOKEN: "shell-token", CLAUDE_CONFIG_DIR: "C:\\users\\own\\.claude" };
	const base = claudeBaseEnv("C:\\app\\claude-code", shell);
	assert.equal(base.ANTHROPIC_API_KEY, undefined);
	assert.equal(base.CLAUDE_CODE_OAUTH_TOKEN, undefined);
	assert.equal(base.CLAUDE_CONFIG_DIR, "C:\\app\\claude-code");
	assert.equal(base.PATH, "p");
	const cfg = { configDir: "C:\\app\\claude-code", clientApp: "projektesana/test" };
	assert.equal(claudeEnv(null, cfg, shell).CLAUDE_CODE_OAUTH_TOKEN, undefined, "a login run: the shell's token must not win");
	assert.equal(claudeEnv("app-token", cfg, shell).CLAUDE_CODE_OAUTH_TOKEN, "app-token");
	assert.equal(claudeEnv("app-token", cfg, shell).ANTHROPIC_API_KEY, undefined);
});

/** A claude.exe stand-in: prints what the real one prints, takes the code on stdin, closes when told. */
function fake() {
	const log: { args: string[]; stdin: string }[] = [];
	type Fake = EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; exitCode: number | null; signalCode: null; pid: number; kill: () => void };
	let child: Fake | null = null;
	const spawn = (_file: string, args: string[]) => {
		const c: Fake = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(),
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			exitCode: null as number | null,
			signalCode: null,
			pid: 0,
			kill() {
				c.exitCode = 1;
				c.emit("exit", 1);
				c.emit("close", 1);
			},
		});
		const entry = { args, stdin: "" };
		c.stdin.on("data", (d: Buffer) => (entry.stdin += d.toString()));
		log.push(entry);
		child = c;
		if (args[1] === "logout") setImmediate(() => c.emit("close", 0));
		return c as never;
	};
	return {
		spawn,
		log,
		get child() {
			return child!;
		},
		close(code = 0) {
			child!.exitCode = code;
			child!.emit("exit", code);
			child!.emit("close", code);
		},
	};
}

test("sign-in flow: link shown, one login at a time, the code goes to stdin, `auth status` confirms", async () => {
	const f = fake();
	let state: ClaudeAuthInfo = { state: "out" };
	let changes = 0;
	const acct = new ClaudeAccount({ cli: () => "claude.exe", configDir: "C:\\app\\claude-code", spawn: f.spawn as never, status: async () => state, onChange: () => changes++ });
	const ends: ClaudeLoginResult[] = [];
	const started = acct.start((r) => ends.push(r));
	await new Promise((r) => setTimeout(r, 10));
	f.child.stdout.write("Opening browser…\nVisit https://claude.ai/oauth/authorize?x=1\nPaste code here if prompted > ");
	assert.deepEqual(await started, { url: "https://claude.ai/oauth/authorize?x=1" });
	assert.deepEqual(f.log[0]!.args, ["auth", "login"]);
	assert.equal(acct.busy, true);
	assert.deepEqual(await acct.start((r) => ends.push(r)), { url: "https://claude.ai/oauth/authorize?x=1" }, "a second click joins the same login");
	assert.equal(f.log.length, 1);
	assert.throws(() => acct.complete("bad code"), /kodu/);
	acct.complete("abcDEF123456#state");
	assert.equal(f.log[0]!.stdin, "abcDEF123456#state\n");
	assert.throws(() => acct.complete("abcDEF123456#state"), /jau nosūtīts/);
	state = { state: "in", account: { email: "boris@buvdizains.lv" } };
	f.close(0);
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(ends.length, 1, "the ended sign-in is reported once");
	assert.deepEqual(ends[0], { ok: true });
	assert.equal(acct.peek().account?.email, "boris@buvdizains.lv");
	assert.equal(acct.busy, false);
	assert.ok(changes >= 1);
	assert.equal(await acct.ensureSignedIn(), true);
});

test("sign-in flow: a program that ends without a login is a failure; sign-out confirms with auth status", async () => {
	const f = fake();
	let state: ClaudeAuthInfo = { state: "out" };
	const acct = new ClaudeAccount({ cli: () => "claude.exe", configDir: "C:\\app\\claude-code", spawn: f.spawn as never, status: async () => state });
	const ends: ClaudeLoginResult[] = [];
	const started = acct.start((r) => ends.push(r));
	await new Promise((r) => setTimeout(r, 10));
	f.child.stdout.write("Visit https://claude.ai/a\n");
	await started;
	f.close(1);
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(ends[0]?.ok, false);

	state = { state: "in" };
	await acct.refresh();
	await assert.rejects(acct.signOut(), /joprojām/, "the program still says signed in: not a sign-out");
	assert.deepEqual(f.log.at(-1)!.args, ["auth", "logout"]);
	state = { state: "out" };
	await acct.signOut();
	assert.equal(acct.peek().state, "out");
});

test("sign-in flow: already signed in is not replaced", async () => {
	const f = fake();
	const acct = new ClaudeAccount({ cli: () => "claude.exe", configDir: "C:\\app\\claude-code", spawn: f.spawn as never, status: async () => ({ state: "in" }) });
	const ends: ClaudeLoginResult[] = [];
	assert.deepEqual(await acct.start((r) => ends.push(r)), { url: null });
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(f.log.length, 0, "no `auth login` was started");
	assert.deepEqual(ends, [{ ok: true }]);
});

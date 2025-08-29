import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	CallToolResultSchema,
	ListToolsResultSchema,
	EmptyResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline";

type ServerTarget =
	| {
		kind: "script";
		interpreter: "node" | "python";
		path: string;
		args: string[];
	}
	| {
		kind: "npx";
		pkg: string;
		version?: string;
		bin?: string;
		args: string[];
		npxArgs?: string[];
	};

function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
	const cleaned = Object.fromEntries(
		Object.entries(process.env).filter(([, v]) => typeof v === "string")
	) as Record<string, string>;
	return { ...cleaned, ...extra };
}

function parseServerSpec(raw: string, serverArgs: string[]): { target: ServerTarget; } {
	// Forma: npx:@scope/pkg[@version][#bin]
	if (raw.startsWith("npx:")) {
		const spec = raw.slice("npx:".length);
		const [pkgAndVer, bin] = spec.split("#");

		const atIdx = pkgAndVer.lastIndexOf("@");
		let pkg = pkgAndVer;
		let version: string | undefined;
		// Si l'@ no és part de l'scope, l'interpretem com a versió
		if (atIdx > 0 && pkgAndVer.slice(atIdx - 1, atIdx) !== "/") {
			pkg = pkgAndVer.slice(0, atIdx);
			version = pkgAndVer.slice(atIdx + 1);
		}

		return {
			target: {
				kind: "npx",
				pkg,
				version,
				bin: bin || undefined,
				args: serverArgs,
				npxArgs: ["-y"], // evita prompts de npx
			},
		};
	}

	// Script local .js o .py
	const isPy = raw.endsWith(".py");
	const isJs = raw.endsWith(".js");
	if (!isPy && !isJs) {
		throw new Error(
			"Provide a .js/.py path or use the form npx:@scope/pkg[@ver][#bin]"
		);
	}

	return {
		target: {
			kind: "script",
			interpreter: isPy ? "python" : "node",
			path: raw,
			args: serverArgs,
		},
	};
}

class MCPReplClient {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private lastTools: Array<{ name: string; description?: string; inputSchema?: unknown; }> = [];

	async connect(target: ServerTarget): Promise<void> {
		if (target.kind === "script") {
			const pythonCmd = process.env.PYTHON_CMD || "python";
			const cmd = target.interpreter === "node" ? process.execPath : pythonCmd;

			this.transport = new StdioClientTransport({
				command: cmd,
				args: [target.path, ...target.args],
				env: safeEnv(),
			});
		} else {
			const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
			const pkgWithVer = target.version ? `${target.pkg}@${target.version}` : target.pkg;

			const args = target.bin
				? [...(target.npxArgs ?? ["-y"]), "-p", pkgWithVer, target.bin, ...target.args]
				: [...(target.npxArgs ?? ["-y"]), pkgWithVer, ...target.args];

			this.transport = new StdioClientTransport({
				command: npxCmd,
				args,
				env: safeEnv({ NO_UPDATE_NOTIFIER: "1" }),
			});
		}

		this.client = new Client(
			{ name: "mcp-repl-client", version: "1.0.0" },
			{ capabilities: {} }
		);

		await this.client.connect(this.transport);

		const list = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
		this.lastTools = list.tools.map((t: any) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema ?? t.input_schema ?? t.inputschema,
		}));

		console.log(
			"Connected. Tools:",
			this.lastTools.map((t) => t.name).join(", ") || "(none)"
		);
	}

	async refreshTools(): Promise<void> {
		this.ensureConnected();
		const list = await this.client!.request({ method: "tools/list" }, ListToolsResultSchema);
		this.lastTools = list.tools.map((t: any) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema ?? t.input_schema ?? t.inputschema,
		}));
	}

	async listTools(): Promise<void> {
		if (!this.lastTools.length) await this.refreshTools();
		for (const t of this.lastTools) {
			console.log(`- ${t.name}${t.description ? `: ${t.description}` : ""}`);
		}
	}

	async describeTool(name: string): Promise<void> {
		if (!this.lastTools.length) await this.refreshTools();
		const t = this.lastTools.find((x) => x.name === name);
		if (!t) {
			console.error(`Tool not found: ${name}`);
			return;
		}
		console.log(JSON.stringify(t, null, 2));
	}


	async setLoggingLevel(level: string) {
		const res = await this.client!.request(
			{ method: "logging/setLevel", params: { level } },
			EmptyResultSchema
		);

		// El resultat és un array de content blocks MCP. El printem tal qual en JSON.
		console.log(JSON.stringify(res, null, 2));
	}

	async callTool(name: string, args: unknown): Promise<void> {
		this.ensureConnected();
		const res = await this.client!.request(
			{
				method: "tools/call",
				// ⬇️  AIXÒ és el bo: 'arguments', no 'args'
				params: { name, arguments: args },
			},
			CallToolResultSchema
		);
		console.log(JSON.stringify(res, null, 2));
	}

	async disconnect(): Promise<void> {
		if (this.transport) {
			await this.transport.close();
		}
	}

	private ensureConnected() {
		if (!this.client) {
			throw new Error("Client not connected");
		}
	}
}

// ---------- REPL ----------

function tokenize(input: string): string[] {
	// Split simple amb suport de cometes simples/dobles
	const result: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (let i = 0;i < input.length;i++) {
		const ch = input[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else if (ch === "\\" && i + 1 < input.length) {
				// escape bàsic dins de cometes
				i++;
				current += input[i];
			} else {
				current += ch;
			}
		} else {
			if (ch === '"' || ch === "'") {
				quote = ch as '"' | "'";
			} else if (/\s/.test(ch)) {
				if (current) {
					result.push(current);
					current = "";
				}
			} else {
				current += ch;
			}
		}
	}
	if (current) result.push(current);
	return result;
}

async function startRepl(cli: MCPReplClient) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "mcp> " });

	const cleanupAndExit = async (code = 0) => {
		rl.pause();
		try {
			await cli.disconnect();
		} catch {
			// ja ens entenem
		} finally {
			process.exit(code);
		}
	};

	rl.on("SIGINT", async () => {
		console.log("\nTancant…");
		await cleanupAndExit(0);
	});

	rl.on("close", async () => {
		console.log("");
		await cleanupAndExit(0);
	});

	const helpText = `
Comandes:
  list
  describe <toolName>
  call <toolName> '<jsonArgs>'
  help
  exit | quit
`.trim();

	console.log("REPL actiu. Escriu 'help' si has oblidat què vols fer.");
	rl.prompt();

	rl.on("line", async (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			rl.prompt();
			return;
		}

		const args = tokenize(trimmed);
		const cmd = args[0];

		try {
			switch (cmd) {
				case "help":
					console.log(helpText);
					break;
				case "exit":
				case "quit":
					await cleanupAndExit(0);
					return;
				case "list":
					await cli.listTools();
					break;
				case "describe": {
					const name = args[1];
					if (!name) {
						console.error("Usage: describe <toolName>");
						break;
					}
					await cli.describeTool(name);
					break;
				}
				case "call": {
					const name = args[1];
					const jsonArgStr = args.slice(2).join(" ");
					if (!name) {
						console.error("Usage: call <toolName> '<jsonArgs>'");
						break;
					}
					let parsed: unknown = {};
					if (jsonArgStr) {
						try {
							parsed = JSON.parse(jsonArgStr);
						} catch (e) {
							console.error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
							break;
						}
					}
					await cli.callTool(name, parsed);
					break;
				}
				case "setLoggingLevel": {
					if (args.length < 2) {
						console.error("Usage: setLoggingLevel <level>");
						break;
					}
					let level = args[1].toLowerCase();

					await cli.setLoggingLevel(level);
					console.log(`Logging level set to ${level}`);
					break;
				}
				default:
					console.error(`Comanda desconeguda: ${cmd}`);
					console.log("Escriu 'help' si et cal memòria assistida.");
			}
		} catch (err) {
			console.error("Error:", err instanceof Error ? err.message : err);
		} finally {
			rl.prompt();
		}
	});
}

// ---------- MAIN ----------

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length < 1) {
		console.error(`
Usage:
  ts-node src/client.ts <path_or_npx_spec> -- [serverArgs...]

Examples:
  ts-node src/client.ts "npx:@scope/mcp-server@0.3.1#mcp-server" -- --stdio
  ts-node src/client.ts ./server.js -- --stdio
  ts-node src/client.ts ./server.py -- --stdio
`.trim());
		process.exit(2);
	}

	const sepIdx = argv.indexOf("--");
	const spec = argv[0];
	const serverArgs = sepIdx === -1 ? argv.slice(1) : argv.slice(sepIdx + 1);

	const { target } = parseServerSpec(spec, serverArgs);

	const cli = new MCPReplClient();
	try {
		await cli.connect(target);
		await startRepl(cli);
	} catch (err) {
		console.error("Error:", err instanceof Error ? err.message : err);
		try {
			await cli.disconnect();
		} catch {
			// tant se val
		}
		process.exit(1);
	}
}

// Only run if invoked directly
if (import.meta.url === new URL(process.argv[1], "file:").href) {
	main();
}
#!/usr/bin/env node

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema, ListToolsResultSchema, EmptyResultSchema, LoggingMessageNotificationSchema, ResourceListChangedNotificationSchema, ListResourcesResultSchema, ResourceUpdatedNotificationSchema, ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';

type ServerTarget =
	| {
			kind: 'script';
			interpreter: 'node' | 'python';
			path: string;
			args: string[];
	  }
	| {
			kind: 'npx';
			pkg: string;
			version?: string;
			bin?: string;
			args: string[];
			npxArgs?: string[];
	  };

interface ServerCapabilities {
	logging?: boolean;
	resources?: boolean;
	[key: string]: unknown;
}

interface ToolInfo {
	name: string;
	description?: string;
	inputSchema?: unknown;
	[key: string]: unknown; // Add index signature to allow dynamic property access
}

interface ResourceInfo {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
	annotations?: Record<string, unknown>;
}

interface ResourceData {
	name?: string;
	description?: string;
	mimeType?: string;
	annotations?: Record<string, unknown>;
}

function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
	const cleaned = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
	return {...cleaned, ...extra};
}

function parseServerSpec(raw: string, serverArgs: string[]): {target: ServerTarget} {
	// Forma: npx:@scope/pkg[@version][#bin]
	if (raw.startsWith('npx:')) {
		const spec = raw.slice('npx:'.length);
		const [pkgAndVer, bin] = spec.split('#');

		const atIdx = pkgAndVer.lastIndexOf('@');
		let pkg = pkgAndVer;
		let version: string | undefined;
		// Si l'@ no és part de l'scope, l'interpretem com a versió
		if (atIdx > 0 && pkgAndVer.slice(atIdx - 1, atIdx) !== '/') {
			pkg = pkgAndVer.slice(0, atIdx);
			version = pkgAndVer.slice(atIdx + 1);
		}

		return {
			target: {
				kind: 'npx',
				pkg,
				version,
				bin: bin || undefined,
				args: serverArgs,
				npxArgs: ['-y'] // evita prompts de npx
			}
		};
	}

	// Script local .js o .py
	const isPy = raw.endsWith('.py');
	const isJs = raw.endsWith('.js');
	if (!(isPy || isJs)) {
		throw new Error('Provide a .js/.py path or use the form npx:@scope/pkg[@ver][#bin]');
	}

	return {
		target: {
			kind: 'script',
			interpreter: isPy ? 'python' : 'node',
			path: raw,
			args: serverArgs
		}
	};
}

class TestMcpClient {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private serverCapabilities: ServerCapabilities | null = null;

	private lastTools: ToolInfo[] = [];
	private resources: Record<string, ResourceInfo> = {};
	private quiet = false;

	async connect(target: ServerTarget, options?: {quiet?: boolean}): Promise<void> {
		this.quiet = Boolean(options?.quiet);
		if (target.kind === 'script') {
			const pythonCmd = process.env.PYTHON_CMD || 'python';
			const cmd = target.interpreter === 'node' ? process.execPath : pythonCmd;

			this.transport = new StdioClientTransport({
				command: cmd,
				args: [target.path, ...target.args],
				env: safeEnv()
			});
		} else {
			const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
			const pkgWithVer = target.version ? `${target.pkg}@${target.version}` : target.pkg;

			const args = target.bin ? [...(target.npxArgs ?? ['-y']), '-p', pkgWithVer, target.bin, ...target.args] : [...(target.npxArgs ?? ['-y']), pkgWithVer, ...target.args];

			this.transport = new StdioClientTransport({
				command: npxCmd,
				args,
				env: safeEnv({NO_UPDATE_NOTIFIER: '1'})
			});
		}

		this.client = new Client(
			{name: 'IBM Salesforce MCP Test Client', version: '0.0.1'},
			{
				capabilities: {
					roots: {listChanged: true},
					logging: {}
				}
			}
		);

		await this.client.connect(this.transport);

		this.serverCapabilities = (await this.client.getServerCapabilities()) as ServerCapabilities | null;
		if (!this.quiet) {
			console.log(`Server capabilities: ${JSON.stringify(this.serverCapabilities, null, 2)}\n`);
		}

		if (this.serverCapabilities?.logging) {
			this.client.setLoggingLevel('info');

			this.client?.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
				if (!this.quiet) {
					const {level, logger, data} = n.params;
					console.log(`Server log: [${level}]${logger ? ` [${logger}]` : ''}:`, data);
				}
			});
		}

		this.client.setRequestHandler(ListRootsRequestSchema, async (_) => {
			return {roots: []};
		});

		// Carregar la llista inicial de recursos
		if (this.serverCapabilities?.resources) {
			try {
				const resourcesResult = await this.client.request({method: 'resources/list', params: {}}, ListResourcesResultSchema);
				this.resources = resourcesResult.resources.reduce((acc: Record<string, ResourceInfo>, r: ResourceInfo) => {
					acc[r.uri] = {
						uri: r.uri,
						name: r.name,
						description: r.description,
						mimeType: r.mimeType,
						annotations: r.annotations
					};
					return acc;
				}, {});
				if (!this.quiet) {
					if (Object.keys(this.resources).length) {
						console.log(`Resources: ${Object.keys(this.resources).join(', ') || '(none)'}\n`);
					}
				}
			} catch {
				if (!this.quiet) {
					console.log('Failed to load initial resources list');
				}
			}
		}

		if (this.serverCapabilities?.resources) {
			this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
				try {
					const resourcesResult = await this.client?.request({method: 'resources/list', params: {}}, ListResourcesResultSchema);
					if (resourcesResult) {
						this.resources = resourcesResult.resources.reduce((acc: Record<string, ResourceInfo>, r: ResourceInfo) => {
							acc[r.uri] = {
								uri: r.uri,
								name: r.name,
								description: r.description,
								mimeType: r.mimeType,
								annotations: r.annotations
							};
							return acc;
						}, {});
					}
				} catch {
					if (!this.quiet) {
						console.log('Failed to list resources after change notification');
					}
				}
			});

			this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
				const {uri} = notification.params as {uri: string};

				// Actualitzar només el recurs específic que s'ha modificat
				try {
					const resource = await this.client?.readResource({uri});
					if (resource) {
						const resourceData = resource as ResourceData;
						this.resources[uri] = {
							uri: uri,
							name: typeof resourceData.name === 'string' ? resourceData.name : '',
							description: typeof resourceData.description === 'string' ? resourceData.description : undefined,
							mimeType: typeof resourceData.mimeType === 'string' ? resourceData.mimeType : undefined,
							annotations: resourceData.annotations
						};
					}
				} catch (error) {
					if (!this.quiet) {
						console.log(`Failed to update resource ${uri}:`, error);
					}
				}
			});
		}

		this.client.fallbackNotificationHandler = async (notif) => {
			if (!this.quiet) {
				console.warn('Gestió de tipus de notificació no implementada al client:', notif.method, notif.params);
			}
		};

		this.client.sendRootsListChanged();

		const toolsList = await this.client.request({method: 'tools/list'}, ListToolsResultSchema);
		this.lastTools = toolsList.tools.map((t: ToolInfo) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema ?? t.input_schema ?? t.inputschema
		}));
		if (!this.quiet) {
			console.log(`Tools:\n   ${this.lastTools.map((t) => t.name).join('\n   ') || '(none)'}\n`);
		}
	}

	private ensureConnected() {
		if (!this.client) {
			throw new Error('Client not connected');
		}
	}

	async setLoggingLevel(level: string) {
		await this.client?.request({method: 'logging/setLevel', params: {level}}, EmptyResultSchema);
	}

	async listTools(): Promise<void> {
		this.ensureConnected();
		await this.client?.listTools();
	}

	/**
	 * Returns the last known tool list.
	 */
	getTools(): ToolInfo[] {
		return this.lastTools.slice();
	}

	/**
	 * Returns a single tool definition by name if available.
	 */
	describeTool(name: string): ToolInfo | undefined {
		return this.lastTools.find((t) => t.name === name);
	}

	getResources(): ResourceInfo[] {
		return Object.values(this.resources);
	}

	getResource(uri: string): ResourceInfo | undefined {
		return this.resources[uri];
	}

	async callTool(name: string, args: unknown) {
		this.ensureConnected();
		return await this.client?.callTool({name, arguments: args as Record<string, unknown>}, CallToolResultSchema);
	}

	async disconnect(): Promise<void> {
		if (this.transport) {
			await this.transport.close();
		}
	}

	private readonly LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

	getLogLevels(): string[] {
		return this.LOG_LEVELS.slice();
	}
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length < 1) {
		console.error(
			`
Usage:
  ts-node src/client.ts <path_or_npx_spec> [--cli] [--run-tool "<tool> <jsonArgs>"] -- [serverArgs...]

Examples:
  ts-node src/client.ts "npx:@scope/mcp-server@0.3.1#mcp-server" --cli -- --stdio
  ts-node src/client.ts ./server.js --cli -- --stdio
  ts-node src/client.ts ./server.py -- --stdio
  ts-node src/client.ts ./server.js -- --stdio  # JSON-RPC listener mode (default)
  ts-node src/client.ts ./server.js --run-tool "echo {"text":"hello"}" -- --stdio
`.trim()
		);
		process.exit(2);
	}

	// Flags parsing
	const cliFlagIndex = argv.indexOf('--cli');
	const useCli = cliFlagIndex !== -1;

	const runToolIdx = argv.indexOf('--run-tool');
	const runTool = runToolIdx !== -1;
	const runToolArg = runTool ? argv[runToolIdx + 1] : undefined;
	if (runTool && (runToolArg === undefined || runToolArg.startsWith('--'))) {
		console.error('Error: --run-tool requires a quoted string: "<tool> <jsonArgs>"');
		process.exit(2);
	}

	// Build args for server spec/args by stripping known flags
	let cleanArgv = argv.slice();
	if (useCli) {
		cleanArgv = cleanArgv.filter((_, i) => i !== cliFlagIndex);
	}
	if (runTool) {
		// Remove flag and its single argument (quoted string)
		cleanArgv = cleanArgv.filter((_, i) => i !== runToolIdx && i !== runToolIdx + 1);
	}

	const sepIdx = cleanArgv.indexOf('--');
	const spec = cleanArgv[0];
	const serverArgs = sepIdx === -1 ? cleanArgv.slice(1) : cleanArgv.slice(sepIdx + 1);

	const {target} = parseServerSpec(spec, serverArgs);

	const cli = new TestMcpClient();
	try {
		await cli.connect(target, {quiet: runTool});

		if (runTool) {
			// Parse: "<tool> <jsonArgs>"
			const raw = runToolArg as string;
			const firstSpace = raw.indexOf(' ');
			const toolName = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
			const argsRaw = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
			let args: unknown = {};
			if (argsRaw) {
				try {
					args = JSON.parse(argsRaw);
				} catch (e) {
					console.error('Invalid JSON for --run-tool:', e instanceof Error ? e.message : e);
					await cli.disconnect();
					process.exit(1);
				}
			}
			try {
				const res = await cli.callTool(toolName, args);
				// Only output the tool response
				process.stdout.write(`${JSON.stringify(res)}\n`);
				await cli.disconnect();
				return;
			} catch (e) {
				console.error(e instanceof Error ? e.message : e);
				await cli.disconnect();
				process.exit(1);
			}
		}

		if (useCli) {
			await runInteractiveCli(cli);
			await cli.disconnect();
			return;
		}
	} catch (err) {
		console.error('Error:', err instanceof Error ? err.message : err);
		try {
			await cli.disconnect();
		} catch {
			// tant se val
		}
		process.exit(1);
	}
}

// Only run if invoked directly
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
	main();
}

// Exports per a ús com a llibreria
export {TestMcpClient};
export {Client} from '@modelcontextprotocol/sdk/client/index.js';
export {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
export type {ServerTarget};

async function runInteractiveCli(client: TestMcpClient): Promise<void> {
	const COMMANDS = ['list', 'describe', 'call', 'setLoggingLevel', 'resources', 'resource', 'help', 'exit', 'quit'];

	const rl = createInterface({
		input,
		output,
		historySize: 100,
		completer: (line: string): [string[], string] => {
			const trimmed = line;

			// Completing the first token (the command)
			if (!trimmed.includes(' ')) {
				const hits = COMMANDS.filter((c) => c.toLowerCase().startsWith(trimmed.toLowerCase()));
				return [hits.length ? hits : COMMANDS, trimmed];
			}

			const firstSpace = trimmed.indexOf(' ');
			const cmd = trimmed.slice(0, firstSpace);
			const rest = trimmed.slice(firstSpace + 1);

			// Suggest tool names for describe/call when typing the first argument
			if (cmd === 'describe' || cmd === 'call') {
				// Only complete the first arg (tool name). If user already added a space, stop.
				if (rest.includes(' ')) {
					return [[], ''];
				}
				const tools = client.getTools().map((t) => t.name);
				const hits = tools.filter((t) => t.toLowerCase().startsWith(rest.toLowerCase()));
				return [hits.length ? hits : tools, rest];
			}

			return [[], ''];
		}
	});

	const goodbye = async () => {
		try {
			await client.disconnect();
		} catch {
			// ignore
		}
		rl.close();
	};

	process.on('SIGINT', async () => {
		console.log('\nCaught SIGINT. Exiting...');
		await goodbye();
		process.exit(0);
	});

	console.log('Interactive MCP client. Type "help" for commands.');
	printQuickIntro();

	while (true) {
		const line = (await rl.question('> ')).trim();
		if (!line) {
			continue;
		}

		const [cmd, ...restParts] = line.split(' ');
		const rest = restParts.join(' ').trim();

		try {
			switch (cmd.toLowerCase()) {
				case 'help':
					printHelp();
					break;
				case 'exit':
				case 'quit':
					await goodbye();
					return;
				case 'list': {
					const tools = client.getTools();
					if (!tools.length) {
						console.log('(no tools)');
						break;
					}
					for (const t of tools) {
						console.log(`- ${t.name}${t.description ? `: ${t.description}` : ''}`);
					}
					break;
				}
				case 'describe': {
					if (!rest) {
						console.log('Usage: describe <toolName>');
						break;
					}
					const tool = client.describeTool(rest);
					if (!tool) {
						console.log(`Tool not found: ${rest}`);
						break;
					}
					console.log(JSON.stringify(tool, null, 2));
					break;
				}
				case 'call': {
					if (!rest) {
						console.log("Usage: call <toolName> '<jsonArgs>'");
						break;
					}
					const firstSpace = rest.indexOf(' ');
					const toolName = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
					const argsRaw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
					let args: unknown = {};
					if (argsRaw) {
						try {
							args = JSON.parse(stripQuotes(argsRaw));
						} catch (e) {
							console.error('Invalid JSON args:', e instanceof Error ? e.message : e);
							break;
						}
					}

					const res = await client.callTool(toolName, args);
					console.log(JSON.stringify(res, null, 2));
					break;
				}
				case 'setlogginglevel': {
					const level = rest.toLowerCase();
					if (!level) {
						console.log('Usage: setLoggingLevel <level>');
						break;
					}
					if (!client.getLogLevels().includes(level)) {
						console.log(`Invalid level. Allowed: ${client.getLogLevels().join(', ')}`);
						break;
					}
					await client.setLoggingLevel(level);
					console.log('Logging level set to', level);
					break;
				}
				case 'resources': {
					const all = client.getResources();
					if (!all.length) {
						console.log('(no resources)');
						break;
					}
					for (const r of all) {
						console.log(`- ${r.uri}${r.name ? ` (${r.name})` : ''}${r.mimeType ? ` [${r.mimeType}]` : ''}`);
					}
					break;
				}
				case 'resource': {
					if (!rest) {
						console.log('Usage: resource <uri>');
						break;
					}
					const r = client.getResource(rest);
					if (!r) {
						console.log(`Resource not found: ${rest}`);
						break;
					}
					console.log(JSON.stringify(r, null, 2));
					break;
				}
				default:
					console.log(`Unknown command: ${cmd}`);
					printHelp();
			}
		} catch (err) {
			console.error('Command error:', err instanceof Error ? err.message : err);
		}
	}
}

function printHelp() {
	console.log(
		[
			'Commands:',
			'- list                         List available tools',
			'- describe <tool>              Show tool details',
			"- call <tool> '<jsonArgs>'     Call tool with JSON args",
			'- setLoggingLevel <level>      Set server logging level',
			'- resources                    List known resources',
			'- resource <uri>               Show resource details',
			'- help                         Show this help',
			'- exit | quit                  Exit the client'
		].join('\n')
	);
}

function stripQuotes(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

function printQuickIntro() {
	console.log(['', "Commands: list | describe <tool> | call <tool> '<json>' | setLoggingLevel <level> | resources | resource <uri> | help | exit", ''].join('\n'));
}

#!/usr/bin/env node

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema, ListToolsResultSchema, EmptyResultSchema, LoggingMessageNotificationSchema, ResourceListChangedNotificationSchema, ListResourcesResultSchema, ResourceUpdatedNotificationSchema, ListRootsRequestSchema, LoggingLevelSchema} from '@modelcontextprotocol/sdk/types.js';

import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';

// Constants
const CLIENT_NAME = 'MiCroscoPe';
const CLIENT_VERSION = '0.0.1';

/**
 * Function to format errors consistently
 * @param error Error to handle
 * @returns Formatted error message
 */
function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	} else if (typeof error === 'string') {
		return error;
	} else {
		return String(error);
	}
}

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
	// Forma: npx:@scope/pkg[@version][#bin] [additional args...]
	if (raw.startsWith('npx:')) {
		const spec = raw.slice('npx:'.length);

		// Separate package from additional arguments
		const parts = spec.split(' ');
		const pkgSpec = parts[0];
		const additionalArgs = parts.slice(1);

		// Separate npx arguments from MCP server arguments
		const npxArgs: string[] = [];
		const serverMCPArgs: string[] = [];

		for (const arg of additionalArgs) {
			// Known npx arguments
			if (arg === '-y' || arg === '--yes' || arg === '--package' || arg === '-p') {
				npxArgs.push(arg);
			} else {
				// Other arguments go to the MCP server
				serverMCPArgs.push(arg);
			}
		}

		const [pkgAndVer, bin] = pkgSpec.split('#');

		const atIdx = pkgAndVer.lastIndexOf('@');
		let pkg = pkgAndVer;
		let version: string | undefined;
		// If the @ is not part of the scope, we interpret it as a version
		if (atIdx > 0 && pkgAndVer.slice(atIdx - 1, atIdx) !== '/') {
			pkg = pkgAndVer.slice(0, atIdx);
			version = pkgAndVer.slice(atIdx + 1);
		}

		// If the user has not specified -y, we add it automatically
		const finalNpxArgs = npxArgs.includes('-y') ? npxArgs : ['-y', ...npxArgs];

		return {
			target: {
				kind: 'npx',
				pkg,
				version,
				bin: bin || undefined,
				args: [...serverMCPArgs, ...serverArgs], // Only server MCP arguments
				npxArgs: finalNpxArgs
			}
		};
	}

	// Local script .js or .py
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
			{
				name: CLIENT_NAME,
				version: CLIENT_VERSION
			},
			{
				capabilities: {
					roots: {listChanged: true},
					logging: {}
				}
			}
		);
		await this.client.connect(this.transport);

		this.serverCapabilities = (await this.client.getServerCapabilities()) as ServerCapabilities | null;

		if (this.serverCapabilities?.logging) {
			// Use LoggingLevelSchema to validate the logging level
			const logLevel = process.env.LOG_LEVEL || 'info';
			this.client.setLoggingLevel(LoggingLevelSchema.parse(logLevel));

			this.client?.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
				if (!this.quiet) {
					const {level, logger, data} = n.params;

					// Interrupt current prompt if exists
					if (process.stdout.isTTY && process.stdin.isTTY) {
						process.stdout.clearLine(0); // Clear the current line
						process.stdout.cursorTo(0); // Move the cursor to the beginning
					}

					// Show the log message with previous line break and all the content in orange-brown more dark color
					// Remove the "Server log: " prefix and show only the server information
					console.log(`\n\x1b[38;5;136m[${level}]${logger ? ` ${logger}` : ''}:`, data, `\x1b[0m`);

					// Restore the prompt if we are in interactive mode
					if (process.stdout.isTTY && process.stdin.isTTY) {
						process.stdout.write('> '); // Restore the prompt
					}
				}
			});
		}

		this.client.setRequestHandler(ListRootsRequestSchema, async (_) => {
			return {roots: []};
		});

		// Load initial resources list and configure notification handlers if exists
		if (this.serverCapabilities?.resources) {
			// Load initial resources list
			await this.updateResourcesList('Failed to load initial resources list');

			// Configure notification handler for changes in the resources list
			this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
				await this.updateResourcesList('Failed to list resources after change notification');
			});

			this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
				const {uri} = notification.params as {uri: string};

				// Update only the specific resource that has been modified
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
						// Interrupt current prompt if exists
						if (process.stdout.isTTY && process.stdin.isTTY) {
							process.stdout.clearLine(0); // Clear the current line
							process.stdout.cursorTo(0); // Move the cursor to the beginning
						}

						console.log(`\n\x1b[31mFailed to update resource ${uri}:\x1b[0m`, error);

						// Restore the prompt if we are in interactive mode
						if (process.stdout.isTTY && process.stdin.isTTY) {
							process.stdout.write('> '); // Restore the prompt
						}
					}
				}
			});
		}

		this.client.fallbackNotificationHandler = async (notif) => {
			if (!this.quiet) {
				// Interrupt current prompt if exists
				if (process.stdout.isTTY && process.stdin.isTTY) {
					process.stdout.clearLine(0); // Clear the current line
					process.stdout.cursorTo(0); // Move the cursor to the beginning
				}

				console.warn(`\n\x1b[31mNotification type handling not implemented in client:\x1b[0m`, notif.method, notif.params);

				// Restore the prompt if we are in interactive mode
				if (process.stdout.isTTY && process.stdin.isTTY) {
					process.stdout.write('> '); // Restore the prompt
				}
			}
		};

		this.client.sendRootsListChanged();

		const toolsList = await this.client.request({method: 'tools/list'}, ListToolsResultSchema);
		this.lastTools = toolsList.tools.map((t: ToolInfo) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema ?? t.input_schema ?? t.inputschema
		}));
	}

	/**
	 * Updates the resources list from the server if exists
	 * @param errorMessage Error message to show if the request fails
	 */
	private async updateResourcesList(errorMessage: string): Promise<void> {
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
				// Interrupt current prompt if exists
				if (process.stdout.isTTY && process.stdin.isTTY) {
					process.stdout.clearLine(0); // Clear the current line
					process.stdout.cursorTo(0); // Move the cursor to the beginning
				}

				console.log(`\n\x1b[31m${errorMessage}\x1b[0m`);

				// Restore the prompt if we are in interactive mode
				if (process.stdout.isTTY && process.stdin.isTTY) {
					process.stdout.write('> '); // Restore the prompt
				}
			}
		}
	}

	private ensureConnected() {
		if (!this.client) {
			throw new Error('Client not connected');
		}
	}

	async setLoggingLevel(level: string) {
		// Use LoggingLevelSchema to validate the logging level
		await this.client?.request({method: 'logging/setLevel', params: {level: LoggingLevelSchema.parse(level)}}, EmptyResultSchema);
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

	/**
	 * Returns information about the handshake and connection state
	 */
	getHandshakeInfo(): {
		connected: boolean;
		clientInfo: {name: string; version: string; title: string};
		clientCapabilities: Record<string, unknown>;
		serverCapabilities: ServerCapabilities | null;
		transportType: string;
	} {
		return {
			connected: this.client !== null && this.transport !== null,
			clientInfo: {
				name: CLIENT_NAME,
				version: CLIENT_VERSION,
				title: CLIENT_NAME
			},
			clientCapabilities: {
				// TODO
				roots: {listChanged: true},
				sampling: {},
				elicitation: {},
				logging: {}
			},
			serverCapabilities: this.serverCapabilities,
			transportType: this.transport?.constructor.name || 'Unknown'
		};
	}

	/**
	 * Verifies that the handshake has completed correctly
	 */
	verifyHandshake(): boolean {
		return Boolean(this.client && this.transport && this.serverCapabilities);
	}
}

/**
 * Returns the main help message for the client
 * @returns Formatted help message
 */
function getUsageMessage(): string {
	return `
MiCroscoPe - REPL client for interacting with MCP (Model Context Protocol) servers

Usage:
  ts-node src/client.ts --server <path_or_npx_spec> [--call-tool "<tool> <jsonArgs>"] [--list-tools] [--log-level <level>] [--help] -- [serverArgs...]

Options:
  --server <spec>           MCP server specification (required)
  --call-tool "<tool> <args>"  Execute a specific tool and exit
  --list-tools             Show list of available tools with their arguments
  --log-level <level>      Configure server logging level
  --help                   Show this help
  --version                Show client version

Server Specifications:
  npx:package[@version][#bin] [args...]  MCP server via npx with optional arguments
  ./server.js              Local JavaScript server
  ./server.py              Local Python server

Examples:
  # Interactive mode (default)
  ts-node src/client.ts --server "npx:@scope/mcp-server@0.3.1#mcp-server"
  ts-node src/client.ts --server "npx:@modelcontextprotocol/server-everything stdio"
  ts-node src/client.ts --server ./server.js
  ts-node src/client.ts --server ./server.py

  # Execute a specific tool
  ts-node src/client.ts --server ./server.js --call-tool "echo {"message":"hello"}"
  ts-node src/client.ts --server "npx:@modelcontextprotocol/server-everything stdio" --call-tool "echo {"message":"hello"}"

  # Show tools list
  ts-node src/client.ts --server ./server.js --list-tools

  # Configure logging level
  ts-node src/client.ts --server ./server.js --log-level debug

  # Show help
  ts-node src/client.ts --help

Interactive Mode Commands:
  list                     List all available tools
  describe <tool>          Show detailed information about a tool
  call <tool> '<jsonArgs>' Execute a tool with JSON arguments
  setLoggingLevel <level>  Configure logging level
  resources                List all available resources
  resource <uri>           Show information about a specific resource
  help                     Show interactive mode help
  exit | quit              Close the client

Notes:
  - --call-tool and --list-tools options are incompatible
  - If --call-tool is present, runs non-interactively and exits immediately
  - Interactive mode offers Tab autocompletion for commands and tool names
`.trim();
}

/**
 * Verifies that a server specification is valid
 * @param spec Server specification to validate
 * @returns true if valid, false otherwise
 */
function isValidServerSpec(spec: string): boolean {
	// Form: npx:@scope/pkg[@version][#bin]
	if (spec.startsWith('npx:')) {
		return true;
	}

	// Local script .js or .py
	const isPy = spec.endsWith('.py');
	const isJs = spec.endsWith('.js');
	return isPy || isJs;
}

async function main() {
	const argv = process.argv.slice(2);

	// Check if --server has been specified
	const serverIdx = argv.indexOf('--server');
	if (serverIdx === -1) {
		console.log(getUsageMessage());
		process.exit(0);
	}

	// Check that there are arguments after --server
	if (serverIdx >= argv.length - 1) {
		console.log(`Error: --server requires a server specification\n\n${getUsageMessage()}`);
		process.exit(0);
	}

	// Parse command line arguments
	const {runTool, runToolArg, listTools, help, logLevel, spec, serverArgs} = parseCommandLineArgs(argv);

	// Show help if requested
	if (help) {
		console.log(getUsageMessage());
		process.exit(0);
	}

	// Validate that --call-tool and --list-tools are not used together
	if (runTool && listTools) {
		console.log(`Error: Cannot use --call-tool and --list-tools at the same time\n\n${getUsageMessage()}`);
		process.exit(0);
	}

	// Validate that the server specification is valid
	if (!isValidServerSpec(spec)) {
		console.log(getUsageMessage());
		process.exit(0);
	}

	const {target} = parseServerSpec(spec, serverArgs);

	const cli = new TestMcpClient();
	try {
		await cli.connect(target, {quiet: runTool || listTools});

		// Set logging level if provided
		if (logLevel) {
			await cli.setLoggingLevel(logLevel);
		}

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
					console.error('Invalid JSON for --call-tool:', formatError(e));
					await cli.disconnect();
					process.exit(1);
				}
			}

			try {
				const res = await cli.callTool(toolName, args);
				process.stdout.write(`${JSON.stringify(res)}\n`);
				await cli.disconnect();
				return;
			} catch (e) {
				console.error(formatError(e));
				await cli.disconnect();
				process.exit(1);
			}
		}

		if (listTools) {
			// Show tools list with their arguments
			handleListToolsCommand(cli);
			await cli.disconnect();
			return;
		}

		// Default mode: Interactive CLI
		await runInteractiveCli(cli);
		await cli.disconnect();
		return;
	} catch (err) {
		console.error('Error:', formatError(err));
		try {
			await cli.disconnect();
		} catch {
			// doesn't matter
		}
		process.exit(1);
	}
}

// Only run if invoked directly
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
	main();
}

// Exports for use as a library
export {TestMcpClient};
export {Client} from '@modelcontextprotocol/sdk/client/index.js';
export {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
export type {ServerTarget};

/**
 * Parses command line arguments
 * @param argv Command line arguments (process.argv.slice(2))
 * @returns Object with parsed arguments
 */
function parseCommandLineArgs(argv: string[]):
	| {
			runTool: boolean;
			runToolArg: string | undefined;
			listTools: boolean;
			help: boolean;
			logLevel: string | undefined;
			spec: string;
			serverArgs: string[];
	  }
	| never {
	const knownClientOptions = ['--call-tool', '--list-tools', '--help', '--version', '--log-level'];

	// Find option indexes
	const runToolIdx = argv.indexOf('--call-tool');
	const listToolsIdx = argv.indexOf('--list-tools');
	const helpIdx = argv.indexOf('--help');
	const logLevelIdx = argv.indexOf('--log-level');
	const serverIdx = argv.indexOf('--server');

	// Validate required arguments
	const runToolArg = runToolIdx !== -1 ? argv[runToolIdx + 1] : undefined;
	const logLevel = logLevelIdx !== -1 ? argv[logLevelIdx + 1] : undefined;
	const serverSpec = argv[serverIdx + 1];

	if (runToolIdx !== -1 && (runToolArg === undefined || runToolArg.startsWith('--'))) {
		console.error('Error: --call-tool requires a quoted string: "<tool> <jsonArgs>"');
		process.exit(2);
	}

	if (logLevelIdx !== -1 && (logLevel === undefined || logLevel.startsWith('--'))) {
		console.error('Error: --log-level requires a log level value');
		process.exit(2);
	}

	// Filter server arguments
	const serverArgs = argv.filter((arg, i) => {
		// Keep arguments after --
		const separatorIndex = argv.indexOf('--');
		if (i > separatorIndex && separatorIndex !== -1) {
			return true;
		}

		// Remove client options and their arguments
		const isClientOption = knownClientOptions.includes(arg);
		const isRunToolArg = runToolIdx !== -1 && i === runToolIdx + 1;
		const isLogLevelArg = logLevelIdx !== -1 && i === logLevelIdx + 1;
		const isServerArg = serverIdx !== -1 && i === serverIdx + 1;
		const isClientArg = isRunToolArg || isLogLevelArg || isServerArg;

		const isNotClientOption = !isClientOption;
		const isNotClientArg = !isClientArg;
		const isNotClientFlag = !arg.startsWith('--');

		return isNotClientOption && isNotClientArg && isNotClientFlag;
	});

	return {
		runTool: runToolIdx !== -1,
		runToolArg,
		listTools: listToolsIdx !== -1,
		help: helpIdx !== -1,
		logLevel,
		spec: serverSpec,
		serverArgs
	};
}

/**
 * Gestiona l'autocompleció JSON per a la comanda call
 */
function handleJsonAutocompletion(client: TestMcpClient, rest: string): [string[], string] {
	const secondSpace = rest.indexOf(' ');
	if (secondSpace === -1) {
		return [[], ''];
	}

	const toolName = rest.slice(0, secondSpace).trim();
	const argsInput = rest.slice(secondSpace + 1).trim();

	if (!argsInput.startsWith('{') || argsInput.endsWith('}')) {
		return [[], ''];
	}

	const tool = client.describeTool(toolName);
	if (!tool?.inputSchema) {
		return [[], ''];
	}

	try {
		const schema = tool.inputSchema as Record<string, unknown>;
		const properties = (schema.properties as Record<string, unknown>) || {};
		const propertyNames = Object.keys(properties);

		const lastQuotePos = argsInput.lastIndexOf('"');
		const lastColonPos = argsInput.lastIndexOf(':');

		// Autocompletar claus de propietats
		if (lastQuotePos > -1 && (lastColonPos < lastQuotePos || lastColonPos === -1)) {
			const partialKey = argsInput.substring(lastQuotePos + 1).trim();
			const matchingProps = propertyNames.filter((p) => p.toLowerCase().startsWith(partialKey.toLowerCase()));

			if (matchingProps.length > 0) {
				const suggestions = matchingProps.map((p) => `"${p}": `);
				return [suggestions, partialKey];
			}
		}

		// Autocompletar valors
		if (lastColonPos > lastQuotePos) {
			const currentKey = argsInput.substring(argsInput.substring(0, lastColonPos).lastIndexOf('"') + 1, lastColonPos).trim();
			const property = properties[currentKey] as Record<string, unknown>;

			if (property?.enum) {
				const enumValues = property.enum as unknown[];
				const suggestions = enumValues.map((val: unknown) => (typeof val === 'string' ? `"${val}"` : String(val)));
				return [suggestions, argsInput.substring(lastColonPos + 1).trim()];
			}

			if (property?.type === 'boolean') {
				return [['true', 'false'], argsInput.substring(lastColonPos + 1).trim()];
			}
		}
	} catch {
		// Si hi ha error processant l'schema, no mostrem suggeriments
	}

	return [[], ''];
}

/**
 * Funció auxiliar per gestionar entrada amb timeout
 * @param rl Interface de readline
 * @param prompt Prompt a mostrar
 * @param timeoutMs Timeout en mil·lisegons (per defecte 60 segons)
 * @returns Promise amb la resposta de l'usuari
 */
/**
 * Funció auxiliar per gestionar entrada amb timeout
 * @param rl Interface de readline
 * @param prompt Prompt a mostrar
 * @param timeoutMs Timeout en mil·lisegons (per defecte 60 segons)
 * @returns Promise amb la resposta de l'usuari
 */
async function questionWithTimeout(rl: ReturnType<typeof createInterface>, prompt: string, timeoutMs: number = 60_000): Promise<string> {
	return Promise.race([
		rl.question(prompt),
		new Promise<string>((_, reject) => {
			setTimeout(() => {
				reject(new Error('Timeout: User took too long to respond'));
			}, timeoutMs);
		})
	]);
}

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
			if ((cmd === 'describe' || cmd === 'call') && !rest.includes(' ')) {
				const tools = client.getTools().map((t) => t.name);
				const hits = tools.filter((t) => t.toLowerCase().startsWith(rest.toLowerCase()));
				return [hits.length ? hits : tools, rest];
			}

			// JSON autocompletion for call command
			if (cmd === 'call' && rest.includes(' ')) {
				return handleJsonAutocompletion(client, rest);
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

	// Verificar que el handshake s'ha completat abans de permetre comandes
	const handshakeInfo = client.getHandshakeInfo();
	if (!handshakeInfo.connected) {
		console.error('❌ Error: Client not connected. Cannot start interactive mode.');
		await goodbye();
		return;
	}

	const isVerified = client.verifyHandshake();
	if (!isVerified) {
		console.error('❌ Error: Handshake verification failed. Cannot start interactive mode.');
		await goodbye();
		return;
	}

	console.log('Interactive MCP client. Type "help" for commands.');

	while (true) {
		// Verificar que la connexió segueix activa abans de processar comandes
		if (!client.getHandshakeInfo().connected) {
			console.error('❌ Error: Connection lost. Exiting interactive mode.');
			await goodbye();
			return;
		}

		let line: string;
		try {
			line = (await questionWithTimeout(rl, '> ')).trim();
		} catch (error) {
			if (error instanceof Error && error.message.includes('Timeout')) {
				console.log('\nTimeout: User took too long to respond. Exiting...');
				await goodbye();
				return;
			}
			throw error;
		}

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
					process.exit(0);
					break;
				case 'list':
					handleListCommand(client, rest);
					break;
				case 'describe':
					handleDescribeCommand(client, rest);
					break;
				case 'call':
					await handleCallCommand(client, rest, rl);
					break;
				case 'setlogginglevel':
					await handleSetLoggingLevelCommand(client, rest);
					break;
				case 'resources':
					handleResourcesCommand(client);
					break;
				case 'resource':
					handleResourceCommand(client, rest);
					break;
				default:
					console.log(`Unknown command: ${cmd}`);
					printHelp();
			}
		} catch (err) {
			console.error('Command error:', formatError(err));
		}
	}
}

function printHelp() {
	console.log(
		[
			'Commands:',
			'- list [json]                  List available tools (add "json" for JSON format)',
			'- describe <tool>              Show tool details',
			"- call <tool> ['<jsonArgs>']   Call tool with arguments",
			"  '<jsonArgs>'                 JSON arguments (optional)",
			'- setLoggingLevel <level>      Set server logging level',
			'- resources                    List known resources',
			'- resource <uri>               Show resource details',
			'- help                         Show this help',
			'- exit | quit                  Exit the client',
			'',
			'Call command behavior:',
			'  call myTool \'{"param": "value"}\'  Use JSON arguments',
			'  call myTool                  Interactive mode (if tool has parameters)',
			'  call myTool                  Empty arguments (if tool has no parameters)',
			'',
			'Autocomplete features:',
			'- Press TAB to autocomplete commands and tool names',
			'- When entering JSON arguments, press TAB to autocomplete property names and values',
			'- For enum properties, TAB will suggest possible values',
			'- For boolean properties, TAB will suggest true/false'
		].join('\n')
	);
}

function stripQuotes(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

/**
 * Funció unificada per mostrar la llista d'eines disponibles
 */
function displayToolsList(client: TestMcpClient): void {
	const tools = client.getTools();
	if (!tools.length) {
		console.log('(no tools)');
		return;
	}

	console.log('Available tools:');
	console.log('');

	for (const t of tools) {
		console.log(`\x1b[1m\x1b[35m${t.name}\x1b[0m`);

		if (t.inputSchema) {
			const schema = t.inputSchema as Record<string, unknown>;
			const properties = (schema.properties as Record<string, unknown>) || {};
			const required = (schema.required as string[]) || [];

			if (Object.keys(properties).length > 0) {
				console.log('  Arguments:');
				for (const [propName, prop] of Object.entries(properties)) {
					const propDef = prop as Record<string, unknown>;
					const propType = (propDef.type as string) || 'string';
					const propDescription = (propDef.description as string) || '';
					const isRequired = required.includes(propName);
					console.log(`    ${propName} (${propType})${isRequired ? ' [REQUIRED]' : ''}`);
					if (propDescription) {
						console.log(`      Description: ${propDescription}`);
					}
					if (propDef.enum) {
						const enumValues = propDef.enum as unknown[];
						const suggestions = enumValues.map((val: unknown) => (typeof val === 'string' ? `"${val}"` : String(val)));
						console.log(`      Available options: ${suggestions.join(', ')}`);
					}
					console.log('');
				}
			} else {
				console.log('  Arguments: (none)');
			}
		} else {
			console.log('');
			console.log('  Arguments: (no schema available)');
		}
		console.log('');
	}
}

/**
 * Gestiona la comanda 'list' del CLI interactiu
 */
function handleListCommand(client: TestMcpClient, args: string): void {
	if (args.toLowerCase() === 'json') {
		// Mode JSON: mostrar tools en format JSON per facilitar parsing
		const tools = client.getTools();
		const toolsJson = tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema
		}));
		console.log(JSON.stringify(toolsJson, null, 2));
	} else {
		// Mode normal: mostrar tools en format llegible
		displayToolsList(client);
	}
}

/**
 * Gestiona l'opció --list-tools de la línia de comandes
 */
function handleListToolsCommand(client: TestMcpClient): void {
	displayToolsList(client);
}

/**
 * Gestiona la comanda 'describe' del CLI interactiu
 */
function handleDescribeCommand(client: TestMcpClient, toolName: string): void {
	if (!toolName) {
		console.log('Usage: describe <toolName>');
		return;
	}

	const tool = client.describeTool(toolName);
	if (!tool) {
		console.log(`Tool not found: ${toolName}`);
		return;
	}

	console.log(JSON.stringify(tool, null, 2));
}

/**
 * Gestiona la comanda 'call' del CLI interactiu
 */
async function handleCallCommand(client: TestMcpClient, args: string, rl: ReturnType<typeof createInterface>): Promise<void> {
	if (!args) {
		console.log("Usage: call <toolName> ['<jsonArgs>']");
		console.log("  '<jsonArgs>': JSON arguments (optional, if not provided will use interactive mode)");
		return;
	}

	const parts = args.split(' ');
	const toolName = parts[0];
	const argsRaw = parts.length > 1 ? parts.slice(1).join(' ') : '';

	let parsedArgs: unknown = {};

	if (argsRaw) {
		// Mode JSON: parsejem els arguments JSON
		try {
			parsedArgs = JSON.parse(stripQuotes(argsRaw));
		} catch (e) {
			console.error('Invalid JSON args:', formatError(e));

			// Mostrem l'schema d'entrada de la tool per ajudar a l'usuari
			const tool = client.describeTool(toolName);
			if (tool?.inputSchema) {
				console.log('\nExpected input schema:');
				console.log(JSON.stringify(tool.inputSchema, null, 2));

				// Si hi ha propietats requerides, les mostrem específicament
				const schema = tool.inputSchema as Record<string, unknown>;
				if (schema.required && Array.isArray(schema.required) && schema.required.length > 0) {
					console.log('\nRequired properties:', schema.required.join(', '));
				}
			}
			return;
		}
	} else {
		// Si no hi ha arguments JSON, comprovem si la tool té paràmetres
		const tool = client.describeTool(toolName);
		if (tool?.inputSchema) {
			const schema = tool.inputSchema as Record<string, unknown>;
			const properties = (schema.properties as Record<string, unknown>) || {};

			// Si la tool té propietats definides, usem mode interactiu
			if (Object.keys(properties).length > 0) {
				parsedArgs = await handleInteractiveArgs(client, toolName, rl);
			} else {
				console.log(`\nℹ️  Tool '${toolName}' has no parameters. Using empty arguments.`);
				parsedArgs = {};
			}
		} else {
			console.log(`\nℹ️  No input schema available for tool '${toolName}'. Using empty arguments.`);
			parsedArgs = {};
		}
	}

	try {
		const res = await client.callTool(toolName, parsedArgs);
		console.log(`\x1b[38;5;136m${JSON.stringify(res, null, 2)}\x1b[0m\n`);
	} catch (e) {
		console.error(`Error calling tool ${toolName}:`, formatError(e));
	}
}

/**
 * Gestiona l'entrada interactiva d'arguments per a una tool
 */
async function handleInteractiveArgs(client: TestMcpClient, toolName: string, rl: ReturnType<typeof createInterface>): Promise<Record<string, unknown>> {
	const tool = client.describeTool(toolName);
	if (!tool?.inputSchema) {
		console.log('No input schema available for this tool. Using empty object.');
		return {};
	}

	const schema = tool.inputSchema as Record<string, unknown>;
	const properties = (schema.properties as Record<string, unknown>) || {};
	const required = (schema.required as string[]) || [];
	const args: Record<string, unknown> = {};

	console.log(`\nInteractive input for tool \x1b[35m${toolName}\x1b[0m\n`);

	// Obtenim la llista de propietats ordenades (requerides primer)
	const allProperties = Object.keys(properties);
	const orderedProperties = [...required, ...allProperties.filter((p) => !required.includes(p))];

	for (const propName of orderedProperties) {
		const prop = properties[propName] as Record<string, unknown>;
		const isRequired = required.includes(propName);
		const propType = (prop.type as string) || 'string';
		const propDescription = (prop.description as string) || '';
		const defaultValue = prop.default;

		// Mostrem informació sobre la propietat
		console.log(`\x1b[36m${propName}\x1b[0m (\x1b[90m${propType}\x1b[0m)${isRequired ? ' \x1b[38;5;208m(REQUIRED)\x1b[0m' : ''}`);
		if (propDescription) {
			console.log(`   \x1b[90mDescription: ${propDescription}\x1b[0m`);
		}

		// Si hi ha un valor per defecte, el mostrem
		if (defaultValue !== undefined) {
			console.log(`   Default: ${JSON.stringify(defaultValue)}`);
		}

		// Demanem l'entrada de l'usuari
		let input: string;
		try {
			if (prop.enum) {
				const enumValues = prop.enum as unknown[];
				const suggestions = enumValues.map((val: unknown) => (typeof val === 'string' ? `"${val}"` : String(val)));
				console.log('');
				console.log(`   \x1b[90mAvailable options: ${suggestions.join(', ')}\x1b[0m`);
				console.log('');
				input = await questionWithTimeout(rl, `   Value: `);
			} else if (defaultValue !== undefined) {
				input = await questionWithTimeout(rl, `   Value [${JSON.stringify(defaultValue)}]: `);
				if (input.trim() === '') {
					input = JSON.stringify(defaultValue);
				}
			} else {
				input = await questionWithTimeout(rl, `   Value: `);
			}

			// Parsejem l'entrada segons el tipus
			let parsedValue: unknown;
			try {
				if (input.trim() === '') {
					if (isRequired) {
						console.log(`   ❌ Error: ${propName} is required`);
						continue;
					} else {
						// Propietat opcional buida, la saltem
						continue;
					}
				}

				// Intentem parsejar com a JSON primer
				try {
					parsedValue = JSON.parse(input);
				} catch {
					// Si no és JSON vàlid, tractem com a string
					parsedValue = input;
				}

				// Validem el tipus
				if (propType === 'boolean' && typeof parsedValue !== 'boolean') {
					if (typeof parsedValue === 'string') {
						const lower = parsedValue.toLowerCase();
						if (lower === 'true' || lower === 'false') {
							parsedValue = lower === 'true';
						} else {
							console.log(`   ❌ Error: Expected boolean value (true/false)`);
							continue;
						}
					} else {
						console.log(`   ❌ Error: Expected boolean value (true/false)`);
						continue;
					}
				}

				if (propType === 'number' && typeof parsedValue !== 'number') {
					const num = Number(parsedValue);
					if (Number.isNaN(num)) {
						console.log(`   ❌ Error: Expected number value`);
						continue;
					}
					parsedValue = num;
				}

				// Validem enum si aplica
				if (prop.enum) {
					const enumValues = prop.enum as unknown[];
					if (!enumValues.includes(parsedValue)) {
						console.log(`   ❌ Error: Value must be one of: ${enumValues.map((v) => JSON.stringify(v)).join(', ')}`);
						continue;
					}
				}

				args[propName] = parsedValue;
				console.log(`   ✅ Set ${propName} = ${JSON.stringify(parsedValue)}\n`);

				// Petita pausa per permetre que l'usuari vegi la confirmació abans de continuar
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (e) {
				console.log(`   ❌ Error parsing value: ${formatError(e)}`);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('Timeout')) {
				console.log('\nTimeout: User took too long to respond. Exiting...');
				return {};
			}
			throw error;
		}
	}

	console.log('\n📋 Final arguments:');
	console.log(JSON.stringify(args, null, 2));
	return args;
}

/**
 * Gestiona la comanda 'setLoggingLevel' del CLI interactiu
 */
async function handleSetLoggingLevelCommand(client: TestMcpClient, level: string): Promise<void> {
	const normalizedLevel = level.toLowerCase();
	if (!normalizedLevel) {
		console.log('Usage: setLoggingLevel <level>');
		return;
	}

	if (!client.getLogLevels().includes(normalizedLevel)) {
		console.log(`Invalid level. Allowed: ${client.getLogLevels().join(', ')}`);
		return;
	}

	try {
		await client.setLoggingLevel(normalizedLevel);
		console.log('Logging level set to', normalizedLevel);
	} catch (e) {
		console.error('Error setting logging level:', formatError(e));
	}
}

/**
 * Gestiona les comandes de recursos del CLI interactiu
 */
function handleResourcesCommand(client: TestMcpClient): void {
	const all = client.getResources();
	if (!all.length) {
		console.log('(no resources)');
		return;
	}

	for (const r of all) {
		console.log(`- ${r.uri}${r.name ? ` (${r.name})` : ''}${r.mimeType ? ` [${r.mimeType}]` : ''}`);
	}
}

function handleResourceCommand(client: TestMcpClient, uri: string): void {
	if (!uri) {
		console.log('Usage: resource <uri>');
		return;
	}

	const r = client.getResource(uri);
	if (!r) {
		console.log(`Resource not found: ${uri}`);
		return;
	}

	console.log(JSON.stringify(r, null, 2));
}

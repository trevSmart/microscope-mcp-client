#!/usr/bin/env node

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema, ListToolsResultSchema, EmptyResultSchema, LoggingMessageNotificationSchema, ResourceListChangedNotificationSchema, ListResourcesResultSchema, ResourceUpdatedNotificationSchema, ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';

// Constants
const CLIENT_NAME = 'IBM Salesforce MCP Test Client';
const CLIENT_VERSION = '0.0.40';

/**
 * Funció d'ajuda per gestionar errors de manera consistent
 * @param error Error a gestionar
 * @returns Missatge d'error formatat
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
			{name: CLIENT_NAME, version: CLIENT_VERSION},
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

		// Carregar la llista inicial de recursos i configurar gestors de notificacions
		if (this.serverCapabilities?.resources) {
			// Carregar recursos inicials
			await this.updateResourcesList('Failed to load initial resources list');

			// Configurar gestor de notificacions per canvis en la llista de recursos
			this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
				await this.updateResourcesList('Failed to list resources after change notification');
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

	/**
	 * Actualitza la llista de recursos des del servidor
	 * @param errorMessage Missatge d'error a mostrar si falla la petició
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

				if (!this.quiet) {
					const resourceCount = Object.keys(this.resources).length;
					if (resourceCount > 0) {
						console.log(`Resources: ${Object.keys(this.resources).join(', ')}\n`);
					}
				}
			}
		} catch {
			if (!this.quiet) {
				console.log(errorMessage);
			}
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

	/**
	 * Retorna informació sobre l'estat del handshake i la connexió
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
	 * Verifica que el handshake s'ha completat correctament
	 */
	verifyHandshake(): boolean {
		return Boolean(this.client && this.transport && this.serverCapabilities);
	}
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length < 1) {
		console.error(
			`
Usage:
  ts-node src/client.ts <path_or_npx_spec> [--run-tool "<tool> <jsonArgs>"] -- [serverArgs...]

Examples:
  ts-node src/client.ts "npx:@scope/mcp-server@0.3.1#mcp-server" -- --stdio
  ts-node src/client.ts ./server.js -- --stdio
  ts-node src/client.ts ./server.py -- --stdio
  ts-node src/client.ts ./server.js --run-tool "salesforceMcpUtils {'action':'getState'}" -- --stdio
`.trim()
		);
		process.exit(2);
	}

	// Parse command line arguments
	const {runTool, runToolArg, spec, serverArgs} = parseCommandLineArgs(argv);

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
					console.error('Invalid JSON for --run-tool:', formatError(e));
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
				console.error(formatError(e));
				await cli.disconnect();
				process.exit(1);
			}
		}

		// Mode per defecte: CLI interactiu
		await runInteractiveCli(cli);
		await cli.disconnect();
		return;
	} catch (err) {
		console.error('Error:', formatError(err));
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

/**
 * Parseja els arguments de la línia de comandes
 * @param argv Arguments de la línia de comandes (process.argv.slice(2))
 * @returns Objecte amb els arguments parsejats
 */
function parseCommandLineArgs(argv: string[]): {
	runTool: boolean;
	runToolArg: string | undefined;
	spec: string;
	serverArgs: string[];
} {
	const runToolIdx = argv.indexOf('--run-tool');
	const runTool = runToolIdx !== -1;
	const runToolArg = runTool ? argv[runToolIdx + 1] : undefined;

	if (runTool && (runToolArg === undefined || runToolArg.startsWith('--'))) {
		console.error('Error: --run-tool requires a quoted string: "<tool> <jsonArgs>"');
		process.exit(2);
	}

	// Build args for server spec/args by stripping known flags
	let cleanArgv = argv.slice();
	if (runTool) {
		// Remove flag and its single argument (quoted string)
		cleanArgv = cleanArgv.filter((_, i) => i !== runToolIdx && i !== runToolIdx + 1);
	}

	const sepIdx = cleanArgv.indexOf('--');
	const spec = cleanArgv[0];
	const serverArgs = sepIdx === -1 ? cleanArgv.slice(1) : cleanArgv.slice(sepIdx + 1);

	return {runTool, runToolArg, spec, serverArgs};
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
			if (cmd === 'describe' || cmd === 'call') {
				// Si no hi ha un segon espai, estem completant el nom de la tool
				if (!rest.includes(' ')) {
					const tools = client.getTools().map((t) => t.name);
					const hits = tools.filter((t) => t.toLowerCase().startsWith(rest.toLowerCase()));
					return [hits.length ? hits : tools, rest];
				}

				// Si estem a la comanda 'call', intentem autocompletar els paràmetres
				if (cmd === 'call') {
					const secondSpace = rest.indexOf(' ');
					if (secondSpace !== -1) {
						const toolName = rest.slice(0, secondSpace).trim();
						const argsInput = rest.slice(secondSpace + 1).trim();

						// Només intentem autocompletar si l'usuari ha començat a escriure un objecte JSON
						if (argsInput.startsWith('{') && !argsInput.endsWith('}')) {
							const tool = client.describeTool(toolName);

							if (tool?.inputSchema) {
								try {
									// Intentem extreure les propietats de l'schema d'entrada
									const schema = tool.inputSchema as Record<string, unknown>;
									const properties = (schema.properties as Record<string, unknown>) || {};
									const propertyNames = Object.keys(properties);

									// Si l'usuari ha escrit una clau parcial, autocompletem
									const lastQuotePos = argsInput.lastIndexOf('"');
									const lastColonPos = argsInput.lastIndexOf(':');

									// Si hi ha una cometa però no hi ha dos punts després, estem escrivint una clau
									if (lastQuotePos > -1 && (lastColonPos < lastQuotePos || lastColonPos === -1)) {
										const partialKey = argsInput.substring(argsInput.lastIndexOf('"') + 1).trim();

										// Filtrem propietats que coincideixen amb el que l'usuari ha escrit
										const matchingProps = propertyNames.filter((p) => p.toLowerCase().startsWith(partialKey.toLowerCase()));

										if (matchingProps.length > 0) {
											// Retornem suggeriments amb el format adequat per completar el JSON
											const suggestions = matchingProps.map((p) => `"${p}": `);
											return [suggestions, partialKey];
										}
									}

									// Si l'usuari ha escrit una clau i dos punts, però no un valor, suggerim valors
									if (lastColonPos > lastQuotePos) {
										// Extraiem la clau actual
										const currentKey = argsInput.substring(argsInput.substring(0, lastColonPos).lastIndexOf('"') + 1, lastColonPos).trim();

										// Si la propietat és un enum, suggerim els valors possibles
										const property = properties[currentKey] as Record<string, unknown>;
										if (property?.enum) {
											const enumValues = property.enum as unknown[];
											// Formatem els valors segons el tipus
											const suggestions = enumValues.map((val: unknown) => (typeof val === 'string' ? `"${val}"` : String(val)));
											return [suggestions, argsInput.substring(lastColonPos + 1).trim()];
										}

										// Si la propietat és un boolean, suggerim true/false
										if (property?.type === 'boolean') {
											return [['true', 'false'], argsInput.substring(lastColonPos + 1).trim()];
										}
									}
								} catch {
									// Si hi ha algun error en processar l'schema, simplement no mostrem suggeriments
									return [[], ''];
								}
							}
						}
					}
				}
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

	console.log('✅ Handshake completed successfully');
	console.log('Interactive MCP client. Type "help" for commands.');
	printQuickIntro();

	while (true) {
		// Verificar que la connexió segueix activa abans de processar comandes
		if (!client.getHandshakeInfo().connected) {
			console.error('❌ Error: Connection lost. Exiting interactive mode.');
			await goodbye();
			return;
		}

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
				case 'list':
					handleListCommand(client);
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
			'- list                         List available tools',
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

function printQuickIntro() {
	console.log(['', "Commands: list | describe <tool> | call <tool> ['<json>'] | setLoggingLevel <level> | resources | resource <uri> | help | exit", ''].join('\n'));
}

/**
 * Gestiona la comanda 'list' del CLI interactiu
 */
function handleListCommand(client: TestMcpClient): void {
	const tools = client.getTools();
	if (!tools.length) {
		console.log('(no tools)');
		return;
	}
	for (const t of tools) {
		console.log(`- ${t.name}${t.description ? `: ${t.description}` : ''}`);
	}
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
				console.log(`\n🔍 Tool '${toolName}' has parameters. Starting interactive mode...`);
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
		console.log(JSON.stringify(res, null, 2));
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

	console.log(`\n📝 Interactive input for tool: ${toolName}\n`);

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
		console.log(`${isRequired ? '🔴' : '🟡'} ${propName} (${propType})${isRequired ? ' [REQUIRED]' : ''}`);
		if (propDescription) {
			console.log(`   Description: ${propDescription}`);
		}

		// Si hi ha un valor per defecte, el mostrem
		if (defaultValue !== undefined) {
			console.log(`   Default: ${JSON.stringify(defaultValue)}`);
		}

		// Si és un enum, mostrem les opcions
		if (prop.enum) {
			const enumValues = prop.enum as unknown[];
			console.log(`   Options: ${enumValues.map((v) => JSON.stringify(v)).join(', ')}`);
		}

		// Demanem l'entrada de l'usuari
		let input: string;
		if (prop.enum) {
			const enumValues = prop.enum as unknown[];
			const suggestions = enumValues.map((val: unknown) => (typeof val === 'string' ? `"${val}"` : String(val)));
			console.log(`   Available options: ${suggestions.join(', ')}`);
			input = await rl.question(`   Value: `);
		} else if (defaultValue !== undefined) {
			input = await rl.question(`   Value [${JSON.stringify(defaultValue)}]: `);
			if (input.trim() === '') {
				input = JSON.stringify(defaultValue);
			}
		} else {
			input = await rl.question(`   Value: `);
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
			console.log(`   ✅ Set ${propName} = ${JSON.stringify(parsedValue)}`);
		} catch (e) {
			console.log(`   ❌ Error parsing value: ${formatError(e)}`);
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
 * Gestiona la comanda 'resources' del CLI interactiu
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

/**
 * Gestiona la comanda 'resource' del CLI interactiu
 */
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

/**
 * Exemple d'ús del client amb verificació del handshake
 */
export async function testHandshake(serverPath: string): Promise<void> {
	console.log('🧪 Testing MCP handshake...');

	const client = new TestMcpClient();
	try {
		// Connexió al servidor
		await client.connect(
			{
				kind: 'script',
				interpreter: 'node',
				path: serverPath,
				args: ['--stdio']
			},
			{quiet: false}
		);

		// Verificar l'estat del handshake
		const handshakeInfo = client.getHandshakeInfo();
		console.log('\n📊 Handshake Information:');
		console.log(JSON.stringify(handshakeInfo, null, 2));

		// Verificar que el handshake s'ha completat correctament
		const isVerified = client.verifyHandshake();
		console.log(`\n✅ Handshake verification: ${isVerified ? 'PASSED' : 'FAILED'}`);

		// Llistar les eines disponibles
		const tools = client.getTools();
		console.log(`\n🛠️ Available tools: ${tools.length}`);
		for (const tool of tools) {
			console.log(`   - ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);
		}

		await client.disconnect();
		console.log('\n✅ Test completed successfully');
	} catch (error) {
		console.error('❌ Test failed:', formatError(error));
		await client.disconnect();
		throw error;
	}
}

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

/**
 * Retorna el missatge d'ajuda principal del client
 * @returns Missatge d'ajuda formatat
 */
function getUsageMessage(): string {
	return `
IBM Test MCP Client - Client REPL per a interactuar amb servidors MCP (Model Context Protocol)

Usage:
  ts-node src/client.ts --server <path_or_npx_spec> [--call-tool "<tool> <jsonArgs>"] [--list-tools] [--log-level <level>] [--help] -- [serverArgs...]

Options:
  --server <spec>           Especificació del servidor MCP (obligatòria)
  --call-tool "<tool> <args>"  Executa una eina específica i surt
  --list-tools             Mostra llista d'eines disponibles amb els seus arguments
  --log-level <level>      Configura el nivell de logging del servidor
  --help                   Mostra aquesta ajuda
  --version                Mostra la versió del client

Server Specifications:
  npx:package[@version][#bin]  Servidor MCP via npx
  ./server.js              Servidor local JavaScript
  ./server.py              Servidor local Python

Examples:
  # Mode interactiu (per defecte)
  ts-node src/client.ts --server "npx:@scope/mcp-server@0.3.1#mcp-server"
  ts-node src/client.ts --server ./server.js
  ts-node src/client.ts --server ./server.py

  # Executar una eina específica
  ts-node src/client.ts --server ./server.js --call-tool "echo {"message":"hello"}"
  ts-node src/client.ts --server "npx:@scope/mcp-server@0.3.1#mcp-server" --call-tool "toolName {"param":"value"}"

  # Mostrar llista d'eines
  ts-node src/client.ts --server ./server.js --list-tools

  # Configurar nivell de logging
  ts-node src/client.ts --server ./server.js --log-level debug

  # Mostrar ajuda
  ts-node src/client.ts --help

Interactive Mode Commands:
  list                     Llista totes les eines disponibles
  describe <tool>          Mostra informació detallada d'una eina
  call <tool> '<jsonArgs>' Executa una eina amb arguments JSON
  setLoggingLevel <level>  Configura el nivell de logging
  resources                Llista tots els recursos disponibles
  resource <uri>           Mostra informació d'un recurs específic
  help                     Mostra ajuda del mode interactiu
  exit | quit              Tanca el client

Notes:
  - Les opcions --call-tool i --list-tools són incompatibles
  - Si --call-tool està present, s'executa de forma no-interactiva i surt immediatament
  - El mode interactiu ofereix autocompleció amb Tab per comandes i noms d'eines
`.trim();
}

/**
 * Verifica que una especificació de servidor és vàlida
 * @param spec Especificació del servidor a validar
 * @returns true si és vàlida, false altrament
 */
function isValidServerSpec(spec: string): boolean {
	// Forma npx: @scope/pkg[@version][#bin]
	if (spec.startsWith('npx:')) {
		return true;
	}

	// Script local .js o .py
	const isPy = spec.endsWith('.py');
	const isJs = spec.endsWith('.js');
	return isPy || isJs;
}

async function main() {
	const argv = process.argv.slice(2);

	// Comprovar si s'ha especificat --server
	const serverIdx = argv.indexOf('--server');
	if (serverIdx === -1) {
		console.log(getUsageMessage());
		process.exit(0);
	}

	// Comprovar que hi ha arguments després de --server
	if (serverIdx >= argv.length - 1) {
		console.log(`Error: --server requires a server specification\n\n${getUsageMessage()}`);
		process.exit(0);
	}

	// Parse command line arguments
	const {runTool, runToolArg, listTools, help, logLevel, spec, serverArgs} = parseCommandLineArgs(argv);

	// Mostrar ajuda si s'ha sol·licitat
	if (help) {
		console.log(getUsageMessage());
		process.exit(0);
	}

	// Validar que --call-tool i --list-tools no s'utilitzin alhora
	if (runTool && listTools) {
		console.log(`Error: Cannot use --call-tool and --list-tools at the same time\n\n${getUsageMessage()}`);
		process.exit(0);
	}

	// Validar que l'especificació del servidor és vàlida
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

		if (listTools) {
			// Mostrar llista d'eines amb els seus arguments
			handleListToolsCommand(cli);
			await cli.disconnect();
			return;
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
	// Llista d'opcions conegudes del client
	const knownClientOptions = ['--call-tool', '--list-tools', '--help', '--version', '--log-level'];

	const runToolIdx = argv.indexOf('--call-tool');
	const runTool = runToolIdx !== -1;
	const runToolArg = runTool ? argv[runToolIdx + 1] : undefined;

	const listToolsIdx = argv.indexOf('--list-tools');
	const listTools = listToolsIdx !== -1;

	const helpIdx = argv.indexOf('--help');
	const help = helpIdx !== -1;

	const logLevelIdx = argv.indexOf('--log-level');
	const logLevel = logLevelIdx !== -1 ? argv[logLevelIdx + 1] : undefined;

	if (runTool && (runToolArg === undefined || runToolArg.startsWith('--'))) {
		console.error('Error: --call-tool requires a quoted string: "<tool> <jsonArgs>"');
		process.exit(2);
	}

	if (logLevelIdx !== -1 && (logLevel === undefined || logLevel.startsWith('--'))) {
		console.error('Error: --log-level requires a log level value');
		process.exit(2);
	}

	// Trobar --server i la seva especificació
	const serverIdx = argv.indexOf('--server');
	const serverSpec = argv[serverIdx + 1];

	// Build args for server spec/args by stripping known flags and unknown options
	let cleanArgv = argv.slice();

	// Eliminar --server i la seva especificació
	cleanArgv = cleanArgv.filter((_, i) => i !== serverIdx && i !== serverIdx + 1);

	// Eliminar opcions conegudes del client
	if (runTool) {
		// Remove --call-tool flag and its single argument (quoted string)
		cleanArgv = cleanArgv.filter((_, i) => i !== runToolIdx && i !== runToolIdx + 1);
	}

	if (logLevelIdx !== -1) {
		// Remove --log-level flag and its single argument
		cleanArgv = cleanArgv.filter((_, i) => i !== logLevelIdx && i !== logLevelIdx + 1);
	}

	// Eliminar altres opcions conegudes del client i desconegudes
	cleanArgv = cleanArgv.filter((arg, i) => {
		// Si és una opció coneguda, l'eliminem
		if (knownClientOptions.includes(arg)) {
			// Si té un argument (no comença amb --), també l'eliminem
			if (i + 1 < cleanArgv.length && !cleanArgv[i + 1].startsWith('--')) {
				return false; // Eliminar aquesta opció
			}
			return false; // Eliminar aquesta opció
		}
		// Si és una opció desconeguda (comença amb --), l'eliminem
		if (arg.startsWith('--') && !knownClientOptions.includes(arg)) {
			// Si té un argument (no comença amb --), també l'eliminem
			if (i + 1 < cleanArgv.length && !cleanArgv[i + 1].startsWith('--')) {
				return false; // Eliminar aquesta opció
			}
			return false; // Eliminar aquesta opció
		}
		return true; // Mantenir aquest argument
	});

	const sepIdx = cleanArgv.indexOf('--');
	const serverArgs = sepIdx === -1 ? cleanArgv : cleanArgv.slice(sepIdx + 1);

	return {runTool, runToolArg, listTools, help, logLevel, spec: serverSpec, serverArgs};
}

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

/**
 * Gestiona la comanda 'list' del CLI interactiu
 */
function handleListCommand(client: TestMcpClient): void {
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

			if (Object.keys(properties).length) {
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
 * Gestiona l'opció --list-tools de la línia de comandes
 */
function handleListToolsCommand(client: TestMcpClient): void {
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

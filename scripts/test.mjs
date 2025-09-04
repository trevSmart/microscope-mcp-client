// scripts/run-test.mjs
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {existsSync} from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validació d'arguments d'entrada
function validateArgs() {
	const args = process.argv.slice(2);

	// Comprovar si hi ha arguments
	if (args.length === 0) {
		console.error(
			`
❌ Error: No arguments provided

Usage:
  node scripts/test.mjs <logLevel> [extraArgs...]

Examples:
  node scripts/test.mjs info
  node scripts/test.mjs debug --call-tool 'salesforceMcpUtils {"action":"getState"}'
  node scripts/test.mjs info --list-tools

Log levels: debug, info, notice, warning, error, critical, alert, emergency
		`.trim()
		);
		process.exit(2);
	}

	// Validar nivell de log
	const logLevel = args[0];
	const validLogLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

	if (!validLogLevels.includes(logLevel)) {
		console.error(
			`
❌ Error: Invalid log level '${logLevel}'

Valid log levels: ${validLogLevels.join(', ')}

Usage:
  node scripts/test.mjs <logLevel> [extraArgs...]
Example:
  node scripts/test.mjs info
		`.trim()
		);
		process.exit(2);
	}

	return args;
}

// Validar arguments abans de continuar
const args = validateArgs();

// 1) Nivell de log des de arg (info|debug...), per comoditat als scripts
const logLevel = args[0] || process.env.LOG_LEVEL || 'info';

// 2) Args extra (p. ex. --call-tool '...')
const extraArgs = args.slice(1);

// 3) Resolució del servidor MCP
function resolveMcpServer() {
	// a) Si ve com a últim arg posicional explícit (si el vols suportar), passa.
	// En aquest flux prioritzem: CLI arg separat? Pots afegir-ho si vols.

	// b) Env var
	if (process.env.MCP_SERVER?.trim()) {
		return process.env.MCP_SERVER.trim();
	}

	// c) npm package config (overrideable amb `npm config set ibm-test-mcp-client:mcpServer=...`)
	const fromNpmConfig = process.env.npm_package_config_mcpServer;
	if (fromNpmConfig?.trim()) {
		return fromNpmConfig.trim();
	}

	// d) CI detectat
	const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
	if (isCi) {
		return 'npx:@modelcontextprotocol/server-everything';
	}

	// e) Per defecte local (el teu path)
	return '/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js';
}

const server = resolveMcpServer();

// Validar que el servidor s'ha resolt correctament
if (!server || server.trim() === '') {
	console.error(
		`
❌ Error: Failed to resolve MCP server

Please set one of the following:
- MCP_SERVER environment variable
- npm config: npm config set ibm-test-mcp-client:mcpServer=<server_spec>
- Or ensure the default server path exists: /Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js
	`.trim()
	);
	process.exit(2);
}

// 4) Executa el client
const clientEntry = resolve(__dirname, '../build/index.js');

// Verificar que el client existeix
if (!existsSync(clientEntry)) {
	console.error(
		`
❌ Error: Client binary not found at ${clientEntry}

Please run 'npm run build' first to build the client.
	`.trim()
	);
	process.exit(2);
}

const child = spawn(process.execPath, [clientEntry, server, ...extraArgs], {
	env: {...process.env, LOG_LEVEL: logLevel}
});

child.on('exit', (code) => process.exit(code ?? 1));

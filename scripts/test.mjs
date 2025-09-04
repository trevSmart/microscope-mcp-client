// scripts/run-test.mjs
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1) Nivell de log des de arg (info|debug...), per comoditat als scripts
const logLevel = process.argv[2] || process.env.LOG_LEVEL || 'info';

// 2) Args extra (p. ex. --run-tool '...')
const extraArgs = process.argv.slice(3);

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

// 4) Executa el client
const clientEntry = resolve(__dirname, '../build/index.js');

const child = spawn(process.execPath, [clientEntry, server, ...extraArgs], {
	stdio: 'inherit',
	env: {...process.env, LOG_LEVEL: logLevel}
});

child.on('exit', (code) => process.exit(code ?? 1));

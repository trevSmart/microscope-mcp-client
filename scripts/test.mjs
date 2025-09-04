// scripts/run-test.mjs
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {existsSync} from 'node:fs';
import dotenv from 'dotenv';

// Suprimir missatges de tip de dotenv
process.env.DOTENV_CONFIG_QUIET = 'true';
dotenv.config({debug: false});

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
	// a) Variable d'entorn (màxima prioritat)
	if (process.env.TEST_MCP_SERVER?.trim()) {
		return process.env.TEST_MCP_SERVER.trim();
	}

	// b) Detecció automàtica de CI
	const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
	if (isCi) {
		return 'npx:@modelcontextprotocol/server-everything';
	}

	// c) Per defecte local
	return '/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js';
}

const server = resolveMcpServer();

// Validar que el servidor s'ha resolt correctament
if (!server || server.trim() === '') {
	console.error(
		`
❌ Error: Failed to resolve MCP server

Please set one of the following:
- TEST_MCP_SERVER environment variable
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

// Detectar si estem en mode one-shot (--call-tool)
const isOneShotMode = extraArgs.includes('--call-tool');

if (isOneShotMode) {
	// Mode one-shot: capturar sortida per prettify
	const child = spawn(process.execPath, [clientEntry, '--server', server, ...extraArgs], {
		env: {...process.env, LOG_LEVEL: logLevel},
		stdio: ['inherit', 'pipe', 'inherit'] // Capturar stdout per processar-lo
	});

	let output = '';

	child.stdout.on('data', (data) => {
		output += data.toString();
	});

	// Afegir timeout per evitar que s'queda penjat indefinidament
	const timeout = setTimeout(() => {
		console.error('Timeout: Client took too long to respond');
		child.kill('SIGTERM');
		process.exit(1);
	}, 60_000); // 60 segons

	child.on('exit', (code) => {
		clearTimeout(timeout);

		if (code === 0) {
			// Processar la sortida per prettify
			try {
				// Buscar la resposta JSON en la sortida
				// Intentem trobar un JSON vàlid que comenci amb { i acabi amb }
				const lines = output.split('\n');
				let jsonFound = false;

				for (const line of lines) {
					const trimmedLine = line.trim();
					// Busquem línies que semblen JSON (comencen amb { i acaben amb })
					if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
						try {
							const parsed = JSON.parse(trimmedLine);
							console.log(`\x1b[38;5;136m${JSON.stringify(parsed, null, 2)}\x1b[0m`);
							jsonFound = true;
							break;
						} catch {
							// Si aquesta línia no és JSON vàlid, continuem buscant
						}
					}
				}

				// Si no hem trobat JSON vàlid, mostrar la sortida original
				if (!jsonFound) {
					console.log(output);
				}
			} catch (_error) {
				// Si hi ha error parsing JSON, mostrar la sortida original
				console.log(output);
			}
		} else {
			console.error('Client exited with code:', code);
		}

		process.exit(code ?? 1);
	});

	child.on('error', (error) => {
		clearTimeout(timeout);
		console.error('Failed to start client:', error);
		process.exit(1);
	});
} else {
	// Mode interactiu: heretar sortida directament
	const child = spawn(process.execPath, [clientEntry, '--server', server, ...extraArgs], {
		env: {...process.env, LOG_LEVEL: logLevel},
		stdio: ['inherit', 'inherit', 'inherit'] // Heretar stdin, stdout, stderr del procés pare
	});

	// Afegir timeout per evitar que s'queda penjat indefinidament
	const timeout = setTimeout(() => {
		console.error('Timeout: Client took too long to respond');
		child.kill('SIGTERM');
		process.exit(1);
	}, 60_000); // 60 segons

	child.on('exit', (code) => {
		clearTimeout(timeout);
		process.exit(code ?? 1);
	});

	child.on('error', (error) => {
		clearTimeout(timeout);
		console.error('Failed to start client:', error);
		process.exit(1);
	});
}

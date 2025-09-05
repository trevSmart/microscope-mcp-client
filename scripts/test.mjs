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

	// Validar nivell de log si s'especifica
	const logLevelIdx = args.indexOf('--log-level');
	if (logLevelIdx !== -1) {
		// Validar que hi ha un valor després de --log-level
		if (logLevelIdx >= args.length - 1) {
			console.error(
				`
❌ Error: --log-level requires a value

Usage:
  node scripts/test.mjs [--log-level <level>] [extraArgs...]
Example:
  node scripts/test.mjs --log-level info
		`.trim()
			);
			process.exit(2);
		}

		// Validar nivell de log
		const logLevel = args[logLevelIdx + 1];
		const validLogLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

		if (!validLogLevels.includes(logLevel)) {
			console.error(
				`
❌ Error: Invalid log level '${logLevel}'

Valid log levels: ${validLogLevels.join(', ')}

Usage:
  node scripts/test.mjs [--log-level <level>] [extraArgs...]
Example:
  node scripts/test.mjs --log-level info
		`.trim()
			);
			process.exit(2);
		}
	}

	return args;
}

// Validar arguments abans de continuar
const args = validateArgs();

// Args extra (p. ex. --call-tool '...', --oneshot, etc.)
const extraArgs = args.slice(0);

// 1) Resolució del nivell de log
function resolveLogLevel() {
	// a) Argument --log-level manual (màxima prioritat)
	const logLevelIndex = extraArgs.indexOf('--log-level');
	if (logLevelIndex !== -1 && logLevelIndex + 1 < extraArgs.length) {
		return extraArgs[logLevelIndex + 1];
	}

	// b) Variable d'entorn
	if (process.env.LOG_LEVEL?.trim()) {
		return process.env.LOG_LEVEL.trim();
	}

	// c) Per defecte (no passar --log-level al client)
	return null;
}

const logLevel = resolveLogLevel();

// 2) Resolució del oneshot arg
function resolveOneshotArg() {
	// a) Argument --call-tool manual (màxima prioritat)
	const callToolIndex = extraArgs.indexOf('--call-tool');
	if (callToolIndex !== -1 && callToolIndex + 1 < extraArgs.length) {
		return extraArgs[callToolIndex + 1];
	}

	// b) Variable d'entorn (només si s'especifica --oneshot)
	const hasOneshotFlag = extraArgs.includes('--oneshot');
	if (hasOneshotFlag && process.env.TEST_ONESHOT_ARG?.trim()) {
		// Processar les cometes escapades del JSON
		return process.env.TEST_ONESHOT_ARG.trim().replace(/\\"/g, '"');
	}

	// c) Per defecte (no oneshot)
	return null;
}

const oneshotArg = resolveOneshotArg();

// 3) Resolució del servidor MCP
function resolveMcpServer() {
	// a) Argument --server manual (màxima prioritat)
	const serverIndex = extraArgs.indexOf('--server');
	if (serverIndex !== -1 && serverIndex + 1 < extraArgs.length) {
		return extraArgs[serverIndex + 1];
	}

	// b) Variable d'entorn
	if (process.env.TEST_MCP_SERVER?.trim()) {
		return process.env.TEST_MCP_SERVER.trim();
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

// Detectar si estem en mode one-shot
const isOneShotMode = oneshotArg !== null;

if (isOneShotMode) {
	// Mode one-shot: capturar sortida per prettify
	const oneshotArgs = [...extraArgs];
	if (oneshotArg && !oneshotArgs.includes('--call-tool')) {
		oneshotArgs.push('--call-tool', oneshotArg);
	}

	// Construir arguments del client
	const clientArgs = [clientEntry, '--server', server];
	if (logLevel) {
		clientArgs.push('--log-level', logLevel);
	}
	clientArgs.push(...oneshotArgs);

	const child = spawn(process.execPath, clientArgs, {
		env: {...process.env},
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
	const clientArgs = [clientEntry, '--server', server];
	if (logLevel) {
		clientArgs.push('--log-level', logLevel);
	}
	clientArgs.push(...extraArgs);

	const child = spawn(process.execPath, clientArgs, {
		env: {...process.env},
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

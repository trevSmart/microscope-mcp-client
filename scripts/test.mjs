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
	return 'npx:@modelcontextprotocol/server-everything -y stdio';
}

const server = resolveMcpServer();

// Validar que el servidor s'ha resolt correctament
if (!server || server.trim() === '') {
	console.error(
		`
❌ Error: Failed to resolve MCP server

Please set one of the following:
- TEST_MCP_SERVER environment variable
- Or ensure the default server path exists: npx:@modelcontextprotocol/server-everything -y stdio
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

// Detectar modes d'execució
const isOneShotMode = oneshotArg !== null;
const isAutomatedMode = extraArgs.includes('--automated');

// Funció helper per construir arguments del client
function buildClientArgs(additionalArgs = []) {
	const clientArgs = [clientEntry, '--server', server];
	if (logLevel) {
		clientArgs.push('--log-level', logLevel);
	}
	clientArgs.push(...extraArgs, ...additionalArgs);
	return clientArgs;
}

if (isOneShotMode) {
	// Mode one-shot: capturar sortida per prettify
	const oneshotArgs = oneshotArg && !extraArgs.includes('--call-tool') ? ['--call-tool', oneshotArg] : [];
	const clientArgs = buildClientArgs(oneshotArgs);

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
} else if (isAutomatedMode) {
	// Mode automàtic: injectar comandes via stdin amb descobriment dinàmic
	console.log('🚀 Starting automated MCP client test...');
	console.log(`📡 Server: ${server}`);
	console.log('');

	const clientArgs = buildClientArgs();

	const child = spawn(process.execPath, clientArgs, {
		env: {...process.env},
		stdio: ['pipe', 'pipe', 'inherit'] // Pipe stdin i stdout per capturar respostes
	});

	let output = '';
	const discoveredTools = [];
	let commandQueue = [];
	let currentPhase = 'discovery';
	const testResults = [];
	let currentCommandOutput = '';
	let currentCommandStartTime = 0;

	// Capturar sortida per analitzar les eines descobertes
	child.stdout.on('data', (data) => {
		const dataStr = data.toString();
		output += dataStr;
		currentCommandOutput += dataStr; // Capturar sortida per la comanda actual
		process.stdout.write(data); // Mostrar també a la consola

		// Detectar JSON immediatament quan arriba
		if (currentPhase === 'discovery') {
			detectAndProcessJson();
		}
	});

	// Funció per detectar i processar JSON immediatament
	function detectAndProcessJson() {
		// Buscar JSON complet en la sortida després del prompt
		const jsonMatch = output.match(/\[\s*\{[\s\S]*?\}\s*\]/);
		if (jsonMatch) {
			try {
				const toolsData = JSON.parse(jsonMatch[0]);

				if (Array.isArray(toolsData)) {
					discoveredTools.length = 0; // Netejar l'array
					discoveredTools.push(...toolsData.map((tool) => tool.name));
					console.log(`\n🔍 Discovered ${discoveredTools.length} tools: ${discoveredTools.join(', ')}`);
					currentPhase = 'testing';
					buildTestCommands(toolsData);
					// Reinicialitzar l'índex de comandes per començar amb les noves comandes
					commandIndex = 0;
					// Continuar immediatament amb les noves comandes
					setTimeout(() => {
						sendNextCommand();
					}, 1000); // Petita pausa per permetre que es processi la sortida
				}
			} catch (error) {
				console.log('⚠️  Failed to parse tools JSON:', error.message);
				// Fallback al parsing de text si el JSON falla
				analyzeOutputText();
			}
		}
	}

	// Funció per analitzar la sortida i extreure eines descobertes (fallback)
	function analyzeOutput() {
		if (currentPhase !== 'discovery') {
			return;
		}
		// Aquesta funció ara només s'usa com a fallback
		analyzeOutputText();
	}

	// Funció de fallback per analitzar la sortida de text (implementació original)
	function analyzeOutputText() {
		const lines = output.split('\n');
		let inToolsSection = false;
		let foundTools = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Detectar l'inici de la secció d'eines
			if (trimmed === 'Available tools:' || trimmed.includes('Available tools:')) {
				inToolsSection = true;
				continue;
			}

			// Detectar noms d'eines
			if (inToolsSection && trimmed && !foundTools) {
				const hasInvalidChars =
					trimmed.startsWith('  ') || trimmed.startsWith('-') || trimmed.includes('Arguments:') || trimmed.includes('Description:') || trimmed.includes('Available options:') || trimmed.includes('[') || trimmed.includes(']') || trimmed.includes('(') || trimmed.includes(')') || trimmed.includes(':');

				const isValidLength = trimmed.length > 0 && trimmed.length < 50;
				const isValidFormat = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed);

				if (!hasInvalidChars && isValidLength && isValidFormat) {
					discoveredTools.push(trimmed);
					foundTools = true;
				}
			}

			// Continuar buscant després d'Arguments:
			if (inToolsSection && trimmed.includes('Arguments:')) {
				foundTools = false;
			}

			// Sortir si trobem línia buida després d'eines
			if (inToolsSection && trimmed === '' && discoveredTools.length > 0) {
				break;
			}
		}

		// Passar a testing si hem descobert eines
		if (discoveredTools.length > 0) {
			console.log(`\n🔍 Discovered ${discoveredTools.length} tools: ${discoveredTools.join(', ')}`);
			currentPhase = 'testing';
			buildTestCommands();
			// Reinicialitzar l'índex de comandes per començar amb les noves comandes
			commandIndex = 0;
			// Continuar immediatament amb les noves comandes
			setTimeout(() => {
				sendNextCommand();
			}, 1000); // Petita pausa per permetre que es processi la sortida
		}
	}

	// Funció per construir comandes de prova basades en les eines descobertes
	function buildTestCommands(toolsData = null) {
		commandQueue = []; // Netejar la cua

		// Si tenim dades JSON, usar-les per generar comandes intel·ligents
		if (toolsData && Array.isArray(toolsData)) {
			// Trobar una tool que no tingui arguments d'entrada
			const toolWithoutArgs = toolsData.find((tool) => !tool.inputSchema?.properties || Object.keys(tool.inputSchema.properties).length === 0);

			if (toolWithoutArgs) {
				commandQueue.push(`describe ${toolWithoutArgs.name}`);
				commandQueue.push(`call ${toolWithoutArgs.name}`);
				console.log(`🎯 Selected tool without arguments: ${toolWithoutArgs.name}`);
			} else {
				// Si no trobem cap tool sense arguments, sortir amb error
				console.error(
					`
❌ Error: No tools without arguments found

This automated test requires a server with at least one tool that doesn't require input arguments.
The test found ${toolsData.length} tools, but all of them require arguments.

Available tools: ${toolsData.map((tool) => tool.name).join(', ')}

Please use a different MCP server that provides tools without arguments, such as:
- printEnv
- getTinyImage
- getRecentlyViewedRecords
- Or any other tool that doesn't require input parameters

You can test with the 'everything' server which includes tools without arguments:
  npm run test -- --server "npx:@modelcontextprotocol/server-everything"
				`.trim()
				);
				process.exit(1);
			}
		} else {
			// Fallback: usar l'aproximació original per compatibilitat
			// Buscar una tool que no necessiti arguments
			const toolWithoutArgs = discoveredTools.find((tool) => tool === 'printEnv' || tool === 'getTinyImage' || tool === 'getRecentlyViewedRecords');

			if (toolWithoutArgs) {
				commandQueue.push(`describe ${toolWithoutArgs}`);
				commandQueue.push(`call ${toolWithoutArgs}`);
				console.log(`🎯 Selected tool without arguments: ${toolWithoutArgs}`);
			} else {
				// Si no trobem cap tool sense arguments, sortir amb error
				console.error(
					`
❌ Error: No tools without arguments found

This automated test requires a server with at least one tool that doesn't require input arguments.
The test found ${discoveredTools.length} tools, but none of them are known tools without arguments.

Available tools: ${discoveredTools.join(', ')}

Please use a different MCP server that provides tools without arguments, such as:
- printEnv
- getTinyImage
- getRecentlyViewedRecords
- Or any other tool that doesn't require input parameters

You can test with the 'everything' server which includes tools without arguments:
  npm run test -- --server "npx:@modelcontextprotocol/server-everything"
				`.trim()
				);
				process.exit(1);
			}
		}

		// Afegir comandes finals (sense exit, que es crida després del resum)
		commandQueue.push('help');

		console.log(`📋 Generated ${commandQueue.length} test commands`);
	}

	// Funció per enviar comandes amb delays
	let commandIndex = 0;

	function sendNextCommand() {
		if (commandIndex >= commandQueue.length) {
			console.log('\n✅ All test commands executed. Showing summary...');
			showTestSummary(() => {
				// Després del resum, enviar comanda exit i tancar
				console.log('\n📤 Executing final command: exit');
				child.stdin.write('exit\n');

				// Tancar stdin després d'un petit delay per permetre que exit es processi
				setTimeout(() => {
					child.stdin.end();
				}, 200);
			});

			return;
		}

		const command = commandQueue[commandIndex];
		console.log(`\n📤 Executing command ${commandIndex + 1}/${commandQueue.length}: ${command}`);

		// Inicialitzar captura de sortida per aquesta comanda
		currentCommandOutput = '';
		currentCommandStartTime = Date.now();

		// Enviar la comanda
		child.stdin.write(`${command}\n`);
		commandIndex++;

		// Analitzar la sortida després d'un delay
		setTimeout(() => {
			analyzeOutput();
			captureCommandResult(command);
			sendNextCommand();
		}, 3000); // 3 segons entre comandes per permetre processament
	}

	// Funció per capturar el resultat d'una comanda
	function captureCommandResult(command) {
		const executionTime = Date.now() - currentCommandStartTime;
		let success = false;

		// Analitzar si la comanda ha tingut èxit basant-nos en la sortida
		if (command === 'list' || command === 'list json') {
			success = discoveredTools.length > 0;
		} else if (command.startsWith('describe ')) {
			const hasToolNotFound = currentCommandOutput.includes('Tool not found:');
			const hasError = currentCommandOutput.includes('Error:');
			success = !hasToolNotFound;
			if (hasError) {
				success = false;
			}
		} else if (command.startsWith('call ')) {
			const hasErrorCalling = currentCommandOutput.includes('Error calling tool');
			const hasMcpError = currentCommandOutput.includes('MCP error');
			success = !hasErrorCalling;
			if (hasMcpError) {
				success = false;
			}
		} else if (command === 'resources') {
			const hasResourceList = currentCommandOutput.includes('- ');
			const hasNoResources = currentCommandOutput.includes('No resources available');
			success = hasResourceList || hasNoResources;
		} else if (command === 'help') {
			success = currentCommandOutput.includes('Commands:');
		} else if (command === 'exit') {
			success = true; // Exit sempre és exitós
		}

		// Emmagatzemar el resultat
		testResults.push({
			command: command,
			success: success,
			executionTime: executionTime
		});
	}

	// Funció per mostrar el resum dels tests
	function showTestSummary(callback) {
		console.log(`\n${'='.repeat(60)}`);
		console.log('📊 TEST SUMMARY');
		console.log(`${'='.repeat(60)}`);

		let passedCount = 0;
		let failedCount = 0;

		for (const result of testResults) {
			const status = result.success ? '✅ PASS' : '❌ FAIL';
			const time = `${result.executionTime}ms`;

			console.log(`${status} | ${time.padStart(8)} | ${result.command}`);

			if (result.success) {
				passedCount++;
			} else {
				failedCount++;
			}
		}

		console.log(`${'='.repeat(60)}`);
		console.log(`📈 Results: ${passedCount} passed, ${failedCount} failed`);
		console.log(`⏱️  Total execution time: ${Date.now() - (testResults[0]?.executionTime || 0)}ms`);

		if (failedCount === 0) {
			console.log('🎉 All tests passed!');
		} else {
			console.log(`⚠️  ${failedCount} test(s) failed`);
		}
		console.log(`${'='.repeat(60)}`);

		// Cridar el callback quan el resum s'hagi imprès completament
		if (callback) {
			// Petita pausa per assegurar-nos que el resum es vegi abans de tancar
			setTimeout(() => {
				callback();
			}, 100);
		}
	}

	// Mode automàtic: no necessita timeout global perquè no espera entrada de l'usuari
	// El timeout s'aplica només quan s'espera entrada de l'usuari, no durant l'execució automàtica

	// Esperar que el client estigui llest abans d'enviar comandes
	setTimeout(() => {
		console.log('🎯 Starting automated command execution...');
		// Començar amb la comanda 'list json' per descobrir eines en format JSON
		commandQueue = ['list json'];
		sendNextCommand();
	}, 3000); // Esperar 3 segons perquè el client s'inicialitzi

	child.on('exit', (code) => {
		if (code === 0) {
			console.log('\n🎉 Automated test completed successfully!');
		} else if (code === null) {
			console.log('\n⚠️  Client terminated by signal (this is normal for automated tests)');
		} else {
			console.error(`\n❌ Client exited with code: ${code}`);
		}

		// Sortir del procés principal
		setTimeout(() => {
			process.exit(code === null ? 0 : code);
		}, 100);
	});

	child.on('error', (error) => {
		console.error('Failed to start client:', error);
		process.exit(1);
	});
} else {
	// Mode interactiu: heretar sortida directament
	const clientArgs = buildClientArgs();

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

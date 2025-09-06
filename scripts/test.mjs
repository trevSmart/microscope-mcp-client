// scripts/run-test.mjs
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {existsSync} from 'node:fs';
import dotenv from 'dotenv';

// Suppress dotenv tip messages
process.env.DOTENV_CONFIG_QUIET = 'true';
dotenv.config({debug: false});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Input arguments validation
function validateArgs() {
	const args = process.argv.slice(2);

	// Validate log level if specified
	const logLevelIdx = args.indexOf('--log-level');
	if (logLevelIdx !== -1) {
		// Validate that there's a value after --log-level
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

		// Validate log level
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

// Validate arguments before continuing
const args = validateArgs();

// Extra args (e.g. --call-tool '...', --oneshot, etc.)
const extraArgs = args.slice(0);

// 1) Log level resolution
function resolveLogLevel() {
	// a) Manual --log-level argument (highest priority)
	const logLevelIndex = extraArgs.indexOf('--log-level');
	if (logLevelIndex !== -1 && logLevelIndex + 1 < extraArgs.length) {
		return extraArgs[logLevelIndex + 1];
	}

	// b) Environment variable
	if (process.env.LOG_LEVEL?.trim()) {
		return process.env.LOG_LEVEL.trim();
	}

	// c) Default (don't pass --log-level to client)
	return null;
}

const logLevel = resolveLogLevel();

// 2) Oneshot arg resolution
function resolveOneshotArg() {
	// a) Manual --call-tool argument (highest priority)
	const callToolIndex = extraArgs.indexOf('--call-tool');
	if (callToolIndex !== -1 && callToolIndex + 1 < extraArgs.length) {
		return extraArgs[callToolIndex + 1];
	}

	// b) Environment variable (only if --oneshot is specified)
	const hasOneshotFlag = extraArgs.includes('--oneshot');
	if (hasOneshotFlag && process.env.TEST_ONESHOT_ARG?.trim()) {
		// Process escaped quotes from JSON
		return process.env.TEST_ONESHOT_ARG.trim().replace(/\\"/g, '"');
	}

	// c) Default (no oneshot)
	return null;
}

const oneshotArg = resolveOneshotArg();

// 3) MCP server resolution
function resolveMcpServer() {
	// a) Manual --server argument (highest priority)
	const serverIndex = extraArgs.indexOf('--server');
	if (serverIndex !== -1 && serverIndex + 1 < extraArgs.length) {
		return extraArgs[serverIndex + 1];
	}

	// b) Environment variable
	if (process.env.TEST_MCP_SERVER?.trim()) {
		return process.env.TEST_MCP_SERVER.trim();
	}

	// c) Local default
	return 'npx:@modelcontextprotocol/server-everything -y stdio';
}

const server = resolveMcpServer();

// Validate that the server has been resolved correctly
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

// 4) Execute the client
const clientEntry = resolve(__dirname, '../build/index.js');

// Verify that the client exists
if (!existsSync(clientEntry)) {
	console.error(
		`
❌ Error: Client binary not found at ${clientEntry}

Please run 'npm run build' first to build the client.
	`.trim()
	);
	process.exit(2);
}

// Detect execution modes
const isOneShotMode = oneshotArg !== null;
const isAutomatedMode = extraArgs.includes('--automated');

// Helper function to build client arguments
function buildClientArgs(additionalArgs = []) {
	const clientArgs = [clientEntry, '--server', server];
	if (logLevel) {
		clientArgs.push('--log-level', logLevel);
	}
	clientArgs.push(...extraArgs, ...additionalArgs);
	return clientArgs;
}

if (isOneShotMode) {
	// One-shot mode: capture output for prettify
	const oneshotArgs = oneshotArg && !extraArgs.includes('--call-tool') ? ['--call-tool', oneshotArg] : [];
	const clientArgs = buildClientArgs(oneshotArgs);

	const child = spawn(process.execPath, clientArgs, {
		env: {...process.env},
		stdio: ['inherit', 'pipe', 'inherit'] // Capture stdout to process it
	});

	let output = '';

	child.stdout.on('data', (data) => {
		output += data.toString();
	});

	// Add timeout to avoid hanging indefinitely
	const timeout = setTimeout(() => {
		console.error('Timeout: Client took too long to respond');
		child.kill('SIGTERM');
		process.exit(1);
	}, 60_000); // 60 seconds

	child.on('exit', (code) => {
		clearTimeout(timeout);

		if (code === 0) {
			// Process output for prettify
			try {
				// Search for JSON response in output
				// Try to find valid JSON that starts with { and ends with }
				const lines = output.split('\n');
				let jsonFound = false;

				for (const line of lines) {
					const trimmedLine = line.trim();
					// Look for lines that look like JSON (start with { and end with })
					if (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) {
						try {
							const parsed = JSON.parse(trimmedLine);
							console.log(`\x1b[38;5;136m${JSON.stringify(parsed, null, 2)}\x1b[0m`);
							jsonFound = true;
							break;
						} catch {
							// If this line is not valid JSON, continue searching
						}
					}
				}

				// If no valid JSON found, show original output
				if (!jsonFound) {
					console.log(output);
				}
			} catch (_error) {
				// If there's an error parsing JSON, show original output
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
	// Automated mode: inject commands via stdin with dynamic discovery
	console.log('🚀 Starting automated MCP client test...');
	console.log(`📡 Server: ${server}`);
	console.log('');

	const clientArgs = buildClientArgs();

	const child = spawn(process.execPath, clientArgs, {
		env: {...process.env},
		stdio: ['pipe', 'pipe', 'inherit'] // Pipe stdin and stdout to capture responses
	});

	let output = '';
	const discoveredTools = [];
	let commandQueue = [];
	let currentPhase = 'discovery';
	const testResults = [];
	let currentCommandOutput = '';
	let currentCommandStartTime = 0;

	// Capture output to analyze discovered tools
	child.stdout.on('data', (data) => {
		const dataStr = data.toString();
		output += dataStr;
		currentCommandOutput += dataStr; // Capture output for current command
		process.stdout.write(data); // Also show on console

		// Detect JSON immediately when it arrives
		if (currentPhase === 'discovery') {
			detectAndProcessJson();
		}
	});

	// Function to detect and process JSON immediately
	function detectAndProcessJson() {
		// Search for complete JSON in output after prompt
		const jsonMatch = output.match(/\[\s*\{[\s\S]*?\}\s*\]/);
		if (jsonMatch) {
			try {
				const toolsData = JSON.parse(jsonMatch[0]);

				if (Array.isArray(toolsData)) {
					discoveredTools.length = 0; // Clear array
					discoveredTools.push(...toolsData.map((tool) => tool.name));
					console.log(`\n🔍 Discovered ${discoveredTools.length} tools: ${discoveredTools.join(', ')}`);
					currentPhase = 'testing';
					buildTestCommands(toolsData);
					// Reinitialize command index to start with new commands
					commandIndex = 0;
					// Continue immediately with new commands
					setTimeout(() => {
						sendNextCommand();
					}, 1000); // Small pause to allow output processing
				}
			} catch (error) {
				console.log('⚠️  Failed to parse tools JSON:', error.message);
				// Fallback to text parsing if JSON fails
				analyzeOutputText();
			}
		}
	}

	// Function to analyze output and extract discovered tools (fallback)
	function analyzeOutput() {
		if (currentPhase !== 'discovery') {
			return;
		}
		// This function is now only used as fallback
		analyzeOutputText();
	}

	// Fallback function to analyze text output (original implementation)
	function analyzeOutputText() {
		const lines = output.split('\n');
		let inToolsSection = false;
		let foundTools = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Detect start of tools section
			if (trimmed === 'Available tools:' || trimmed.includes('Available tools:')) {
				inToolsSection = true;
				continue;
			}

			// Detect tool names
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

			// Continue searching after Arguments:
			if (inToolsSection && trimmed.includes('Arguments:')) {
				foundTools = false;
			}

			// Exit if we find empty line after tools
			if (inToolsSection && trimmed === '' && discoveredTools.length > 0) {
				break;
			}
		}

		// Move to testing if we've discovered tools
		if (discoveredTools.length > 0) {
			console.log(`\n🔍 Discovered ${discoveredTools.length} tools: ${discoveredTools.join(', ')}`);
			currentPhase = 'testing';
			buildTestCommands();
			// Reinitialize command index to start with new commands
			commandIndex = 0;
			// Continue immediately with new commands
			setTimeout(() => {
				sendNextCommand();
			}, 1000); // Small pause to allow output processing
		}
	}

	// Function to build test commands based on discovered tools
	function buildTestCommands(toolsData = null) {
		commandQueue = []; // Clear queue

		// If we have JSON data, use it to generate intelligent commands
		if (toolsData && Array.isArray(toolsData)) {
			// Find a tool that doesn't have input arguments
			const toolWithoutArgs = toolsData.find((tool) => !tool.inputSchema?.properties || Object.keys(tool.inputSchema.properties).length === 0);

			if (toolWithoutArgs) {
				commandQueue.push(`describe ${toolWithoutArgs.name}`);
				commandQueue.push(`call ${toolWithoutArgs.name}`);
				console.log(`🎯 Selected tool without arguments: ${toolWithoutArgs.name}`);
			} else {
				// If we don't find any tool without arguments, exit with error
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
			// Fallback: use original approach for compatibility
			// Find a tool that doesn't need arguments
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

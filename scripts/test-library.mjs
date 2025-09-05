#!/usr/bin/env node

/**
 * Test per demostrar l'ús del client MCP com a llibreria importada
 *
 * Aquest test mostra com utilitzar el client dins d'un altre projecte
 * sense necessitat d'executar-lo com a CLI o one-shot.
 */

import {TestMcpClient} from '../build/index.js';
import {spawn} from 'node:child_process';

// Configuració del test
const TEST_SERVER = process.env.TEST_MCP_SERVER || 'npx:@modelcontextprotocol/server-everything -y stdio';
const TEST_TIMEOUT = 30_000; // 30 segons

/**
 * Funció per executar el servidor MCP en mode stdio
 */
async function startMcpServer() {
	return new Promise((resolve, reject) => {
		// Parsejar la especificació del servidor com ho fa el client principal
		let cmd;
		let args;

		if (TEST_SERVER.startsWith('npx:')) {
			const spec = TEST_SERVER.slice('npx:'.length);
			const parts = spec.split(' ');
			const pkgSpec = parts[0];
			const additionalArgs = parts.slice(1);

			// Separar arguments de npx dels arguments del servidor MCP
			const npxArgs = [];
			const serverMCPArgs = [];

			for (const arg of additionalArgs) {
				if (arg === '-y' || arg === '--yes' || arg === '--package' || arg === '-p') {
					npxArgs.push(arg);
				} else {
					serverMCPArgs.push(arg);
				}
			}

			// Si l'usuari no ha especificat -y, l'afegim automàticament
			const finalNpxArgs = npxArgs.includes('-y') ? npxArgs : ['-y', ...npxArgs];

			cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
			args = [...finalNpxArgs, pkgSpec, ...serverMCPArgs];
		} else {
			// Script local
			const isPy = TEST_SERVER.endsWith('.py');
			cmd = isPy ? process.env.PYTHON_CMD || 'python' : process.execPath;
			args = [TEST_SERVER];
		}

		const child = spawn(cmd, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {...process.env, NO_UPDATE_NOTIFIER: '1'}
		});

		// Timeout per evitar que el test s'queda penjat
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error('Server startup timeout'));
		}, 10_000);

		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		// Esperar una mica perquè el servidor s'inicialitzi
		setTimeout(() => {
			clearTimeout(timeout);
			resolve(child);
		}, 2000);
	});
}

/**
 * Test principal que demostra l'ús de la llibreria
 */
async function runLibraryTest() {
	console.log('🧪 Iniciant test de llibreria MCP...');
	console.log(`📡 Servidor: ${TEST_SERVER}`);
	console.log('');

	let serverProcess = null;
	let client = null;

	try {
		// 1. Iniciar el servidor MCP
		console.log('1️⃣ Iniciant servidor MCP...');
		serverProcess = await startMcpServer();
		console.log('✅ Servidor MCP iniciat');

		// 2. Crear instància del client
		console.log('2️⃣ Creant instància del client...');
		client = new TestMcpClient();
		console.log('✅ Client creat');

		// 3. Conectar al servidor
		console.log('3️⃣ Connectant al servidor...');
		const serverTarget = {
			kind: 'npx',
			pkg: '@modelcontextprotocol/server-everything',
			args: ['stdio'],
			npxArgs: ['-y']
		};

		await client.connect(serverTarget, {quiet: true});
		console.log('✅ Connectat al servidor');

		// 4. Verificar handshake
		console.log('4️⃣ Verificant handshake...');
		const handshakeInfo = client.getHandshakeInfo();
		console.log(`   - Connectat: ${handshakeInfo.connected ? '✅' : '❌'}`);
		console.log(`   - Client: ${handshakeInfo.clientInfo.name} v${handshakeInfo.clientInfo.version}`);
		console.log(`   - Transport: ${handshakeInfo.transportType}`);

		if (!client.verifyHandshake()) {
			throw new Error('Handshake verification failed');
		}
		console.log('✅ Handshake verificat');

		// 5. Llistar eines disponibles
		console.log('5️⃣ Llistant eines disponibles...');
		const tools = client.getTools();
		console.log(`   - Trobades ${tools.length} eines:`);
		for (const tool of tools.slice(0, 5)) {
			console.log(`     • ${tool.name}`);
		}
		if (tools.length > 5) {
			console.log(`     ... i ${tools.length - 5} més`);
		}
		console.log('✅ Eines llistades');

		// 6. Describir una eina específica
		console.log('6️⃣ Descrivint una eina...');
		const firstTool = tools[0];
		if (firstTool) {
			const toolInfo = client.describeTool(firstTool.name);
			console.log(`   - Eina: ${toolInfo?.name}`);
			console.log(`   - Descripció: ${toolInfo?.description || 'No disponible'}`);
			console.log(`   - Schema: ${toolInfo?.inputSchema ? 'Disponible' : 'No disponible'}`);
		}
		console.log('✅ Eina descrita');

		// 7. Cridar una eina (si n'hi ha una sense arguments)
		console.log('7️⃣ Cridant una eina...');
		const toolWithoutArgs = tools.find((tool) => {
			const schema = tool.inputSchema;
			return !schema?.properties || Object.keys(schema.properties).length === 0;
		});

		if (toolWithoutArgs) {
			console.log(`   - Cridant eina: ${toolWithoutArgs.name}`);
			const result = await client.callTool(toolWithoutArgs.name, {});
			console.log(`   - Resultat: ${JSON.stringify(result, null, 2).substring(0, 100)}...`);
			console.log('✅ Eina cridada amb èxit');
		} else {
			console.log("   - No s'ha trobat cap eina sense arguments");
			console.log("✅ Saltant crida d'eina");
		}

		// 8. Llistar recursos (si estan disponibles)
		console.log('8️⃣ Llistant recursos...');
		const resources = client.getResources();
		console.log(`   - Trobats ${resources.length} recursos`);
		for (const resource of resources.slice(0, 3)) {
			console.log(`     • ${resource.uri} (${resource.name || 'Sense nom'})`);
		}
		if (resources.length > 3) {
			console.log(`     ... i ${resources.length - 3} més`);
		}
		console.log('✅ Recursos llistats');

		// 9. Configurar logging
		console.log('9️⃣ Configurant logging...');
		const logLevels = client.getLogLevels();
		console.log(`   - Nivells disponibles: ${logLevels.join(', ')}`);
		await client.setLoggingLevel('info');
		console.log('✅ Logging configurat');

		console.log('');
		console.log('🎉 Test de llibreria completat amb èxit!');
		console.log('');
		console.log('📋 Resum del test:');
		console.log(`   - Servidor: ${TEST_SERVER}`);
		console.log(`   - Eines descobertes: ${tools.length}`);
		console.log(`   - Recursos disponibles: ${resources.length}`);
		console.log(`   - Handshake: ✅`);
		console.log(`   - Connexió: ✅`);
	} catch (error) {
		console.error('❌ Error durant el test:', error.message);
		console.error('Stack trace:', error.stack);
		process.exit(1);
	} finally {
		// Netejar recursos
		console.log('');
		console.log('🧹 Netejant recursos...');

		if (client) {
			try {
				await client.disconnect();
				console.log('✅ Client desconnectat');
			} catch (error) {
				console.log('⚠️ Error desconnectant client:', error.message);
			}
		}

		if (serverProcess) {
			try {
				serverProcess.kill('SIGTERM');
				console.log('✅ Servidor tancat');
			} catch (error) {
				console.log('⚠️ Error tancant servidor:', error.message);
			}
		}
	}
}

// Executar el test amb timeout global
const timeout = setTimeout(() => {
	console.error('❌ Test timeout - el test ha trigat massa temps');
	process.exit(1);
}, TEST_TIMEOUT);

runLibraryTest()
	.then(() => {
		clearTimeout(timeout);
		console.log('✅ Test finalitzat correctament');
		process.exit(0);
	})
	.catch((error) => {
		clearTimeout(timeout);
		console.error('❌ Test fallat:', error.message);
		process.exit(1);
	});

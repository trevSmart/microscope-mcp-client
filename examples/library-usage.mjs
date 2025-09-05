#!/usr/bin/env node

/**
 * Exemple d'ús del client MCP com a llibreria
 *
 * Aquest exemple mostra com utilitzar el client dins d'un altre projecte
 * per interactuar amb servidors MCP de manera programàtica.
 */

import {TestMcpClient} from '../build/index.js';

async function exampleUsage() {
	console.log("📚 Exemple d'ús de la llibreria IBM Test MCP Client");
	console.log('');

	// Crear una instància del client
	const client = new TestMcpClient();

	try {
		// Conectar a un servidor MCP
		console.log('1. Connectant al servidor MCP...');
		const serverTarget = {
			kind: 'npx',
			pkg: '@modelcontextprotocol/server-everything',
			args: ['stdio'],
			npxArgs: ['-y']
		};

		await client.connect(serverTarget, {quiet: true});
		console.log('✅ Connectat!');

		// Obtenir informació del handshake
		const handshakeInfo = client.getHandshakeInfo();
		console.log(`   Client: ${handshakeInfo.clientInfo.name} v${handshakeInfo.clientInfo.version}`);
		console.log(`   Transport: ${handshakeInfo.transportType}`);

		// Llistar eines disponibles
		console.log('\n2. Llistant eines disponibles...');
		const tools = client.getTools();
		console.log(`   Trobades ${tools.length} eines:`);
		for (const tool of tools) {
			console.log(`   - ${tool.name}: ${tool.description || 'Sense descripció'}`);
		}

		// Describir una eina específica
		if (tools.length > 0) {
			console.log('\n3. Descrivint primera eina...');
			const firstTool = tools[0];
			const toolInfo = client.describeTool(firstTool.name);
			console.log(`   Eina: ${toolInfo?.name}`);
			console.log(`   Descripció: ${toolInfo?.description || 'No disponible'}`);

			if (toolInfo?.inputSchema) {
				const schema = toolInfo.inputSchema;
				const properties = schema.properties || {};
				const required = schema.required || [];

				console.log(`   Arguments:`);
				if (Object.keys(properties).length === 0) {
					console.log(`     - Cap argument requerit`);
				} else {
					for (const [propName, prop] of Object.entries(properties)) {
						const propDef = prop;
						const isRequired = required.includes(propName);
						console.log(`     - ${propName} (${propDef.type || 'string'})${isRequired ? ' [REQUERIT]' : ''}`);
					}
				}
			}
		}

		// Cridar una eina si n'hi ha una sense arguments
		const toolWithoutArgs = tools.find((tool) => {
			const schema = tool.inputSchema;
			return !schema?.properties || Object.keys(schema.properties).length === 0;
		});

		if (toolWithoutArgs) {
			console.log(`\n4. Cridant eina sense arguments: ${toolWithoutArgs.name}`);
			try {
				const result = await client.callTool(toolWithoutArgs.name, {});
				console.log('   Resultat:');
				console.log(JSON.stringify(result, null, 2));
			} catch (error) {
				console.log(`   Error: ${error.message}`);
			}
		} else {
			console.log("\n4. No s'ha trobat cap eina sense arguments per cridar");
		}

		// Llistar recursos
		console.log('\n5. Llistant recursos...');
		const resources = client.getResources();
		if (resources.length > 0) {
			console.log(`   Trobats ${resources.length} recursos:`);
			for (const resource of resources) {
				console.log(`   - ${resource.uri} (${resource.name || 'Sense nom'})`);
			}
		} else {
			console.log('   No hi ha recursos disponibles');
		}

		// Configurar logging
		console.log('\n6. Configurant logging...');
		const logLevels = client.getLogLevels();
		console.log(`   Nivells disponibles: ${logLevels.join(', ')}`);
		await client.setLoggingLevel('info');
		console.log('   Logging configurat a "info"');

		console.log('\n✅ Exemple completat amb èxit!');
	} catch (error) {
		console.error('❌ Error:', error.message);
	} finally {
		// Sempre desconnectar
		try {
			await client.disconnect();
			console.log('\n🔌 Client desconnectat');
		} catch (error) {
			console.log('\n⚠️ Error desconnectant:', error.message);
		}
	}
}

// Executar l'exemple
exampleUsage().catch(console.error);

#!/usr/bin/env node

/**
 * Test to demonstrate the usage of the MCP client as an imported library
 *
 * This test shows how to use the client within another project
 * without needing to run it as CLI or one-shot.
 */

import {TestMcpClient} from '../build/index.js';
import {spawn} from 'node:child_process';

// Test configuration
const TEST_SERVER = process.env.TEST_MCP_SERVER || 'npx:@modelcontextprotocol/server-everything -y stdio';
const TEST_TIMEOUT = 30_000; // 30 seconds

/**
 * Function to execute the MCP server in stdio mode
 */
async function startMcpServer() {
	return new Promise((resolve, reject) => {
		// Parse server specification as the main client does
		let cmd;
		let args;

		if (TEST_SERVER.startsWith('npx:')) {
			const spec = TEST_SERVER.slice('npx:'.length);
			const parts = spec.split(' ');
			const pkgSpec = parts[0];
			const additionalArgs = parts.slice(1);

			// Separate npx arguments from MCP server arguments
			const npxArgs = [];
			const serverMCPArgs = [];

			for (const arg of additionalArgs) {
				if (arg === '-y' || arg === '--yes' || arg === '--package' || arg === '-p') {
					npxArgs.push(arg);
				} else {
					serverMCPArgs.push(arg);
				}
			}

			// If user hasn't specified -y, add it automatically
			const finalNpxArgs = npxArgs.includes('-y') ? npxArgs : ['-y', ...npxArgs];

			cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
			args = [...finalNpxArgs, pkgSpec, ...serverMCPArgs];
		} else {
			// Local script
			const isPy = TEST_SERVER.endsWith('.py');
			cmd = isPy ? process.env.PYTHON_CMD || 'python' : process.execPath;
			args = [TEST_SERVER];
		}

		const child = spawn(cmd, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {...process.env, NO_UPDATE_NOTIFIER: '1'}
		});

		// Timeout to prevent test from hanging
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error('Server startup timeout'));
		}, 10_000);

		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		// Wait a bit for server to initialize
		setTimeout(() => {
			clearTimeout(timeout);
			resolve(child);
		}, 2000);
	});
}

/**
 * Main test that demonstrates library usage
 */
async function runLibraryTest() {
	console.log('🧪 Starting MCP library test...');
	console.log(`📡 Server: ${TEST_SERVER}`);
	console.log('');

	let serverProcess = null;
	let client = null;

	try {
		// 1. Start MCP server
		console.log('1️⃣ Starting MCP server...');
		serverProcess = await startMcpServer();
		console.log('✅ MCP server started');

		// 2. Create client instance
		console.log('2️⃣ Creating client instance...');
		client = new TestMcpClient();
		console.log('✅ Client created');

		// 3. Connect to server
		console.log('3️⃣ Connecting to server...');
		const serverTarget = {
			kind: 'npx',
			pkg: '@modelcontextprotocol/server-everything',
			args: ['stdio'],
			npxArgs: ['-y']
		};

		await client.connect(serverTarget, {quiet: true});
		console.log('✅ Connected to server');

		// 4. Verify handshake
		console.log('4️⃣ Verifying handshake...');
		const handshakeInfo = client.getHandshakeInfo();
		console.log(`   - Connected: ${handshakeInfo.connected ? '✅' : '❌'}`);
		console.log(`   - Client: ${handshakeInfo.clientInfo.name} v${handshakeInfo.clientInfo.version}`);
		console.log(`   - Transport: ${handshakeInfo.transportType}`);

		if (!client.verifyHandshake()) {
			throw new Error('Handshake verification failed');
		}
		console.log('✅ Handshake verified');

		// 5. List available tools
		console.log('5️⃣ Listing available tools...');
		const tools = client.getTools();
		console.log(`   - Found ${tools.length} tools:`);
		for (const tool of tools.slice(0, 5)) {
			console.log(`     • ${tool.name}`);
		}
		if (tools.length > 5) {
			console.log(`     ... and ${tools.length - 5} more`);
		}
		console.log('✅ Tools listed');

		// 6. Describe a specific tool
		console.log('6️⃣ Describing a tool...');
		const firstTool = tools[0];
		if (firstTool) {
			const toolInfo = client.describeTool(firstTool.name);
			console.log(`   - Tool: ${toolInfo?.name}`);
			console.log(`   - Description: ${toolInfo?.description || 'Not available'}`);
			console.log(`   - Schema: ${toolInfo?.inputSchema ? 'Available' : 'Not available'}`);
		}
		console.log('✅ Tool described');

		// 7. Call a tool (if there's one without arguments)
		console.log('7️⃣ Calling a tool...');
		const toolWithoutArgs = tools.find((tool) => {
			const schema = tool.inputSchema;
			return !schema?.properties || Object.keys(schema.properties).length === 0;
		});

		if (toolWithoutArgs) {
			console.log(`   - Calling tool: ${toolWithoutArgs.name}`);
			const result = await client.callTool(toolWithoutArgs.name, {});
			console.log(`   - Result: ${JSON.stringify(result, null, 2).substring(0, 100)}...`);
			console.log('✅ Tool called successfully');
		} else {
			console.log('   - No tool without arguments found');
			console.log('✅ Skipping tool call');
		}

		// 8. List resources (if available)
		console.log('8️⃣ Listing resources...');
		const resources = client.getResources();
		console.log(`   - Found ${resources.length} resources`);
		for (const resource of resources.slice(0, 3)) {
			console.log(`     • ${resource.uri} (${resource.name || 'No name'})`);
		}
		if (resources.length > 3) {
			console.log(`     ... and ${resources.length - 3} more`);
		}
		console.log('✅ Resources listed');

		// 9. Configure logging
		console.log('9️⃣ Configuring logging...');
		const logLevels = client.getLogLevels();
		console.log(`   - Available levels: ${logLevels.join(', ')}`);
		await client.setLoggingLevel('info');
		console.log('✅ Logging configured');

		console.log('');
		console.log('🎉 Library test completed successfully!');
		console.log('');
		console.log('📋 Test summary:');
		console.log(`   - Server: ${TEST_SERVER}`);
		console.log(`   - Tools discovered: ${tools.length}`);
		console.log(`   - Resources available: ${resources.length}`);
		console.log(`   - Handshake: ✅`);
		console.log(`   - Connection: ✅`);
	} catch (error) {
		console.error('❌ Error during test:', error.message);
		console.error('Stack trace:', error.stack);
		process.exit(1);
	} finally {
		// Clean up resources
		console.log('');
		console.log('🧹 Cleaning up resources...');

		if (client) {
			try {
				await client.disconnect();
				console.log('✅ Client disconnected');
			} catch (error) {
				console.log('⚠️ Error disconnecting client:', error.message);
			}
		}

		if (serverProcess) {
			try {
				serverProcess.kill('SIGTERM');
				console.log('✅ Server closed');
			} catch (error) {
				console.log('⚠️ Error closing server:', error.message);
			}
		}
	}
}

// Execute test with global timeout
const timeout = setTimeout(() => {
	console.error('❌ Test timeout - test took too long');
	process.exit(1);
}, TEST_TIMEOUT);

runLibraryTest()
	.then(() => {
		clearTimeout(timeout);
		console.log('✅ Test completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		clearTimeout(timeout);
		console.error('❌ Test failed:', error.message);
		process.exit(1);
	});

#!/usr/bin/env node

/**
 * Test to demonstrate the usage of the MCP client with HTTP transport
 *
 * This test shows how to use the client with a remote HTTP server
 */

import {TestMcpClient} from '../build/index.js';

// Test configuration
const TEST_HTTP_SERVER = process.env.TEST_HTTP_SERVER || 'http://localhost:3000/mcp';
// Timeout value (unused currently but kept for future use)
const _TEST_TIMEOUT = 30_000; // 30 seconds

/**
 * Main test that demonstrates HTTP connection
 */
async function runHttpTest() {
	console.log('🧪 Starting MCP HTTP transport test...');
	console.log(`📡 Server: ${TEST_HTTP_SERVER}`);
	console.log('');

	let client = null;

	try {
		// 1. Create client instance
		console.log('1️⃣ Creating client instance...');
		client = new TestMcpClient();
		console.log('✅ Client created');

		// 2. Connect to HTTP server
		console.log('2️⃣ Connecting to HTTP server...');
		const serverTarget = {
			kind: 'http',
			url: TEST_HTTP_SERVER,
			headers: {}
		};

		await client.connect(serverTarget, {quiet: true});
		console.log('✅ Connected to server');

		// 3. Verify handshake
		console.log('3️⃣ Verifying handshake...');
		const handshakeInfo = client.getHandshakeInfo();
		console.log(`   - Connected: ${handshakeInfo.connected ? '✅' : '❌'}`);
		console.log(`   - Client: ${handshakeInfo.clientInfo.name} v${handshakeInfo.clientInfo.version}`);
		console.log(`   - Transport: ${handshakeInfo.transportType}`);

		if (!client.verifyHandshake()) {
			throw new Error('Handshake verification failed');
		}
		console.log('✅ Handshake verified');

		// 4. List available tools
		console.log('4️⃣ Listing available tools...');
		const tools = client.getTools();
		console.log(`   - Found ${tools.length} tools:`);
		for (const tool of tools.slice(0, 5)) {
			console.log(`     • ${tool.name}`);
		}
		if (tools.length > 5) {
			console.log(`     ... and ${tools.length - 5} more`);
		}
		console.log('✅ Tools listed');

		// 5. Test completed
		console.log('');
		console.log('✅ HTTP transport test completed successfully');
	} catch (error) {
		console.error('❌ Error:', error.message);
		process.exit(1);
	} finally {
		// Clean up
		if (client) {
			await client.disconnect();
		}
	}
}

// Only run if invoked directly
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
	try {
		await runHttpTest();
		process.exit(0);
	} catch (error) {
		console.error('❌ Unhandled error:', error);
		process.exit(1);
	}
}

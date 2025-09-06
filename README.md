# MiCroscoPe

A REPL client for interacting with MCP (Model Context Protocol) servers. It can also be used as a library for test scripts.

## Usage

### As a CLI command (interactive mode)

```bash
# Show help
microscope --help

# Connect to an MCP server via npx
microscope --server "npx:@modelcontextprotocol/server-everything"

# Connect to a local server with custom logging level
microscope --server ./server.js --log-level debug
microscope --server ./server.py --log-level info
```

#### Available commands
- `list` - List all available tools
- `describe <toolName>` - Show detailed information about a tool
- `call <toolName> '<jsonArgs>'` - Execute a tool with JSON arguments
- `setLoggingLevel <level>` - Configure the logging level
- `resources` - List all available resources
- `resource <uri>` - Show information about a specific resource
- `help` - Show this help
- `exit` or `quit` - Close the client

---

### One-shot mode (single tool execution)

To execute a single tool and exit immediately:

```bash
# Single tool execution with custom logging level
microscope --server ./server.js --log-level debug --call-tool "<toolName> {\"toolParam1\":\"toolParamValue1\", \"toolParam2\":\"toolParamValue2\"}"
```

**One-shot mode features**:
- Only shows the JSON response from the tool (all other logs are suppressed)
- In case of parsing error or tool failure, writes a short error message to stderr and exits with non-zero code
- The `--call-tool` argument expects a quoted string containing the tool name followed by a JSON object with parameters
- If `--call-tool` is present, it runs non-interactively and exits immediately

**Query available tools list**:
```bash
# List all available tools with custom logging level
microscope --server ./server.js --log-level info --list-tools
```

This option is useful to discover which tools are available in an MCP server before executing one with one-shot mode.

---

### As a library for test scripts

The client can also be used as an imported library within another project:

```javascript
import { TestMcpClient } from 'microscope';

async function exampleUsage() {
    const client = new TestMcpClient();

    try {
        // Connect to an MCP server
        const serverTarget = {
            kind: 'npx',
            pkg: '@modelcontextprotocol/server-everything',
            args: ['stdio'],
            npxArgs: ['-y']
        };

        await client.connect(serverTarget, { quiet: true });

        // List available tools
        const tools = client.getTools();
        console.log(`Found ${tools.length} tools`);

        // Describe a specific tool
        const toolInfo = client.describeTool('echo');
        console.log('Echo tool:', toolInfo);

        // Call a tool
        const result = await client.callTool('echo', { message: 'Hello World!' });
        console.log('Result:', result);

        // List resources
        const resources = client.getResources();
        console.log(`Found ${resources.length} resources`);

    } finally {
        await client.disconnect();
    }
}
```

**Library API**:
- `new TestMcpClient()` - Creates a new client instance
- `client.connect(target, options)` - Connects to the MCP server
- `client.disconnect()` - Disconnects from the server
- `client.getTools()` - Returns list of available tools
- `client.describeTool(name)` - Returns information about a specific tool
- `client.callTool(name, args)` - Calls a tool with arguments
- `client.getResources()` - Returns list of available resources
- `client.getResource(uri)` - Returns information about a specific resource
- `client.setLoggingLevel(level)` - Configures the logging level
- `client.getHandshakeInfo()` - Returns handshake information
- `client.verifyHandshake()` - Verifies that the handshake has completed

See `examples/library-usage.mjs` for a complete usage example.

**Run the example**:
```bash
# After building
npm run build
node examples/library-usage.mjs
```

---

## Testing

### Testing using NPM scripts

```bash
# Interactive CLI mode (log level: info)
npm run test:cli

# One-shot mode (log level: debug)
npm run test:1shot

# Library test (as imported library)
npm run test:lib

The test scripts use the environment variables `TEST_MCP_SERVER` and `TEST_ONESHOT_ARG` for configuration. The logging level is automatically configured via the `--log-level` argument.

#### Automated mode (`npm run test:cli`)

The automated mode executes a series of predefined test commands to verify that the client works correctly:

1. `list` - List all available tools
2. `describe echo` - Describe the echo tool
3. `call echo {"message":"Hello from automated test!"}` - Call the echo tool with a message
4. `resources` - List available resources
5. `help` - Show help
6. `exit` - Exit the client

This mode is ideal for:
- Verifying that the client connects correctly to the MCP server
- Testing basic CLI functionalities
- Running automated tests in CI/CD
- Quick debugging without manual intervention

#### Library test (`npm run test:lib`)

The library test demonstrates the use of the client as an imported library within another project:

1. Creates a client instance programmatically
2. Connects to the MCP server
3. Verifies the handshake and connection
4. Lists available tools
5. Describes specific tools
6. Calls tools (if there are any available without arguments)
7. Lists available resources
8. Configures logging
9. Disconnects properly

This test is ideal for:
- Verifying that the library API works correctly
- Testing programmatic integration with MCP servers
- Validating that the client can be used in external projects
- Testing advanced library functionalities

### Direct client testing

```bash
npm run build
node build/index.js --server "npx:@modelcontextprotocol/server-everything" --log-level debug
```

### Configuration

#### Environment variables

The client supports the following environment variables for testing:

- `TEST_MCP_SERVER`: Value for the `--server` argument
- `TEST_ONESHOT_ARG`: Value for the `--call-tool` argument

**Configuration example** (`.env`):
```bash
TEST_MCP_SERVER="npx:@modelcontextprotocol/server-everything"
TEST_ONESHOT_ARG="echo {\"message\":\"hello\"}"
```

**Note**: The logging level is now configured directly via the `--log-level` argument instead of the `LOG_LEVEL` environment variable.

## License

ISC

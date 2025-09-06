# <img src="assets/logo.png" alt="MiCroscoPe logo" width="120" style="position: relative; margin-right: 4px; top: 4px;"/> MiCroscoPe MCP Client

A simple command line interface MCP client for testing.

## Installation

### From GitHub Packages (Recommended)

```bash
# Configure npm to use GitHub Packages for @trevsmart scope
npm config set @trevsmart:registry https://npm.pkg.github.com

# Install the package
npm install @trevsmart/microscope-mcp-client

# Use the CLI
npx @trevsmart/microscope-mcp-client --server "npx:@modelcontextprotocol/server-everything"
```

### From npm

```bash
# Install from npm
npm install microscope-mcp-client

# Use the CLI
npx microscope-mcp-client --server "npx:@modelcontextprotocol/server-everything"
```

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

## License

ISC

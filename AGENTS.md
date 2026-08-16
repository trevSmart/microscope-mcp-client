# MiCroscoPe

MiCroscoPe is a lightweight command-line client that enables exhaustive testing of MCP servers by AI agents.

## Execution modes

### 1. As a CLI (interactive mode, default mode)
```bash
microscope --server "server_spec" [--log-level <level>]
```

The `server_spec` can be one of the following:
- `npx:@scope/pkg[@version][#bin]` - MCP server via npx
- `./server.js` or `./server.py` - Local JavaScript or Python server
- `http://host:port/path` or `https://host:port/path` - Remote HTTP server

#### Interactive CLI commands

The interactive CLI mode supports the following commands with autocompletion capabilities:

```bash
list                     # list all tools
describe <toolName>      # describe a tool
call <toolName> '<jsonArgs>' # call a tool
setlogginglevel <level>  # configure logging level
resources                # list all resources
resource <uri>           # show a resource
help                     # show help
exit | quit              # close the client
```

### 2. As a single command to execute a single tool of the MCP server (one-shot mode)
```bash
microscope --server "server_spec" [--log-level <level>] --call-tool "toolName {"k":"v"}" --
```

This mode allows executing a single MCP server tool and displaying the response directly to the console.

**Usage examples:**
```bash
# Execute a tool without parameters
microscope --server "npx:@modelcontextprotocol/server-everything" --log-level debug --call-tool "getCurrentDatetime" --

# Execute a tool with JSON parameters
microscope --server "npx:@modelcontextprotocol/server-everything" --log-level info --call-tool 'describeObject {"sObjectName":"Account"}' --
```

### 3. As a library for test scripts
```json
"devDependencies": {
	"microscope"
}
```

## Development

- All literals including comments and documentation must be in English.
- Don't perform cleanup on SIGINT or SIGTERM when the client shuts down.

## Testing

### Testing using NPM scripts

```bash
# Interactive CLI mode (automated)
npm run test:cli

# One-shot mode
npm run test:1shot

# Library usage test (imports build/index.js as a module)
npm run test:lib

# HTTP transport test
npm run test:http
```

Each script runs `npm run build` first. `test:cli` and `test:1shot` are driven by `scripts/test.mjs`, which reads the `TEST_MCP_SERVER` and `TEST_ONESHOT_ARG` environment variables and forwards `--log-level` (or `LOG_LEVEL`) to the client. `test:lib` and `test:http` are plain Node scripts under `test/`.

By default, the client will use the "everything" remote MCP server via npx.

### Direct client testing

```bash
npm run build
node build/index.js --server "npx:@modelcontextprotocol/server-everything" --log-level debug
```

You can also use the convenience scripts `run:cli:local`, `run:cli:npx` and `run:cli:http` to launch the CLI directly against a local, npx or HTTP server respectively.

### Configuration

#### Environment variables

The client supports the following environment variables for testing (see `.env.example`):

- `TEST_MCP_SERVER`: Value for the `--server` argument
- `TEST_ONESHOT_ARG`: Value for the `--call-tool` argument
- `LOG_LEVEL`: Fallback logging level when `--log-level` is not passed
- `MCP_SERVER_DIR`: Optional path to a dependent MCP server directory, used by `scripts/publish-package.sh` to update the dependency after publishing

**Configuration example** (`.env`):
```bash
TEST_MCP_SERVER="npx:@modelcontextprotocol/server-everything"
TEST_ONESHOT_ARG="echo {\"message\":\"hello\"}"
```

**Note**: The logging level is best configured directly via the `--log-level` argument rather than the `LOG_LEVEL` environment variable.

## Documentation

The README.md and other documentation should not expose the internal implementation details of the client.
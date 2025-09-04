This project is a client for the Model Context Protocol (MCP).

You can test the client with the default NPM test scripts:
```bash
npm run test # interactive CLI mode
```
```bash
npm run test:oneshot # single tool execution, shows the tool response and exits
```
By default, the client will use the "everything" remote MCP server via npx.

The CLI interactive mode supports the following commands with autocomplete capabilities:
```bash
list # list all tools
describe <toolName> # describe a tool
call <toolName> '<jsonArgs>' # call a tool
setlogginglevel <level> # set the logging level
resources # list all resources
resource <uri> # show a resource
```

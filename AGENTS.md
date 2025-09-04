# IBM Test MCP Client

Aquest projecte és un client per al Model Context Protocol (MCP) que ofereix múltiples modes d'execució.

## Modes d'execució

### 1. Com a CLI (mode interactiu, mode per defecte)
```bash
ibm-test-mcp-client --server "server_spec"
```

#### Comandes del CLI interactiu

El mode CLI interactiu suporta les següents comandes amb capacitats d'autocompleció:

```bash
list                     # llista totes les eines
describe <toolName>      # descriu una eina
call <toolName> '<jsonArgs>' # crida una eina
setlogginglevel <level>  # configura el nivell de logging
resources                # llista tots els recursos
resource <uri>           # mostra un recurs
help                     # mostra ajuda
exit | quit              # tanca el client
```

### 2. Com a comanda única per executar una sola eina del servidor MCP (mode one-shot)
```bash
ibm-test-mcp-client --server "server_spec" --call-tool "toolName {"k":"v"}" --
```

Aquest mode permet executar una sola eina del servidor MCP i mostrar la resposta directament a la consola.

**Exemples d'ús:**
```bash
# Executar una eina sense paràmetres
ibm-test-mcp-client --server "npx:@modelcontextprotocol/server-everything" --call-tool "getCurrentDatetime" --

# Executar una eina amb paràmetres JSON
ibm-test-mcp-client --server "npx:@modelcontextprotocol/server-everything" --call-tool 'describeObject {"sObjectName":"Account"}' --
```

### 3. Com a llibreria per a scripts de test
```json
"devDependencies": {
	"ibm-test-mcp-client"
}
```

## Testing

### Testing utilitzant els scripts NPM

```bash
# Mode CLI interactiu
npm run test

# Mode one-shot (execució única d'eina)
npm run test:oneshot
```

Els scripts de test utilitzen les variables d'entorn `TEST_MCP_SERVER` i `TEST_ONESHOT_ARG` per a la configuració.

### Testing directe del client

```bash
npm run build
node build/index.js --server "npx:@modelcontextprotocol/server-everything"
```

### Configuració

#### Variables d'entorn

El client suporta les següents variables d'entorn per a testing:

- `TEST_MCP_SERVER`: Valor de l'argument `--server`
- `TEST_ONESHOT_ARG`: Valor de l'argument `--call-tool`
- `LOG_LEVEL`: Nivell de logging pel servidor MCP (per defecte: `info`)

**Exemple de configuració** (`.env`):
```bash
TEST_MCP_SERVER="npx:@modelcontextprotocol/server-everything"
TEST_ONESHOT_ARG="echo {\"message\":\"hello\"}"
LOG_LEVEL="info"
```
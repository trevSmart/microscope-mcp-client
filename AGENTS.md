# IBM Test MCP Client

Aquest projecte és un client per al Model Context Protocol (MCP) que ofereix múltiples modes d'execució.

## Configuració

### Variables d'entorn

El client suporta les següents variables d'entorn per a testing:

- `TEST_MCP_SERVER`: Especificació del servidor MCP per a testing (per defecte: servidor local de Salesforce)
- `TEST_ONESHOT_ARG`: Arguments per a l'execució one-shot (per defecte: `"salesforceMcpUtils {\"action\":\"getState\"}"`)
- `LOG_LEVEL`: Nivell de logging (per defecte: `info`)

**Exemple de configuració** (`.env`):
```bash
TEST_MCP_SERVER="/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js"
TEST_ONESHOT_ARG="salesforceMcpUtils {\"action\":\"getState\"}"
LOG_LEVEL=info
```

## Modes d'execució

### 1. Com a CLI (mode interactiu, mode per defecte)
```bash
ibm-test-mcp-client --server "server_spec"
```

### 2. Com a comanda única per executar una sola eina del servidor MCP (mode one-shot)
```bash
ibm-test-mcp-client --server "server_spec" --call-tool "toolName {"k":"v"}" --
```

Aquest mode permet executar una sola eina del servidor MCP i mostrar la resposta directament a la consola. És útil per a:
- Scripts d'automatització
- Testing d'eines específiques
- Integració amb altres eines

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

### Testing utilitzant els scripts NPM per defecte
Pots provar el client amb els scripts NPM per defecte:
```bash
npm run test # mode CLI interactiu
```
```bash
npm run test:oneshot # execució única d'eina, mostra la resposta de l'eina i surt
```

Els scripts de test utilitzen les variables d'entorn `TEST_MCP_SERVER` i `TEST_ONESHOT_ARG` per a la configuració.

### Testing del client directament sense utilitzar els scripts NPM
```bash
npm run build
node build/index.js --server "server_spec"
```

Durant les proves, pots utilitzar les següents opcions per a "server_spec":

- `/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js` (servidor local)
- `npx:@modelcontextprotocol/server-everything` (servidor remot)

### Configuració automàtica per entorns

El client detecta automàticament l'entorn i configura el servidor adequat:

- **Desenvolupament local**: Usa `TEST_MCP_SERVER` del fitxer `.env` o el valor per defecte
- **CI/CD**: Detecta automàticament i usa `npx:@modelcontextprotocol/server-everything`

## Comandes del CLI interactiu

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
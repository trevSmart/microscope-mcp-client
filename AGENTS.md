# IBM Test MCP Client

Aquest projecte és un client per al Model Context Protocol (MCP) que ofereix múltiples modes d'execució.

## Modes d'execució

### 1. Com a CLI (mode interactiu, mode per defecte)
```bash
ibm-test-mcp-client --server "server_spec"
```

### 2. Com a comanda única per executar una sola eina del servidor MCP
```bash
ibm-test-mcp-client --server "server_spec" --call-tool "toolName {"k":"v"}" --
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
Per defecte, el client utilitzarà el servidor MCP remot "everything" via npx.

### Testing del client directament sense utilitzar els scripts NPM
```bash
npm run build
node build/index.js --server "server_spec"
```

Durant les proves, pots utilitzar els següents arguments "server_spec":

- `/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js`
- `npx:@modelcontextprotocol/server-everything`

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
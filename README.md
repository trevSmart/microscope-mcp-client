# IBM Test MCP Client

Un client REPL per a interactuar amb servidors MCP (Model Context Protocol). També es pot utilitzar com a llibreria per a scripts de test.

## Ús

### Com a comanda CLI (mode interactiu)

```bash
# Mostrar ajuda
ibm-test-mcp-client --help

# Connexió a un servidor MCP via npx
ibm-test-mcp-client --server "npx:@modelcontextprotocol/server-everything"

# Connexió a un servidor local amb nivell de logging personalitzat
ibm-test-mcp-client --server ./server.js --log-level debug
ibm-test-mcp-client --server ./server.py --log-level info
```

#### Comandes disponibles
- `list` - Llista totes les eines disponibles
- `describe <toolName>` - Mostra informació detallada d'una eina
- `call <toolName> '<jsonArgs>'` - Executa una eina amb arguments JSON
- `setLoggingLevel <level>` - Configura el nivell de logging
- `resources` - Llista tots els recursos disponibles
- `resource <uri>` - Mostra informació d'un recurs específic
- `help` - Mostra aquesta ajuda
- `exit` o `quit` - Tanca el client

---

### Mode *one-shot* (execució única d'eina)

Per executar una sola eina i sortir immediatament:

```bash
# Execució única d'una eina amb nivell de logging personalitzat
ibm-test-mcp-client --server ./server.js --log-level debug --call-tool "<toolName> {\"toolParam1\":\"toolParamValue1\", \"toolParam2\":\"toolParamValue2\"}"
```

**Característiques del mode one-shot**:
- Només mostra la resposta JSON de l'eina (tots els altres logs es suprimeixen)
- En cas d'error de parsing o fallada de l'eina, escriu un missatge d'error curt a stderr i surt amb codi no-zero
- L'argument `--call-tool` espera una cadena entre cometes que conté el nom de l'eina seguit d'un objecte JSON amb els paràmetres
- Si `--call-tool` està present, s'executa de forma no-interactiva i surt immediatament

**Consultar la llista d'eines disponibles**:
```bash
# Llistar totes les eines disponibles amb nivell de logging personalitzat
ibm-test-mcp-client --server ./server.js --log-level info --list-tools
```

Aquesta opció és útil per descobrir quines eines estan disponibles en un servidor MCP abans d'executar-ne una amb el mode one-shot.

---

### Com a llibreria per a scripts de test

El client també es pot utilitzar com a llibreria importada dins d'un altre projecte:

```javascript
import { TestMcpClient } from 'ibm-test-mcp-client';

async function exampleUsage() {
    const client = new TestMcpClient();

    try {
        // Conectar a un servidor MCP
        const serverTarget = {
            kind: 'npx',
            pkg: '@modelcontextprotocol/server-everything',
            args: ['stdio'],
            npxArgs: ['-y']
        };

        await client.connect(serverTarget, { quiet: true });

        // Llistar eines disponibles
        const tools = client.getTools();
        console.log(`Trobades ${tools.length} eines`);

        // Describir una eina específica
        const toolInfo = client.describeTool('echo');
        console.log('Eina echo:', toolInfo);

        // Cridar una eina
        const result = await client.callTool('echo', { message: 'Hello World!' });
        console.log('Resultat:', result);

        // Llistar recursos
        const resources = client.getResources();
        console.log(`Trobats ${resources.length} recursos`);

    } finally {
        await client.disconnect();
    }
}
```

**API de la llibreria**:
- `new TestMcpClient()` - Crea una nova instància del client
- `client.connect(target, options)` - Connecta al servidor MCP
- `client.disconnect()` - Desconnecta del servidor
- `client.getTools()` - Retorna llista d'eines disponibles
- `client.describeTool(name)` - Retorna informació d'una eina específica
- `client.callTool(name, args)` - Crida una eina amb arguments
- `client.getResources()` - Retorna llista de recursos disponibles
- `client.getResource(uri)` - Retorna informació d'un recurs específic
- `client.setLoggingLevel(level)` - Configura el nivell de logging
- `client.getHandshakeInfo()` - Retorna informació del handshake
- `client.verifyHandshake()` - Verifica que el handshake s'ha completat

Veure `examples/library-usage.mjs` per un exemple complet d'ús.

**Executar l'exemple**:
```bash
# Després de fer build
npm run build
node examples/library-usage.mjs
```

---

## Testing

### Testing utilitzant els scripts NPM

```bash
# Mode CLI interactiu (log level: info)
npm run test:cli

# Mode one-shot (log level: debug)
npm run test:1shot

# Test de llibreria (com a llibreria importada)
npm run test:lib

Els scripts de test utilitzen les variables d'entorn `TEST_MCP_SERVER` i `TEST_ONESHOT_ARG` per a la configuració. El nivell de logging es configura automàticament via l'argument `--log-level`.

#### Mode automàtic (`npm run test:cli`)

El mode automàtic executa una sèrie de comandes de prova predefinides per verificar que el client funciona correctament:

1. `list` - Llista totes les eines disponibles
2. `describe echo` - Describir l'eina echo
3. `call echo {"message":"Hello from automated test!"}` - Cridar l'eina echo amb un missatge
4. `resources` - Llistar recursos disponibles
5. `help` - Mostrar l'ajuda
6. `exit` - Sortir del client

Aquest mode és ideal per a:
- Verificar que el client es connecta correctament al servidor MCP
- Provar les funcionalitats bàsiques del CLI
- Executar tests automatitzats en CI/CD
- Debugging ràpid sense intervenció manual

#### Test de llibreria (`npm run test:lib`)

El test de llibreria demostra l'ús del client com a llibreria importada dins d'un altre projecte:

1. Crea una instància del client programàticament
2. Connecta al servidor MCP
3. Verifica el handshake i la connexió
4. Llista eines disponibles
5. Describir eines específices
6. Crida eines (si n'hi ha disponibles sense arguments)
7. Llista recursos disponibles
8. Configura logging
9. Desconnecta correctament

Aquest test és ideal per a:
- Verificar que l'API de la llibreria funciona correctament
- Provar la integració programàtica amb servidors MCP
- Validar que el client es pot utilitzar en projectes externs
- Testing de funcionalitats avançades com a llibreria

### Testing directe del client

```bash
npm run build
node build/index.js --server "npx:@modelcontextprotocol/server-everything" --log-level debug
```

### Configuració

#### Variables d'entorn

El client suporta les següents variables d'entorn per a testing:

- `TEST_MCP_SERVER`: Valor de l'argument `--server`
- `TEST_ONESHOT_ARG`: Valor de l'argument `--call-tool`

**Exemple de configuració** (`.env`):
```bash
TEST_MCP_SERVER="npx:@modelcontextprotocol/server-everything"
TEST_ONESHOT_ARG="echo {\"message\":\"hello\"}"
```

**Nota**: El nivell de logging ara es configura directament via l'argument `--log-level` en lloc de la variable d'entorn `LOG_LEVEL`.

## Llicència

ISC

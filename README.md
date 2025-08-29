# IBM Test MCP Client

Un client REPL per a interactuar amb servidors MCP (Model Context Protocol). També es pot utilitzar com a llibreria per a scripts de test.

## Instal·lació

```bash
npm install -g ibm-test-client
```

## Ús

### Com a comanda CLI

```bash
# Connexió a un servidor MCP via npx
ibm-test-client "npx:@scope/mcp-server@0.3.1#mcp-server" -- --stdio

# Connexió a un servidor local
ibm-test-client ./server.js -- --stdio
ibm-test-client ./server.py -- --stdio
```

### Com a llibreria

```javascript
import {TestMcpClient} from 'ibm-test-mcp-client';

const client = new TestMcpClient();

// Connexió a un servidor
await client.connect({
    kind: "script",
    interpreter: "node",
    path: "./my-mcp-server.js",
    args: ["--stdio"]
});

// Llistar eines disponibles
await client.listTools();

// Desconnectar
await client.disconnect();
```

## Comandes disponibles

- `list` - Llista totes les eines disponibles
- `describe <toolName>` - Mostra informació detallada d'una eina
- `call <toolName> '<jsonArgs>'` - Executa una eina amb arguments JSON
- `setLoggingLevel <level>` - Configura el nivell de logging
- `help` - Mostra aquesta ajuda
- `exit` o `quit` - Tanca el client

## Desenvolupament

```bash
# Clonar el repositori
git clone <repository-url>
cd ibm-test-client

# Instal·lar dependències
npm install

# Compilar
npm run build

# Executar localment
npm start
```

## API

### TestMcpClient

La classe principal per a interactuar amb servidors MCP.

#### Mètodes principals

- `connect(target: ServerTarget)`: Conecta al servidor MCP
- `disconnect()`: Desconnecta del servidor
- `listTools()`: Llista totes les eines disponibles
- `describeTool(name: string)`: Mostra informació d'una eina específica
- `callTool(name: string, args: unknown)`: Executa una eina amb arguments
- `setLoggingLevel(level: string)`: Configura el nivell de logging

#### Tipus exportats

- `ServerTarget`: Tipus per definir el servidor objectiu
- `Client`: Classe base del SDK MCP
- `StdioClientTransport`: Transport per comunicació via stdio

## Publicació

```bash
# Publicar a npm
npm run publish-package

# O utilitzar el script de shell
./scripts/publish.sh
```

## Llicència

ISC

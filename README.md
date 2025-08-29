# IBM Test Client

Un client REPL per a interactuar amb servidors MCP (Model Context Protocol).

## Instal·lació

```bash
npm install -g ibm-test-client
```

## Ús

```bash
# Connexió a un servidor MCP via npx
ibm-test-client "npx:@scope/mcp-server@0.3.1#mcp-server" -- --stdio

# Connexió a un servidor local
ibm-test-client ./server.js -- --stdio
ibm-test-client ./server.py -- --stdio
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

## Publicació

```bash
# Publicar a npm
npm run publish-package

# O utilitzar el script de shell
./scripts/publish.sh
```

## Llicència

ISC

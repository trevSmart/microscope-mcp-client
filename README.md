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

## Testing

### Testing utilitzant els scripts NPM

```bash
# Mode CLI interactiu (log level: info)
npm run test:cli

# Mode one-shot (log level: debug)
npm run test:1shot

Els scripts de test utilitzen les variables d'entorn `TEST_MCP_SERVER` i `TEST_ONESHOT_ARG` per a la configuració. El nivell de logging es configura automàticament via l'argument `--log-level`.

#### Mode automàtic (`npm run test:automated`)

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

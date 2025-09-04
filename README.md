# IBM Test MCP Client

Un client REPL per a interactuar amb servidors MCP (Model Context Protocol). També es pot utilitzar com a llibreria per a scripts de test.

## Ús

### Com a comanda CLI (mode interactiu)

```bash
# Mostrar ajuda
ibm-test-mcp-client --help

# Connexió a un servidor MCP via npx
ibm-test-mcp-client --server "npx:@scope/mcp-server@0.3.1#mcp-server"

# Connexió a un servidor local
ibm-test-mcp-client --server ./server.js
ibm-test-mcp-client --server ./server.py
```

# Exemple d'ús dins del REPL
> list
> describe <toolName>
> call <toolName> '<jsonArgs>'
> setLoggingLevel <level> # debug, info, warning, error
> exit
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

### Mode one-shot (execució única d'eina)

Per executar una sola eina i sortir immediatament:

```bash
# Execució única d'una eina
ibm-test-mcp-client --server ./server.js --call-tool "<toolName> {\"toolParam1\":\"toolParamValue1\", \"toolParam2\":\"toolParamValue2\"}"
```

**Característiques del mode one-shot**:
- Només mostra la resposta JSON de l'eina (tots els altres logs es suprimeixen)
- En cas d'error de parsing o fallada de l'eina, escriu un missatge d'error curt a stderr i surt amb codi no-zero
- L'argument `--call-tool` espera una cadena entre cometes que conté el nom de l'eina seguit d'un objecte JSON amb els paràmetres
- Si `--call-tool` està present, s'executa de forma no-interactiva i surt immediatament

---

## Llicència

ISC

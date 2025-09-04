# IBM Test MCP Client

Un client REPL per a interactuar amb servidors MCP (Model Context Protocol). També es pot utilitzar com a llibreria per a scripts de test.

## Handshake d'Inicialització MCP

Aquest client implementa el handshake d'inicialització segons l'[especificació MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization).

### Fases del Handshake

1. **Negociació de versió del protocol**: El client envia la versió que suporta i el servidor respon amb la versió acordada
2. **Intercanvi de capacitats**: El client i servidor intercanvien les seves capacitats
3. **Informació d'implementació**: Es comparteix informació sobre les implementacions

### Capacitats del Client

El client suporta les següents capacitats:

- **roots**: Suport per a llistes de roots amb notificacions de canvis
- **sampling**: Suport per a requests de sampling de l'LLM
- **elicitation**: Suport per a requests d'elicitation del servidor
- **logging**: Suport per a logging estructurat

### Logging del Handshake

Quan s'executa en mode verbose (no quiet), el client mostra informació detallada del handshake:

```
🔄 Iniciant handshake MCP...
📋 Client info: IBM Salesforce MCP Test Client v0.0.40
🔧 Client capabilities: {
  "roots": {"listChanged": true},
  "sampling": {},
  "elicitation": {},
  "logging": {}
}
✅ Handshake completat amb èxit
📡 Server capabilities: {...}
```

## Ús

### Com a comanda CLI (mode interactiu)

```bash
# Connexió a un servidor MCP via npx
ibm-test-mcp-client "npx:@scope/mcp-server@0.3.1#mcp-server" --cli

# Connexió a un servidor local
ibm-test-mcp-client ./server.js --cli
ibm-test-mcp-client ./server.py --cli

# Exemple d'ús dins del REPL
> list
> describe <toolName>
> call <toolName> '<jsonArgs>'
> setLoggingLevel <level> # debug, info, warning, error
> exit
```

**Introducció ràpida**: Quan s'inicia el mode interactiu, es mostra una línia de comandes disponibles per orientar l'usuari immediatament:
```
list | describe <tool> | call <tool> '<json>' | setLoggingLevel <level> | resources | resource <uri> | help | exit
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


#### Autocompleció dins del REPL

- Comandes: prem `Tab` per completar comandes (`list`, `describe`, `call`, `setLoggingLevel`, `resources`, `resource`, `help`, `exit`, `quit`).
- Noms d'eina: per a `describe` i `call`, prem `Tab` per completar el nom de l'eina disponible al servidor MCP.
- Exemple: escriu `des` + `Tab` -> `describe`; escriu `describe ec` + `Tab` -> completa el nom de l'eina que comenci per `ec`.

---

### Mode one-off (execució única d'eina)

Per executar una sola eina i sortir immediatament:

```bash
# Execució única d'una eina
ibm-test-mcp-client ./server.js --run-tool "echo {\"text\":\"hello\"}"
ibm-test-mcp-client "npx:@scope/mcp-server@0.3.1#mcp-server" --run-tool "toolName {\"k\":\"v\"}"
```

**Característiques del mode one-off**:
- Només mostra la resposta JSON de l'eina (tots els altres logs es suprimeixen)
- En cas d'error de parsing o fallada de l'eina, escriu un missatge d'error curt a stderr i surt amb codi no-zero
- L'argument `--run-tool` espera una cadena entre cometes que conté el nom de l'eina seguit d'un objecte JSON
- Si tant `--cli` com `--run-tool` estan presents, `--run-tool` té precedència i s'executa de forma no-interactiva

---

## Llicència

ISC

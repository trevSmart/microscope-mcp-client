# Configuració de GitHub Packages

Aquest document descriu els canvis realitzats per configurar el projecte per utilitzar GitHub Packages.

## Canvis realitzats

### 1. Package.json

- **Nom del paquet**: Canviat de `microscope-mcp-client` a `@trevsmart/microscope-mcp-client`
- **PublishConfig**: Afegit `"registry": "https://npm.pkg.github.com"`
- **Bin**: Simplificat de `microscope-mcp-client` a `microscope`
- **Scripts**: Afegit `publish-github-packages` per publicació manual

### 2. Workflow de GitHub Actions

- **Fitxer**: `.github/workflows/npm-publish.yml`
- **Canvis**:
  - Job `publish-npm` → `publish-github-packages`
  - Registry URL: `https://npm.pkg.github.com/`
  - Scope: `@trevsmart`
  - Permissions: Afegit `packages: write`
  - Token: Utilitza `GITHUB_TOKEN` en lloc de `npm_token`

### 3. Scripts de publicació

- **Nou fitxer**: `scripts/publish-github-packages.sh`
- **Funcionalitats**:
  - Configuració automàtica de npm per GitHub Packages
  - Creació de fitxer `.npmrc` amb token
  - Increment automàtic de versió
  - Publicació a GitHub Packages

### 4. Documentació

- **README.md**: Afegida secció d'instal·lació des de GitHub Packages
- **Secció de publicació**: Instruccions per publicar a GitHub Packages i npm
- **Fitxer d'exemple**: `.npmrc.example` amb configuració de GitHub Packages

## Com utilitzar

### Instal·lació des de GitHub Packages

```bash
# Configurar npm per GitHub Packages
npm config set @trevsmart:registry https://npm.pkg.github.com

# Instal·lar el paquet
npm install @trevsmart/microscope-mcp-client

# Utilitzar el CLI
npx @trevsmart/microscope-mcp-client --server "npx:@modelcontextprotocol/server-everything"
```

### Publicació manual

```bash
# Configurar token de GitHub
export GITHUB_TOKEN=your_github_token_here

# Publicar a GitHub Packages
npm run publish-github-packages
```

### Publicació automàtica

La publicació automàtica es realitza quan es crea un release a GitHub. El workflow:
1. Executa els tests
2. Actualitza la versió del paquet
3. Publica a GitHub Packages

## Configuració necessària

### Per desenvolupadors

1. **Token de GitHub**: Necessari per publicar paquets
   - Anar a GitHub Settings → Developer settings → Personal access tokens
   - Crear token amb permisos `write:packages` i `read:packages`

2. **Configuració local**:
   ```bash
   # Configurar npm per GitHub Packages
   npm config set @trevsmart:registry https://npm.pkg.github.com

   # Crear fitxer .npmrc amb el token
   echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" > .npmrc
   ```

### Per usuaris

1. **Configuració de npm**:
   ```bash
   npm config set @trevsmart:registry https://npm.pkg.github.com
   ```

2. **Instal·lació**:
   ```bash
   npm install @trevsmart/microscope-mcp-client
   ```

## Avantatges de GitHub Packages

- **Integració**: Publicació automàtica amb releases de GitHub
- **Seguretat**: Control d'accés granular per paquets
- **Gratuït**: Per repositoris públics
- **Versionat**: Integrat amb el sistema de versions de GitHub

## Compatibilitat

El projecte manté compatibilitat amb npm tradicional:
- Scripts de publicació per npm (`publish-package`)
- Documentació per instal·lació des de npm
- Workflow existent per npm (si es necessita)

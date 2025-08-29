# Guia de Publicació

Aquest document explica com publicar el paquet `ibm-test-client` a npm.

## Prerequisits

1. **Compte de npm**: Necessites tenir un compte a [npmjs.com](https://www.npmjs.com)
2. **Autenticació**: Executa `npm login` per autenticar-te
3. **Permisos**: Assegura't que tens permisos per publicar al paquet

## Passos per publicar

### Opció 1: Script npm (recomanat per a usuaris avançats)

```bash
npm run publish-package
```

Aquest script:
- Compila el projecte TypeScript
- Configura els permisos d'execució
- Publica el paquet a npm

### Opció 2: Script de shell (recomanat per a usuaris nous)

```bash
./scripts/publish.sh
```

Aquest script:
- Verifica prerequisits
- Neteja el directori build
- Compila el projecte
- Verifica que tot està correcte
- Demana confirmació
- Publica el paquet

### Opció 3: Comandes manuals

```bash
# 1. Compilar
npm run build

# 2. Verificar que el fitxer és executable
ls -la build/index.js

# 3. Verificar que té el shebang
head -n1 build/index.js

# 4. Publicar
npm publish
```

## Verificació prèvia

Abans de publicar, pots verificar què s'inclourà al paquet:

```bash
# Mostra quins fitxers s'inclouran
npm pack --dry-run

# Crea un paquet local per verificar
npm pack
```

## Estructura del paquet publicat

El paquet publicat inclourà:

```
ibm-test-client-1.0.0.tgz
├── package.json
├── README.md
└── build/
    └── index.js (executable)
```

## Actualitzar la versió

Abans de publicar una nova versió:

1. Actualitza la versió al `package.json`:
   ```bash
   npm version patch  # 1.0.0 → 1.0.1
   npm version minor  # 1.0.0 → 1.1.0
   npm version major  # 1.0.0 → 2.0.0
   ```

2. Fes commit dels canvis:
   ```bash
   git add package.json
   git commit -m "Bump version to $(node -p "require('./package.json').version")"
   git tag v$(node -p "require('./package.json').version")
   ```

3. Publica:
   ```bash
   npm run publish-package
   ```

## Solució de problemes

### Error: "You must be logged in to publish packages"

```bash
npm login
```

### Error: "Package name already exists"

El nom del paquet ja està pres. Considera:
- Canviar el nom al `package.json`
- Afegir un scope: `@tu-usuari/ibm-test-client`

### Error: "Permission denied"

```bash
chmod +x build/index.js
```

### Error: "Invalid package name"

El nom del paquet ha de complir les regles de npm:
- Només lletres minúscules, números i guions
- No pot començar amb un guió
- No pot contenir espais ni caràcters especials

## Després de la publicació

1. **Verifica**: Visita la pàgina del paquet a npmjs.com
2. **Testeja**: Instal·la el paquet globalment per verificar que funciona:
   ```bash
   npm install -g ibm-test-client
   ibm-test-client --help
   ```
3. **Documenta**: Actualitza la documentació si cal

## Rollback

Si necessites desfer una publicació:

```bash
npm unpublish ibm-test-client@1.0.0
```

**Nota**: Només pots desfer publicacions en les primeres 72 hores.

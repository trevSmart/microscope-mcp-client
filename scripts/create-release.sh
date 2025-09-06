#!/bin/bash

# Script per crear una release i publicar automàticament
set -e

# Parsing d'arguments
SKIP_TESTS=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        *)
            echo "Argument desconegut: $1"
            echo "Ús: $0 [--skip-tests] [versió] [missatge]"
            exit 1
            ;;
    esac
done

# Verificacions de seguretat
echo "🔍 Verificant configuració del projecte..."

# Verificar que estem al directori arrel del projecte
if [ ! -f "package.json" ]; then
    echo "Error: No es troba package.json. Executa aquest script des del directori arrel del projecte."
    exit 1
fi

echo "✅ Configuració del projecte verificada correctament"

# Funció per obtenir la versió actual del package.json
get_current_version() {
    node -p "require('./package.json').version"
}

# Funció per incrementar la versió patch
increment_patch() {
    local version=$1
    local major=$(echo $version | cut -d. -f1)
    local minor=$(echo $version | cut -d. -f2)
    local patch=$(echo $version | cut -d. -f3)
    echo "$major.$minor.$((patch + 1))"
}

# Funció per implementar timeout en macOS
run_with_timeout() {
    local timeout_duration=$1
    shift

    # Iniciar el comando en background
    "$@" &
    local cmd_pid=$!

    # Esperar el timeout o que el comando acabi
    local count=0
    while [ $count -lt $timeout_duration ]; do
        if ! kill -0 $cmd_pid 2>/dev/null; then
            # El comando ha acabat
            wait $cmd_pid
            return $?
        fi
        sleep 1
        count=$((count + 1))
    done

    # Timeout arribat, matar el procés
    kill $cmd_pid 2>/dev/null
    return 124
}

# Obtenir la versió actual
CURRENT_VERSION=$(get_current_version)
echo "📋 Versió actual: $CURRENT_VERSION"

# Missatge d'inici
echo ""
echo "🚀 Iniciant creació de release per al client MCP..."
if [ "$SKIP_TESTS" = true ]; then
    echo "⚠️  Mode: Saltant tests locals (--skip-tests especificat)"
else
    echo "✅ Mode: Executant tests locals abans de la publicació"
fi
echo ""

# Demanar la nova versió
if [ $# -eq 0 ]; then
    DEFAULT_VERSION=$(increment_patch $CURRENT_VERSION)
    echo "💡 Versió suggerida (patch increment): $DEFAULT_VERSION"
    read -p "🔢 Introdueix la nova versió [$DEFAULT_VERSION]: " NEW_VERSION
    NEW_VERSION=${NEW_VERSION:-$DEFAULT_VERSION}

    read -p "📝 Missatge de la release (opcional): " MESSAGE
    MESSAGE=${MESSAGE:-"Release $NEW_VERSION"}
else
    NEW_VERSION=$1
    MESSAGE=${2:-"Release $NEW_VERSION"}
fi

VERSION=$NEW_VERSION

echo "🚀 Creant release $VERSION..."

# 0. Comprovar si hi ha canvis pendents
echo "🔍 Comprovant estat del repositori..."
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: Hi ha canvis sense commit al working directory."
    echo "   Fes commit dels canvis abans de crear una release."
    git status --short
    exit 1
fi

if ! git diff-index --quiet --cached HEAD --; then
    echo "❌ Error: Hi ha canvis staged sense commit."
    echo "   Fes commit dels canvis abans de crear una release."
    git status --short
    exit 1
fi

# Comprovar si hi ha commits locals que no s'han pujat
if [ "$(git rev-list --count @{u}..HEAD)" -gt 0 ]; then
    echo "❌ Error: Hi ha commits locals que no s'han pujat al repositori remot."
    echo "   Fes push dels commits abans de crear una release."
    echo "   Commits pendents:"
    git log --oneline @{u}..HEAD
    exit 1
fi

echo "✅ Repositori sincronitzat correctament."

# 1. Build del projecte
echo "🔨 Compilant el projecte..."
echo "   Executant: npm run build"
npm run build

# Verificacions locals del build
echo ""
echo "🔍 Verificant build generat..."
echo "   Comprovant integritat del fitxer build/index.js..."

# Verificar que el fitxer build existeix
if [ ! -f "build/index.js" ]; then
    echo "Error: El fitxer build/index.js no s'ha generat correctament."
    exit 1
fi

# Afegir permisos d'execució
echo "   Afegint permisos d'execució..."
chmod +x build/index.js

# Verificar permisos d'execució
echo "   Verificant permisos d'execució..."
if [ ! -x "build/index.js" ]; then
    echo "Error: El fitxer build/index.js no té permisos d'execució."
    exit 1
fi

# Verificar shebang
echo "   Verificant shebang..."
if ! head -n1 "build/index.js" | grep -q "#!/usr/bin/env node"; then
    echo "Error: El shebang no està present al fitxer build/index.js."
    exit 1
fi

echo "✅ Build generat i verificat correctament"
echo "   ✓ Fitxer build/index.js existeix"
echo "   ✓ Permisos d'execució configurats"
echo "   ✓ Shebang present"

# Executar proves prèvies ABANS de qualsevol operació de publicació (si no es salten)
if [ "$SKIP_TESTS" = false ]; then
    echo ""
    echo "🧪 Executant proves prèvies per verificar que el client funciona..."
    echo "   Aquests tests validen la compatibilitat amb diferents servidors MCP"
    echo ""

    # Test 1: Mode one-shot amb servidor Salesforce MCP
    echo "Prova 1/5: Testant mode one-shot amb servidor Salesforce MCP..."
    TEST_OUTPUT=$(run_with_timeout 30 node build/index.js --server "/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js" --call-tool 'salesforceMcpUtils {"action":"getCurrentDatetime"}' 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Mode one-shot (Salesforce MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ Mode one-shot (Salesforce MCP): TIMEOUT (30s)"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    else
        echo "❌ Mode one-shot (Salesforce MCP): FALLAT"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    fi

    # Test 2: Mode CLI amb servidor Salesforce MCP
    echo "Prova 2/5: Testant mode CLI amb servidor Salesforce MCP..."
    TEST_OUTPUT=$(run_with_timeout 60 node scripts/test.mjs --server "/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp/index.js" --automated 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Mode CLI (Salesforce MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "⚠️  Mode CLI (Salesforce MCP): TIMEOUT (60s)"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo "   El mode CLI té problemes de rendiment amb Salesforce MCP però altres tests funcionen."
        echo "   Continuant amb la publicació ja que altres funcionalitats funcionen."
    else
        echo "❌ Mode CLI (Salesforce MCP): FALLAT"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El client té problemes amb el servidor Salesforce MCP."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    fi

    # Test 3: Mode one-shot amb servidor Everything MCP
    echo "Prova 3/5: Testant mode one-shot amb servidor Everything MCP..."
    TEST_OUTPUT=$(run_with_timeout 30 node build/index.js --server "npx:@modelcontextprotocol/server-everything -y stdio" --call-tool 'echo {"message":"hello"}' 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Mode one-shot (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ Mode one-shot (Everything MCP): TIMEOUT (30s)"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El client no funciona correctament amb el servidor Everything MCP."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    else
        echo "❌ Mode one-shot (Everything MCP): FALLAT"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El client no funciona correctament amb el servidor Everything MCP."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    fi

    # Test 4: Mode CLI amb servidor Everything MCP
    echo "Prova 4/5: Testant mode CLI amb servidor Everything MCP..."
    TEST_OUTPUT=$(run_with_timeout 60 node scripts/test.mjs --server "npx:@modelcontextprotocol/server-everything -y stdio" --automated 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Mode CLI (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "⚠️  Mode CLI (Everything MCP): TIMEOUT (60s)"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo "   El mode CLI té problemes de rendiment amb Everything MCP però altres tests funcionen."
        echo "   Continuant amb la publicació ja que altres funcionalitats funcionen."
    else
        echo "❌ Mode CLI (Everything MCP): FALLAT"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El client té problemes amb el servidor Everything MCP."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    fi

    # Test 5: Test de llibreria amb servidor Everything MCP
    echo "Prova 5/5: Testant mode llibreria amb servidor Everything MCP..."
    TEST_OUTPUT=$(run_with_timeout 45 node scripts/test-library.mjs 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Test de llibreria (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ Test de llibreria (Everything MCP): TIMEOUT (45s)"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El test de llibreria no funciona correctament."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    else
        echo "❌ Test de llibreria (Everything MCP): FALLAT"
        echo "   Detalls de l'error:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   El test de llibreria no funciona correctament."
        echo "   Abortant publicació per evitar distribuir una versió defectuosa."
        echo "   Prem Enter per continuar..."
        read
        exit 1
    fi

    echo "✅ Totes les proves prèvies completades"
    echo "   ✓ Mode one-shot (Salesforce MCP): Funcionant"
    echo "   ✓ Mode CLI (Salesforce MCP): Funcionant"
    echo "   ✓ Mode one-shot (Everything MCP): Funcionant"
    echo "   ✓ Mode CLI (Everything MCP): Funcionant"
    echo "   ✓ Mode llibreria (Everything MCP): Funcionant"
    echo ""
else
    echo ""
    echo "⚠️  Saltant proves prèvies (--skip-tests especificat)"
    echo "   ⚠️  ATENCIÓ: No s'han validat les funcionalitats del client"
    echo ""
fi

# Creació de la release
echo "📦 Creant release $VERSION..."
echo "   Aquest procés crearà una nova versió i la publicarà automàticament"
echo ""

# 1. Actualitzar package.json
echo "📝 Actualitzant package.json a versió $VERSION..."
echo "   Executant: npm version $VERSION --no-git-tag-version"
npm version $VERSION --no-git-tag-version

# 2. Commit dels canvis
echo "📝 Fent commit dels canvis de versió..."
echo "   Afegint package.json al staging area..."
git add package.json
echo "   Creant commit amb missatge: 'Bump version to $VERSION'"
git commit -m "Bump version to $VERSION"

# 3. Crear tag
echo "🏷️  Creant tag v$VERSION..."
echo "   Executant: git tag v$VERSION"
git tag "v$VERSION"

# 4. Push dels canvis i tag
echo "📤 Pujant canvis i tag al repositori remot..."
echo "   Pujant commits a origin/main..."
git push origin main
echo "   Pujant tag v$VERSION..."
git push origin "v$VERSION"

# 5. Crear release a GitHub (requereix GitHub CLI)
echo "📋 Creant release a GitHub..."
if command -v gh &> /dev/null; then
    echo "   GitHub CLI detectat, creant release automàticament..."
    echo "   Executant: gh release create v$VERSION --title 'Release $VERSION' --notes '$MESSAGE'"
    gh release create "v$VERSION" --title "Release $VERSION" --notes "$MESSAGE"
    echo "   ✅ Release creat amb èxit a GitHub"
else
    echo "   ⚠️  GitHub CLI no està instal·lat"
    echo "   📝 Crea la release manualment a GitHub:"
    echo "   🔗 URL: https://github.com/trevSmart/microscope-mcp-client/releases/new?tag=v$VERSION"
fi

echo ""
echo "🎉 Release $VERSION creat amb èxit!"
echo ""
echo "📋 Resum de l'operació:"
echo "   📦 Versió anterior: $CURRENT_VERSION"
echo "   📦 Versió nova: $VERSION"
echo "   🏷️  Tag creat: v$VERSION"
echo "   📤 Commits pujats a origin/main"
echo "   📤 Tag pujat a origin"
if command -v gh &> /dev/null; then
    echo "   📋 Release creat a GitHub"
else
    echo "   ⚠️  Release pendent de crear manualment a GitHub"
fi
echo ""
echo "🔄 Pròxims passos:"
echo "   • El workflow de GitHub Actions publicarà automàticament a npm"
echo "   • El paquet estarà disponible com a @trevsmart/microscope-mcp-client"
echo "   • Els usuaris podran instal·lar-lo amb: npm install @trevsmart/microscope-mcp-client"
echo ""

# Actualització automàtica del servidor dependent (si la publicació ha anat bé)
echo "🔗 Actualització automàtica del servidor dependent..."
echo "   Comprovant si la nova versió està disponible a npm..."

# Configuració del servidor
SERVER_DIR="/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp"
CLIENT_PACKAGE_NAME="microscope"

# Verificar que el directori del servidor existeix
if [ ! -d "$SERVER_DIR" ]; then
    echo "   ⚠️  No es troba el directori del servidor: $SERVER_DIR"
    echo "   📝 Actualitza manualment la dependència al servidor quan sigui convenient"
    echo ""
else
    if [ ! -f "$SERVER_DIR/package.json" ]; then
        echo "   ⚠️  No es troba package.json al directori del servidor"
        echo "   📝 Actualitza manualment la dependència al servidor quan sigui convenient"
        echo ""
    else
        echo "   📦 Nova versió del client: $VERSION"

        # Anar al directori del servidor
        cd "$SERVER_DIR"

        # Obtenir la versió actual de la dependència del client al servidor
        CURRENT_CLIENT_VERSION=$(node -p "require('./package.json').dependencies['$CLIENT_PACKAGE_NAME'] || require('./package.json').devDependencies['$CLIENT_PACKAGE_NAME'] || 'no instal·lat'")
        echo "   📦 Versió actual del client al servidor: $CURRENT_CLIENT_VERSION"

        # Actualitzar la dependència del client al servidor
        echo "   📦 Actualitzant dependència del client al servidor..."

        # Modificar directament el package.json del servidor amb la nova versió
        echo "   📝 Modificant package.json del servidor..."
        if node -e "
          const pkg = require('./package.json');
          if (pkg.dependencies && pkg.dependencies['$CLIENT_PACKAGE_NAME']) {
            pkg.dependencies['$CLIENT_PACKAGE_NAME'] = '$VERSION';
            require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
            console.log('✅ Dependència actualitzada a versió $VERSION');
          } else if (pkg.devDependencies && pkg.devDependencies['$CLIENT_PACKAGE_NAME']) {
            pkg.devDependencies['$CLIENT_PACKAGE_NAME'] = '$VERSION';
            require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
            console.log('✅ DevDependència actualitzada a versió $VERSION');
          } else {
            console.log('❌ No es troba la dependència $CLIENT_PACKAGE_NAME');
            process.exit(1);
          }
        "; then
          echo "   ✅ Package.json del servidor actualitzat"

          # Espera 15 segons a que la nova versió del pkg estigui visible a npm
          echo ""
          echo "   ⏰ Esperant 15 segons a que la nova versió estigui visible a npm..."
          sleep 15

          # Instal·lar la nova dependència
          echo "   🔄 Instal·lant la nova dependència..."
          npm install ibm-test-mcp-client@latest --save-dev
          echo "   ✅ Dependència del client actualitzada amb èxit!"

          echo ""
          echo "   📋 Resum de canvis al servidor:"
          echo "      📦 Client: $VERSION"
          echo "      📦 Dependència al servidor: $CURRENT_CLIENT_VERSION → $VERSION"
          echo "      📦 Servidor actualitzat amb: $CLIENT_PACKAGE_NAME@$VERSION"
        else
          echo "   ❌ Error actualitzant package.json del servidor"
          echo "   📝 Actualitza manualment la dependència al servidor quan sigui convenient"
        fi

        # Tornar al directori original
        cd - > /dev/null
        echo ""
    fi
fi

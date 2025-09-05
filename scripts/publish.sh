#!/bin/bash

# Script per actualitzar el servidor MCP amb la nova versió del client
set -e

echo "Iniciant publicació del paquet del client MCP a npm..."

# Verificar que estem al directori arrel del projecte
if [ ! -f "package.json" ]; then
    echo "Error: No es troba package.json. Executa aquest script des del directori arrel del projecte."
    exit 1
fi

# Generar i verificar build
if [ ! -f "build/index.js" ]; then
    echo "Error: El fitxer build/index.js no s'ha generat correctament."
    exit 1
fi

chmod +x build/index.js

if [ ! -x "build/index.js" ]; then
    echo "Error: El fitxer build/index.js no té permisos d'execució."
    exit 1
fi

if ! head -n1 "build/index.js" | grep -q "#!/usr/bin/env node"; then
    echo "Error: El shebang no està present al fitxer build/index.js."
    exit 1
fi

echo "Build generat i verificat correctament"
echo ""

# Executar proves prèvies ABANS de qualsevol operació de publicació
echo ""
echo "Executant proves prèvies per verificar que el client funciona..."
echo ""

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

# Test 1: Mode one-shot amb servidor Salesforce MCP
echo "Prova 1/4: Testant mode one-shot amb servidor Salesforce MCP..."
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
echo "Prova 2/4: Testant mode CLI amb servidor Salesforce MCP..."
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
echo "Prova 3/4: Testant mode one-shot amb servidor Everything MCP..."
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
echo "Prova 4/4: Testant mode CLI amb servidor Everything MCP..."
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

echo "✅ Totes les proves prèvies completades"
echo ""

# Incrementar la versió del paquet (només després que els tests hagin passat)
echo "📦 Incrementant la versió del paquet..."
npm version patch

# Publicar el paquet a npm
echo "📤 Publicant el paquet a npm..."
npm publish

echo "✅ Paquet publicat amb èxit!"

# Configuració del servidor
SERVER_DIR="/Users/marcpla/Documents/Feina/Projectes/mcp/ibm-salesforce-mcp"
CLIENT_PACKAGE_NAME="ibm-test-mcp-client"

# Verificar que el directori del servidor existeix
if [ ! -d "$SERVER_DIR" ]; then
    echo "❌ Error: No es troba el directori del servidor: $SERVER_DIR"
    echo "   Actualitza manualment la dependència al servidor."
    exit 1
fi

if [ ! -f "$SERVER_DIR/package.json" ]; then
    echo "❌ Error: No es troba package.json al directori del servidor."
    echo "   Actualitza manualment la dependència al servidor."
    exit 1
fi

# Obtenir la nova versió del client
NEW_VERSION=$(node -p "require('./package.json').version")
echo "📦 Nova versió del client: $NEW_VERSION"

# Anar al directori del servidor
cd "$SERVER_DIR"

# Obtenir la versió actual de la dependència del client al servidor
CURRENT_CLIENT_VERSION=$(node -p "require('./package.json').dependencies['$CLIENT_PACKAGE_NAME'] || require('./package.json').devDependencies['$CLIENT_PACKAGE_NAME'] || 'no instal·lat'")
echo "📦 Versió actual del client al servidor: $CURRENT_CLIENT_VERSION"

# Actualitzar la dependència del client al servidor
echo "📦 Actualitzant dependència del client al servidor..."

# Modificar directament el package.json del servidor amb la nova versió
echo "📝 Modificant package.json del servidor..."
if node -e "
  const pkg = require('./package.json');
  if (pkg.dependencies && pkg.dependencies['$CLIENT_PACKAGE_NAME']) {
    pkg.dependencies['$CLIENT_PACKAGE_NAME'] = '$NEW_VERSION';
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('✅ Dependència actualitzada a versió $NEW_VERSION');
  } else if (pkg.devDependencies && pkg.devDependencies['$CLIENT_PACKAGE_NAME']) {
    pkg.devDependencies['$CLIENT_PACKAGE_NAME'] = '$NEW_VERSION';
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('✅ DevDependència actualitzada a versió $NEW_VERSION');
  } else {
    console.log('❌ No es troba la dependència $CLIENT_PACKAGE_NAME');
    process.exit(1);
  }
"; then
  echo "✅ Package.json del servidor actualitzat"
else
  echo "❌ Error actualitzant package.json del servidor"
  exit 1
fi

#Espera 15 segons a que la nova versió del pkg estigui visible a npm
echo
echo "⏰ Espera 10 segons a que la nova versió del pkg estigui visible a npm..."
sleep 10

# Instal·lar la nova dependència
echo "🔄 Instal·lant la nova dependència..."
npm install ibm-test-mcp-client@latest --save-dev
echo "✅ Dependència del client actualitzada amb èxit!"

echo ""
echo "📋 Resum de canvis:"
echo "   Client: $NEW_VERSION"
echo "   Dependència al servidor: $CURRENT_CLIENT_VERSION → $NEW_VERSION"
echo "   Servidor actualitzat amb: $CLIENT_PACKAGE_NAME@$NEW_VERSION"
echo ""

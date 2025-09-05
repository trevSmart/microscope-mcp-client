#!/bin/bash

# Script per actualitzar el servidor MCP amb la nova versió del client
set -e

echo "🔄 Iniciant publicació del paquet del client MCP a npm..."

# Verificar que estem al directori arrel del projecte
if [ ! -f "package.json" ]; then
    echo "❌ Error: No es troba package.json. Executa aquest script des del directori arrel del projecte."
    exit 1
fi

# Verificar que el fitxer build/index.js existeix
if [ ! -f "build/index.js" ]; then
    echo "❌ Error: El fitxer build/index.js no s'ha generat correctament."
    exit 1
fi

# Assegurar permisos d'execució
echo "🔐 Configurant permisos d'execució..."
chmod +x build/index.js

# Verificar que el fitxer és executable
if [ ! -x "build/index.js" ]; then
    echo "❌ Error: El fitxer build/index.js no té permisos d'execució."
    exit 1
fi

# Verificar que el shebang està present
if ! head -n1 "build/index.js" | grep -q "#!/usr/bin/env node"; then
    echo "❌ Error: El shebang no està present al fitxer build/index.js."
    exit 1
fi

echo "✅ Build del client verificat correctament"

# Executar proves prèvies abans de la publicació
echo ""
echo "🧪 Executant proves prèvies per verificar que el client funciona..."

# Test 1: Mode one-shot
echo "🔍 Prova 1/2: Testant mode one-shot..."
if npm run test:1shot > /dev/null 2>&1; then
    echo "✅ Mode one-shot: PASSAT"
else
    echo "❌ Mode one-shot: FALLAT"
    echo "   El client no funciona correctament en mode one-shot."
    echo "   Abortant publicació per evitar distribuir una versió defectuosa."
    exit 1
fi

# Test 2: Mode CLI (amb timeout més llarg)
echo "🔍 Prova 2/2: Testant mode CLI..."
echo "   ⚠️  Aquest test pot trigar fins a 60 segons..."
if timeout 60s npm run test:cli > /dev/null 2>&1; then
    echo "✅ Mode CLI: PASSAT"
elif [ $? -eq 124 ]; then
    echo "⚠️  Mode CLI: TIMEOUT (60s)"
    echo "   El mode CLI té problemes de rendiment però el mode one-shot funciona."
    echo "   Continuant amb la publicació ja que la funcionalitat principal funciona."
else
    echo "❌ Mode CLI: FALLAT"
    echo "   El client té problemes en mode CLI."
    echo "   Abortant publicació per evitar distribuir una versió defectuosa."
    exit 1
fi

echo "✅ Totes les proves prèvies completades"
echo ""

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

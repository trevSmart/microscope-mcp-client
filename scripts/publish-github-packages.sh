#!/bin/bash

# Script per publicar el paquet a GitHub Packages
set -e

echo "Iniciant publicació del paquet del client MCP a GitHub Packages..."

# Verificar que estem al directori arrel del projecte
if [ ! -f "package.json" ]; then
    echo "Error: No es troba package.json. Executa aquest script des del directori arrel del projecte."
    exit 1
fi

# Verificar que tenim un token de GitHub configurat
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN no està configurat."
    echo "Configura el token amb: export GITHUB_TOKEN=your_token_here"
    echo "O crea un fitxer .npmrc amb el token:"
    echo "//npm.pkg.github.com/:_authToken=your_token_here"
    exit 1
fi

# Generar i verificar build
echo "🔨 Generant build..."
npm run build

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

echo "✅ Build generat i verificat correctament"

# Configurar npm per GitHub Packages
echo "🔧 Configurant npm per GitHub Packages..."
npm config set @trevsmart:registry https://npm.pkg.github.com

# Crear fitxer .npmrc si no existeix
if [ ! -f ".npmrc" ]; then
    echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" > .npmrc
    echo "✅ Fitxer .npmrc creat"
else
    echo "⚠️  Fitxer .npmrc ja existeix. Assegura't que conté el token correcte."
fi

# Incrementar la versió del paquet
echo "📦 Incrementant la versió del paquet..."
npm version patch

# Publicar el paquet a GitHub Packages
echo "📤 Publicant el paquet a GitHub Packages..."
npm publish

echo "✅ Paquet publicat amb èxit a GitHub Packages!"
echo ""
echo "📋 Per instal·lar el paquet:"
echo "   npm install @trevsmart/microscope-mcp-client"
echo ""
echo "📋 Per utilitzar el paquet:"
echo "   npx @trevsmart/microscope-mcp-client --server 'server_spec'"
echo ""

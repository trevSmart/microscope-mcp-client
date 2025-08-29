#!/bin/bash

# Script per publicar el paquet ibm-test-mcp-client a npm
set -e

echo "🚀 Iniciant procés de publicació..."

# Verificar que estem al directori arrel del projecte
if [ ! -f "package.json" ]; then
    echo "❌ Error: No es troba package.json. Executa aquest script des del directori arrel del projecte."
    exit 1
fi

# Verificar que npm està instal·lat
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm no està instal·lat o no està al PATH."
    exit 1
fi

# Verificar que estem autenticats a npm
if ! npm whoami &> /dev/null; then
    echo "❌ Error: No estàs autenticat a npm. Executa 'npm login' primer."
    exit 1
fi

# Netejar el directori build
echo "🧹 Netejant directori build..."
rm -rf build/

# Fer build del projecte
echo "🔨 Compilant TypeScript..."
npm run build

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

# Verificar l'estat del git (opcional)
if [ -d ".git" ]; then
    if [ -n "$(git status --porcelain)" ]; then
        echo "⚠️  Advertència: Hi ha canvis no commitats al repositori."
        echo "   Considera fer commit dels canvis abans de publicar."
        read -p "Vols continuar de totes maneres? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "❌ Publicació cancel·lada."
            exit 1
        fi
    fi
fi

# Mostrar informació del paquet
echo "📦 Informació del paquet:"
echo "   Nom: $(node -p "require('./package.json').name")"
echo "   Versió: $(node -p "require('./package.json').version")"
echo "   Descripció: $(node -p "require('./package.json').description")"

# Confirmar publicació
read -p "Vols publicar aquest paquet a npm? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Publicació cancel·lada."
    exit 1
fi

# Publicar a npm
echo "📤 Publicant a npm..."
npm publish

echo "✅ Paquet publicat amb èxit!"
echo "🔗 El paquet està disponible a: https://www.npmjs.com/package/$(node -p "require('./package.json').name")"
echo "💡 Per instal·lar-lo globalment: npm install -g $(node -p "require('./package.json').name")"

#!/bin/bash

# Script per crear una release i publicar automàticament
set -e

if [ $# -eq 0 ]; then
    echo "Ús: $0 <versió> [missatge]"
    echo "Exemple: $0 0.0.7 'Fix important bug'"
    exit 1
fi

VERSION=$1
MESSAGE=${2:-"Release $VERSION"}

echo "🚀 Creant release $VERSION..."

# 1. Actualitzar package.json
echo "📦 Actualitzant package.json a versió $VERSION..."
npm version $VERSION --no-git-tag-version

# 2. Commit dels canvis
echo "📝 Fent commit dels canvis..."
git add package.json
git commit -m "Bump version to $VERSION"

# 3. Crear tag
echo "🏷️  Creant tag v$VERSION..."
git tag "v$VERSION"

# 4. Push dels canvis i tag
echo "📤 Pujant canvis i tag..."
git push origin main
git push origin "v$VERSION"

# 5. Crear release a GitHub (requereix GitHub CLI)
if command -v gh &> /dev/null; then
    echo "📋 Creant release a GitHub..."
    gh release create "v$VERSION" --title "Release $VERSION" --notes "$MESSAGE"
else
    echo "⚠️  GitHub CLI no està instal·lat. Crea la release manualment a GitHub."
    echo "   URL: https://github.com/trevSmart/microscope-mcp-client/releases/new?tag=v$VERSION"
fi

echo "✅ Release $VERSION creat amb èxit!"
echo "   El workflow de GitHub Actions publicarà automàticament a npm."

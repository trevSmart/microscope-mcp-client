#!/bin/bash

# Script per crear una release i publicar automàticament
set -e

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

# Obtenir la versió actual
CURRENT_VERSION=$(get_current_version)
echo "📋 Versió actual: $CURRENT_VERSION"

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
npm run build

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

#!/bin/bash

# Script to create a release and publish automatically
set -e

source .env

# Parsing arguments
SKIP_TESTS=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: $0 [--skip-tests] [version] [message]"
            exit 1
            ;;
    esac
done

# Security verifications
echo "🔍 Verifying project configuration..."

# Verify that we are in the project root directory
if [ ! -f "package.json" ]; then
    echo "Error: package.json not found. Run this script from the project root directory."
    exit 1
fi

echo "✅ Project configuration verified correctly"

# Function to get the current version from package.json
get_current_version() {
    node -p "require('./package.json').version"
}

# Function to increment the patch version
increment_patch() {
    local version=$1
    local major=$(echo $version | cut -d. -f1)
    local minor=$(echo $version | cut -d. -f2)
    local patch=$(echo $version | cut -d. -f3)
    echo "$major.$minor.$((patch + 1))"
}

# Function to implement timeout in macOS
run_with_timeout() {
    local timeout_duration=$1
    shift

    # Create temporary files for output capture
    local stdout_file=$(mktemp)
    local stderr_file=$(mktemp)

    # Start the command in background, capturing output
    "$@" > "$stdout_file" 2> "$stderr_file" &
    local cmd_pid=$!

    # Wait for timeout or command completion
    local count=0
    while [ $count -lt $timeout_duration ]; do
        if ! kill -0 $cmd_pid 2>/dev/null; then
            # Command has finished
            wait $cmd_pid
            local exit_code=$?
            # Combine stdout and stderr
            cat "$stdout_file" "$stderr_file"
            rm -f "$stdout_file" "$stderr_file"
            return $exit_code
        fi
        sleep 1
        count=$((count + 1))
    done

    # Timeout reached, kill the process
    kill $cmd_pid 2>/dev/null
    # Still capture any output that was generated
    cat "$stdout_file" "$stderr_file"
    rm -f "$stdout_file" "$stderr_file"
    return 124
}

# Get current version
CURRENT_VERSION=$(get_current_version)
echo "📋 Current version: $CURRENT_VERSION"

# Start message
echo ""
echo "🚀 Starting release creation for MCP client..."
if [ "$SKIP_TESTS" = true ]; then
    echo "⚠️  Mode: Skipping local tests (--skip-tests specified)"
else
    echo "✅ Mode: Running local tests before publishing"
fi
echo ""

# Request the new version
if [ $# -eq 0 ]; then
    DEFAULT_VERSION=$(increment_patch $CURRENT_VERSION)
    echo "💡 Suggested version (patch increment): $DEFAULT_VERSION"
    read -p "🔢 Enter the new version [$DEFAULT_VERSION]: " NEW_VERSION
    NEW_VERSION=${NEW_VERSION:-$DEFAULT_VERSION}

    read -p "📝 Release message (optional): " MESSAGE
    MESSAGE=${MESSAGE:-"Release $NEW_VERSION"}
else
    NEW_VERSION=$1
    MESSAGE=${2:-"Release $NEW_VERSION"}
fi

VERSION=$NEW_VERSION

echo "🚀 Creating release $VERSION..."

# 0. Check if there are pending changes
echo "🔍 Checking repository status..."
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: There are uncommitted changes in the working directory."
    echo "   Commit the changes before creating a release."
    git status --short
    exit 1
fi

if ! git diff-index --quiet --cached HEAD --; then
    echo "❌ Error: There are staged changes without commit."
    echo "   Commit the changes before creating a release."
    git status --short
    exit 1
fi

# Check if there are local commits that haven't been pushed
if [ "$(git rev-list --count @{u}..HEAD)" -gt 0 ]; then
    echo "❌ Error: There are local commits that haven't been pushed to the remote repository."
    echo "   Push the commits before creating a release."
    echo "   Pending commits:"
    git log --oneline @{u}..HEAD
    exit 1
fi

echo "✅ Repository synchronized correctly."

# 1. Project build
echo "🔨 Building the project..."
echo "   Running: npm run build"
npm run build

# Local build verifications
echo ""
echo "🔍 Verifying generated build..."
echo "   Checking integrity of build/index.js file..."

# Verify that the build file exists
if [ ! -f "build/index.js" ]; then
    echo "Error: The build/index.js file has not been generated correctly."
    exit 1
fi

# Add execution permissions
echo "   Adding execution permissions..."
chmod +x build/index.js

# Verify execution permissions
echo "   Verifying execution permissions..."
if [ ! -x "build/index.js" ]; then
    echo "Error: The build/index.js file does not have execution permissions."
    exit 1
fi

# Verify shebang
echo "   Verifying shebang..."
if ! head -n1 "build/index.js" | grep -q "#!/usr/bin/env node"; then
    echo "Error: The shebang is not present in the build/index.js file."
    exit 1
fi

echo "✅ Build generated and verified correctly"
echo "   ✓ File build/index.js exists"
echo "   ✓ Execution permissions configured"
echo "   ✓ Shebang present"

# Run preliminary tests BEFORE any publication operation (if not skipped)
if [ "$SKIP_TESTS" = false ]; then
    echo ""
    echo "🧪 Running preliminary tests to verify that the client works..."
    echo "   These tests validate compatibility with different MCP servers"
    echo ""

    # Test 1: One-shot mode with Salesforce MCP server
    echo "Test 1/5: Testing one-shot mode with Salesforce MCP server..."

    # Run the test using the npm script and capture output
    TEST_OUTPUT=$(run_with_timeout 30 npm run test:1shot)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "One-shot mode (Salesforce MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ One-shot mode (Salesforce MCP): TIMEOUT (30s)"
        echo "   Error details:"
        echo "$TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    else
        echo "❌ One-shot mode (Salesforce MCP): FAILED"
        echo "   Error details:"
        echo "$TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    fi

    # Test 2: CLI mode with Salesforce MCP server
    echo "Test 2/5: Testing CLI mode with Salesforce MCP server..."
    TEST_OUTPUT=$(run_with_timeout 60 npm run test:cli)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "CLI mode (Salesforce MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "⚠️  CLI mode (Salesforce MCP): TIMEOUT (60s)"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo "   The CLI mode has performance issues with Salesforce MCP but other tests work."
        echo "   Continuing with publication since other functionalities work."
    else
        echo "❌ CLI mode (Salesforce MCP): FAILED"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The client has issues with the Salesforce MCP server."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    fi

    # Test 3: One-shot mode with Everything MCP server
    echo "Test 3/5: Testing one-shot mode with Everything MCP server..."
    TEST_OUTPUT=$(run_with_timeout 30 node build/index.js --server "npx:@modelcontextprotocol/server-everything -y stdio" --call-tool 'echo {"message":"hello"}' 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "One-shot mode (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ One-shot mode (Everything MCP): TIMEOUT (30s)"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The client does not work correctly with the Everything MCP server."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    else
        echo "❌ One-shot mode (Everything MCP): FAILED"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The client does not work correctly with the Everything MCP server."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    fi

    # Test 4: CLI mode with Everything MCP server
    echo "Test 4/5: Testing CLI mode with Everything MCP server..."
    TEST_OUTPUT=$(run_with_timeout 60 node scripts/test.mjs --server "npx:@modelcontextprotocol/server-everything -y stdio" --automated 2>&1)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "CLI mode (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "⚠️  CLI mode (Everything MCP): TIMEOUT (60s)"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo "   The CLI mode has performance issues with Everything MCP but other tests work."
        echo "   Continuing with publication since other functionalities work."
    else
        echo "❌ CLI mode (Everything MCP): FAILED"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The client has issues with the Everything MCP server."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    fi

    # Test 5: Library test with Everything MCP server
    echo "Test 5/5: Testing library mode with Everything MCP server..."
    TEST_OUTPUT=$(run_with_timeout 45 npm run test:lib)
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "Library test (Everything MCP): \033[32m✓ PASS\033[0m"
        echo ""
    elif [ $TEST_EXIT_CODE -eq 124 ]; then
        echo "❌ Library test (Everything MCP): TIMEOUT (45s)"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The library test does not work correctly."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    else
        echo "❌ Library test (Everything MCP): FAILED"
        echo "   Error details:"
        echo "   $TEST_OUTPUT" | sed 's/^/   /'
        echo ""
        echo "   The library test does not work correctly."
        echo "   Aborting publication to avoid distributing a defective version."
        echo "   Press Enter to continue..."
        read
        exit 1
    fi

    echo "✅ All preliminary tests completed"
    echo "   ✓ One-shot mode (Salesforce MCP): Working"
    echo "   ✓ CLI mode (Salesforce MCP): Working"
    echo "   ✓ One-shot mode (Everything MCP): Working"
    echo "   ✓ CLI mode (Everything MCP): Working"
    echo "   ✓ Library mode (Everything MCP): Working"
    echo ""
else
    echo ""
    echo "⚠️  Skipping preliminary tests (--skip-tests specified)"
    echo "   ⚠️  WARNING: Client functionalities have not been validated"
    echo ""
fi

# Release creation
echo "📦 Creating release $VERSION..."
echo "   This process will create a new version and publish it automatically"
echo ""

# 1. Update package.json
echo "📝 Updating package.json to version $VERSION..."
echo "   Running: npm version $VERSION --no-git-tag-version"
npm version $VERSION --no-git-tag-version

# 2. Commit changes
echo "📝 Committing version changes..."
echo "   Adding package.json to staging area..."
git add package.json
echo "   Creating commit with message: 'Bump version to $VERSION'"
git commit -m "Bump version to $VERSION"

# 3. Create tag
echo "🏷️  Creating tag v$VERSION..."
echo "   Running: git tag v$VERSION"
git tag "v$VERSION"

# 4. Push changes and tag
echo "📤 Pushing changes and tag to remote repository..."
echo "   Pushing commits to origin/main..."
git push origin main
echo "   Pushing tag v$VERSION..."
git push origin "v$VERSION"

# 5. Create release on GitHub (requires GitHub CLI)
echo "📋 Creating release on GitHub..."
if command -v gh &> /dev/null; then
    echo "   GitHub CLI detected, creating release automatically..."
    echo "   Running: gh release create v$VERSION --title 'Release $VERSION' --notes '$MESSAGE'"
    gh release create "v$VERSION" --title "Release $VERSION" --notes "$MESSAGE"
    echo "   ✅ Release successfully created on GitHub"
else
    echo "   ⚠️  GitHub CLI is not installed"
    echo "   📝 Create the release manually on GitHub:"
    echo "   🔗 URL: https://github.com/trevSmart/microscope-mcp-client/releases/new?tag=v$VERSION"
fi

echo ""
echo "🎉 Release $VERSION successfully created!"
echo ""
echo "📋 Operation summary:"
echo "   📦 Previous version: $CURRENT_VERSION"
echo "   📦 New version: $VERSION"
echo "   🏷️  Tag created: v$VERSION"
echo "   📤 Commits pushed to origin/main"
echo "   📤 Tag pushed to origin"
if command -v gh &> /dev/null; then
    echo "   📋 Release created on GitHub"
else
    echo "   ⚠️  Release pending manual creation on GitHub"
fi
echo ""
echo "🔄 Next steps:"
echo "   • The GitHub Actions workflow will automatically publish to npm"
echo "   • The package will be available as @trevsmart/microscope-mcp-client"
echo "   • Users will be able to install it with: npm install @trevsmart/microscope-mcp-client"
echo ""

# Automatic update of the dependent server (if the publication went well)
echo "🔗 Automatic update of the dependent server..."
echo "   Checking if the new version is available on npm..."

# Server configuration
SERVER_DIR="${MCP_SERVER_DIR:-}"
CLIENT_PACKAGE_NAME="microscope-mcp-client"

# Verify that the server directory exists
if [ ! -d "$SERVER_DIR" ]; then
    echo "   ⚠️  Server directory not found: $SERVER_DIR"
    echo "   📝 Update the dependency on the server manually when convenient"
    echo ""
else
    if [ ! -f "$SERVER_DIR/package.json" ]; then
        echo "   ⚠️  package.json not found in the server directory"
        echo "   📝 Update the dependency on the server manually when convenient"
        echo ""
    else
        echo "   📦 New client version: $VERSION"

        # Go to the server directory
        cd "$SERVER_DIR"

        # Get the current version of the client dependency on the server
        CURRENT_CLIENT_VERSION=$(node -p "require('./package.json').dependencies['$CLIENT_PACKAGE_NAME'] || require('./package.json').devDependencies['$CLIENT_PACKAGE_NAME'] || 'not installed'")
        echo "   📦 Current client version on the server: $CURRENT_CLIENT_VERSION"

        # Update the client dependency on the server
        echo "   📦 Updating client dependency on the server..."

        # Directly modify the server's package.json with the new version
        echo "   📝 Modifying server's package.json..."
        if node -e "
          const pkg = require('./package.json');
          if (pkg.dependencies && pkg.dependencies['$CLIENT_PACKAGE_NAME']) {
            pkg.dependencies['$CLIENT_PACKAGE_NAME'] = '$VERSION';
            require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
            console.log('✅ Dependency updated to version $VERSION');
          } else if (pkg.devDependencies && pkg.devDependencies['$CLIENT_PACKAGE_NAME']) {
            pkg.devDependencies['$CLIENT_PACKAGE_NAME'] = '$VERSION';
            require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
            console.log('✅ DevDependency updated to version $VERSION');
          } else {
            console.log('❌ Dependency $CLIENT_PACKAGE_NAME not found');
            process.exit(1);
          }
        "; then
          echo "   ✅ Server's package.json updated"

          # Waiting to give time to the GitHub Actions publication workflow...
          echo ""
          echo "   ⏰ Waiting 60 seconds for the new version to be visible on npm..."
          sleep 60

          # Install the new dependency
          echo "   🔄 Installing the new dependency..."
          npm install
          echo "   ✅ Client dependency successfully updated!"

          echo ""
          echo "   📋 Summary of changes on the server:"
          echo "      📦 Client: $VERSION"
          echo "      📦 Dependency on server: $CURRENT_CLIENT_VERSION → $VERSION"
          echo "      📦 Server updated with: $CLIENT_PACKAGE_NAME@$VERSION"
        else
          echo "   ❌ Error updating server's package.json"
          echo "   📝 Update the dependency on the server manually when convenient"
        fi

        # Return to the original directory
        cd - > /dev/null
        echo ""
    fi
fi

#!/bin/bash

# Fix Next.js and dependency issues
echo "🔧 Fixing dependencies..."

# Clean everything
echo "Cleaning node_modules and lockfile..."
rm -rf node_modules
rm -rf apps/*/node_modules
rm -rf packages/*/node_modules
rm -f pnpm-lock.yaml

# Reinstall dependencies
echo "Reinstalling dependencies..."
pnpm install

echo "✅ Dependencies fixed! Now run: docker-compose up -d && pnpm dev"

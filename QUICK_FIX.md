# Quick Fix Guide

## Issue 1: Docker Daemon Not Running

**Error**: `Cannot connect to the Docker daemon`

**Solution**: 
1. Open Docker Desktop application
2. Wait until Docker is fully started (whale icon in menu bar should be steady)
3. Then run: `docker-compose up -d`

## Issue 2: Next.js Module Error

**Error**: `Cannot find module './modern-browserslist-target'`

**Solution**: This is a dependency mismatch issue. Run:

```bash
# Option 1: Use the fix script
chmod +x fix-dependencies.sh
./fix-dependencies.sh

# Option 2: Manual fix
rm -rf node_modules apps/*/node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
```

## Complete Startup Sequence

```bash
# 1. Make sure Docker Desktop is running
# (Check menu bar for Docker icon)

# 2. Start Docker containers
docker-compose up -d

# 3. Fix dependencies (if needed)
./fix-dependencies.sh

# 4. Start dev servers
pnpm dev
```

## What Was Fixed

1. ✅ Updated Next.js from `^14.0.4` to `^14.2.5` (matches installed version)
2. ✅ Updated React to `^18.3.1` (matches installed version)
3. ✅ Removed obsolete `version` field from docker-compose.yml
4. ✅ Created fix script for easy dependency cleanup

## If Issues Persist

If you still see errors after running the fix script:

```bash
# Nuclear option: Complete clean reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules pnpm-lock.yaml
pnpm store prune
pnpm install --force
```

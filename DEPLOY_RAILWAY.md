# Deploy to Railway - Step by Step Guide

This guide will help you deploy the Alzheimer's Analyst Workstation to Railway in about 30 minutes.

## Prerequisites

1. A [GitHub](https://github.com) account
2. A [Railway](https://railway.app) account (sign up with GitHub)

---

## Step 1: Push Code to GitHub

If you haven't already, push your code to GitHub:

```bash
cd /Users/marcus/Desktop/Medino/Alzheimer

# Initialize git (if needed)
git init

# Add all files
git add .

# Commit
git commit -m "Prepare for Railway deployment"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/Marcuselis/Analytics-.git
git branch -M main
git push -u origin main
```

---

## Step 2: Create Railway Project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Empty Project"**
3. Name your project (e.g., "alzheimer-analyst")

---

## Step 3: Add Database Services

### Add PostgreSQL
1. Click **"+ New"** in your project
2. Select **"Database"** → **"PostgreSQL"**
3. Wait for it to provision (30 seconds)

### Add Redis
1. Click **"+ New"** again
2. Select **"Database"** → **"Redis"**
3. Wait for it to provision

---

## Step 4: Deploy the API Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Go to **Settings**:
   - Set **Dockerfile Path**: `apps/api/Dockerfile`
   - Set **Watch Paths**: `apps/api/**`, `packages/shared/**`
4. Click on **Variables** tab and add (click "Add Reference" for database vars):
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   REDIS_URL = ${{Redis.REDIS_URL}}
   NODE_ENV = production
   PORT = 3001
   API_PORT = 3001
   ```
5. Click **"Deploy"**
6. Once deployed, go to **Settings** → **Networking** → **Generate Domain**
7. Copy the URL (e.g., `https://api-production-xxxx.up.railway.app`)
8. **IMPORTANT**: After deploying the Web service (Step 6), come back and add:
   ```
   CORS_ORIGINS = https://YOUR-WEB-URL.up.railway.app
   ```
   (Replace with your actual Web service URL)

---

## Step 5: Deploy the Workers Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select the SAME repository
3. In **Settings**:
   - Set **Dockerfile Path**: `apps/workers/Dockerfile`
   - Set **Watch Paths**: `apps/workers/**`, `packages/shared/**`
4. Click on **Variables** tab and add:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   REDIS_URL = ${{Redis.REDIS_URL}}
   NODE_ENV = production
   ```
5. Click **"Deploy"**

---

## Step 6: Deploy the Web Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select the SAME repository
3. In **Settings**:
   - Set **Dockerfile Path**: `apps/web/Dockerfile`
   - Set **Watch Paths**: `apps/web/**`, `packages/shared/**`
4. Click on **Variables** tab and add:
   ```
   NEXT_PUBLIC_API_URL = https://YOUR-API-URL.up.railway.app
   NODE_ENV = production
   PORT = 3000
   ```
   (Replace `YOUR-API-URL` with the API URL from Step 4)
5. **IMPORTANT**: Also add as **Build Argument**:
   - Go to **Settings** → **Build** → **Build Arguments**
   - Add: `NEXT_PUBLIC_API_URL = https://YOUR-API-URL.up.railway.app`
6. Click **"Deploy"**
7. Go to **Settings** → **Networking** → **Generate Domain**
8. This is your public URL! 🎉

---

## Step 7: Run Database Migrations

1. In Railway dashboard, click on the **API** service
2. Go to **Settings** → **"Connect"** (or use Railway CLI)
3. Open a shell and run:
   ```bash
   cd apps/api && node dist/db/migrate.js
   ```

Or use Railway CLI:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Run migration
railway run -s api "cd apps/api && node dist/db/migrate.js"
```

---

## Step 8: Initialize Market Data

After migrations, trigger a market refresh:

1. Open your **Web URL** in a browser
2. Go to **Market Scan**
3. Click **"Quick Refresh"** to load initial data

---

## Environment Variables Reference

### API Service
| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | PostgreSQL connection |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Redis connection |
| `NODE_ENV` | `production` | Environment |
| `PORT` | `3001` | Server port |
| `API_PORT` | `3001` | API port |
| `CORS_ORIGINS` | `https://YOUR-WEB.up.railway.app` | **REQUIRED**: Web app URL for CORS |

### Workers Service
| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | PostgreSQL connection |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Redis connection |
| `NODE_ENV` | `production` | Environment |

### Web Service
| Variable | Value | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://your-api.up.railway.app` | API URL |
| `NODE_ENV` | `production` | Environment |
| `PORT` | `3000` | Server port |

---

## Troubleshooting

### Build Fails
- Check the build logs in Railway dashboard
- Ensure all Dockerfiles are committed to git
- Verify `pnpm-lock.yaml` is committed

### API Connection Error
- Verify `NEXT_PUBLIC_API_URL` is set correctly on Web service
- Check API service is running and has a domain
- Ensure API CORS settings allow your web domain

### Database Connection Error
- Check `DATABASE_URL` is using Railway's variable reference: `${{Postgres.DATABASE_URL}}`
- Verify PostgreSQL service is running

### Redis Connection Error
- Check `REDIS_URL` is using Railway's variable reference: `${{Redis.REDIS_URL}}`
- Verify Redis service is running

---

## Estimated Costs

Railway provides $5 free credit per month. Typical usage:

| Service | Estimated Cost |
|---------|---------------|
| PostgreSQL | ~$2-5/month |
| Redis | ~$1-2/month |
| API | ~$2-5/month |
| Workers | ~$2-5/month |
| Web | ~$2-5/month |

**Total: $0 (free tier) to ~$15-20/month** depending on usage.

---

## Quick Links

- 🚂 [Railway Dashboard](https://railway.app/dashboard)
- 📚 [Railway Docs](https://docs.railway.app/)
- 💬 [Railway Discord](https://discord.gg/railway)

---

## Success! 🎉

Your app should now be live at:
- **Web**: `https://your-web-service.up.railway.app`
- **API**: `https://your-api-service.up.railway.app`

Share the Web URL with your CEO!

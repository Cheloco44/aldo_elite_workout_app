# Aldo Elite — Backend Setup Guide

## What You Need
- Node.js installed (download at https://nodejs.org — get the LTS version)
- Your Anthropic API key (get it at https://console.anthropic.com/keys)

---

## Setup Steps (do this once)

### 1. Copy these files into your project folder
Place these 3 new files alongside your existing HTML files:
  - server.js
  - package.json
  - .env  (rename .env.example → .env, then add your key)

Your folder should look like:
  aldo-elite/
  ├── server.js          ← NEW
  ├── package.json       ← NEW
  ├── .env               ← NEW (your API key lives here)
  ├── index.html
  ├── nutrition.html
  ├── 531.html
  └── ... (all other HTML files)

### 2. Add your API key
Open .env and replace the placeholder:
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

### 3. Install dependencies
Open a terminal in your project folder and run:
  npm install

This installs Express, dotenv, node-fetch, and cors.

---

## Running the App (every time)

In your terminal:
  node server.js

You'll see:
  ✅  Aldo Elite server running at http://localhost:3000

Then open your browser to:
  http://localhost:3000

All your HTML files are served from there. The nutrition planner
will now work — it calls /api/meal-plan on your local server,
which securely forwards to Anthropic with your API key.

---

## Tips

- Keep the terminal open while using the app (Ctrl+C to stop)
- Never commit your .env file to GitHub — add it to .gitignore
- For auto-restart on file changes during development:
    npm run dev   (uses nodemon)

---

## Hosting Online Later (optional)

When you're ready to put this online, the easiest free options:
  - Railway.app — drag and drop your folder, set ANTHROPIC_API_KEY
                   as an environment variable in their dashboard
  - Render.com   — same process, free tier available
  - Heroku       — classic option, also supports env vars

All of them let you set ANTHROPIC_API_KEY in their dashboard
so you never expose it in your code.

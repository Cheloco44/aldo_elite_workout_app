// ============================================================
//  ALDO ELITE — Nutrition API Server
//  Run: node server.js
//  Then open: http://localhost:3000
// ============================================================

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const path     = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve all your HTML files (put server.js in the same folder
// as index.html, 531.html, nutrition.html, etc.)
app.use(express.static(path.join(__dirname)));

// ── Nutrition meal-plan endpoint ─────────────────────────────
app.post('/api/meal-plan', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body;

  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({ error: 'Missing systemPrompt or userPrompt' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error('Anthropic API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Aldo Elite server running at http://localhost:${PORT}`);
  console.log(`    Open http://localhost:${PORT}/nutrition.html in your browser\n`);
});

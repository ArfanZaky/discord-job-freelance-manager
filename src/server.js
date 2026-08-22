const dotenv = require('dotenv');
const result = dotenv.config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const db = require('./db');
const { syncAllChannels } = require('./discordScraper');
const { generateCoverLetter, analyzeJobMatch } = require('./aiService');
const { applyToJob } = require('./autoApplyEngine');

const app = express();
const PORT = process.env.APP_PORT || 5220;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 1. Get all jobs / freelance items
app.get('/api/items', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM items ORDER BY datetime(created_at) DESC').all();
    res.json({ success: true, count: items.length, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Trigger Discord sync manually
app.post('/api/sync', async (req, res) => {
  try {
    const newCount = await syncAllChannels();
    res.json({ success: true, new_count: newCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. User Profile API
app.get('/api/profile', (req, res) => {
  try {
    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const p = req.body;
    db.prepare(`
      UPDATE user_profile SET
        full_name = ?,
        email = ?,
        phone = ?,
        linkedin = ?,
        github = ?,
        portfolio = ?,
        skills = ?,
        experience_years = ?,
        bio = ?
      WHERE id = 1
    `).run(
      p.full_name || '',
      p.email || '',
      p.phone || '',
      p.linkedin || '',
      p.github || '',
      p.portfolio || '',
      p.skills || '',
      p.experience_years || '',
      p.bio || ''
    );
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Generate AI Cover Letter / Proposal
app.post('/api/generate-cover-letter', async (req, res) => {
  try {
    const { item_id } = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    const coverLetter = await generateCoverLetter(item, profile);

    db.prepare('UPDATE items SET ai_cover_letter = ? WHERE id = ?').run(coverLetter, item_id);

    res.json({ success: true, cover_letter: coverLetter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Execute Auto-Apply
app.post('/api/apply', async (req, res) => {
  try {
    const { item_id, cover_letter } = req.body;
    const result = await applyToJob(item_id, cover_letter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Setup automated Cron schedule (Every 5 minutes by default)
const cronInterval = process.env.CRON_INTERVAL_MINUTES || 5;
cron.schedule(`*/${cronInterval} * * * *`, async () => {
  console.log(`[Cron Runner] Checking Discord channels for new jobs & freelance listings...`);
  try {
    await syncAllChannels();
  } catch (err) {
    console.error('[Cron Runner] Error syncing Discord:', err.message);
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Job & Freelance Manager running on port ${PORT}`);
  console.log(`📡 Local Gateway: http://127.0.0.1:${PORT}`);
  console.log(`🤖 9Router API connected at: ${process.env.NINEROUTER_URL}`);
  console.log(`=======================================================`);
});

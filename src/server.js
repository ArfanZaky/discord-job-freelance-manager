const dotenv = require('dotenv');
dotenv.config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const db = require('./db');
const { getAllSettings, setSetting, getSetting } = require('./db');
const { syncAllChannels } = require('./discordScraper');
const { generateCoverLetter, analyzeJobMatch, testAIConnection, fetchAvailableModels } = require('./aiService');
const { applyToJob, runAutoBidRoutine } = require('./autoApplyEngine');
const { scrapeProjectsCoIdAccount } = require('./projectscoidScraper');

const app = express();
const PORT = process.env.APP_PORT || 5220;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Ensure notifications table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS projectscoid_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_id TEXT UNIQUE,
    avatar TEXT,
    sender TEXT,
    notif_datetime TEXT,
    content_text TEXT,
    content_html TEXT,
    notif_type TEXT,
    links_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

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

// 3. Toggle Bid Success / Won
app.post('/api/items/:id/bid-success', (req, res) => {
  try {
    const { id } = req.params;
    const { is_bid_success } = req.body;
    const successVal = is_bid_success ? 1 : 0;
    
    db.prepare('UPDATE items SET is_bid_success = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(successVal, id);
    
    res.json({ success: true, is_bid_success: successVal });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. User Profile API
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

// 5. Settings API (AI + Projects.co.id & Platform Automations)
app.get('/api/settings', (req, res) => {
  try {
    const settings = getAllSettings();
    const maskedKey = settings.ai_api_key && settings.ai_api_key.length > 8
      ? `${settings.ai_api_key.substring(0, 4)}...${settings.ai_api_key.substring(settings.ai_api_key.length - 4)}`
      : settings.ai_api_key || '';
    
    res.json({
      success: true,
      settings: {
        ...settings,
        has_api_key: Boolean(settings.ai_api_key),
        masked_api_key: maskedKey,
        has_projectscoid_pass: Boolean(settings.projectscoid_pass)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const {
      ai_host,
      ai_api_key,
      ai_model_filter,
      ai_model_proposal,
      ai_model_vision,
      projectscoid_user,
      projectscoid_pass,
      autobid_enabled,
      autobid_custom_prompt,
      autobid_bid_prompt,
      sync_interval_discord,
      sync_interval_notif
    } = req.body;
    
    if (ai_host !== undefined) setSetting('ai_host', ai_host.trim());
    if (ai_api_key !== undefined && ai_api_key !== '********') {
      setSetting('ai_api_key', ai_api_key.trim());
    }
    if (ai_model_filter !== undefined) setSetting('ai_model_filter', ai_model_filter.trim());
    if (ai_model_proposal !== undefined) setSetting('ai_model_proposal', ai_model_proposal.trim());
    if (ai_model_vision !== undefined) setSetting('ai_model_vision', ai_model_vision.trim());

    if (projectscoid_user !== undefined) setSetting('projectscoid_user', projectscoid_user.trim());
    if (projectscoid_pass !== undefined && projectscoid_pass !== '********') {
      setSetting('projectscoid_pass', projectscoid_pass.trim());
    }

    if (autobid_enabled !== undefined) setSetting('autobid_enabled', autobid_enabled ? '1' : '0');
    if (autobid_custom_prompt !== undefined) setSetting('autobid_custom_prompt', autobid_custom_prompt.trim());
    if (autobid_bid_prompt !== undefined) setSetting('autobid_bid_prompt', autobid_bid_prompt.trim());
    if (sync_interval_discord !== undefined) setSetting('sync_interval_discord', String(Math.max(1, parseInt(sync_interval_discord) || 5)));
    if (sync_interval_notif !== undefined) setSetting('sync_interval_notif', String(Math.max(1, parseInt(sync_interval_notif) || 15)));
    restartCronTasks();

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch models list from AI host
app.get('/api/models', async (req, res) => {
  try {
    const models = await fetchAvailableModels();
    res.json({ success: true, models });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings/test', async (req, res) => {
  try {
    const { ai_host, ai_api_key, ai_model_proposal, ai_model_filter } = req.body;
    let override = null;
    if (ai_host || ai_api_key || ai_model_proposal || ai_model_filter) {
      const current = getAllSettings();
      override = {
        host: (ai_host || current.ai_host || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        apiKey: (ai_api_key && ai_api_key !== '********') ? ai_api_key : current.ai_api_key,
        modelProposal: ai_model_proposal || current.ai_model_proposal || 'ag/gemini-3.7-flash-high',
        modelFilter: ai_model_filter || current.ai_model_filter || 'ag/gemini-3.7-flash-high',
        modelVision: current.ai_model_vision || 'ag/gemini-3.7-flash-high'
      };
    }
    const result = await testAIConnection(override);
    res.json({ success: true, message: 'AI Connection Test Successful', response: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Trigger Auto-Bid routine manually or test
app.post('/api/autobid/run-now', async (req, res) => {
  try {
    const result = await runAutoBidRoutine(3);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Generate AI Cover Letter / Proposal
app.post('/api/generate-cover-letter', async (req, res) => {
  try {
    const { item_id, prompt_override } = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
    const coverLetter = await generateCoverLetter(item, profile, prompt_override);

    db.prepare('UPDATE items SET ai_cover_letter = ? WHERE id = ?').run(coverLetter, item_id);

    res.json({ success: true, cover_letter: coverLetter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Execute Auto-Apply
app.post('/api/apply', async (req, res) => {
  try {
    const { item_id, cover_letter } = req.body;
    const result = await applyToJob(item_id, cover_letter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Projects.co.id Notifications API
app.get('/api/notifications', (req, res) => {
  try {
    const stats = {
      pesta_points: getSetting('projectscoid_pesta_points', '0'),
      worker_points: getSetting('projectscoid_worker_points', '0'),
      affiliate_points: getSetting('projectscoid_affiliate_points', '0'),
      balance: getSetting('projectscoid_balance', 'Rp 0'),
      last_synced: getSetting('projectscoid_last_synced', null)
    };

    const notifications = db.prepare(`
      SELECT * FROM projectscoid_notifications 
      ORDER BY id ASC
    `).all();

    res.json({
      success: true,
      stats,
      count: notifications.length,
      notifications
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notifications/sync', async (req, res) => {
  try {
    const result = await scrapeProjectsCoIdAccount();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic Automated Cron Scheduler
let discordCronTask = null;
let notifCronTask = null;

function restartCronTasks() {
  const settings = getAllSettings();
  const discordInterval = Math.max(1, parseInt(settings.sync_interval_discord) || 5);
  const notifInterval = Math.max(1, parseInt(settings.sync_interval_notif) || 15);

  if (discordCronTask) discordCronTask.stop();
  if (notifCronTask) notifCronTask.stop();

  console.log(`[Cron Scheduler] Initializing Tasks: Discord Sync + Auto-Bid every ${discordInterval}m, Notification Sync every ${notifInterval}m`);

  // 1. Discord Ingestion & Auto-Bid Cron
  discordCronTask = cron.schedule(`*/${discordInterval} * * * *`, async () => {
    console.log(`[Cron Scheduler] Running scheduled Discord sync (Interval: ${discordInterval}m)...`);
    try {
      await syncAllChannels();
      const current = getAllSettings();
      if (current.autobid_enabled === '1') {
        console.log('[Cron Scheduler] Auto-Bid active. Evaluating Projects.co.id listings...');
        await runAutoBidRoutine(3);
      }
    } catch (err) {
      console.error('[Cron Scheduler] Discord/Auto-Bid Error:', err.message);
    }
  });

  // 2. Projects.co.id Notifications Auto-Sync Cron
  notifCronTask = cron.schedule(`*/${notifInterval} * * * *`, async () => {
    console.log(`[Cron Scheduler] Running scheduled Projects.co.id notification sync (Interval: ${notifInterval}m)...`);
    try {
      await scrapeProjectsCoIdAccount();
    } catch (err) {
      console.error('[Cron Scheduler] Notification Sync Error:', err.message);
    }
  });
}

// Initial cron start
restartCronTasks();

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Job & Freelance Manager running on port ${PORT}`);
  console.log(`📡 Local Gateway: http://127.0.0.1:${PORT}`);
  console.log(`⚙️ Dynamic AI & Platform Automation Configuration enabled`);
  console.log(`=======================================================`);
});

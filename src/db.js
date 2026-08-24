const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(process.env.DATABASE_PATH || path.join(dataDir, 'jobs.sqlite'));

db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL, -- 'job' or 'freelance'
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT,
    location TEXT,
    budget_salary TEXT,
    job_type TEXT,
    category TEXT,
    skills TEXT,
    url TEXT,
    description TEXT,
    raw_payload TEXT,
    platform_source TEXT DEFAULT 'Discord',
    status TEXT DEFAULT 'new', -- 'new', 'analyzed', 'applying', 'applied', 'failed', 'rejected', 'skipped'
    ai_summary TEXT,
    ai_cover_letter TEXT,
    apply_log TEXT,
    is_bid_success INTEGER DEFAULT 0,
    bid_amount TEXT,
    auto_bid_evaluated INTEGER DEFAULT 0,
    auto_bid_matched INTEGER DEFAULT 0,
    auto_bid_category TEXT,
    auto_bid_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    full_name TEXT DEFAULT 'Arfan Zaky Hifdillah',
    email DEFAULT 'arfanzaky@cloudverra.com',
    phone TEXT DEFAULT '+6281234567890',
    linkedin TEXT DEFAULT 'https://linkedin.com/in/arfanzaky',
    github TEXT DEFAULT 'https://github.com/ArfanZaky',
    portfolio TEXT DEFAULT 'https://cloudverra.com',
    skills TEXT DEFAULT 'Node.js, TypeScript, Python, React, Next.js, Docker, Linux, DevOps, AI Integrations, Full Stack Engineering',
    experience_years TEXT DEFAULT '4+ Years',
    bio TEXT DEFAULT 'Full Stack Software Engineer & Automation Specialist experienced in backend systems, AI integration, and modern cloud deployment.'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_cursors (
    channel_id TEXT PRIMARY KEY,
    last_message_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS autobid_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT,
    item_title TEXT,
    matched INTEGER,
    category TEXT,
    reason TEXT,
    status TEXT, -- 'matched_and_bid', 'skipped', 'bid_failed', 'bid_success'
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Seed default profile if not exists
  INSERT OR IGNORE INTO user_profile (id) VALUES (1);

  -- Seed default settings if not exist
  INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('ai_host', 'https://9routers.cloudverra.com/v1'),
    ('ai_api_key', ''),
    ('ai_model_filter', 'ag/gemini-3.7-flash-high'),
    ('ai_model_proposal', 'ag/gemini-3.7-flash-high'),
    ('ai_model_vision', 'ag/gemini-3.7-flash-high'),
    ('projectscoid_user', 'AzakyHifdillah'),
    ('projectscoid_pass', '456321987Azaky'),
    ('autobid_enabled', '0'),
    ('autobid_custom_prompt', 'Hanya terima proyek yang berkaitan dengan perbaikan bug website (PHP, Laravel, WordPress, Next.js, React, Python, Vue, HTML/CSS/JS, API) atau pengembangan sistem website (Web application, backend, frontend, portal, SaaS web). Tolak proyek mobile app murni, video, desain grafis, adsense, voice over, penulisan artikel, sosmed.'),
    ('autobid_bid_prompt', 'Buat proposal penawaran yang to the point, profesional, dan meyakinkan. Jelaskan pemahaman teknis singkat mengenai masalah atau sistem yang akan dibangun, sebutkan stack teknologi relevan yang dikuasai, tawarkan estimasi waktu realistis, serta jaminan pengerjaan rapi dan siap revisi.');
`);

// Helpers for settings key-value
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const res = {
    ai_host: 'https://9routers.cloudverra.com/v1',
    ai_api_key: '',
    ai_model_filter: 'ag/gemini-3.7-flash-high',
    ai_model_proposal: 'ag/gemini-3.7-flash-high',
    ai_model_vision: 'ag/gemini-3.7-flash-high',
    projectscoid_user: 'AzakyHifdillah',
    projectscoid_pass: '456321987Azaky',
    autobid_enabled: '0',
    autobid_custom_prompt: 'Hanya terima proyek yang berkaitan dengan perbaikan bug website (PHP, Laravel, WordPress, Next.js, React, Python, Vue, HTML/CSS/JS, API) atau pengembangan sistem website (Web application, backend, frontend, portal, SaaS web). Tolak proyek mobile app murni, video, desain grafis, adsense, voice over, penulisan artikel, sosmed.',
    autobid_bid_prompt: 'Buat proposal penawaran yang to the point, profesional, dan meyakinkan. Jelaskan pemahaman teknis singkat mengenai masalah atau sistem yang akan dibangun, sebutkan stack teknologi relevan yang dikuasai, tawarkan estimasi waktu realistis, serta jaminan pengerjaan rapi dan siap revisi.'
  };
  rows.forEach(r => {
    res[r.key] = r.value;
  });

  // Handle legacy keys fallback
  if (!res.ai_model_filter && res.ai_model_text) res.ai_model_filter = res.ai_model_text;
  if (!res.ai_model_proposal && res.ai_model_text) res.ai_model_proposal = res.ai_model_text;

  return res;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value ?? ''));
}

module.exports = db;
module.exports.getSetting = getSetting;
module.exports.getAllSettings = getAllSettings;
module.exports.setSetting = setSetting;

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
    status TEXT DEFAULT 'new', -- 'new', 'analyzed', 'applying', 'applied', 'failed', 'rejected'
    ai_summary TEXT,
    ai_cover_letter TEXT,
    apply_log TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    full_name TEXT DEFAULT 'Arfan Zaky Hifdillah',
    email TEXT DEFAULT 'arfanzaky@cloudverra.com',
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

  -- Seed default profile if not exists
  INSERT OR IGNORE INTO user_profile (id) VALUES (1);

  -- Seed default AI settings if not exist
  INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('ai_host', 'https://api.openai.com/v1'),
    ('ai_api_key', ''),
    ('ai_model_text', 'gpt-4o-mini'),
    ('ai_model_vision', 'gpt-4o-mini');
`);

// Helpers for settings key-value
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const res = {
    ai_host: 'https://api.openai.com/v1',
    ai_api_key: '',
    ai_model_text: 'gpt-4o-mini',
    ai_model_vision: 'gpt-4o-mini'
  };
  rows.forEach(r => {
    res[r.key] = r.value;
  });
  return res;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value || ''));
}

module.exports = db;
module.exports.getSetting = getSetting;
module.exports.getAllSettings = getAllSettings;
module.exports.setSetting = setSetting;

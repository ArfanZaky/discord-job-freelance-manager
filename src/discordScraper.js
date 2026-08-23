const axios = require('axios');
const db = require('./db');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNELS = (process.env.DISCORD_CHANNELS || '1501058754630910102,1500464207479701624')
  .split(',')
  .map(c => c.trim())
  .filter(Boolean);

async function fetchChannelMessages(channelId, limit = 50) {
  if (!DISCORD_BOT_TOKEN) {
    console.error('DISCORD_BOT_TOKEN is not set!');
    return [];
  }

  const cursorRow = db.prepare('SELECT last_message_id FROM sync_cursors WHERE channel_id = ?').get(channelId);
  let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`;
  if (cursorRow && cursorRow.last_message_id) {
    url += `&after=${cursorRow.last_message_id}`;
  }

  try {
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
      },
      timeout: 15000
    });

    return res.data || [];
  } catch (err) {
    if (err.response?.status === 400 && cursorRow) {
      const fallbackRes = await axios.get(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
        headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` }
      });
      return fallbackRes.data || [];
    }
    console.error(`Error fetching Discord channel ${channelId}:`, err.response?.data || err.message);
    return [];
  }
}

function detectPlatformSource(embed, channelId, fallbackText = '') {
  const isFreelanceChannel = channelId === '1500464207479701624';
  
  // Check footer
  const footerText = embed?.footer?.text?.toLowerCase() || '';
  if (footerText.includes('projects.co.id')) return 'Projects.co.id';
  if (footerText.includes('kalibrr')) return 'Kalibrr';
  if (footerText.includes('dealls')) return 'Dealls';
  if (footerText.includes('glints')) return 'Glints';
  if (footerText.includes('jobstreet')) return 'JobStreet';
  if (footerText.includes('fastwork')) return 'Fastwork';
  if (footerText.includes('freelancer')) return 'Freelancer';
  if (footerText.includes('upwork')) return 'Upwork';
  if (footerText.includes('sribulancer')) return 'Sribulancer';

  // Check fields
  if (embed?.fields) {
    for (const f of embed.fields) {
      const fn = f.name.toLowerCase();
      const fv = f.value;
      if (fn.includes('source') || fn.includes('platform')) {
        if (/projects\.co\.id/i.test(fv)) return 'Projects.co.id';
        if (/kalibrr/i.test(fv)) return 'Kalibrr';
        if (/dealls/i.test(fv)) return 'Dealls';
        if (/glints/i.test(fv)) return 'Glints';
        if (/jobstreet/i.test(fv)) return 'JobStreet';
      }
    }
  }

  // Check description & url
  const fullContent = `${embed?.title || ''} ${embed?.description || ''} ${embed?.url || ''} ${fallbackText}`.toLowerCase();
  if (fullContent.includes('projects.co.id')) return 'Projects.co.id';
  if (fullContent.includes('kalibrr')) return 'Kalibrr';
  if (fullContent.includes('dealls')) return 'Dealls';
  if (fullContent.includes('glints')) return 'Glints';
  if (fullContent.includes('jobstreet')) return 'JobStreet';
  if (fullContent.includes('fastwork')) return 'Fastwork';
  if (fullContent.includes('freelancer')) return 'Freelancer';
  if (fullContent.includes('upwork')) return 'Upwork';
  if (fullContent.includes('sribu')) return 'Sribu';
  if (fullContent.includes('linkedin')) return 'LinkedIn';

  return isFreelanceChannel ? 'Projects.co.id' : 'Discord Feed';
}

function parseEmbedToItem(embed, messageId, channelId) {
  const platformSource = detectPlatformSource(embed, channelId);
  const isFreelance = channelId === '1500464207479701624' || (embed.title && embed.title.includes('Projects.co.id')) || platformSource === 'Projects.co.id';
  const sourceType = isFreelance ? 'freelance' : 'job';

  // Extract fields
  const fields = embed.fields || [];
  let company = '';
  let location = '';
  let salary = '';
  let jobType = '';
  let category = '';
  let skills = '';
  let applyUrl = embed.url || '';

  for (const f of fields) {
    const name = f.name.toLowerCase();
    const val = f.value;

    if (name.includes('company') || name.includes('perusahaan')) {
      company = val;
    } else if (name.includes('location') || name.includes('lokasi')) {
      location = val;
    } else if (name.includes('salary') || name.includes('budget') || name.includes('gaji')) {
      salary = val;
    } else if (name.includes('type') || name.includes('tipe')) {
      jobType = val;
    } else if (name.includes('category') || name.includes('kategori')) {
      category = val;
    } else if (name.includes('skills') || name.includes('keahlian')) {
      skills = val;
    } else if (name.includes('link') || name.includes('url')) {
      const match = val.match(/\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
      if (match) {
        applyUrl = match[1];
      }
    }
  }

  // Find apply url in description if still empty
  if (!applyUrl && embed.description) {
    const match = embed.description.match(/\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
    if (match) {
      applyUrl = match[1];
    } else {
      const rawUrl = embed.description.match(/https?:\/\/[^\s\)]+/);
      if (rawUrl) applyUrl = rawUrl[0];
    }
  }

  const title = (embed.title || 'Untitled Listing').replace(/^[^\w\s]+/, '').trim();
  const description = embed.description || '';

  // Filter out summaries
  if (title.toLowerCase().includes('scraping summary')) {
    return null;
  }

  const id = `${channelId}_${messageId}_${Math.abs(hashString(title + applyUrl))}`;

  return {
    id,
    source_type: sourceType,
    platform_source: platformSource,
    channel_id: channelId,
    message_id: messageId,
    title,
    company,
    location,
    budget_salary: salary,
    job_type: jobType,
    category,
    skills,
    url: applyUrl,
    description,
    raw_payload: JSON.stringify(embed)
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

async function syncDiscordChannel(channelId) {
  const messages = await fetchChannelMessages(channelId, 40);
  if (!messages || messages.length === 0) return 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO items (
      id, source_type, platform_source, channel_id, message_id, title, company, location,
      budget_salary, job_type, category, skills, url, description, raw_payload
    ) VALUES (
      @id, @source_type, @platform_source, @channel_id, @message_id, @title, @company, @location,
      @budget_salary, @job_type, @category, @skills, @url, @description, @raw_payload
    )
  `);

  let addedCount = 0;
  let newestMessageId = null;

  for (const msg of messages) {
    if (!newestMessageId) {
      newestMessageId = msg.id;
    }

    if (msg.embeds && msg.embeds.length > 0) {
      for (const emb of msg.embeds) {
        const item = parseEmbedToItem(emb, msg.id, channelId);
        if (item && item.title) {
          const res = insertStmt.run(item);
          if (res.changes > 0) addedCount++;
        }
      }
    } else if (msg.content && msg.content.trim()) {
      // Content-only discord message
      const isFreelance = channelId === '1500464207479701624';
      const id = `${channelId}_${msg.id}`;
      const lines = msg.content.trim().split('\n');
      const title = lines[0].substring(0, 150);
      const urlMatch = msg.content.match(/https?:\/\/[^\s]+/);
      const platformSource = detectPlatformSource(null, channelId, msg.content);

      const res = insertStmt.run({
        id,
        source_type: isFreelance ? 'freelance' : 'job',
        platform_source: platformSource,
        channel_id: channelId,
        message_id: msg.id,
        title,
        company: msg.author?.username || 'Discord Post',
        location: 'Remote/Unspecified',
        budget_salary: 'Discussable',
        job_type: isFreelance ? 'Freelance' : 'Full-time',
        category: 'General',
        skills: '',
        url: urlMatch ? urlMatch[0] : '',
        description: msg.content,
        raw_payload: JSON.stringify(msg)
      });
      if (res.changes > 0) addedCount++;
    }
  }

  if (newestMessageId) {
    db.prepare(`
      INSERT INTO sync_cursors (channel_id, last_message_id, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(channel_id) DO UPDATE SET
        last_message_id = excluded.last_message_id,
        updated_at = CURRENT_TIMESTAMP
    `).run(channelId, newestMessageId);
  }

  return addedCount;
}

async function syncAllChannels() {
  console.log(`[Discord Sync] Starting sync for channels: ${DISCORD_CHANNELS.join(', ')}`);
  let totalNew = 0;
  for (const cid of DISCORD_CHANNELS) {
    try {
      const count = await syncDiscordChannel(cid);
      console.log(`[Discord Sync] Channel ${cid}: ${count} new items added.`);
      totalNew += count;
    } catch (e) {
      console.error(`[Discord Sync] Channel ${cid} error:`, e.message);
    }
  }
  return totalNew;
}

module.exports = {
  syncDiscordChannel,
  syncAllChannels,
  detectPlatformSource
};

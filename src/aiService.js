const axios = require('axios');
const { getSetting, getAllSettings } = require('./db');

function getAIConfig() {
  const settings = getAllSettings();
  
  let host = settings.ai_host || process.env.AI_HOST || process.env.NINEROUTER_URL || 'https://api.openai.com/v1';
  host = host.replace(/\/+$/, '');

  const apiKey = settings.ai_api_key || process.env.AI_API_KEY || process.env.NINEROUTER_API_KEY || '';
  const modelText = settings.ai_model_text || process.env.AI_MODEL_TEXT || 'gpt-4o-mini';
  const modelVision = settings.ai_model_vision || process.env.AI_MODEL_VISION || 'gpt-4o-mini';

  return {
    host,
    apiKey,
    modelText,
    modelVision
  };
}

async function testAIConnection(configOverride = null) {
  const config = configOverride || getAIConfig();
  if (!config.apiKey) {
    throw new Error('API Key belum diisi pada menu Settings.');
  }

  const endpoint = `${config.host}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  const response = await axios.post(endpoint, {
    model: config.modelText,
    messages: [{ role: 'user', content: 'Say "AI Connected Successfully" in 4 words.' }],
    max_tokens: 30
  }, {
    headers,
    timeout: 15000
  });

  return response.data?.choices?.[0]?.message?.content?.trim() || 'Connected';
}

/**
 * AI Classifier to strictly determine if a project matches:
 * 1. Fix Bug Website
 * 2. Development System Website
 * Exclusively for WEBSITE ecosystem.
 */
async function classifyProjectForAutoBid(item) {
  const config = getAIConfig();
  if (!config.apiKey) {
    return { match: false, category: 'Unconfigured AI', reason: 'API Key AI belum diset di Settings' };
  }

  const filterFixBug = getSetting('autobid_filter_fix_bug', '1') === '1';
  const filterDevSystem = getSetting('autobid_filter_dev_system', '1') === '1';
  const filterWebOnly = getSetting('autobid_filter_website_only', '1') === '1';
  const customFilterRule = getSetting('autobid_custom_prompt', '');

  const allowedCategories = [];
  if (filterFixBug) allowedCategories.push('"Fix Bug Website" (perbaikan bug, error, debugging, fixing code website)');
  if (filterDevSystem) allowedCategories.push('"Development System Website" (pembuatan website, web app, web backend/frontend, integrasi API web, dashboard, CMS, SaaS web)');

  const prompt = `Anda adalah sistem kurasi proyek freelance spesialis Full Stack & Web Developer.
Tugas Anda mengevaluasi apakah proyek berikut LAYAK di-auto-bid sesuai kriteria ketat berikut:

KRITERIA WAJIB:
1. Target kategori yang diizinkan: ${allowedCategories.join(' ATAU ') || 'Tidak ada kriteria aktif'}.
2. Lingkup: ${filterWebOnly ? 'KHUSUS EKOSISTEM WEBSITE (PHP, Laravel, WordPress, Next.js, React, Node.js, Python, Vue, CodeIgniter, Django, HTML/CSS/JS, Tailwind, API Backend Web, dsb).' : 'Umum'}
3. LARANGAN KERAS (Wajib tolak match: false):
   - Proyek video editing, animasi, reels, tiktok, youtube
   - Desain grafis murni, logo, banner, ilustrasi tanpa coding web
   - Penulisan artikel, copywriting, SEO content, data entry, review
   - Jual beli akun (AdSense, domain, sosmed, game)
   - Voice over, audio, musik
   - Mobile app murni (Flutter/React Native/Android/iOS) KECUALI ada integrasi backend/web API yang eksplisit.
${customFilterRule ? `Aturan Filter Tambahan:\n${customFilterRule}` : ''}

DETAIL PROYEK:
- Judul: ${item.title}
- Platform: ${item.platform_source || 'Projects.co.id'}
- Kategori/Skills: ${item.category || ''} | ${item.skills || ''}
- Budget: ${item.budget_salary || ''}
- Deskripsi:
${item.description || 'Tidak ada deskripsi detail'}

KEMBALIKAN OUTPUT DALAM FORMAT JSON VALID SAJA:
{
  "match": true / false,
  "category": "Fix Bug Website" | "Development System Website" | "Other / Rejected",
  "reason": "Alasan singkat (1 kalimat padat dalam Bahasa Indonesia)"
}`;

  try {
    const res = await axios.post(`${config.host}/chat/completions`, {
      model: config.modelText,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });

    const content = res.data?.choices?.[0]?.message?.content?.trim() || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        match: Boolean(parsed.match),
        category: parsed.category || 'Other / Rejected',
        reason: parsed.reason || 'Selesai dianalisis AI'
      };
    }

    return { match: false, category: 'Parse Error', reason: 'Gagal parse JSON hasil AI' };
  } catch (err) {
    console.error('Error classifying project for autobid:', err.response?.data || err.message);
    return { match: false, category: 'AI Error', reason: err.message };
  }
}

async function generateCoverLetter(jobData, userProfile, customPromptDirective = null) {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new Error('API Key AI belum dikonfigurasi. Silakan isi di menu Settings.');
  }

  const bidPromptDirective = customPromptDirective || getSetting('autobid_bid_prompt', 'Buat proposal penawaran yang to the point, profesional, dan meyakinkan. Jelaskan pemahaman teknis singkat mengenai masalah atau sistem yang akan dibangun, sebutkan stack teknologi relevan yang dikuasai, tawarkan estimasi waktu realistis, serta jaminan pengerjaan rapi dan siap revisi.');

  const prompt = `Anda adalah asisten AI profesional untuk karir software engineer & freelancer.
Tulis Proposal penawaran/bid yang persuasif, tajam, padat, to the point, dan sangat relevan dalam Bahasa Indonesia (atau English jika listing berbahasa English).

Profil Pelamar:
- Nama: ${userProfile.full_name}
- Keahlian Utama: ${userProfile.skills}
- Pengalaman: ${userProfile.experience_years}
- Portofolio / GitHub: ${userProfile.portfolio} / ${userProfile.github}
- Bio Singkat: ${userProfile.bio}

Detail Pekerjaan / Proyek:
- Judul: ${jobData.title}
- Perusahaan / Klien: ${jobData.company || '-'}
- Kategori / Scope: ${jobData.category || '-'}
- Gaji / Budget: ${jobData.budget_salary || '-'}
- Skills Diperlukan: ${jobData.skills || '-'}
- Deskripsi:
${jobData.description || 'Tidak ada deskripsi detail'}

PANDUAN & ATURAN PROMPT BID KHUSUS:
${bidPromptDirective}

Format Output:
Hanya kembalikan teks proposal siap kirim (tanpa pembuka basa-basi seperti "Berikut proposal saya..."). Tunjukkan pemahaman teknis atas problem klien.`;

  try {
    const res = await axios.post(`${config.host}/chat/completions`, {
      model: config.modelText,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return res.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Error generating cover letter:', err.response?.data || err.message);
    throw new Error(err.response?.data?.error?.message || err.message);
  }
}

async function solveCaptchaWithVision(base64Image, instruction = 'Read the captcha text or solve the instruction') {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new Error('API Key AI belum dikonfigurasi. Silakan isi di menu Settings.');
  }

  const prompt = `Inspect this CAPTCHA image and provide the exact solution characters or answer.
Instruction: ${instruction}
Respond ONLY with the solution string/number, nothing else.`;

  try {
    const res = await axios.post(`${config.host}/chat/completions`, {
      model: config.modelVision,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: base64Image.startsWith('data:') ? base64Image : `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return res.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Error solving captcha with vision:', err.response?.data || err.message);
    throw new Error(err.response?.data?.error?.message || err.message);
  }
}

async function analyzeJobMatch(jobData, userProfile) {
  const config = getAIConfig();
  if (!config.apiKey) {
    return { score: 70, reason: 'AI not configured' };
  }

  const prompt = `Analisis kecocokan pekerjaan berikut dengan profil pelamar.
Pekerjaan: ${jobData.title} | ${jobData.skills || ''} | ${jobData.description || ''}
Profil: ${userProfile.skills}

Berikan skor kecocokan 0-100 dan alasan 1 kalimat.
Format JSON: {"score": 85, "reason": "Keahlian React dan Node.js sangat cocok dengan kebutuhan proyek"}`;

  try {
    const res = await axios.post(`${config.host}/chat/completions`, {
      model: config.modelText,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    const content = res.data?.choices?.[0]?.message?.content?.trim() || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { score: 75, reason: content };
  } catch (err) {
    return { score: 70, reason: 'Auto analyzed' };
  }
}

module.exports = {
  getAIConfig,
  testAIConnection,
  classifyProjectForAutoBid,
  generateCoverLetter,
  solveCaptchaWithVision,
  analyzeJobMatch
};

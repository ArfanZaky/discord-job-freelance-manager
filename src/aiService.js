const axios = require('axios');
const { getSetting, getAllSettings } = require('./db');

function getAIConfig() {
  const settings = getAllSettings();
  
  let host = settings.ai_host || process.env.AI_HOST || process.env.NINEROUTER_URL || 'https://9routers.cloudverra.com/v1';
  host = host.replace(/\/+$/, '');

  const apiKey = settings.ai_api_key || process.env.AI_API_KEY || process.env.NINEROUTER_API_KEY || '';
  const modelFilter = settings.ai_model_filter || settings.ai_model_text || 'ag/gemini-3.7-flash-high';
  const modelProposal = settings.ai_model_proposal || settings.ai_model_text || 'ag/gemini-3.7-flash-high';
  const modelVision = settings.ai_model_vision || 'ag/gemini-3.7-flash-high';

  return {
    host,
    apiKey,
    modelFilter,
    modelProposal,
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

  const testModel = config.modelProposal || config.modelFilter || 'ag/gemini-3.7-flash-high';

  const response = await axios.post(endpoint, {
    model: testModel,
    messages: [{ role: 'user', content: 'Say "AI Connected Successfully" in 4 words.' }],
    max_tokens: 30
  }, {
    headers,
    timeout: 15000
  });

  return response.data?.choices?.[0]?.message?.content?.trim() || 'Connected';
}

async function fetchAvailableModels(configOverride = null) {
  const config = configOverride || getAIConfig();
  if (!config.apiKey) return [];

  try {
    const res = await axios.get(`${config.host}/models`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      },
      timeout: 10000
    });
    if (res.data && Array.isArray(res.data.data)) {
      return res.data.data.map(m => ({
        id: m.id,
        vision: m.capabilities ? Boolean(m.capabilities.vision) : true
      }));
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch models from AI host:', err.message);
    return [];
  }
}

/**
 * AI Classifier using modelFilter to strictly evaluate project eligibility based solely on user prompt & criteria.
 */
async function classifyProjectForAutoBid(item) {
  const config = getAIConfig();
  if (!config.apiKey) {
    return { match: false, category: 'Unconfigured AI', reason: 'API Key AI belum diset di Settings' };
  }

  const customFilterRule = getSetting('autobid_custom_prompt', 'Hanya terima proyek yang berkaitan dengan perbaikan bug website (PHP, Laravel, WordPress, Next.js, React, Python, Vue, HTML/CSS/JS, API) atau pengembangan sistem website (Web application, backend, frontend, portal, SaaS web). Tolak proyek mobile app murni, video, desain grafis, adsense, voice over, penulisan artikel, sosmed.');

  const prompt = `Anda adalah kurator dan evaluator proyek freelance AI.
Tugas Anda mengevaluasi secara objektif apakah proyek lowongan ini LAYAK diterima sesuai dengan ATURAN DAN KRITERIA FILTER di bawah:

ATURAN & KRITERIA PENYARINGAN:
${customFilterRule}

DETAIL PROYEK / LOWONGAN:
- Judul: ${item.title}
- Platform: ${item.platform_source || 'Projects.co.id'}
- Kategori/Skills: ${item.category || ''} | ${item.skills || ''}
- Budget: ${item.budget_salary || ''}
- Deskripsi:
${item.description || 'Tidak ada deskripsi detail'}

KEMBALIKAN OUTPUT DALAM FORMAT JSON VALID SAJA (TANPA PENJELASAN LAIN DI LUAR JSON):
{
  "match": true / false,
  "category": "Nama Kategori / Scope yang Cocok",
  "reason": "Alasan singkat padat (1 kalimat bahasa Indonesia)"
}`;

  try {
    const res = await axios.post(`${config.host}/chat/completions`, {
      model: config.modelFilter,
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
        category: parsed.category || 'Evaluated',
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
      model: config.modelProposal,
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
      model: config.modelFilter,
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
  fetchAvailableModels,
  classifyProjectForAutoBid,
  generateCoverLetter,
  solveCaptchaWithVision,
  analyzeJobMatch
};

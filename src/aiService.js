const axios = require('axios');
const { getSetting, getAllSettings } = require('./db');

function getAIConfig() {
  const settings = getAllSettings();
  
  let host = settings.ai_host || process.env.AI_HOST || process.env.NINEROUTER_URL || 'https://api.openai.com/v1';
  // Strip trailing slash if present
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

async function generateCoverLetter(jobData, userProfile) {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new Error('API Key AI belum dikonfigurasi. Silakan isi di menu Settings.');
  }

  const prompt = `Anda adalah asisten AI profesional untuk karir software engineer & freelancer.
Tulis Cover Letter / Proposal penawaran lamaran yang persuasif, tajam, padat, dan sangat relevan dalam Bahasa Indonesia (atau English jika listing berbahasa English).

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

Format Output:
Hanya kembalikan teks cover letter siap kirim (tanpa pembuka basa-basi seperti "Berikut cover letter...").`;

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
  generateCoverLetter,
  solveCaptchaWithVision,
  analyzeJobMatch
};

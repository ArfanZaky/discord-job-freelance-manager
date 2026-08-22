const axios = require('axios');

const NINEROUTER_URL = process.env.NINEROUTER_URL || 'http://127.0.0.1:20129/v1';
const NINEROUTER_API_KEY = process.env.NINEROUTER_API_KEY || 'sk-0811de2aed8e821b-crqqvr-bdb6c819';
const MODEL_TEXT = process.env.AI_MODEL_TEXT || 'ag/gemini-3-flash';
const MODEL_VISION = process.env.AI_MODEL_VISION || 'ag/gemini-3-flash';

async function generateCoverLetter(jobData, userProfile) {
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
    const res = await axios.post(`${NINEROUTER_URL}/chat/completions`, {
      model: MODEL_TEXT,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${NINEROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return res.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Error generating cover letter:', err.response?.data || err.message);
    throw err;
  }
}

async function solveCaptchaWithVision(base64Image, instruction = 'Read the captcha text or solve the instruction') {
  const prompt = `Inspect this CAPTCHA image and provide the exact solution characters or answer.
Instruction: ${instruction}
Respond ONLY with the solution string/number, nothing else.`;

  try {
    const res = await axios.post(`${NINEROUTER_URL}/chat/completions`, {
      model: MODEL_VISION,
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
        'Authorization': `Bearer ${NINEROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return res.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Error solving captcha with vision:', err.response?.data || err.message);
    throw err;
  }
}

async function analyzeJobMatch(jobData, userProfile) {
  const prompt = `Analisis kecocokan pekerjaan berikut dengan profil pelamar.
Pekerjaan: ${jobData.title} | ${jobData.skills || ''} | ${jobData.description || ''}
Profil: ${userProfile.skills}

Berikan skor kecocokan 0-100 dan alasan 1 kalimat.
Format JSON: {"score": 85, "reason": "Keahlian React dan Node.js sangat cocok dengan kebutuhan proyek"}`;

  try {
    const res = await axios.post(`${NINEROUTER_URL}/chat/completions`, {
      model: MODEL_TEXT,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${NINEROUTER_API_KEY}`,
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
  generateCoverLetter,
  solveCaptchaWithVision,
  analyzeJobMatch
};

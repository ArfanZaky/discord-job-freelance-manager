const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const db = require('./db');
const { getSetting } = require('./db');

/**
 * Scrape account stats and notifications from https://projects.co.id/user/home
 */
async function scrapeProjectsCoIdAccount() {
  const username = getSetting('projectscoid_user', 'AzakyHifdillah');
  const password = getSetting('projectscoid_pass', '456321987Azaky');

  console.log(`[Projects.co.id Scraper] Launching browser to sync account & notifications for ${username}...`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta'
    });

    const page = await context.newPage();

    // 1. Login if needed
    await page.goto('https://projects.co.id/public/home/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const userField = await page.$('#LoginActivity__user_name');
    if (userField) {
      await userField.fill(username);
      await page.fill('#LoginActivity__password', password);
      await Promise.all([
        page.waitForURL('https://projects.co.id/**', { timeout: 20000 }).catch(() => {}),
        page.click('button[type="submit"]')
      ]);
      await page.waitForTimeout(2000);
    }

    // 2. Navigate to user home / notifications
    await page.goto('https://projects.co.id/user/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const extracted = await page.evaluate(() => {
      // 1. Account Stats
      const stats = {
        pesta_points: '0',
        worker_points: '0',
        affiliate_points: '0',
        balance: 'Rp 0'
      };

      document.querySelectorAll('.dashboard-stat, .col-md-3, .col-sm-6, .panel, .widget').forEach(el => {
        const text = el.innerText || '';
        if (text.includes('Pesta Points')) {
          const num = text.match(/(\d+)\s*Pesta Points/) || text.match(/(\d+)/);
          if (num) stats.pesta_points = num[1] || num[0];
        }
        if (text.includes('Worker Points')) {
          const num = text.match(/(\d+)\s*Worker Points/) || text.match(/(\d+)/);
          if (num) stats.worker_points = num[1] || num[0];
        }
        if (text.includes('Affiliate Points')) {
          const num = text.match(/(\d+)\s*Affiliate Points/) || text.match(/(\d+)/);
          if (num) stats.affiliate_points = num[1] || num[0];
        }
        if (text.includes('Available Balance')) {
          const m = text.match(/(Rp\s*[\d\.\,]+)/);
          if (m) stats.balance = m[1];
        }
      });

      // 2. Feed / Notifications
      const notifs = [];
      const chatItems = document.querySelectorAll('ul.chats > li');
      chatItems.forEach((li, idx) => {
        const avatar = li.querySelector('img.avatar')?.getAttribute('src') || '';
        const name = li.querySelector('.name')?.innerText?.trim() || 'System';
        const datetime = li.querySelector('.datetime')?.innerText?.trim() || '';
        
        // Clean inner text and body html
        const bodyEl = li.querySelector('.body, .message');
        let bodyHtml = bodyEl ? bodyEl.innerHTML : li.innerHTML;
        
        // Strip out any intrusive ad tags / google-anno svgs if any
        const temp = document.createElement('div');
        temp.innerHTML = bodyHtml;
        temp.querySelectorAll('.google-anno, svg').forEach(s => s.remove());
        bodyHtml = temp.innerHTML.trim();

        const text = li.innerText.trim();

        // Extract key links (project link, owner link, etc)
        const links = [];
        li.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href');
          const aText = a.innerText.trim();
          if (href && href !== '#' && !href.startsWith('javascript:')) {
            links.push({ text: aText, href });
          }
        });

        // Determine notification type
        let notifType = 'system';
        if (text.includes('memilih bid') || text.includes('sebagai pemenang')) {
          notifType = 'winner_chosen';
        } else if (text.includes('autocancel') || text.includes('terlewati')) {
          notifType = 'autocancel';
        } else if (text.includes('pesan') || text.includes('message')) {
          notifType = 'message';
        }

        notifs.push({
          raw_id: `${name}_${datetime}_${idx}`,
          avatar,
          name,
          datetime,
          text,
          bodyHtml,
          notifType,
          links: JSON.stringify(links)
        });
      });

      return { stats, notifs };
    });

    await browser.close();

    // 3. Persist stats into DB
    const updateStat = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    updateStat.run('projectscoid_pesta_points', String(extracted.stats.pesta_points || '0'));
    updateStat.run('projectscoid_worker_points', String(extracted.stats.worker_points || '0'));
    updateStat.run('projectscoid_affiliate_points', String(extracted.stats.affiliate_points || '0'));
    updateStat.run('projectscoid_balance', String(extracted.stats.balance || 'Rp 0'));
    updateStat.run('projectscoid_last_synced', new Date().toISOString());

    // 4. Persist notifications into DB
    const insertNotif = db.prepare(`
      INSERT OR REPLACE INTO projectscoid_notifications 
        (raw_id, avatar, sender, notif_datetime, content_text, content_html, notif_type, links_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insertTx = db.transaction((list) => {
      for (const n of list) {
        insertNotif.run(
          n.raw_id,
          n.avatar,
          n.name,
          n.datetime,
          n.text,
          n.bodyHtml,
          n.notifType,
          n.links
        );
      }
    });

    insertTx(extracted.notifs);

    console.log(`[Projects.co.id Scraper] Successfully synced ${extracted.notifs.length} notifications.`);
    return {
      success: true,
      stats: extracted.stats,
      count: extracted.notifs.length,
      notifications: extracted.notifs
    };

  } catch (err) {
    if (browser) await browser.close();
    console.error(`[Projects.co.id Scraper] Error scraping:`, err.message);
    throw err;
  }
}

module.exports = {
  scrapeProjectsCoIdAccount
};

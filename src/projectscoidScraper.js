const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const db = require('./db');
const fs = require('fs');
const { execSync } = require('child_process');

chromium.use(stealthPlugin());

function ensurePlaywrightBrowser() {
  const cachePath = '/root/.cache/ms-playwright';
  const hasShell = fs.existsSync(cachePath) && fs.readdirSync(cachePath).some(dir => dir.startsWith('chromium_headless_shell'));
  if (!hasShell) {
    try {
      console.log('[Scraper] Playwright browser not found. Auto-installing chromium...');
      execSync('npx playwright install chromium', { stdio: 'inherit' });
      console.log('[Scraper] Playwright browser installed successfully.');
    } catch (e) {
      console.error('[Scraper] Failed to auto-install Playwright browser:', e.message);
    }
  }
}

async function syncProjectsCoIdAccount() {
  const settings = db.getAllSettings();
  const username = settings.projectscoid_user || 'AzakyHifdillah';
  const password = settings.projectscoid_pass || '456321987Azaky';

  ensurePlaywrightBrowser();
  console.log(`[Projects.co.id Scraper] Launching browser to sync account & notifications for ${username}...`);
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    console.log(`[Projects.co.id Scraper] Logging in...`);
    await page.goto('https://projects.co.id/public/home/login', { waitUntil: 'networkidle', timeout: 35000 });

    const loginInput = await page.$('#user_login');
    if (loginInput) {
      await page.fill('input[name="user[username]"], #user_login', username);
      await page.fill('input[name="user[password]"], #user_password', password);
      await Promise.all([
        page.click('button[type="submit"], input[type="submit"], .btn-primary'),
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {})
      ]);
    }

    console.log(`[Projects.co.id Scraper] Navigating to user home overview: https://projects.co.id/user/home`);
    await page.goto('https://projects.co.id/user/home', { waitUntil: 'networkidle', timeout: 35000 });

    const stats = await page.evaluate(() => {
      let pesta = '0';
      let worker = '211';
      let affiliate = '0';
      let balance = 'Rp 0';

      const tiles = document.querySelectorAll('.panel, .panel-default, .tile-stats, .media, div[class*="widget"]');
      tiles.forEach(t => {
        const txt = t.innerText;
        if (txt.includes('Pesta Points')) pesta = (txt.match(/\d+/) || [pesta])[0];
        if (txt.includes('Worker Points')) worker = (txt.match(/\d+/) || [worker])[0];
        if (txt.includes('Affiliate Points')) affiliate = (txt.match(/\d+/) || [affiliate])[0];
        if (txt.includes('Available Balance') || txt.includes('Balance')) {
          const m = txt.match(/Rp\s*[\d\.,]+/);
          if (m) balance = m[0];
        }
      });

      return { pesta, worker, affiliate, balance };
    });

    console.log(`[Projects.co.id Scraper] Stats extracted:`, stats);

    const notifications = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('tr, .list-group-item, li.media, .timeline-item, .notification-item, .table tbody tr');

      rows.forEach((row, idx) => {
        const fullText = row.innerText.trim();
        const html = row.innerHTML;

        if (fullText.includes('WIB') || fullText.includes('System') || fullText.includes('memilih') || fullText.includes('project') || fullText.includes('Masa penawaran')) {
          const dateMatch = fullText.match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+WIB/);
          const datetime = dateMatch ? dateMatch[0] : '';
          
          let sender = 'System';
          if (fullText.toLowerCase().includes('owner')) {
            const m = fullText.match(/Owner\s+([a-zA-Z0-9_\-]+)/i);
            if (m) sender = m[1];
          }

          let notifType = 'SYSTEM';
          if (fullText.includes('memilih bid') || fullText.includes('pemenang')) {
            notifType = 'WINNER_SELECTED';
          } else if (fullText.includes('di-autocancel') || fullText.includes('sudah terlewati')) {
            notifType = 'AUTO_CANCELLED';
          }

          const linkEl = row.querySelector('a[href*="project"], a[href*="browse_projects"], a[href*="user"]');
          const relatedUrl = linkEl ? linkEl.getAttribute('href') : '';
          const projectTitle = linkEl ? linkEl.innerText.trim() : '';

          items.push({
            external_id: `notif_${Date.now()}_${idx}`,
            sender,
            notif_type: notifType,
            title: projectTitle || sender,
            content_text: fullText,
            content_html: html,
            related_url: relatedUrl,
            notif_datetime: datetime || new Date().toISOString()
          });
        }
      });

      return items;
    });

    console.log(`[Projects.co.id Scraper] Scraped ${notifications.length} notification items.`);

    const insertStmt = db.prepare(`
      INSERT INTO projects_co_id_notifications (
        external_id, sender, notif_type, title, content_text, content_html, related_url, notif_datetime, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(content_text) DO UPDATE SET
        notif_type = excluded.notif_type,
        notif_datetime = excluded.notif_datetime
    `);

    db.transaction(() => {
      for (const n of notifications) {
        if (!n.content_text || n.content_text.length < 5) continue;
        insertStmt.run(
          n.external_id,
          n.sender,
          n.notif_type,
          n.title,
          n.content_text,
          n.content_html,
          n.related_url,
          n.notif_datetime,
          new Date().toISOString()
        );
      }
    })();

    db.setSetting('projectscoid_stats', JSON.stringify(stats));
    db.setSetting('last_projectscoid_sync', new Date().toISOString());

    return {
      success: true,
      stats,
      notificationCount: notifications.length
    };

  } catch (error) {
    console.error(`[Projects.co.id Scraper] Error syncing account:`, error.message);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  syncProjectsCoIdAccount
};

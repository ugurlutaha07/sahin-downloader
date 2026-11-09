const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Notification, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const lib = require('./lib');

let win, tray = null, quitting = false;
const jobs = new Map();      // id -> child process
let cancelled = false;
let cvCancelled = false;

const userData = app.getPath('userData');
// Eski adla (Şahin Doğumlandır) kurulmuş sürümden ayar, geçmiş, takip listesi ve motor dosyalarını taşı
try {
  const oldData = path.join(app.getPath('appData'), 'Şahin Doğumlandır');
  if (fs.existsSync(oldData) && !fs.existsSync(path.join(userData, 'settings.json')) && !fs.existsSync(path.join(userData, 'bin'))) {
    fs.mkdirSync(userData, { recursive: true });
    for (const n of ['settings.json', 'history.json', 'follows.json', 'bin']) {
      const s = path.join(oldData, n);
      if (fs.existsSync(s)) fs.cpSync(s, path.join(userData, n), { recursive: true });
    }
  }
} catch {}
const binDir = path.join(userData, 'bin');
const tmpDir = path.join(userData, 'tmp');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const ytdlpPath = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + (isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp_linux');
const ffmpegPath = () => lib.ffmpeg();
const iconPath = size => path.join(__dirname, 'build', size ? `icon-${size}.png` : 'icon.png');

// ---------- JSON dosyaları ----------
function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function writeJson(file, data) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} }

// ---------- Ayarlar ----------
const settingsFile = path.join(userData, 'settings.json');
const DEFAULTS = {
  theme: 'system', design: 'klasik', zoom: '1', folder: '', cvFolder: '',
  mode: 'video', vfmt: 'mp4', quality: '1080', afmt: 'mp3', abr: '320',
  conc: 2, numbered: true, nameTpl: 'title',
  subs: false, subLang: 'tr,en', embedThumb: true, rate: '',
  normalize: false, trimSilence: false,
  notify: true, openDone: false,
  cvFmt: 'mp4', cvQuality: 'balanced', cvRes: 'orig', cvNormalize: false, cvTrimSilence: false,
  clipWatch: true, tray: false, autoStart: false,
  cookies: 'none', cookieFile: '', followMin: 30,
  splitChapters: false, subsFile: false, liveFromStart: false,
  presets: [], defaultDl: '', defaultCv: '', renameTpl: '{sanatçı} - {başlık}',
  autoUpdate: true, lastEngineCheck: 0, galleryMax: 200
};
let settings = { ...DEFAULTS, ...readJson(settingsFile, {}) };
function applyTheme() { nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system'; }
function applySystem() {
  // Yalnızca değer değiştiyse yaz; imzasız macOS sürümünde gereksiz çağrı sistem hatası günlüğe yazdırır
  try {
    const want = !!settings.autoStart;
    if (app.getLoginItemSettings().openAtLogin !== want) {
      app.setLoginItemSettings(isMac ? { openAtLogin: want, openAsHidden: !!settings.tray } : { openAtLogin: want, args: settings.tray ? ['--hidden'] : [] });
    }
  } catch {}
  if (settings.tray && !tray) {
    try {
      // macOS menü çubuğu simgesi ~18 pt olmalı; 32 px görüntü olduğu gibi kullanılırsa çok büyük görünür
      const trayImg = nativeImage.createFromPath(iconPath(isMac ? 64 : 32));
      tray = new Tray(isMac ? trayImg.resize({ width: 18, height: 18 }) : trayImg);
      tray.setToolTip('Şahin Downloader');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Aç', click: showWin },
        { label: 'Çıkış', click: () => { quitting = true; app.quit(); } }
      ]));
      tray.on('click', showWin);
    } catch {}
  } else if (!settings.tray && tray) { tray.destroy(); tray = null; }
}
function showWin() { if (win) { win.show(); win.focus(); } }
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (e, patch) => {
  settings = { ...settings, ...patch };
  writeJson(settingsFile, settings);
  applyTheme(); applySystem(); scheduleFollows();
  return settings;
});
ipcMain.handle('reset-settings', () => {
  settings = { ...DEFAULTS };
  writeJson(settingsFile, settings);
  applyTheme(); applySystem(); scheduleFollows();
  return settings;
});

function finishNotice(body, folder, wasCancelled) {
  if (wasCancelled) return;
  if (settings.notify && Notification.isSupported()) {
    try { new Notification({ title: 'Şahin Downloader', body, icon: iconPath() }).show(); } catch {}
  }
  if (settings.openDone && folder) shell.openPath(folder);
}

const THEME = {
  dark: { color: '#1c1c1e', symbol: '#c7c7cc' },
  light: { color: '#f5f5f7', symbol: '#3a3a3c' }
};
let chromeColors = null; // arayüz seçilen tasarıma göre pencere/başlık çubuğu rengini bildirir
const themeNow = () => chromeColors || (nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light);
ipcMain.handle('set-chrome', (e, c) => {
  chromeColors = c && c.color ? c : null;
  const n = themeNow();
  try { win.setBackgroundColor(n.color); if (!isMac) win.setTitleBarOverlay({ color: n.color, symbolColor: n.symbol, height: 44 }); } catch {}
});

function createWindow() {
  applyTheme();
  const t = themeNow();
  win = new BrowserWindow({
    width: 1080, height: 780, minWidth: 620, minHeight: 460,
    show: !process.argv.includes('--hidden'),
    backgroundColor: t.color,
    title: 'Şahin Downloader',
    icon: iconPath(),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 16 } } : { titleBarOverlay: { color: t.color, symbolColor: t.symbol, height: 44 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.removeMenu();
  win.loadFile('index.html');
  win.on('close', e => { if (settings.tray && !quitting) { e.preventDefault(); win.hide(); } });
  nativeTheme.on('updated', () => {
    const n = themeNow();
    try { win.setBackgroundColor(n.color); if (!isMac) win.setTitleBarOverlay({ color: n.color, symbolColor: n.symbol, height: 44 }); } catch {}
  });
}

// Windows: görev çubuğu ve bildirimlerde Electron yerine uygulamanın kimliği ve simgesi görünsün
if (isWin) app.setAppUserModelId('com.sahin.downloader');

// macOS: geliştirme modunda da Dock'ta Electron simgesi yerine Şahin simgesi görünsün; menü Türkçe olsun
function setupMac() {
  try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon-mac.png'))); } catch {}
  const name = 'Şahin Downloader';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: name, submenu: [
      { label: name + ' Hakkında', role: 'about' }, { type: 'separator' },
      { label: 'Hizmetler', role: 'services' }, { type: 'separator' },
      { label: name + ' Uygulamasını Gizle', role: 'hide' }, { label: 'Diğerlerini Gizle', role: 'hideOthers' }, { label: 'Tümünü Göster', role: 'unhide' }, { type: 'separator' },
      { label: 'Çıkış', role: 'quit' }
    ] },
    { label: 'Düzen', submenu: [
      { label: 'Geri Al', role: 'undo' }, { label: 'Yinele', role: 'redo' }, { type: 'separator' },
      { label: 'Kes', role: 'cut' }, { label: 'Kopyala', role: 'copy' }, { label: 'Yapıştır', role: 'paste' }, { label: 'Tümünü Seç', role: 'selectAll' }
    ] },
    { label: 'Pencere', submenu: [
      { label: 'Simge Durumuna Küçült', role: 'minimize' }, { label: 'Yakınlaştır', role: 'zoom' }, { label: 'Öne Getir', role: 'front' }
    ] }
  ]));
}

app.whenReady().then(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  if (isMac) setupMac();
  createWindow();
  applySystem();
  startClipboardWatch();
  scheduleFollows();
  setTimeout(() => checkAllFollows(), 30000);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!settings.tray || quitting) app.quit(); });
app.on('activate', () => { if (win && !win.isDestroyed()) showWin(); });

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const defaultFolder = () => {          // eski adla oluşturulmuş indirme klasörü varsa onu kullanmaya devam et
  const v = app.getPath('videos'), nw = path.join(v, 'Şahin Downloader'), old = path.join(v, 'Şahin Doğumlandır');
  return (!fs.existsSync(nw) && fs.existsSync(old)) ? old : nw;
};
const baseFolder = () => settings.folder || defaultFolder();

// ---------- yt-dlp ----------
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'sahin-downloader' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const tmp = dest + '.part';
      const f = fs.createWriteStream(tmp);
      res.pipe(f);
      f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      f.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureYtdlp(force = false) {
  fs.mkdirSync(binDir, { recursive: true });
  if (!force && fs.existsSync(ytdlpPath)) return;
  send('status', 'İndirme motoru yükleniyor...');
  await download(ytdlpUrl, ytdlpPath);
  if (!isWin) fs.chmodSync(ytdlpPath, 0o755);
}

ipcMain.handle('init', async () => {
  try { await ensureYtdlp(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update-ytdlp', async () => {
  try { await ensureYtdlp(true); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
const MEDIA_EXT = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'wmv', 'm4v', 'ts', 'mpg', '3gp', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2', 'gif'];
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Medya', extensions: MEDIA_EXT }, { name: 'Tüm dosyalar', extensions: ['*'] }]
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('pick-audio', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Ses', extensions: ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wav', 'wma', 'mp4'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Resim', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  const mime = /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg';
  return { path: p, dataUrl: `data:${mime};base64,` + fs.readFileSync(p).toString('base64') };
});
ipcMain.handle('pick-cookie-file', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'cookies.txt', extensions: ['txt'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('default-folder', () => defaultFolder());
ipcMain.handle('open-folder', (e, p) => shell.openPath(p));
ipcMain.handle('show-file', (e, p) => { try { shell.showItemInFolder(p); } catch {} });
ipcMain.handle('open-file', (e, p) => shell.openPath(p));

// ---------- Yardımcılar ----------
const safeName = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'dosya';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const UA = 'SahinDownloader/2.0 (desktop app)';

// YouTube'un şifre çözme (n-challenge) adımı için bir JavaScript çalıştırıcısı gerekir
let jsArgsCache = null;
function jsRuntimeArgs() {
  if (jsArgsCache) return jsArgsCache;
  // 1) pakete eklenmiş Node.js  2) sistemde kurulu node  (deno varsa yt-dlp kendisi bulur)
  const nodeName = isWin ? 'node.exe' : 'node';
  const cands = [path.join(process.resourcesPath || '', 'node', nodeName), path.join(__dirname, 'runtime-bundle', process.arch, nodeName)];
  let f = cands.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!f) {
    try {
      const w = require('child_process').spawnSync(isWin ? 'where' : 'which', ['node'], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
      const first = String(w.stdout || '').split(/\r?\n/)[0].trim();
      if (w.status === 0 && first && fs.existsSync(first)) f = first;
    } catch {}
  }
  jsArgsCache = f ? ['--js-runtimes', 'node:' + f] : [];
  return jsArgsCache;
}
const ytCommon = () => [...cookieArgs(), ...jsRuntimeArgs()];

// yt-dlp / ağ hatalarını anlaşılır Türkçe mesajlara çevirir
function friendlyError(msg) {
  const m = String(msg || '');
  const rules = [
    [/instagram.*(login|log in|empty media|rate-limit|restricted|not available|private)|Requested content is not available|instagram.*cookies/i, 'Instagram bu içeriği oturum açmadan vermiyor veya geçici olarak sınırladı. Ayarlar > Hesap erişimi bölümünden bir tarayıcı oturumu (Firefox önerilir) seçip tekrar deneyin.'],
    [/(twitter|tweet|x\.com).*(not found|unavailable|protected|nsfw|age|login|guest|authorization|suspended)|NSFW tweet|protected tweet/i, 'Bu X (Twitter) gönderisi bulunamadı, korumalı ya da yetişkin içerikli olabilir. Giriş yapılmış bir tarayıcı oturumu gerekebilir (Ayarlar > Hesap erişimi).'],
    [/linkedin.*(login|sign in|authwall|unsupported|not available|private)/i, 'LinkedIn bu içeriği oturum olmadan vermiyor veya gönderi herkese açık değil. Ayarlar > Hesap erişimi bölümünden tarayıcı oturumu seçmeyi deneyin.'],
    [/not a bot|confirm your age|age[- ]restricted|inappropriate for some users/i, 'Bu içerik için oturum doğrulaması isteniyor. Ayarlar > Hesap erişimi bölümünden bir tarayıcı oturumu seçin.'],
    [/login required|requires authentication|sign in|members[- ]only|join this channel/i, 'Bu içerik için giriş yapılması gerekiyor. Ayarlar > Hesap erişimi bölümünden tarayıcı oturumunu seçin.'],
    [/cookie database|could not copy .*cookie|failed to decrypt|DPAPI/i, 'Tarayıcı çerezleri okunamadı. Tarayıcıyı kapatıp tekrar deneyin ya da Firefox / cookies.txt seçeneğini kullanın.'],
    [/private video|video unavailable|is unavailable|has been removed|no longer available|not available in your country|blocked it|does not exist|this video is not available|content isn't available/i, 'İçerik kullanılamıyor (silinmiş, özel veya bölgenizde engelli olabilir).'],
    [/HTTP Error 403|403: Forbidden/i, 'Sunucu erişimi reddetti (403). İndirme motorunu güncelleyip tekrar deneyin.'],
    [/HTTP Error 404|404: Not Found|Not Found/i, 'Bağlantı bulunamadı (404). Adresi kontrol edin.'],
    [/HTTP Error 429|Too Many Requests/i, 'Çok fazla istek gönderildi (429). Bir süre bekleyin veya eş zamanlı indirme sayısını azaltın.'],
    [/Unsupported URL/i, 'Bu bağlantı desteklenmiyor.'],
    [/Requested format is not available|no video formats found|format is not available/i, 'İstenen biçim veya çözünürlük bu içerik için mevcut değil. Daha düşük bir çözünürlük deneyin.'],
    [/ffmpeg.*not found|ffprobe and ffmpeg not found/i, 'Dönüştürme bileşeni (ffmpeg) bulunamadı. Uygulamayı yeniden kurun.'],
    [/getaddrinfo|ENOTFOUND|ECONNRESET|ETIMEDOUT|timed out|Unable to download (webpage|JSON)|Connection (refused|reset)|Temporary failure|Network is unreachable|<urlopen error/i, 'İnternet bağlantısı kurulamadı. Bağlantınızı kontrol edip tekrar deneyin.'],
    [/premieres in|live event will begin|this live event/i, 'Canlı yayın veya prömiyer henüz başlamadı.'],
    [/No space left|ENOSPC/i, 'Diskte yeterli boş alan yok.'],
    [/Permission denied|EACCES|EPERM/i, 'Klasöre yazma izni yok. Başka bir indirme klasörü seçin.'],
    [/ENOENT/i, 'Gerekli bir dosya veya klasör bulunamadı.'],
    [/Unable to extract|Unable to find|extractor error|Sign in to confirm/i, 'Site içeriği çözümlenemedi. İndirme motorunu güncelleyip tekrar deneyin.']
  ];
  for (const [re, t] of rules) if (re.test(m)) return t;
  return m.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '').slice(0, 240) || 'Bilinmeyen hata';
}

function cookieArgs() {
  const c = settings.cookies;
  if (c === 'file' && settings.cookieFile && fs.existsSync(settings.cookieFile)) return ['--cookies', settings.cookieFile];
  if (['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'].includes(c)) return ['--cookies-from-browser', c];
  return [];
}

function runCapture(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlpPath, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) return resolve(out);
      const lines = err.trim().split(/\r?\n/).filter(Boolean);
      const e = lines.filter(l => /^ERROR/i.test(l)).pop() || lines.pop() || 'yt-dlp hata ' + code;
      const er = new Error(friendlyError(e)); er.raw = e;
      reject(er);
    });
  });
}

function getText(url, ua) {
  return new Promise((resolve, reject) => {
    (url.startsWith('https') ? https : require('http')).get(url, { headers: { 'User-Agent': ua || 'Mozilla/5.0', 'Accept-Language': 'en' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(getText(new URL(res.headers.location, url).href, ua));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let b = ''; res.setEncoding('utf8');
      res.on('data', d => b += d); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

async function flatList(url, end) {
  const a = ['--flat-playlist', '--dump-single-json', '--no-warnings', '--encoding', 'utf-8', ...ytCommon()];
  if (end) a.push('--playlist-end', String(end));
  a.push(url);
  return JSON.parse(await runCapture(a));
}

function pickThumb(x, pageUrl) {
  const isYT = /youtube\.com|youtu\.be/i.test(pageUrl || '') || /youtube/i.test(x.ie_key || x.extractor_key || '');
  if (isYT && x.id && /^[\w-]{11}$/.test(x.id)) return `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`; // her zaman bulunan orta boy kapak
  const th = (x.thumbnails || []).filter(t => t && t.url);
  const mid = th.find(t => t.width >= 200 && t.width <= 700) || th[th.length - 1];
  return (mid && mid.url) || x.thumbnail || null;
}

function mkItem(x, i, tag, pageUrl) {
  const u = x.webpage_url || x.url || (x.id && /youtube/.test(pageUrl) ? 'https://www.youtube.com/watch?v=' + x.id : null);
  return {
    id: tag + (x.id || i),
    title: x.title || x.id || u,
    url: u && u.startsWith('http') ? u : (x.id ? 'https://www.youtube.com/watch?v=' + x.id : pageUrl),
    duration: x.duration || null,
    thumb: pickThumb(x, pageUrl)
  };
}

// ---------- Spotify (meta veri -> YouTube eşleşmesi) ----------
async function spotifyInfo(url) {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Desteklenmeyen Spotify bağlantısı (şarkı, albüm veya liste olmalı)');
  const [, type, id] = m;
  const html = await getText(`https://open.spotify.com/embed/${type}/${id}`);
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) throw new Error('Spotify sayfası okunamadı');
  const data = JSON.parse(nd[1]);
  const ent = data?.props?.pageProps?.state?.data?.entity;
  if (!ent) throw new Error('Spotify verisi bulunamadı');
  const cover = ent.coverArt?.sources?.[0]?.url || null;
  const list = ent.trackList || [{ title: ent.title || ent.name, subtitle: (ent.artists || []).map(a => a.name).join(', ') || ent.subtitle, duration: ent.duration, uri: ent.uri }];
  const album = type === 'album' ? (ent.title || ent.name) : '';
  const items = list.map((t, i) => {
    const label = `${t.subtitle || ''} - ${t.title}`.replace(/^ - /, '');
    const tid = t.uri ? String(t.uri).split(':').pop() : null;
    return {
      id: 'sp-' + id + '-' + i,
      title: label,
      url: `ytsearch1:${label} audio`,
      srcUrl: tid ? 'https://open.spotify.com/track/' + tid : url,
      outName: safeName(label),
      duration: t.duration ? Math.round(t.duration / 1000) : null,
      thumb: cover,
      spotify: true,
      meta: { title: t.title, artist: t.subtitle || '', album }
    };
  });
  return { title: ent.title || ent.name || 'Spotify', playlist: type !== 'track', items, source: 'Spotify' };
}

const DIRECT_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|tiff?|avif|heic|ico|pdf|zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|dmg|apk|deb|docx?|xlsx?|pptx?|odt|txt|csv|epub|mobi|torrent|mp3|wav|flac|ogg|m4a|aac|opus|mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts)$/i;
function isDirectFile(u) {
  try { const x = new URL(u); return !/(youtube\.com|youtu\.be|spotify\.com)$/i.test(x.hostname) && DIRECT_EXT.test(decodeURIComponent(x.pathname)); } catch { return false; }
}

// ---------- Galeri motoru (gallery-dl): Instagram, Pinterest, Reddit, X, Flickr, Imgur, DeviantArt vb. fotoğraf paylaşım siteleri ----------
const galleryPath = path.join(binDir, isWin ? 'gallery-dl.exe' : 'gallery-dl');
// Hazır gallery-dl dosyaları artık gdl-org/builds deposunda yayınlanıyor
const galleryUrl = 'https://github.com/gdl-org/builds/releases/latest/download/' + (isWin ? 'gallery-dl_windows.exe' : isMac ? 'gallery-dl_macos' : 'gallery-dl_linux');
async function ensureGallery() {
  if (fs.existsSync(galleryPath)) return;
  fs.mkdirSync(binDir, { recursive: true });
  send('status', 'Galeri motoru yükleniyor...');
  await download(galleryUrl, galleryPath);
  if (!isWin) fs.chmodSync(galleryPath, 0o755);
  send('status', 'Hazır');
}
function galleryCookieArgs() {
  const c = settings.cookies;
  if (c === 'file' && settings.cookieFile && fs.existsSync(settings.cookieFile)) return ['--cookies', settings.cookieFile];
  if (['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'].includes(c)) return ['--cookies-from-browser', c];
  return [];
}
function runGallery(args, onLine, reg) {
  return new Promise(resolve => {
    const p = spawn(galleryPath, args, { windowsHide: true });
    if (reg) reg(p);
    let out = '', err = '', buf = '';
    p.stdout.on('data', d => { out += d; buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); if (onLine) parts.forEach(onLine); });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, out, err: e.message }));
    p.on('close', code => resolve({ code, out, err }));
  });
}
const galleryErr = (s, url) => {
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const l0 = (String(s).split(/\r?\n/).map(x => x.trim()).filter(x => /error/i.test(x)).pop() || '').replace(/^\[[^\]]+\]\[error\]\s*/i, '');
  if (/login|auth|cookie|private|401|403/i.test(l0)) return 'Bu galeri için giriş gerekiyor. Ayarlar > Hesap erişimi bölümünden bir tarayıcı oturumu seçin.';
  if (/NotFound|404|does not exist/i.test(l0)) return 'Galeri bulunamadı. Bağlantıyı kontrol edin.';
  if (/429|rate/i.test(l0)) return 'Çok fazla istek gönderildi. Bir süre bekleyin.';
  // platform adını başa ekle: X, Instagram, LinkedIn için özel Türkçe yönlendirmeler eşleşsin
  const withHost = friendlyError(`${host} ${l0}`);
  return withHost === `${host} ${l0}` ? (friendlyError(l0 || 'Galeri indirilemedi')) : withHost;
};
async function galleryProbe(url) {
  await ensureGallery();
  const r = await runGallery(['-g', '--range', '1-3', ...galleryCookieArgs(), url]);
  const urls = r.out.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:/i.test(s) || /^ytdl:/i.test(s));
  if (r.code === 0 && urls.length) return { ok: true, thumb: /^https?:.*\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(urls[0]) ? urls[0] : null };
  return { ok: false, error: galleryErr(r.err, url) };
}
async function galleryDownload(item, opts) {
  try { await ensureGallery(); } catch (e) { return { ok: false, error: friendlyError(e.message) }; }
  let host = 'galeri'; try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const sub = path.join(opts.folder, 'Galeri', safeName(host));
  fs.mkdirSync(sub, { recursive: true });
  let n = 0, last = '';
  const maxN = +settings.galleryMax;
  const r = await runGallery(['-D', sub, ...(maxN > 0 ? ['--range', `1-${maxN}`] : []), ...galleryCookieArgs(), item.url], line => {
    line = line.trim(); if (!line || line.startsWith('[')) return;
    n++; last = line.replace(/^#\s*/, '');
    send('progress', { id: item.id, percent: 0, state: 'downloading', note: n + ' dosya indirildi' });
  }, p => { p._scope = 'download'; jobs.set(item.id, p); });
  jobs.delete(item.id);
  if (n > 0) return { ok: true, file: last, count: n };
  return { ok: false, error: cancelled ? 'İptal edildi' : galleryErr(r.err, item.url) || 'İndirilecek görsel bulunamadı.' };
}

// Sayfanın HTML'inden video kaynağı çıkarır; bulursa indirilebilir öğe döndürür
async function scrapeVideo(url, tag) {
  const html = await getText(url, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  const r = lib.extractVideoSources(html, url);
  if (!r.sources.length) return null;
  const src = r.sources[0];
  const host = new URL(url).hostname.replace(/^www\./, '');
  const nice = (r.title || host).replace(/\s+on LinkedIn:?/i, ' · LinkedIn').slice(0, 120);
  const item = { id: tag + uid(), title: nice, url: src.url, duration: null, thumb: r.thumb || null, srcUrl: url };
  if (src.kind === 'hls') { item.outName = safeName(nice); }                       // yt-dlp m3u8'i indirir
  else { item.direct = true; item.fileName = safeName(nice) + (src.kind === 'webm' ? '.webm' : '.mp4'); }
  return { ok: true, playlist: false, title: nice, source: host.includes('linkedin') ? 'LinkedIn' : 'Sayfa videosu', items: [item] };
}

ipcMain.handle('fetch-info', async (e, { url, tag }) => {
  try {
    if (/open\.spotify\.com/i.test(url)) {
      const r = await spotifyInfo(url);
      r.items.forEach(i => { i.id = tag + i.id; });
      return { ok: true, ...r };
    }
    if (isDirectFile(url)) {
      const name = decodeURIComponent(path.basename(new URL(url).pathname));
      return { ok: true, playlist: false, title: name, source: 'Dosya bağlantısı', items: [{ id: tag + uid(), title: name, url, direct: true, duration: null, thumb: /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name) ? url : null }] };
    }
    const j = await flatList(url);
    if (j._type === 'playlist') {
      return { ok: true, playlist: true, title: j.title, items: (j.entries || []).filter(Boolean).map((x, i) => mkItem(x, i, tag, url)), source: j.extractor_key || '' };
    }
    return { ok: true, playlist: false, title: j.title, items: [mkItem(j, 0, tag, url)], source: j.extractor_key || '' };
  } catch (err) {
    const raw = err.raw || err.message;
    const noVideo = /Unsupported URL|no video|There is no video|No video could be found|no video formats|does not contain a video|No media|no suitable/i.test(raw);
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    if (noVideo || /linkedin\.com$/i.test(host)) {
      // 1) Sayfadan doğrudan video kaynağı çıkar (LinkedIn gönderileri ve yt-dlp'nin tanımadığı sayfalar)
      try {
        const sc = await scrapeVideo(url, tag);
        if (sc) return sc;
      } catch {}
      // 2) Fotoğraf galerisi olarak dene (Instagram/Pinterest/X fotoğrafları vb.)
      if (noVideo) {
        try {
          const g = await galleryProbe(url);
          if (g.ok) {
            const last = decodeURIComponent((new URL(url).pathname.split('/').filter(Boolean).pop()) || host);
            return { ok: true, playlist: false, title: `Fotoğraf galerisi · ${last}`, source: 'Fotoğraf galerisi', items: [{ id: tag + uid(), title: `Fotoğraf galerisi · ${last} (${host})`, url, gallery: true, duration: null, thumb: g.thumb }] };
          }
          return { ok: false, error: g.error };
        } catch (ge) { return { ok: false, error: friendlyError(ge.message) }; }
      }
    }
    return { ok: false, error: friendlyError(err.message) };
  }
});

// ---------- Doğrudan dosya indirme (resim, belge, arşiv vb.) ----------
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'application/zip': '.zip', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4' };
function downloadDirect(item, folder, id) {
  return new Promise(resolve => {
    let settled = false, currentReq = null;
    const finish = r => { if (!settled) { settled = true; resolve(r); } };
    const handle = { _scope: 'download', abort() { try { currentReq && currentReq.destroy(); } catch {} finish({ ok: false, error: 'İptal edildi' }); } };
    jobs.set(id, handle);
    const done = r => { jobs.delete(id); finish(r); };
    const go = (url, redirects = 0) => {
      const mod = url.startsWith('https') ? https : require('http');
      currentReq = mod.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) { res.resume(); return go(new URL(res.headers.location, url).href, redirects + 1); }
        if (res.statusCode !== 200) { res.resume(); return done({ ok: false, error: friendlyError('HTTP Error ' + res.statusCode) }); }
        const total = +res.headers['content-length'] || 0;
        let name = '';
        const cd = res.headers['content-disposition'] || '';
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
        if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
        if (!name) { try { name = decodeURIComponent(path.basename(new URL(url).pathname)); } catch { name = ''; } }
        if (item.fileName) name = item.fileName;
        name = safeName(name || 'dosya');
        if (!path.extname(name)) name += MIME_EXT[(res.headers['content-type'] || '').split(';')[0].trim()] || '';
        fs.mkdirSync(folder, { recursive: true });
        const dest = uniquePath(path.join(folder, name)), tmp = dest + '.part';
        const f = fs.createWriteStream(tmp);
        let got = 0, last = 0; const t0 = Date.now();
        res.on('data', d => {
          got += d.length;
          const now = Date.now();
          if (now - last > 250) {
            last = now;
            const sp = got / Math.max(1, (now - t0) / 1000);
            const eta = total && sp ? Math.round((total - got) / sp) : 0;
            send('progress', { id, percent: total ? (got / total) * 100 : 0, speed: (sp / 1048576).toFixed(2) + ' MB/sn', eta: eta ? eta + ' sn' : '', state: 'downloading' });
          }
        });
        res.on('error', e => { f.destroy(); try { fs.unlinkSync(tmp); } catch {} done({ ok: false, error: friendlyError(e.message) }); });
        res.pipe(f);
        f.on('finish', () => f.close(() => { try { fs.renameSync(tmp, dest); done({ ok: true, file: dest }); } catch (e) { done({ ok: false, error: friendlyError(e.message) }); } }));
        f.on('error', e => done({ ok: false, error: friendlyError(e.message) }));
        handle.abort = () => { try { currentReq.destroy(); f.destroy(); fs.unlinkSync(tmp); } catch {} done({ ok: false, error: 'İptal edildi' }); };
      });
      currentReq.on('error', e => done({ ok: false, error: friendlyError(e.message) }));
      currentReq.setTimeout(30000, () => currentReq.destroy(new Error('timed out')));
    };
    go(item.url);
  });
}

// ---------- Görsel arama (Wikimedia Commons + Openverse; açık lisanslı görseller) ----------
ipcMain.handle('image-search', async (e, { q, source, page }) => {
  try {
    page = page || 0;
    if (source === 'openverse') {
      const ovUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&page=${page + 1}&mature=false`;
      let txt;
      try { txt = await getText(ovUrl, UA); } catch { await new Promise(r => setTimeout(r, 1200)); txt = await getText(ovUrl, UA); } // geçici 5xx için bir kez yeniden dene
      const j = JSON.parse(txt);
      const items = (j.results || []).map(r => ({
        id: 'ov-' + r.id, title: r.title || 'Görsel', thumb: r.thumbnail || r.url, url: r.url, width: r.width || 0, height: r.height || 0,
        license: ((r.license || '') + (r.license_version ? ' ' + r.license_version : '')).toUpperCase(), creator: r.creator || '', landing: r.foreign_landing_url || ''
      }));
      return { ok: true, items, more: (j.page_count || 0) > page + 1 };
    }
    const off = page * 40;
    const j = JSON.parse(await getText(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&gsrnamespace=6&gsrlimit=40&gsroffset=${off}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=360&format=json`, UA));
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
    const strip = s => String(s || '').replace(/<[^>]*>/g, '').trim();
    const items = pages.filter(p => p.imageinfo && p.imageinfo[0]).map(p => {
      const i = p.imageinfo[0], md = i.extmetadata || {};
      return {
        id: 'wm-' + p.pageid, title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), thumb: i.thumburl || i.url, url: i.url, width: i.width, height: i.height,
        license: strip(md.LicenseShortName && md.LicenseShortName.value), creator: strip(md.Artist && md.Artist.value), landing: i.descriptionurl || ''
      };
    });
    return { ok: true, items, more: !!(j.continue && j.continue.gsroffset) };
  } catch (err) { return { ok: false, error: friendlyError(err.message) }; }
});

// ---------- Geçmiş ----------
const historyFile = path.join(userData, 'history.json');
let history = readJson(historyFile, []);
function addHistory(entry) {
  history.unshift({ id: uid(), date: Date.now(), ...entry });
  history = history.slice(0, 500);
  writeJson(historyFile, history);
  send('history-updated');
}
ipcMain.handle('history-list', () => history.map(h => ({ ...h, exists: h.file ? fs.existsSync(h.file) : false })));
ipcMain.handle('history-remove', (e, id) => { history = history.filter(h => h.id !== id); writeJson(historyFile, history); });
ipcMain.handle('history-clear', () => { history = []; writeJson(historyFile, history); });

// ---------- İndirme ----------
async function applySpotifyTags(file, item) {
  const m = item.meta || {};
  const tags = {};
  if (m.title) tags.title = m.title;
  if (m.artist) { tags.artist = m.artist; tags.album_artist = m.artist; }
  if (m.album) tags.album = m.album;
  let coverPath = null;
  if (item.thumb) {
    coverPath = path.join(tmpDir, 'cv-' + uid() + '.jpg');
    try { await download(item.thumb, coverPath); } catch { coverPath = null; }
  }
  try {
    await lib.writeTags(file, tags, coverPath ? { mode: 'new', path: coverPath } : { mode: 'keep' });
  } catch {
    try { await lib.writeTags(file, tags, { mode: 'keep' }); } catch {}
  }
  if (coverPath) { try { fs.unlinkSync(coverPath); } catch {} }
}

async function downloadOne(item, opts, index) {
  if (item.direct) {
    const sub = item.imageSearch ? path.join(opts.folder, 'Görseller') : opts.folder;
    return downloadDirect(item, sub, item.id);
  }
  if (item.gallery) return galleryDownload(item, opts);
  const audio = opts.mode === 'audio';
  const subsOnly = opts.mode === 'subs';
  const isYTM = /music\.youtube\.com/i.test(item.url || '');
  const folderTmpl = opts.numbered ? path.join(opts.folder, '%(playlist_title,)s') : opts.folder;
  const base = item.outName ? item.outName
    : (isYTM && audio ? '%(artist,uploader)s - %(track,title)s'
      : (opts.nameTpl === 'uploader-title' ? '%(uploader,channel)s - %(title)s' : '%(title)s'));
  const prefix = opts.numbered ? String(index).padStart(3, '0') + ' - ' : '';
  const tmpl = path.join(opts.numbered && !item.spotify ? folderTmpl : opts.folder, prefix + base + '.%(ext)s');
  const pathFile = path.join(tmpDir, 'p-' + uid() + '.txt');
  const args = ['--ffmpeg-location', ffmpegPath(), '--no-playlist', '--newline', '--no-warnings', '--windows-filenames', '--encoding', 'utf-8',
    '--progress-template', 'download:PRG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s', '-o', tmpl,
    '--print-to-file', 'after_move:filepath', pathFile, ...ytCommon()];
  if (opts.rate) args.push('--limit-rate', String(opts.rate));
  if (opts.ss != null || opts.to != null) {
    args.push('--download-sections', `*${opts.ss != null ? opts.ss : 0}-${opts.to != null ? opts.to : 'inf'}`, '--force-keyframes-at-cuts');
  }
  const afmt = opts.afmt || 'mp3', vfmt = opts.vfmt || 'mp4';
  if (opts.liveFromStart && !subsOnly) args.push('--live-from-start', '--wait-for-video', '30');
  if (opts.splitChapters && !subsOnly) {
    args.push('--split-chapters', '-o', 'chapter:' + path.join(opts.folder, '%(title)s - bölümler', '%(section_number)03d - %(section_title)s.%(ext)s'));
  }
  if (subsOnly) {
    args.push('--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', opts.subLang || 'tr,en', '--convert-subs', 'srt');
  } else if (audio) {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', afmt === 'ogg' ? 'vorbis' : afmt, '--embed-metadata');
    if (['mp3', 'm4a', 'aac', 'opus', 'ogg'].includes(afmt)) args.push('--audio-quality', (opts.abr || 320) + 'K');
    if (opts.embedThumb && ['mp3', 'm4a', 'flac', 'opus', 'ogg'].includes(afmt)) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
  } else {
    const h = opts.quality === 'best' ? '' : `[height<=${opts.quality}]`;
    let fsel;
    if (vfmt === 'mp4') fsel = `bestvideo${h}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${h}+bestaudio/best${h}`;
    else if (vfmt === 'webm') fsel = `bestvideo${h}[ext=webm]+bestaudio[ext=webm]/bestvideo${h}+bestaudio/best${h}`;
    else fsel = `bestvideo${h}+bestaudio/best${h}`;
    args.push('-f', fsel, '--merge-output-format', vfmt, '--embed-metadata');
    if (opts.embedThumb && vfmt !== 'webm') args.push('--embed-thumbnail');
    if (opts.subs) args.push('--write-subs', '--write-auto-subs', '--sub-langs', opts.subLang || 'tr,en', '--embed-subs');
    else if (opts.subsFile) args.push('--write-subs', '--write-auto-subs', '--sub-langs', opts.subLang || 'tr,en', '--convert-subs', 'srt');
  }
  args.push(item.url);
  let sawSubs = false;

  const r = await new Promise(resolve => {
    const p = spawn(ytdlpPath, args, { windowsHide: true });
    p._scope = 'download';
    jobs.set(item.id, p);
    let errLine = '', warnLine = '', buf = '';
    const onLine = line => {
      line = line.trim();
      if (line.startsWith('PRG|')) {
        const [, pct, speed, eta] = line.split('|');
        send('progress', { id: item.id, percent: parseFloat(pct) || 0, speed: speed.trim(), eta: eta.trim(), state: 'downloading' });
      } else if (/\[Merger\]|\[ExtractAudio\]|\[VideoConvertor\]|\[EmbedThumbnail\]|\[SplitChapters\]/.test(line)) {
        send('progress', { id: item.id, percent: 100, state: 'processing' });
      }
      if (/Writing video subtitles|\[info\] Writing|SubtitlesConvertor|Converting subtitles/.test(line) && /subtitle/i.test(line)) sawSubs = true;
    };
    p.stdout.on('data', d => { buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop(); parts.forEach(onLine); });
    p.stderr.on('data', d => {
      for (const l of d.toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        if (/^ERROR/i.test(l)) errLine = l; else warnLine = l;
      }
    });
    p.on('error', err => { jobs.delete(item.id); resolve({ code: -1, lastErr: err.message }); });
    p.on('close', code => { jobs.delete(item.id); resolve({ code, lastErr: errLine || warnLine }); });
  });
  if (r.code !== 0) { try { fs.unlinkSync(pathFile); } catch {} return { ok: false, error: cancelled ? 'İptal edildi' : friendlyError(r.lastErr || 'Hata ' + r.code) }; }

  let file = '';
  try { file = fs.readFileSync(pathFile, 'utf8').trim().split(/\r?\n/).pop(); fs.unlinkSync(pathFile); } catch {}
  if (subsOnly) {
    if (!sawSubs) return { ok: false, error: 'Bu içerik için altyazı bulunamadı (seçili dillerde altyazı yok).' };
    return { ok: true, file: '' };
  }
  if (audio && file && fs.existsSync(file)) {
    const af = lib.afChain({ normalize: opts.normalize, trim: opts.trimSilence });
    if (af) {
      send('progress', { id: item.id, percent: 100, state: 'processing' });
      try { await lib.filterAudio(file, af, +opts.abr || 320); } catch {}
    }
    if (item.spotify && item.meta) { try { await applySpotifyTags(file, item); } catch {} }
  }
  return { ok: true, file };
}

// Kuyruk: indirme sürerken yeni öğeler eklenebilir; aynı anda en çok `conc` indirme çalışır
const queue = [];
const itemStore = new Map();   // id -> { item, opts, index }  (duraklatılanı devam ettirmek için)
const pausing = new Set();     // kullanıcı tarafından duraklatılan çalışan işler
let qPaused = false;
let running = 0, qDone = 0, qTotal = 0, qConc = 2, qFolder = '';

function fmtOf(opts, item) {
  if (item.gallery) return 'galeri';
  if (item.direct) return (path.extname(item.title || '').slice(1) || 'dosya').toLowerCase();
  return opts.mode === 'audio' ? (opts.afmt || 'mp3') : opts.mode === 'subs' ? 'srt' : (opts.vfmt || 'mp4');
}

function pump() {
  while (!cancelled && !qPaused && running < qConc && queue.length) {
    const { item, opts, index } = queue.shift();
    running++;
    send('progress', { id: item.id, percent: 0, state: 'downloading' });
    downloadOne(item, opts, index).then(r => {
      running--;
      if (pausing.has(item.id)) {                       // kullanıcı duraklattı: tamamlanmış sayılmaz
        pausing.delete(item.id); qTotal = Math.max(0, qTotal - 1);
        send('progress', { id: item.id, percent: 0, state: 'paused' });
        send('overall', { done: qDone, total: qTotal, running, scope: 'download' });
        pump(); return;
      }
      qDone++;
      send('progress', { id: item.id, percent: r.ok ? 100 : 0, state: r.ok ? 'done' : 'error', error: r.error, file: r.file || '', count: r.count });
      if (r.ok) {
        addHistory({
          kind: 'download', title: item.title, url: item.srcUrl || item.url, mode: item.gallery || item.direct ? 'file' : opts.mode,
          fmt: fmtOf(opts, item), file: r.file || '', folder: item.gallery ? path.dirname(r.file || opts.folder) : opts.folder
        });
      }
      itemStore.delete(item.id);
      send('overall', { done: qDone, total: qTotal, running, scope: 'download' });
      pump();
    });
  }
  if (running === 0 && (cancelled || (queue.length === 0 && !qPaused)) && qTotal > 0) {
    const wasCancelled = cancelled;
    send('finished', { cancelled: wasCancelled, scope: 'download' });
    finishNotice(`${qDone} indirme tamamlandı`, qFolder, wasCancelled);
    qTotal = 0; qDone = 0; cancelled = false;
  }
}

function enqueueItems(items, opts) {
  if (running === 0 && queue.length === 0) { cancelled = false; qDone = 0; qTotal = 0; }
  try { fs.mkdirSync(opts.folder, { recursive: true }); } catch {}
  qFolder = opts.folder;
  qConc = Math.max(1, Math.min(8, opts.concurrency || 2));
  items.forEach((item, i) => {
    const entry = { item, opts, index: item.index || i + 1 };
    queue.push(entry); itemStore.set(item.id, entry);
    qTotal++;
    send('progress', { id: item.id, percent: 0, state: 'queued' });
  });
  send('overall', { done: qDone, total: qTotal, running, scope: 'download' });
  pump();
}

ipcMain.handle('start-download', (e, { items, opts }) => { enqueueItems(items, opts); return { ok: true }; });

// ---- Kuyruk yönetimi ----
ipcMain.handle('queue-pause', (e, on) => {
  qPaused = !!on; send('queue-state', { paused: qPaused });
  if (!qPaused) pump();
  return qPaused;
});
ipcMain.handle('queue-conc', (e, n) => { qConc = Math.max(1, Math.min(8, +n || 2)); pump(); });
ipcMain.handle('queue-reorder', (e, ids) => {
  const rank = new Map(ids.map((id, i) => [id, i]));
  queue.sort((a, b) => (rank.has(a.item.id) ? rank.get(a.item.id) : 1e9) - (rank.has(b.item.id) ? rank.get(b.item.id) : 1e9));
});
ipcMain.handle('item-remove', (e, id) => {                // sıradaki veya duraklatılmış öğe
  const i = queue.findIndex(q => q.item.id === id);
  if (i < 0) { itemStore.delete(id); return false; }
  queue.splice(i, 1); itemStore.delete(id); qTotal = Math.max(0, qTotal - 1);
  send('overall', { done: qDone, total: qTotal, running, scope: 'download' });
  pump(); return true;
});
ipcMain.handle('item-pause', (e, id) => {
  const i = queue.findIndex(q => q.item.id === id);
  if (i >= 0) { queue.splice(i, 1); qTotal = Math.max(0, qTotal - 1); send('progress', { id, percent: 0, state: 'paused' }); send('overall', { done: qDone, total: qTotal, running, scope: 'download' }); return true; }
  const p = jobs.get(id);
  if (p) { pausing.add(id); killJob(p); return true; }      // yt-dlp kısmi dosyadan devam edebilir
  return false;
});
ipcMain.handle('item-resume', (e, id) => {
  const entry = itemStore.get(id);
  if (!entry) return false;
  qTotal++; queue.push(entry);
  send('progress', { id, percent: 0, state: 'queued' });
  send('overall', { done: qDone, total: qTotal, running, scope: 'download' });
  pump(); return true;
});

// ---------- Dönüştürücü ----------
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 999; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

async function convertOne(file, id, fmt, folder, o) {
  const out = uniquePath(path.join(folder, path.parse(file).name + '.' + fmt));
  const spec = lib.convArgs(fmt, o.quality, o.res);
  if (!spec) return { ok: false, error: 'Desteklenmeyen biçim: ' + fmt };
  const fileDur = await lib.probeDuration(file);
  const start = o.ss || 0;
  const end = o.to && (!fileDur || o.to < fileDur) ? o.to : fileDur;
  const eff = Math.max(0.5, (end || 0) - start);
  const pre = [];
  if (o.ss) pre.push('-ss', String(o.ss));
  if (o.to) pre.push('-to', String(o.to));
  const af = lib.afChain({ normalize: o.normalize, trim: o.trimSilence });
  const onPct = pct => send('progress', { id, percent: pct, state: 'downloading', speed: '', eta: '' });
  const reg = p => { p._scope = 'convert'; jobs.set(id, p); };
  let r;
  if (o.mb) {
    r = await lib.compressTo(file, out, { fmt, mb: +o.mb, dur: eff, res: o.res, pre, af }, onPct, reg, () => cvCancelled);
  } else {
    const s2 = af && fmt !== 'gif' ? [...spec, '-af', af] : spec;
    r = await lib.runProgress(['-y', '-hide_banner', ...pre, '-i', file, ...s2, out], eff, onPct, reg);
  }
  jobs.delete(id);
  if (r.code === 0) return { ok: true, out };
  try { fs.unlinkSync(out); } catch {}
  return { ok: false, error: cvCancelled ? 'İptal edildi' : (r.lastErr || 'ffmpeg hata ' + r.code) };
}

ipcMain.handle('start-convert', async (e, { files, format, folder, quality, res, ss, to, mb, normalize, trimSilence }) => {
  cvCancelled = false;
  fs.mkdirSync(folder, { recursive: true });
  let done = 0;
  for (const f of files) {
    if (cvCancelled) break;
    send('progress', { id: f.id, percent: 0, state: 'downloading' });
    const r = await convertOne(f.path, f.id, format, folder, { quality, res, ss, to, mb, normalize, trimSilence });
    done++;
    send('progress', { id: f.id, percent: r.ok ? 100 : 0, state: r.ok ? 'done' : 'error', error: r.error, out: r.out });
    send('overall', { done, total: files.length, scope: 'convert' });
    if (r.ok) addHistory({ kind: 'convert', title: path.basename(f.path), fmt: format, file: r.out, folder, mode: lib.AUDIO_FMT.includes(format) ? 'audio' : 'video' });
  }
  send('finished', { cancelled: cvCancelled, scope: 'convert' });
  finishNotice(`${done} dosya işlendi`, folder, cvCancelled);
  return { ok: true };
});

function killJob(p) {
  if (typeof p.abort === 'function') { try { p.abort(); } catch {} return; }
  try { if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGKILL'); } catch {}
}

ipcMain.handle('cancel', (e, scope) => {
  if (scope === 'convert') cvCancelled = true; else cancelled = true;
  if (scope !== 'convert') {
    while (queue.length) { const q = queue.shift(); send('progress', { id: q.item.id, percent: 0, state: 'error', error: 'İptal edildi' }); qDone++; }
  }
  for (const p of jobs.values()) if ((p._scope || 'download') === (scope || 'download')) killJob(p);
  if (scope !== 'convert') pump();
});

// ---------- Etiket düzenleyici ----------
ipcMain.handle('tags-read', async (e, file) => {
  try {
    const tags = await lib.readTags(file);
    const cover = await lib.extractCover(file);
    const ext = path.extname(file).toLowerCase();
    return { ok: true, tags, cover, coverOk: lib.COVER_EXT.includes(ext), name: path.basename(file) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('tags-write', async (e, { file, tags, coverMode, coverPath }) => {
  try { await lib.writeTags(file, tags, { mode: coverMode || 'keep', path: coverPath }); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// ---------- Panodan yakalama ----------
function startClipboardWatch() {
  let last = '';
  try { last = clipboard.readText().trim(); } catch {}
  setInterval(() => {
    if (!settings.clipWatch || !win || win.isDestroyed() || !win.isVisible()) return;
    let t = '';
    try { t = clipboard.readText().trim(); } catch { return; }
    if (t === last) return;
    last = t;
    if (t.length < 500 && /^https?:\/\/[^\s]+$/i.test(t) && !/^https?:\/\/(localhost|127\.|192\.168\.)/i.test(t)) send('clip-link', t);
  }, 1200);
}

// ---------- Kanal / profil takibi ----------
const followsFile = path.join(userData, 'follows.json');
let follows = readJson(followsFile, []);
let followTimer = null, checking = false;
const saveFollows = () => { writeJson(followsFile, follows); send('follows-updated'); };

function normalizeFollowUrl(url) {
  if (/^https?:\/\/(www\.|m\.)?youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)\/?$/i.test(url)) return url.replace(/\/?$/, '/videos');
  return url;
}
function buildOpts(mode, folder) {
  return {
    folder, mode, vfmt: settings.vfmt, quality: settings.quality, afmt: settings.afmt, abr: +settings.abr,
    concurrency: settings.conc, numbered: false, nameTpl: settings.nameTpl, subs: settings.subs, subLang: settings.subLang,
    embedThumb: settings.embedThumb, rate: settings.rate, normalize: settings.normalize, trimSilence: settings.trimSilence
  };
}

async function checkFollow(f) {
  try {
    const j = await flatList(f.url, 15);
    const entries = (j.entries || []).filter(x => x && x.id);
    const fresh = entries.filter(x => !f.seen.includes(x.id));
    f.lastCheck = Date.now(); f.lastError = '';
    if (fresh.length) {
      const tag = 'fw' + uid() + '-';
      const items = fresh.reverse().map((x, i) => mkItem(x, i, tag, f.url));
      const folder = path.join(baseFolder(), 'Takip', safeName(f.name));
      enqueueItems(items, buildOpts(f.mode, folder));
      send('auto-added', items.map(i => ({ ...i, source: f.name, sel: false, status: 'queued', percent: 0 })));
      f.seen = [...fresh.map(x => x.id), ...f.seen].slice(0, 500);
      f.count = (f.count || 0) + fresh.length;
      if (settings.notify && Notification.isSupported()) {
        try { new Notification({ title: 'Yeni içerik: ' + f.name, body: `${items.length} yeni video kuyruğa eklendi`, icon: iconPath() }).show(); } catch {}
      }
    }
  } catch (err) { f.lastError = friendlyError(err.message); f.lastCheck = Date.now(); }
}
async function checkAllFollows(onlyId) {
  if (checking || !fs.existsSync(ytdlpPath)) return;
  checking = true; send('follows-checking', true);
  try { for (const f of follows) if (!onlyId || f.id === onlyId) await checkFollow(f); }
  finally { checking = false; saveFollows(); send('follows-checking', false); }
}
function scheduleFollows() {
  if (followTimer) clearInterval(followTimer);
  followTimer = null;
  if (+settings.followMin > 0) followTimer = setInterval(() => checkAllFollows(), Math.max(5, +settings.followMin) * 60000);
}
ipcMain.handle('follow-list', () => follows);
ipcMain.handle('follow-add', async (e, { url, mode }) => {
  try {
    const u = normalizeFollowUrl(url.trim());
    if (follows.some(f => f.url === u)) return { ok: false, error: 'Bu kaynak zaten takipte' };
    const j = await flatList(u, 30);
    const entries = (j.entries || []).filter(x => x && x.id);
    if (!entries.length && j._type !== 'playlist') return { ok: false, error: 'Bu bağlantı bir kanal veya liste değil' };
    follows.push({ id: uid(), url: u, name: j.title || j.uploader || u, mode: mode || 'video', added: Date.now(), lastCheck: Date.now(), seen: entries.map(x => x.id), count: 0, lastError: '' });
    saveFollows();
    return { ok: true };
  } catch (err) { return { ok: false, error: friendlyError(err.message) }; }
});
ipcMain.handle('follow-remove', (e, id) => { follows = follows.filter(f => f.id !== id); saveFollows(); });
ipcMain.handle('follow-mode', (e, { id, mode }) => { const f = follows.find(x => x.id === id); if (f) { f.mode = mode; saveFollows(); } });
ipcMain.handle('follow-check', (e, id) => { checkAllFollows(id || undefined); });

// ---------- Bilgisayarı kapatma ----------
ipcMain.handle('shutdown-start', () => {
  if (!isWin) return false;
  spawn('shutdown', ['/s', '/t', '60', '/c', 'Şahin Downloader: işlemler bitti, bilgisayar kapanacak'], { windowsHide: true });
  return true;
});
ipcMain.handle('shutdown-abort', () => { if (isWin) spawn('shutdown', ['/a'], { windowsHide: true }); });

// ---------- Toplu yeniden adlandırma ----------
ipcMain.handle('rename-files', (e, pairs) => {
  const out = [];
  for (const { from, to } of pairs) {
    try {
      if (from === to) { out.push({ from, to, ok: true }); continue; }
      const sameIgnoringCase = from.toLowerCase() === to.toLowerCase();
      if (fs.existsSync(to) && !sameIgnoringCase) { out.push({ from, to, ok: false, error: 'Aynı adlı bir dosya zaten var' }); continue; }
      fs.renameSync(from, to);
      out.push({ from, to, ok: true });
    } catch (err) { out.push({ from, to, ok: false, error: friendlyError(err.message) }); }
  }
  return out;
});
ipcMain.handle('pick-rename-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Tüm dosyalar', extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('tags-bulk', async (e, files) => {
  const res = {};
  for (const f of files) {
    if (!/\.(mp3|m4a|flac|ogg|opus|aac|wav|wma|mp4|mkv|webm|mov|avi)$/i.test(f)) { res[f] = null; continue; }
    try { res[f] = await lib.readTags(f); } catch { res[f] = null; }
  }
  return res;
});
ipcMain.handle('buildname', (e, { tpl, v, opts }) => lib.buildName(tpl, v, opts));

// ---------- Önizleme / dış bağlantı ----------
ipcMain.handle('open-external', (e, u) => { if (/^https?:\/\//i.test(String(u))) shell.openExternal(u); });

// ---------- Ön ayarları dışa / içe aktarma ----------
ipcMain.handle('preset-export', async (e, list) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'sahin-on-ayarlar.json', filters: [{ name: 'Ön ayar dosyası', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  writeJson(r.filePath, { app: 'sahin-downloader', version: 1, presets: list });
  return { ok: true, file: r.filePath };
});
ipcMain.handle('preset-import', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ön ayar dosyası', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const j = readJson(r.filePaths[0], null);
  if (!j || !Array.isArray(j.presets)) return { ok: false, error: 'Dosya geçerli bir ön ayar dosyası değil.' };
  return { ok: true, presets: j.presets.filter(p => p && typeof p.name === 'string' && p.v && typeof p.v === 'object' && ['dl', 'cv'].includes(p.scope)) };
});

// ---------- Motor sürümleri ve otomatik güncelleme ----------
async function engineVersion() { try { return (await runCapture(['--version'])).trim(); } catch { return ''; } }
ipcMain.handle('engine-info', async () => ({
  app: app.getVersion(), ytdlp: fs.existsSync(ytdlpPath) ? await engineVersion() : '', gallery: fs.existsSync(galleryPath), ffmpeg: !!lib.ffmpeg(),
  js: jsRuntimeArgs().length > 0, last: settings.lastEngineCheck
}));
async function autoUpdateEngine() {
  try {
    if (!settings.autoUpdate || !fs.existsSync(ytdlpPath) || running > 0) return;
    if (Date.now() - (settings.lastEngineCheck || 0) < 20 * 3600 * 1000) return;
    await new Promise(resolve => {
      const p = spawn(ytdlpPath, ['-U'], { windowsHide: true });
      let out = ''; p.stdout.on('data', d => out += d);
      const t = setTimeout(() => { try { p.kill(); } catch {} resolve(); }, 90000);
      p.on('close', () => { clearTimeout(t); if (/Updated yt-dlp/i.test(out)) send('status', 'İndirme motoru güncellendi'); resolve(); });
      p.on('error', () => { clearTimeout(t); resolve(); });
    });
    settings.lastEngineCheck = Date.now(); writeJson(settingsFile, settings);
  } catch {}
}
setTimeout(() => autoUpdateEngine(), 25000);

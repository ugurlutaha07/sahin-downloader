/* Şahin Downloader — arayüz mantığı */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = n => `<svg><use href="#i-${n}"/></svg>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDur = s => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
const fmtDate = t => new Date(t).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
function parseTime(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  const parts = s.split(':').map(x => x.trim());
  if (parts.length > 3 || parts.some(x => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  return parts.reduce((a, x) => a * 60 + parseFloat(x), 0);
}
const AUDIO_EXT = /\.(mp3|wav|flac|aac|m4a|ogg|opus|wma|aiff|ac3|mp2)$/i;
const VIDEO_EXT = /\.(mp4|mkv|webm|mov|avi|flv|wmv|m4v|ts|mpg|3gp)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i;
const fileUrl = p => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');

let S = {};                       // ayarlar
let items = [], cvFiles = [];
let fetchSeq = 0, defFolder = '';
let mode = 'video';
let ytmSwitched = false;

const save = patch => { Object.assign(S, patch); return window.api.setSettings(patch); };

/* ================= Tasarımlar ================= */
const DESIGNS = {
  klasik:   { name: 'Klasik',      desc: 'Sade ve nötr, mavi vurgu',
    light: { bg: '#f5f5f7', side: '#ececf0', card: '#ffffff', acc: '#0a6cff', ink: '#ffffff' },
    dark:  { bg: '#1c1c1e', side: '#242426', card: '#2c2c2e', acc: '#0a84ff', ink: '#ffffff' } },
  kartal:   { name: 'Kartal',      desc: 'Logodan esinlenen altın ve kahve',
    light: { bg: '#faf6ee', side: '#f0e8d8', card: '#ffffff', acc: '#a8740a', ink: '#ffffff' },
    dark:  { bg: '#16120c', side: '#1e1810', card: '#2a2217', acc: '#e0a82e', ink: '#1a1305' } },
  okyanus:  { name: 'Okyanus',     desc: 'Serin turkuaz tonları',
    light: { bg: '#f1f7f8', side: '#e2eef0', card: '#ffffff', acc: '#0b7f8f', ink: '#ffffff' },
    dark:  { bg: '#0e191c', side: '#132226', card: '#1a2c31', acc: '#2cc2d6', ink: '#04252b' } },
  orman:    { name: 'Orman',       desc: 'Doğal yeşil',
    light: { bg: '#f3f7f3', side: '#e4eee4', card: '#ffffff', acc: '#2a7d46', ink: '#ffffff' },
    dark:  { bg: '#111a13', side: '#17231a', card: '#1f2d23', acc: '#46c26e', ink: '#05220f' } },
  gunbatimi:{ name: 'Gün Batımı',  desc: 'Sıcak turuncu ve kızıl',
    light: { bg: '#fbf4f1', side: '#f3e5e0', card: '#ffffff', acc: '#d94a2e', ink: '#ffffff' },
    dark:  { bg: '#1b1312', side: '#241917', card: '#30211f', acc: '#ff7a59', ink: '#2a0d05' } },
  ametist:  { name: 'Ametist',     desc: 'Zarif mor',
    light: { bg: '#f6f4fb', side: '#eae6f5', card: '#ffffff', acc: '#6f43d6', ink: '#ffffff' },
    dark:  { bg: '#16131e', side: '#1d1928', card: '#282235', acc: '#9d7bff', ink: '#160a38' } },
  grafit:   { name: 'Grafit',      desc: 'Tek renkli, kurumsal görünüm',
    light: { bg: '#f4f4f4', side: '#e7e7e7', card: '#ffffff', acc: '#3a3a3c', ink: '#ffffff' },
    dark:  { bg: '#151515', side: '#1d1d1d', card: '#272727', acc: '#d6d6d6', ink: '#161616' } }
};
const MODE_VARS = {
  light: { txt: '#1d1d1f', mut: '#6e6e73', line: 'rgba(0,0,0,.09)', fill: 'rgba(0,0,0,.055)', ok: '#2e9e4f', err: '#d92d20', warn: '#b86e00', shadow: '0 1px 2px rgba(0,0,0,.05),0 6px 20px rgba(0,0,0,.05)' },
  dark:  { txt: '#f5f5f7', mut: '#a1a1a6', line: 'rgba(255,255,255,.1)', fill: 'rgba(255,255,255,.08)', ok: '#3ddc84', err: '#ff6259', warn: '#ffb340', shadow: '0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3)' }
};
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const effMode = () => (S.theme === 'dark' ? 'dark' : S.theme === 'light' ? 'light' : (mq.matches ? 'dark' : 'light'));

function applyDesign() {
  const m = effMode();
  const d = (DESIGNS[S.design] || DESIGNS.klasik)[m];
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(MODE_VARS[m])) r.setProperty('--' + k, v);
  r.setProperty('--bg', d.bg); r.setProperty('--side', d.side); r.setProperty('--card', d.card);
  r.setProperty('--acc', d.acc); r.setProperty('--acc-ink', d.ink);
  document.documentElement.dataset.mode = m;
  window.api.setChrome({ color: d.bg, symbol: MODE_VARS[m].mut });
  if (S.zoom) window.api.setZoom(S.zoom);
  renderDesigns();
}
mq.addEventListener('change', () => { if (S.theme === 'system') applyDesign(); });

function renderDesigns() {
  const m = effMode();
  $('s-designs').innerHTML = Object.entries(DESIGNS).map(([id, d]) => `
    <button class="design ${S.design === id ? 'on' : ''}" data-d="${id}" title="${esc(d.desc)}">
      <div class="sw"><i style="background:${d[m].bg};flex:3"></i><i style="background:${d[m].side};flex:2"></i><i style="background:${d[m].acc};flex:2"></i></div>
      <b>${esc(d.name)}</b><small>${esc(d.desc)}</small>
    </button>`).join('');
  $('s-designs').querySelectorAll('.design').forEach(b => b.onclick = async () => { await save({ design: b.dataset.d }); applyDesign(); });
}

// Yüklenemeyen küçük resimlerde simge göster (satır içi olay kullanılamaz: içerik güvenlik politikası)
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('th')) {
    const ph = document.createElement('div'); ph.className = 'ph'; ph.innerHTML = ic('film'); t.replaceWith(ph);
  }
}, true);

/* ================= Gezinme ================= */
function goto(p) {
  document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.page === p));
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === 'page-' + p));
  if (p === 'hs') loadHistory();
  if (p === 'fw') loadFollows();
  if (p === 'pr') renderPresetsPage();
  if (p === 'st') loadVersions();
}
document.querySelectorAll('.nav').forEach(b => { b.onclick = () => goto(b.dataset.page); b.title = b.textContent.trim(); });  // dar pencerede yalnızca simge görünür
const activePage = () => (document.querySelector('.page.active') || {}).id;

/* ================= Bildirimler ================= */
function toast(title, msg, actions = [], opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opts.error ? ' error' : '');
  el.innerHTML = `<b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ''}<div class="tact"></div>`;
  const act = el.querySelector('.tact');
  const close = () => el.remove();
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn sm ' + (a.primary ? 'primary' : 'quiet'); b.textContent = a.label;
    b.onclick = () => { try { a.run && a.run(); } finally { close(); } };
    act.appendChild(b);
  }
  if (!actions.length) { el.style.cursor = 'pointer'; el.onclick = close; }
  $('toasts').appendChild(el);
  setTimeout(close, opts.ttl || (actions.length ? 14000 : 6000));
}
const setStatus = (text, cls) => { $('status').className = cls || ''; $('status').querySelector('span').textContent = text; };

/* ================= Bağlantı algılama ================= */
const PLATFORMS = [
  [/(^|\.)music\.youtube\.com$/, 'YouTube Music'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)spotify\.com$/, 'Spotify'], [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)twitch\.tv$/, 'Twitch'], [/(^|\.)vimeo\.com$/, 'Vimeo'], [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)(twitter\.com|x\.com)$/, 'X (Twitter)'],
  [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'], [/(^|\.)dailymotion\.com$/, 'Dailymotion'],
  [/(^|\.)reddit\.com$/, 'Reddit'], [/(^|\.)(bilibili\.com|b23\.tv)$/, 'Bilibili'], [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)kick\.com$/, 'Kick'], [/(^|\.)(pinterest\.com|pin\.it)$/, 'Pinterest'], [/(^|\.)vk\.com$/, 'VK'],
  [/(^|\.)rumble\.com$/, 'Rumble'], [/(^|\.)odysee\.com$/, 'Odysee'], [/(^|\.)mixcloud\.com$/, 'Mixcloud'],
  [/(^|\.)nicovideo\.jp$/, 'Niconico'], [/(^|\.)archive\.org$/, 'Internet Archive'], [/(^|\.)ted\.com$/, 'TED'],
  [/(^|\.)flickr\.com$/, 'Flickr'], [/(^|\.)imgur\.com$/, 'Imgur'], [/(^|\.)deviantart\.com$/, 'DeviantArt'],
  [/(^|\.)pixiv\.net$/, 'Pixiv'], [/(^|\.)tumblr\.com$/, 'Tumblr'], [/(^|\.)artstation\.com$/, 'ArtStation'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'], [/(^|\.)threads\.(net|com)$/, 'Threads'], [/(^|\.)snapchat\.com$/, 'Snapchat'],
  [/(^|\.)(t\.me|telegram\.me)$/, 'Telegram'], [/(^|\.)(likee\.video|likee\.com)$/, 'Likee'], [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)streamable\.com$/, 'Streamable'], [/(^|\.)ok\.ru$/, 'OK.ru'], [/(^|\.)(t\.co)$/, 'X (Twitter)'], [/(^|\.)twitch\.tv$/, 'Twitch']
];
const DIRECT_RE = /\.(jpe?g|png|webp|gif|bmp|svg|tiff?|avif|heic|ico|pdf|zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|dmg|apk|deb|docx?|xlsx?|pptx?|odt|txt|csv|epub|mobi|torrent|mp3|wav|flac|ogg|m4a|aac|opus|mp4|mkv|webm|avi|mov|wmv|flv|m4v|ts)$/i;
function detect(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    const host = x.hostname.toLowerCase();
    for (const [re, n] of PLATFORMS) if (re.test(host)) return n;
    if (DIRECT_RE.test(decodeURIComponent(x.pathname))) return 'Dosya bağlantısı';
    return host.replace(/^www\./, '');
  } catch { return null; }
}
const links = () => $('url').value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

function updateChips() {
  const ls = links();
  $('chips').innerHTML = ls.map(l => {
    const p = detect(l);
    return p ? `<span class="chip">${esc(p)}</span>` : `<span class="chip bad">Geçersiz bağlantı</span>`;
  }).join('');
  $('spNote').classList.toggle('hidden', !ls.some(l => /spotify\.com/i.test(l)));
  if (!ytmSwitched && mode === 'video' && ls.some(l => /music\.youtube\.com/i.test(l))) {
    ytmSwitched = true; setMode('audio');
    toast('YouTube Music bağlantısı algılandı', 'Çıktı türü otomatik olarak “Ses” olarak değiştirildi.');
  }
  if (!ls.length) ytmSwitched = false;
}
$('url').oninput = updateChips;

/* ================= Çıktı seçenekleri ================= */
function setMode(m) { mode = m; save({ mode: m }); applyMode(); renderPresetBars(); }
function applyMode() {
  const v = mode === 'video', a = mode === 'audio', s = mode === 'subs';
  document.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === mode));
  $('vfWrap').classList.toggle('hidden', !v); $('qWrap').classList.toggle('hidden', !v);
  $('afWrap').classList.toggle('hidden', !a);
  $('aWrap').classList.toggle('hidden', !a || ['flac', 'wav'].includes($('afmt').value));
  $('subsWrap').classList.toggle('hidden', !v); $('subsFileWrap').classList.toggle('hidden', !v);
  $('liveWrap').classList.toggle('hidden', !v);
  $('splitWrap').classList.toggle('hidden', s);
  $('embedThumb').parentElement.classList.toggle('hidden', s);
  $('normWrap').classList.toggle('hidden', !a); $('trimWrap').classList.toggle('hidden', !a);
  $('btnDl').textContent = s ? 'Altyazıyı indir' : (a ? $('afmt').value : $('vfmt').value).toUpperCase() + ' olarak indir';
}
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.v));
const bind = (id, key, num) => {
  const el = $(id);
  el.onchange = () => { save({ [key]: el.type === 'checkbox' ? el.checked : (num ? +el.value : el.value) }); applyMode(); renderPresetBars(); };
};
bind('vfmt', 'vfmt'); bind('quality', 'quality'); bind('afmt', 'afmt'); bind('abr', 'abr');
bind('numbered', 'numbered'); bind('embedThumb', 'embedThumb');
bind('normalize', 'normalize'); bind('trimSilence', 'trimSilence'); bind('splitChapters', 'splitChapters'); bind('liveFromStart', 'liveFromStart');
$('subs').onchange = () => { if ($('subs').checked) { $('subsFile').checked = false; save({ subsFile: false }); } save({ subs: $('subs').checked }); renderPresetBars(); };
$('subsFile').onchange = () => { if ($('subsFile').checked) { $('subs').checked = false; save({ subs: false }); } save({ subsFile: $('subsFile').checked }); renderPresetBars(); };
$('conc').onchange = () => { const n = +$('conc').value; save({ conc: n }); window.api.queueConc(n); };
bind('fmt', 'cvFmt'); bind('cvQuality', 'cvQuality'); bind('cvRes', 'cvRes'); bind('cvNormalize', 'cvNormalize'); bind('cvTrim', 'cvTrimSilence');
$('cvMb').oninput = () => { save({ cvMb: $('cvMb').value.trim() }); renderPresetBars(); };

/* ================= Ön ayarlar ================= */
const BASE = {
  dl: { mode: 'video', vfmt: 'mp4', quality: '1080', afmt: 'mp3', abr: '320', subs: false, subsFile: false, embedThumb: true, normalize: false, trimSilence: false, splitChapters: false, liveFromStart: false },
  cv: { cvFmt: 'mp4', cvQuality: 'balanced', cvRes: 'orig', cvMb: '', cvNormalize: false, cvTrimSilence: false }
};
const BUILTIN = [
  { id: 'b-hd',      scope: 'dl', name: 'Full HD · MP4',            desc: 'Dengeli kalite ve uyumluluk',               v: { mode: 'video', vfmt: 'mp4', quality: '1080' } },
  { id: 'b-phone',   scope: 'dl', name: 'Telefon · 720p',           desc: 'Küçük dosya, her cihazda sorunsuz oynar',   v: { mode: 'video', vfmt: 'mp4', quality: '720' } },
  { id: 'b-small',   scope: 'dl', name: 'Tasarruflu · 480p',        desc: 'Yer ve veri tasarrufu',                      v: { mode: 'video', vfmt: 'mp4', quality: '480', embedThumb: false } },
  { id: 'b-best',    scope: 'dl', name: 'En yüksek kalite · MKV',   desc: 'Mevcut en yüksek çözünürlük',                v: { mode: 'video', vfmt: 'mkv', quality: 'best' } },
  { id: 'b-lecture', scope: 'dl', name: 'Ders ve konferans',        desc: '720p, altyazı gömülü, bölümlere ayrılmış',  v: { mode: 'video', vfmt: 'mp4', quality: '720', subs: true, splitChapters: true } },
  { id: 'b-live',    scope: 'dl', name: 'Canlı yayın kaydı',        desc: 'Yayını baştan kaydeder, başlamasını bekler', v: { mode: 'video', vfmt: 'mkv', quality: 'best', liveFromStart: true } },
  { id: 'b-music',   scope: 'dl', name: 'Müzik · MP3 320',          desc: 'Kapak ve etiketlerle birlikte',              v: { mode: 'audio', afmt: 'mp3', abr: '320' } },
  { id: 'b-flac',    scope: 'dl', name: 'Müzik · FLAC (kayıpsız)',  desc: 'Arşiv kalitesi, büyük dosya',               v: { mode: 'audio', afmt: 'flac' } },
  { id: 'b-podcast', scope: 'dl', name: 'Podcast · MP3 128',        desc: 'Ses seviyesi eşitlenmiş, sessizlik kesilmiş', v: { mode: 'audio', afmt: 'mp3', abr: '128', normalize: true, trimSilence: true } },
  { id: 'b-subs',    scope: 'dl', name: 'Yalnızca altyazı',         desc: 'Videoyu indirmeden .srt dosyası alır',      v: { mode: 'subs' } },
  { id: 'c-hq',      scope: 'cv', name: 'Yüksek kalite · MP4',      desc: 'Özgün çözünürlük, yüksek bit hızı',          v: { cvFmt: 'mp4', cvQuality: 'high' } },
  { id: 'c-wa',      scope: 'cv', name: 'WhatsApp · 16 MB',         desc: '720p, 15 MB hedefli sıkıştırma',            v: { cvFmt: 'mp4', cvRes: '720', cvMb: '15' } },
  { id: 'c-mail',    scope: 'cv', name: 'E-posta ve Discord · 25 MB', desc: '720p, 24 MB hedefli sıkıştırma',           v: { cvFmt: 'mp4', cvRes: '720', cvMb: '24' } },
  { id: 'c-social',  scope: 'cv', name: 'Sosyal medya · 50 MB',     desc: '1080p, 48 MB hedefli sıkıştırma',            v: { cvFmt: 'mp4', cvRes: '1080', cvMb: '48' } },
  { id: 'c-tiny',    scope: 'cv', name: 'Çok küçük · 480p',         desc: 'En küçük dosya boyutu',                      v: { cvFmt: 'mp4', cvQuality: 'small', cvRes: '480' } },
  { id: 'c-web',     scope: 'cv', name: 'Web için WebM',            desc: 'Web sitelerinde yayın için',                 v: { cvFmt: 'webm', cvRes: '720' } },
  { id: 'c-gif',     scope: 'cv', name: 'Kısa GIF',                 desc: 'Kırpılmış kısa klipler için, 480 px',        v: { cvFmt: 'gif', cvRes: '480' } },
  { id: 'c-mp3',     scope: 'cv', name: 'Sesi çıkar · MP3',         desc: 'Videodan yüksek kaliteli MP3',               v: { cvFmt: 'mp3', cvQuality: 'high' } },
  { id: 'c-flac',    scope: 'cv', name: 'Arşiv · FLAC',             desc: 'Kayıpsız ses',                               v: { cvFmt: 'flac' } }
];
const allPresets = scope => [...BUILTIN.filter(p => p.scope === scope), ...(S.presets || []).filter(p => p.scope === scope)];
const findPreset = id => [...BUILTIN, ...(S.presets || [])].find(p => p.id === id);
const eff = p => ({ ...BASE[p.scope], ...p.v });

const MODE_TR = { video: 'Video', audio: 'Ses', subs: 'Altyazı' };
const QUAL_TR = { best: 'En yüksek', 4320: '8K', 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p', 360: '360p', 240: '240p' };
const CVQ_TR = { high: 'Yüksek kalite', balanced: 'Dengeli kalite', small: 'Küçük dosya' };
function describe(scope, v) {
  const o = { ...BASE[scope], ...v }, parts = [];
  if (scope === 'dl') {
    parts.push(MODE_TR[o.mode]);
    if (o.mode === 'video') { parts.push(String(o.vfmt).toUpperCase(), QUAL_TR[o.quality] || o.quality + 'p'); if (o.subs) parts.push('Altyazı gömülü'); else if (o.subsFile) parts.push('Ayrı .srt'); if (o.liveFromStart) parts.push('Canlı yayın baştan'); }
    if (o.mode === 'audio') { parts.push(String(o.afmt).toUpperCase()); if (!['flac', 'wav'].includes(o.afmt)) parts.push(o.abr + ' kb/sn'); if (o.normalize) parts.push('Normalleştirme'); if (o.trimSilence) parts.push('Sessizlik kesme'); }
    if (o.mode !== 'subs' && o.splitChapters) parts.push('Bölümlere ayır');
    if (o.mode !== 'subs' && !o.embedThumb) parts.push('Kapaksız');
  } else {
    parts.push(String(o.cvFmt).toUpperCase());
    if (!AUDIO_FMTS.includes(o.cvFmt) && o.cvFmt !== 'gif') parts.push(o.cvRes === 'orig' ? 'Özgün çözünürlük' : o.cvRes + 'p');
    if (o.cvFmt === 'gif' && o.cvRes !== 'orig') parts.push(o.cvRes + ' px');
    parts.push(o.cvMb ? `Hedef ${o.cvMb} MB` : CVQ_TR[o.cvQuality]);
    if (o.cvNormalize) parts.push('Normalleştirme'); if (o.cvTrimSilence) parts.push('Sessizlik kesme');
  }
  return parts.join(' · ');
}
const AUDIO_FMTS = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus', 'wma', 'ac3', 'mp2'];

const currentVals = scope => {
  const keys = Object.keys(BASE[scope]), o = {};
  for (const k of keys) o[k] = S[k] ?? BASE[scope][k];
  if (scope === 'cv') o.cvMb = String(S.cvMb || '');
  return o;
};
function relevantKeys(scope, o) {
  if (scope === 'cv') return AUDIO_FMTS.includes(o.cvFmt) ? ['cvFmt', 'cvQuality', 'cvMb', 'cvNormalize', 'cvTrimSilence'] : ['cvFmt', 'cvQuality', 'cvRes', 'cvMb', 'cvNormalize', 'cvTrimSilence'];
  if (o.mode === 'video') return ['mode', 'vfmt', 'quality', 'subs', 'subsFile', 'embedThumb', 'splitChapters', 'liveFromStart'];
  if (o.mode === 'audio') return ['mode', 'afmt', ...(['flac', 'wav'].includes(o.afmt) ? [] : ['abr']), 'embedThumb', 'normalize', 'trimSilence', 'splitChapters'];
  return ['mode'];
}
function matches(p) {
  const want = eff(p), cur = currentVals(p.scope);
  return relevantKeys(p.scope, want).every(k => String(want[k]) === String(cur[k]));
}

async function applyPreset(p, silent) {
  const v = eff(p);
  await save(v);
  fillControls(); renderPresetBars(); if (activePage() === 'page-pr') renderPresetsPage();
  if (!silent) toast('Ön ayar uygulandı', p.name);
}

function renderPresetBars() {
  for (const [scope, el] of [['dl', $('pb-dl')], ['cv', $('pb-cv')]]) {
    el.innerHTML = `<span class="plabel">Ön ayar</span>` +
      allPresets(scope).map(p => `<button class="pchip ${matches(p) ? 'on' : ''}" data-id="${esc(p.id)}" title="${esc(p.desc || '')}${p.desc ? ' — ' : ''}${esc(describe(scope, p.v))}">${p.id === S[scope === 'dl' ? 'defaultDl' : 'defaultCv'] ? ic('star') : ''}${esc(p.name)}</button>`).join('') +
      `<button class="pchip ghost" data-act="save">${ic('plus')}Mevcut ayarları kaydet</button><button class="pchip ghost" data-act="manage">Yönet</button>`;
    el.querySelectorAll('.pchip').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'save') return saveCurrentAs(scope);
      if (b.dataset.act === 'manage') return goto('pr');
      applyPreset(findPreset(b.dataset.id));
    });
  }
}

// ---- Ad / açıklama penceresi ----
function askPreset({ title, name = '', desc = '', showUpd = false, summary = '', okLabel = 'Kaydet' }) {
  return new Promise(resolve => {
    $('pm-title').textContent = title; $('pm-name').value = name; $('pm-desc').value = desc;
    $('pm-upd-wrap').classList.toggle('hidden', !showUpd); $('pm-upd').checked = false;
    $('pm-sum').textContent = summary; $('pm-ok').textContent = okLabel;
    $('promptModal').classList.remove('hidden'); setTimeout(() => $('pm-name').focus(), 30);
    const done = r => { $('promptModal').classList.add('hidden'); $('pm-ok').onclick = $('pm-cancel').onclick = null; $('pm-name').onkeydown = null; resolve(r); };
    $('pm-ok').onclick = () => { const n = $('pm-name').value.trim(); if (!n) { $('pm-name').focus(); return; } done({ name: n, desc: $('pm-desc').value.trim(), upd: $('pm-upd').checked }); };
    $('pm-cancel').onclick = () => done(null);
    $('pm-name').onkeydown = e => { if (e.key === 'Enter') $('pm-ok').click(); if (e.key === 'Escape') done(null); };
  });
}
const nameTaken = (scope, name, exceptId) => allPresets(scope).some(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
function uniqueName(scope, base) { let n = base, i = 2; while (nameTaken(scope, n)) n = `${base} (${i++})`; return n; }

async function saveCurrentAs(scope) {
  const cur = currentVals(scope);
  const r = await askPreset({ title: scope === 'dl' ? 'İndirme ön ayarı oluştur' : 'Dönüştürme ön ayarı oluştur', summary: 'Kaydedilecek ayarlar: ' + describe(scope, cur) });
  if (!r) return;
  if (nameTaken(scope, r.name)) { toast('Bu ad zaten kullanılıyor', 'Farklı bir ad girin.', [], { error: true }); return saveCurrentAs(scope); }
  const keep = {}; for (const k of relevantKeys(scope, cur)) keep[k] = cur[k];
  const p = { id: 'u-' + uid(), scope, name: r.name, desc: r.desc, v: keep };
  await save({ presets: [...(S.presets || []), p] });
  renderPresetBars(); if (activePage() === 'page-pr') renderPresetsPage();
  toast('Ön ayar kaydedildi', r.name);
}
async function editPreset(p) {
  const r = await askPreset({ title: 'Ön ayarı düzenle', name: p.name, desc: p.desc, showUpd: true, summary: 'Şu anki ayarlar: ' + describe(p.scope, currentVals(p.scope)) + '\nKayıtlı ayarlar: ' + describe(p.scope, p.v) });
  if (!r) return;
  if (nameTaken(p.scope, r.name, p.id)) { toast('Bu ad zaten kullanılıyor', 'Farklı bir ad girin.', [], { error: true }); return; }
  const list = (S.presets || []).map(x => {
    if (x.id !== p.id) return x;
    const y = { ...x, name: r.name, desc: r.desc };
    if (r.upd) { const cur = currentVals(p.scope), keep = {}; for (const k of relevantKeys(p.scope, cur)) keep[k] = cur[k]; y.v = keep; }
    return y;
  });
  await save({ presets: list }); renderPresetBars(); renderPresetsPage();
}
async function duplicatePreset(p) {
  const c = { id: 'u-' + uid(), scope: p.scope, name: uniqueName(p.scope, p.name + ' (kopya)'), desc: p.desc, v: { ...eff(p) } };
  await save({ presets: [...(S.presets || []), c] }); renderPresetBars(); renderPresetsPage();
  toast('Ön ayar çoğaltıldı', c.name);
}
function deletePreset(p) {
  toast('Ön ayar silinsin mi?', p.name, [{ label: 'Sil', primary: true, run: async () => {
    const patch = { presets: (S.presets || []).filter(x => x.id !== p.id) };
    if (S.defaultDl === p.id) patch.defaultDl = ''; if (S.defaultCv === p.id) patch.defaultCv = '';
    await save(patch); renderPresetBars(); renderPresetsPage();
  } }, { label: 'Vazgeç' }]);
}
async function toggleDefault(p) {
  const key = p.scope === 'dl' ? 'defaultDl' : 'defaultCv';
  await save({ [key]: S[key] === p.id ? '' : p.id });
  renderPresetBars(); renderPresetsPage();
  toast(S[key] ? 'Varsayılan ön ayar belirlendi' : 'Varsayılan ön ayar kaldırıldı', S[key] ? p.name + ' — uygulama her açıldığında uygulanır.' : '');
}

function renderPresetsPage() {
  const card = p => {
    const custom = String(p.id).startsWith('u-'), def = p.id === S[p.scope === 'dl' ? 'defaultDl' : 'defaultCv'];
    return `<div class="pcard ${matches(p) ? 'on' : ''}" data-id="${esc(p.id)}">
      <button class="star ${def ? 'on' : ''}" data-a="def" title="${def ? 'Varsayılanlıktan çıkar' : 'Açılışta uygula (varsayılan yap)'}">${ic('star')}</button>
      <h3>${esc(p.name)}<span class="badge ${custom ? '' : 'warn'}">${custom ? 'Özel' : 'Hazır'}</span></h3>
      <p>${esc(p.desc || '')}</p>
      <div class="sum">${esc(describe(p.scope, p.v))}</div>
      <div class="pact">
        <button class="btn primary sm" data-a="apply">${matches(p) ? 'Etkin' : 'Uygula'}</button>
        <button class="btn quiet sm" data-a="dup">${ic('copy')}Çoğalt</button>
        ${custom ? `<button class="btn quiet sm" data-a="edit">${ic('edit')}Düzenle</button><button class="btn danger sm" data-a="del">${ic('trash')}Sil</button>` : ''}
      </div></div>`;
  };
  const group = (scope, title) => {
    const b = BUILTIN.filter(p => p.scope === scope), u = (S.presets || []).filter(p => p.scope === scope);
    return `<div class="gtitle">${title}</div>
      <div class="pgrid">${b.map(card).join('')}</div>
      <div class="row" style="margin:10px 2px 8px"><b style="font-size:12.5px">Özel ön ayarlarınız</b><span class="sp"></span>
        <button class="btn quiet sm" data-new="${scope}">${ic('plus')}Mevcut ayarlardan oluştur</button></div>
      ${u.length ? `<div class="pgrid">${u.map(card).join('')}</div>` : `<div class="empty-sm">Henüz özel ön ayar yok. İstediğiniz ayarları ilgili sayfada seçip “Mevcut ayarlardan oluştur” düğmesine basın.</div>`}`;
  };
  $('pr-body').innerHTML = group('dl', 'İndirme ön ayarları') + group('cv', 'Dönüştürme ön ayarları');
  $('pr-body').querySelectorAll('[data-new]').forEach(b => b.onclick = () => saveCurrentAs(b.dataset.new));
  $('pr-body').querySelectorAll('.pcard').forEach(c => {
    const p = findPreset(c.dataset.id);
    c.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ({ apply: () => applyPreset(p), dup: () => duplicatePreset(p), edit: () => editPreset(p), del: () => deletePreset(p), def: () => toggleDefault(p) }[b.dataset.a]()));
  });
}
$('pr-export').onclick = async () => {
  const list = S.presets || [];
  if (!list.length) { toast('Dışa aktarılacak özel ön ayar yok', 'Önce kendi ön ayarlarınızı oluşturun.', [], { error: true }); return; }
  const r = await window.api.presetExport(list);
  if (r.ok) toast('Ön ayarlar dışa aktarıldı', r.file);
};
$('pr-import').onclick = async () => {
  const r = await window.api.presetImport();
  if (r.canceled) return;
  if (!r.ok) { toast('İçe aktarılamadı', r.error, [], { error: true }); return; }
  const add = [];
  for (const p of r.presets) {
    const name = uniqueName(p.scope, String(p.name).slice(0, 40));
    const q = { id: 'u-' + uid(), scope: p.scope, name, desc: String(p.desc || '').slice(0, 90), v: p.v };
    add.push(q); S.presets = [...(S.presets || []), q];   // ad çakışmalarını gözetmek için sırayla ekle
  }
  await save({ presets: S.presets }); renderPresetBars(); renderPresetsPage();
  toast('Ön ayarlar içe aktarıldı', `${add.length} ön ayar eklendi.`);
};

/* ================= İndirme listesi ================= */
// durum: idle | queued | downloading | processing | paused | done | error
const LOCKED = ['queued', 'downloading', 'processing', 'paused', 'done'];

function metaText(it, i) {
  const base = `${i + 1}${it.duration ? ' · ' + fmtDur(it.duration) : ''}${it.source ? ' · ' + it.source : ''}`;
  switch (it.status) {
    case 'queued': return base + ' · Kuyrukta';
    case 'paused': return base + ' · Duraklatıldı';
    case 'downloading': return it.note ? `${base} · ${it.note}` : `${base} · %${(it.percent || 0).toFixed(1)}${it.speed ? ' · ' + it.speed : ''}${it.eta ? ' · kalan ' + it.eta : ''}`;
    case 'processing': return base + ' · İşleniyor…';
    case 'done': return base + ' · Tamamlandı' + (it.count ? ` (${it.count} dosya)` : '');
    case 'error': return base + ' · Hata: ' + (it.error || 'bilinmeyen');
    default: return base;
  }
}
function rowActions(it) {
  const b = (a, icon, title, cls = '') => `<button class="iconbtn ${cls}" data-a="${a}" title="${title}">${ic(icon)}</button>`;
  const prev = (it.thumb || it.direct || it.file) ? b('prev', 'eye', 'Önizle') : '';
  switch (it.status) {
    case 'queued': return prev + b('top', 'top', 'Başa al') + b('up', 'up', 'Yukarı taşı') + b('down', 'down', 'Aşağı taşı') + b('pause', 'pause', 'Duraklat') + b('rm', 'x', 'Kuyruktan çıkar', 'danger');
    case 'downloading': case 'processing': return b('pause', 'pause', 'Duraklat');
    case 'paused': return b('play', 'play', 'Devam ettir') + b('rm', 'x', 'Listeden çıkar', 'danger');
    case 'done': return prev + (it.file ? b('show', 'folder', 'Klasörde göster') : '');
    case 'error': return b('retry', 'refresh', 'Yeniden dene') + b('rm', 'x', 'Listeden çıkar', 'danger');
    default: return prev;
  }
}

function renderList() {
  if (!items.length) {
    $('list').innerHTML = `<div class="empty">${ic('download')}<b>Liste boş</b><span>Bir bağlantı ekleyin. Oynatma listeleri ve Spotify listeleri öğe öğe görüntülenir.</span></div>`;
    updateCount(); return;
  }
  $('list').innerHTML = items.map((it, i) => `
    <div class="item ${it.status === 'done' ? 'done' : ''} ${it.status === 'error' ? 'err' : ''} ${it.status === 'queued' ? 'queued' : ''} ${it.status === 'paused' ? 'paused' : ''}" id="it-${esc(it.id)}" data-id="${esc(it.id)}" ${it.status === 'queued' ? 'draggable="true"' : ''}>
      <input type="checkbox" data-i="${i}" ${it.sel ? 'checked' : ''} ${LOCKED.includes(it.status) ? 'disabled' : ''}>
      ${it.thumb ? `<img class="th" src="${esc(it.thumb)}" alt="">` : `<div class="ph">${ic(it.gallery ? 'image' : it.direct ? 'download' : 'music')}</div>`}
      <div class="info">
        <div class="t" title="${esc(it.title)}">${esc(it.title)}</div>
        <div class="meta" data-meta="${esc(it.id)}">${esc(metaText(it, i))}</div>
        <div class="bar"><i data-bar="${esc(it.id)}" style="width:${it.percent || 0}%"></i></div>
      </div>
      <div class="acts" data-acts="${esc(it.id)}">${rowActions(it)}</div>
    </div>`).join('');
  $('list').querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => { items[cb.dataset.i].sel = cb.checked; updateCount(); });
  bindRows();
  updateCount();
}

function queuedIds() { return items.filter(i => i.status === 'queued').map(i => i.id); }
function syncOrder() { window.api.queueReorder(queuedIds()); }
function moveItem(id, dir) {
  const q = items.filter(i => i.status === 'queued'), qi = q.findIndex(i => i.id === id);
  if (qi < 0) return;
  const it = q[qi];
  const tgt = dir === 'top' ? q[0] : dir === 'up' ? q[qi - 1] : q[qi + 1];
  if (!tgt || tgt === it) return;
  items.splice(items.indexOf(it), 1);
  const idx = items.indexOf(tgt);
  items.splice(dir === 'down' ? idx + 1 : idx, 0, it);
  items.forEach((x, i) => x.index = i + 1);
  syncOrder(); renderList();
}

function bindRows() {
  $('list').querySelectorAll('.item').forEach(row => {
    const it = items.find(x => x.id === row.dataset.id); if (!it) return;
    row.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async e => {
      e.stopPropagation();
      const a = btn.dataset.a;
      if (a === 'prev') openItemPreview(it);
      else if (a === 'show') window.api.showFile(it.file);
      else if (a === 'top' || a === 'up' || a === 'down') moveItem(it.id, a);
      else if (a === 'pause') await window.api.itemPause(it.id);
      else if (a === 'play') await window.api.itemResume(it.id);
      else if (a === 'rm') { await window.api.itemRemove(it.id); items = items.filter(x => x.id !== it.id); items.forEach((x, i) => x.index = i + 1); renderList(); }
      else if (a === 'retry') { it.sel = true; enqueue([it]); }
    });
    if (it.status === 'queued') {
      row.ondragstart = e => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; };
      row.ondragover = e => { if (it.status === 'queued') { e.preventDefault(); row.classList.add('dragover'); } };
      row.ondragleave = () => row.classList.remove('dragover');
      row.ondrop = e => {
        e.preventDefault(); e.stopPropagation(); row.classList.remove('dragover');
        const from = e.dataTransfer.getData('text/plain'); if (!from || from === it.id) return;
        const moving = items.find(x => x.id === from); if (!moving || moving.status !== 'queued') return;
        items.splice(items.indexOf(moving), 1);
        items.splice(items.indexOf(it), 0, moving);
        items.forEach((x, i) => x.index = i + 1); syncOrder(); renderList();
      };
    }
  });
}
function updateCount() {
  const pick = items.filter(i => i.sel && !LOCKED.includes(i.status)).length;
  $('count').textContent = items.length ? `${items.filter(i => i.sel).length} / ${items.length} seçili` : '';
  $('btnDl').disabled = pick === 0;
  $('title').textContent = items.length ? `İndirme listesi (${items.length})` : 'İndirme listesi';
}

async function fetchInfo() {
  const ls = links();
  if (!ls.length) { toast('Bağlantı girilmedi', 'Lütfen en az bir bağlantı yapıştırın.', [], { error: true }); return; }
  const seq = ++fetchSeq;
  $('btnFetch').disabled = true;
  $('btnFetch').querySelector('span').textContent = 'Getiriliyor…';
  const errs = []; let added = 0;
  const results = await Promise.all(ls.map(async (l, k) => {
    if (!detect(l)) return { err: l + ' — geçersiz bağlantı' };
    return window.api.fetchInfo({ url: l, tag: `f${seq}-${k}-` });
  }));
  for (const r of results) {
    if (r.err) { errs.push(r.err); continue; }
    if (!r.ok) { errs.push(r.error); continue; }
    for (const x of r.items) {
      if (items.some(o => o.url === x.url && o.status !== 'error')) continue;
      x.source = r.source; x.sel = true; x.status = 'idle'; x.percent = 0;
      items.push(x); added++;
    }
  }
  items.forEach((x, i) => x.index = i + 1);
  $('btnFetch').disabled = false;
  $('btnFetch').querySelector('span').textContent = 'Listeye ekle';
  if (added) $('url').value = '';
  updateChips(); renderList();
  if (errs.length) {
    const needLogin = /Ayarlar >/.test(errs[0]);
    toast(added ? `${errs.length} bağlantı eklenemedi` : 'Bağlantı eklenemedi', errs[0],
      needLogin ? [{ label: 'Ayarlara git', primary: true, run: () => goto('st') }, { label: 'Kapat' }] : [], { error: true, ttl: 12000 });
  }
}

function readTrim(a, b) {
  const ss = parseTime($(a).value), to = parseTime($(b).value);
  if (Number.isNaN(ss) || Number.isNaN(to)) { toast('Kırpma değeri geçersiz', 'Süreleri sn, dk:sn veya sa:dk:sn biçiminde girin.', [], { error: true }); return false; }
  if (ss !== null && to !== null && to <= ss) { toast('Kırpma aralığı geçersiz', 'Bitiş zamanı başlangıçtan büyük olmalıdır.', [], { error: true }); return false; }
  return { ss, to };
}

async function enqueue(list) {
  if (!list.length) return;
  const trim = readTrim('ss', 'to'); if (!trim) return;
  const trimmed = trim.ss !== null || trim.to !== null;
  if (trimmed && $('splitChapters').checked) toast('Bölümlere ayırma atlandı', 'Kırpma kullanıldığında içerik bölümlere ayrılamaz; yalnızca seçilen aralık indirilecek.');
  $('btnCancel').disabled = false;
  list.forEach(i => { i.status = 'queued'; i.percent = 0; i.error = ''; i.note = ''; });
  renderList();
  await window.api.startDownload({
    items: list.map(i => ({ id: i.id, title: i.title, url: i.url, srcUrl: i.srcUrl, outName: i.outName, fileName: i.fileName, spotify: i.spotify, meta: i.meta, thumb: i.thumb, direct: i.direct, gallery: i.gallery, imageSearch: i.imageSearch, index: i.index })),
    opts: {
      folder: S.folder, mode, vfmt: $('vfmt').value, quality: $('quality').value, afmt: $('afmt').value, abr: +$('abr').value,
      concurrency: +$('conc').value, numbered: $('numbered').checked && items.length > 1,
      nameTpl: S.nameTpl, subs: $('subs').checked, subsFile: $('subsFile').checked, subLang: S.subLang, embedThumb: $('embedThumb').checked, rate: S.rate,
      normalize: $('normalize').checked, trimSilence: $('trimSilence').checked, splitChapters: $('splitChapters').checked && !trimmed,
      liveFromStart: $('liveFromStart').checked, ss: trim.ss, to: trim.to
    }
  });
}
const startDl = () => enqueue(items.filter(i => i.sel && !LOCKED.includes(i.status)));
$('btnClearList').onclick = () => { items = items.filter(i => !['done', 'error'].includes(i.status)); items.forEach((x, i) => x.index = i + 1); renderList(); };
$('btnFetch').onclick = fetchInfo;
$('btnDl').onclick = startDl;
$('btnCancel').onclick = () => window.api.cancel('download');
let qPaused = false;
function setPausedUI(p) {
  qPaused = p;
  $('btnPause').querySelector('span').textContent = p ? 'Kuyruğa devam et' : 'Kuyruğu duraklat';
  $('btnPause').querySelector('use').setAttribute('href', p ? '#i-play' : '#i-pause');
  $('btnPause').classList.toggle('primary', p); $('btnPause').classList.toggle('quiet', !p);
}
$('btnPause').onclick = async () => setPausedUI(await window.api.queuePause(!qPaused));
window.api.on('queue-state', s => setPausedUI(s.paused));
$('all').onchange = e => { items.forEach(i => { if (!LOCKED.includes(i.status)) i.sel = e.target.checked; }); renderList(); };
$('btnFolder').onclick = async () => { const f = await window.api.pickFolder(); if (f) { await save({ folder: f }); showFolders(); } };
$('btnOpen').onclick = () => window.api.openFolder(S.folder);

/* ---- Zamanlama ve kapatma ---- */
let schedAt = 0, schedTimer = null;
function schedUI() {
  const on = !!schedAt;
  $('btnSched').classList.toggle('hidden', on); $('btnSchedCancel').classList.toggle('hidden', !on);
  $('schedTime').disabled = on;
  $('schedInfo').textContent = on ? `Planlanan başlangıç: ${fmtDate(schedAt)} — uygulama açık kalmalıdır.` : '';
}
$('btnSched').onclick = () => {
  const v = $('schedTime').value;
  if (!v) { toast('Saat seçilmedi', 'Başlangıç saatini belirleyin.', [], { error: true }); return; }
  if (!items.some(i => i.sel && !LOCKED.includes(i.status))) { toast('Seçili öğe yok', 'Zamanlamak için listeden en az bir öğe seçin.', [], { error: true }); return; }
  const [h, m] = v.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  schedAt = d.getTime(); schedUI();
  clearInterval(schedTimer);
  schedTimer = setInterval(() => {
    if (Date.now() >= schedAt) { clearInterval(schedTimer); schedAt = 0; schedUI(); startDl(); }
  }, 10000);
};
$('btnSchedCancel').onclick = () => { clearInterval(schedTimer); schedAt = 0; schedUI(); };
if (window.api.platform !== 'win32') $('shutWrap').classList.add('hidden');
if (window.api.platform === 'darwin') { $('t-autoStart').textContent = 'macOS ile birlikte başlat'; $('t-tray').textContent = 'Kapatıldığında menü çubuğuna küçült'; }
else if (window.api.platform !== 'win32') { $('t-autoStart').textContent = 'Sistem ile birlikte başlat'; $('t-tray').textContent = 'Kapatıldığında sistem tepsisine küçült'; }
$('s-linkedin').onclick = () => window.api.openExternal('https://www.linkedin.com/in/taha-u%C4%9Furlu-367229434');

let shutTimer = null;
async function beginShutdown() {
  const ok = await window.api.shutdownStart();
  if (!ok) return;
  let sec = 60; $('shutSec').textContent = sec; $('shutModal').classList.remove('hidden');
  shutTimer = setInterval(() => { sec--; $('shutSec').textContent = Math.max(0, sec); if (sec <= 0) clearInterval(shutTimer); }, 1000);
}
$('shutCancel').onclick = async () => {
  clearInterval(shutTimer); await window.api.shutdownAbort();
  $('shutModal').classList.add('hidden'); $('shutdownAfter').checked = false;
};

/* ================= Önizleme ================= */
function openPreview({ title, src, kind, thumb, url, file, note }) {
  const body = $('pv-body'), acts = $('pv-acts');
  $('pv-title').textContent = title || 'Önizleme'; body.innerHTML = ''; acts.innerHTML = '';
  const fallback = msg => {
    body.innerHTML = (thumb ? `<img src="${esc(thumb)}" alt="">` : '') + `<div class="pv-note">${esc(msg)}</div>`;
  };
  if (kind === 'image') body.innerHTML = `<img src="${esc(src)}" alt="">`;
  else if (kind === 'video' || kind === 'audio') {
    const el = document.createElement(kind); el.controls = true; el.autoplay = true; el.src = src;
    el.onerror = () => fallback('Bu dosya uygulama içinde oynatılamıyor. Varsayılan oynatıcıda açabilirsiniz.');
    body.appendChild(el);
  } else fallback(note || 'Bu içerik uygulama içinde oynatılamaz.');
  const mk = (label, fn, primary) => { const b = document.createElement('button'); b.className = 'btn sm ' + (primary ? 'primary' : 'quiet'); b.textContent = label; b.onclick = fn; acts.appendChild(b); };
  if (file) { mk('Varsayılan oynatıcıda aç', () => window.api.openFile(file), true); mk('Klasörde göster', () => window.api.showFile(file)); }
  else if (url && /^https?:/i.test(url)) mk('Tarayıcıda aç', () => window.api.openExternal(url), true);
  $('prevModal').classList.remove('hidden');
}
function closePreview() { $('pv-body').innerHTML = ''; $('prevModal').classList.add('hidden'); }
$('pv-close').onclick = closePreview;
$('prevModal').onclick = e => { if (e.target === $('prevModal')) closePreview(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('prevModal').classList.contains('hidden')) closePreview(); });
function previewFile(file, title) {
  const kind = IMAGE_EXT.test(file) ? 'image' : AUDIO_EXT.test(file) ? 'audio' : VIDEO_EXT.test(file) ? 'video' : null;
  openPreview({ title: title || file.split(/[\\/]/).pop(), src: fileUrl(file), kind, file, note: 'Bu dosya türü uygulama içinde önizlenemiyor.' });
}
function openItemPreview(it) {
  if (it.file && !it.gallery) return previewFile(it.file, it.title);
  if (it.direct && IMAGE_EXT.test(it.url)) return openPreview({ title: it.title, src: it.url, kind: 'image', url: it.url });
  if (it.direct && VIDEO_EXT.test(it.url)) return openPreview({ title: it.title, src: it.url, kind: 'video', url: it.url });
  if (it.direct && AUDIO_EXT.test(it.url)) return openPreview({ title: it.title, src: it.url, kind: 'audio', url: it.url });
  const link = /^https?:/i.test(it.url) ? it.url : (it.srcUrl || '');
  openPreview({ title: it.title + (it.duration ? ' · ' + fmtDur(it.duration) : ''), kind: null, thumb: it.thumb, url: link, note: 'Bu içerik uygulama içinde oynatılamaz. Kapak görseli gösteriliyor; izlemek için tarayıcıda açabilirsiniz.' });
}

/* ================= Dönüştürme ================= */
function addFiles(paths) {
  for (const p of paths) {
    if (!p || cvFiles.some(f => f.path === p)) continue;
    cvFiles.push({ id: 'c' + uid(), path: p, name: p.split(/[\\/]/).pop() });
  }
  renderCv();
}
let cvBusy = false;
function renderCv() {
  if (!cvFiles.length) {
    $('cvList').innerHTML = `<div class="empty">${ic('convert')}<b>Dosya eklenmedi</b><span>Dönüştürmek istediğiniz dosyaları ekleyin.</span></div>`;
    $('btnCv').disabled = true; return;
  }
  $('cvList').innerHTML = cvFiles.map((f, i) => `
    <div class="item" id="it-${f.id}">
      <div class="ph sq">${ic(AUDIO_EXT.test(f.name) ? 'music' : 'film')}</div>
      <div class="info">
        <div class="t" title="${esc(f.path)}">${esc(f.name)}</div>
        <div class="meta" data-meta="${f.id}">Bekliyor</div>
        <div class="bar"><i data-bar="${f.id}"></i></div>
      </div>
      <button class="iconbtn" data-i="${i}" ${cvBusy ? 'disabled' : ''} title="Listeden kaldır">${ic('x')}</button>
    </div>`).join('');
  $('cvList').querySelectorAll('.iconbtn').forEach(b => b.onclick = () => { cvFiles.splice(+b.dataset.i, 1); renderCv(); });
  $('btnCv').disabled = cvBusy;
}
$('btnPick').onclick = async () => addFiles(await window.api.pickFiles());
$('btnClear').onclick = () => { if (!cvBusy) { cvFiles = []; renderCv(); } };
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.remove('over'); } }));
window.addEventListener('drop', e => {
  const ps = [...(e.dataTransfer.files || [])].map(f => window.api.pathOf(f)).filter(Boolean);
  if (!ps.length) return;
  const pg = activePage();
  if (pg === 'page-tg' && AUDIO_EXT.test(ps[0])) { loadTagFile(ps[0]); return; }
  if (pg === 'page-rn') { addRename(ps); return; }
  goto('cv'); addFiles(ps);
});
$('btnCv').onclick = async () => {
  if (!cvFiles.length) return;
  const trim = readTrim('cvSs', 'cvTo'); if (!trim) return;
  const mbRaw = $('cvMb').value.trim().replace(',', '.');
  const mb = mbRaw ? parseFloat(mbRaw) : null;
  if (mbRaw && !(mb > 0)) { toast('Hedef boyut geçersiz', 'Megabayt cinsinden bir sayı girin (örn. 25).', [], { error: true }); return; }
  cvBusy = true; $('btnCv').disabled = true; $('btnCvCancel').disabled = false;
  renderCv();
  await window.api.startConvert({
    files: cvFiles.map(f => ({ id: f.id, path: f.path })), format: $('fmt').value, folder: S.cvFolder,
    quality: $('cvQuality').value, res: $('cvRes').value, ss: trim.ss, to: trim.to, mb,
    normalize: $('cvNormalize').checked, trimSilence: $('cvTrim').checked
  });
};
$('btnCvCancel').onclick = () => window.api.cancel('convert');
$('btnCvFolder').onclick = async () => { const f = await window.api.pickFolder(); if (f) { await save({ cvFolder: f }); showFolders(); } };
$('btnCvOpen').onclick = () => window.api.openFolder(S.cvFolder);

/* ================= Toplu adlandırma ================= */
let rnFiles = [], rnLast = [];
const baseOf = p => p.split(/[\\/]/).pop();
const splitExt = n => { const i = n.lastIndexOf('.'); return i > 0 ? [n.slice(0, i), n.slice(i)] : [n, '']; };
async function addRename(paths) {
  const fresh = paths.filter(p => p && !rnFiles.some(f => f.path === p));
  if (!fresh.length) return;
  $('rn-msg').textContent = 'Etiketler okunuyor…';
  const tags = await window.api.tagsBulk(fresh);
  for (const p of fresh) { const [name, ext] = splitExt(baseOf(p)); rnFiles.push({ path: p, name, ext, tags: tags[p] || null }); }
  $('rn-msg').textContent = ''; renderRename();
}
async function renderRename() {
  if (!rnFiles.length) {
    $('rn-list').innerHTML = `<div class="empty">${ic('type')}<b>Dosya eklenmedi</b><span>Yeniden adlandırmak istediğiniz dosyaları ekleyin veya bu alana sürükleyin.</span></div>`;
    $('rn-apply').disabled = true; return;
  }
  const tpl = $('rn-tpl').value.trim() || '{ad}';
  const opts = { caseMode: $('rn-case').value, ascii: $('rn-ascii').checked, underscore: $('rn-us').checked };
  const bases = await Promise.all(rnFiles.map((f, i) => window.api.buildName({
    tpl, opts, v: { ad: f.name, title: f.tags?.title || '', artist: f.tags?.artist || '', album: f.tags?.album || '', year: (f.tags?.date || '').slice(0, 4), genre: f.tags?.genre || '', track: f.tags?.track || '', index: i + 1 }
  })));
  const seen = new Map();
  rnFiles.forEach((f, i) => {                       // aynı yeni ad çıkarsa sonuna (2), (3) ekle
    let b = bases[i] || f.name, k = b.toLowerCase() + f.ext.toLowerCase(), n = 2;
    while (seen.has(k)) { b = `${bases[i] || f.name} (${n++})`; k = b.toLowerCase() + f.ext.toLowerCase(); }
    seen.set(k, true); f.newName = b + f.ext;
  });
  $('rn-list').innerHTML = rnFiles.map((f, i) => {
    const same = f.newName === baseOf(f.path);
    return `<div class="item ${same ? '' : ''}">
      <div class="ph sq">${ic(AUDIO_EXT.test(f.ext) ? 'music' : 'film')}</div>
      <div class="info"><div class="t diff" title="${esc(f.path)}">${esc(baseOf(f.path))}</div>
        <div class="t diff"><b>${same ? 'Değişmeyecek' : '→ ' + esc(f.newName)}</b></div></div>
      <button class="iconbtn" data-i="${i}" title="Listeden kaldır">${ic('x')}</button></div>`;
  }).join('');
  $('rn-list').querySelectorAll('.iconbtn').forEach(b => b.onclick = () => { rnFiles.splice(+b.dataset.i, 1); renderRename(); });
  $('rn-apply').disabled = !rnFiles.some(f => f.newName !== baseOf(f.path));
}
$('rn-pick').onclick = async () => addRename(await window.api.pickRenameFiles());
$('rn-clear').onclick = () => { rnFiles = []; renderRename(); };
['rn-tpl', 'rn-case', 'rn-ascii', 'rn-us'].forEach(id => { $(id).oninput = $(id).onchange = () => { if (id === 'rn-tpl') save({ renameTpl: $('rn-tpl').value }); renderRename(); }; });
$('rn-apply').onclick = async () => {
  const pairs = rnFiles.filter(f => f.newName !== baseOf(f.path)).map(f => ({ from: f.path, to: f.path.slice(0, f.path.length - baseOf(f.path).length) + f.newName }));
  if (!pairs.length) return;
  const res = await window.api.renameFiles(pairs);
  const okp = res.filter(r => r.ok), bad = res.filter(r => !r.ok);
  rnLast = okp.map(r => ({ from: r.to, to: r.from }));
  for (const r of okp) { const f = rnFiles.find(x => x.path === r.from); if (f) { f.path = r.to; [f.name, f.ext] = splitExt(baseOf(r.to)); } }
  $('rn-undo').disabled = !rnLast.length;
  $('rn-msg').textContent = `${okp.length} dosya yeniden adlandırıldı${bad.length ? `, ${bad.length} dosyada hata oluştu` : ''}.`;
  if (bad.length) toast('Bazı dosyalar adlandırılamadı', baseOf(bad[0].from) + ': ' + bad[0].error, [], { error: true });
  renderRename();
};
$('rn-undo').onclick = async () => {
  if (!rnLast.length) return;
  const res = await window.api.renameFiles(rnLast);
  for (const r of res.filter(x => x.ok)) { const f = rnFiles.find(x => x.path === r.from); if (f) { f.path = r.to; [f.name, f.ext] = splitExt(baseOf(r.to)); } }
  $('rn-msg').textContent = `${res.filter(x => x.ok).length} dosya eski adına döndürüldü.`;
  rnLast = []; $('rn-undo').disabled = true; renderRename();
};

/* ================= Görsel arama ================= */
let imAll = [], imSel = new Set(), imPage = 0, imBusy = false;
function imView() {
  const min = +$('im-size').value;
  let v = imAll.filter(x => Math.max(x.width, x.height) >= min);
  if ($('im-sort').value === 'big') v = v.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return v;
}
function renderImages() {
  const v = imView();
  if (!v.length) {
    $('im-grid').innerHTML = `<div class="empty">${ic('image')}<b>Sonuç bulunamadı</b><span>${imAll.length ? 'Seçili çözünürlük filtresine uyan görsel yok. Filtreyi düşürün veya daha fazla sonuç yükleyin.' : 'Farklı bir arama ifadesi deneyin.'}</span></div>`;
  } else {
    $('im-grid').innerHTML = v.map(x => `
      <div class="imgc ${imSel.has(x.id) ? 'on' : ''}" data-id="${esc(x.id)}" title="${esc(x.title)}">
        <div class="im" style="background-image:url('${esc(x.thumb)}')"><span class="res">${x.width && x.height ? x.width + ' × ' + x.height : 'Boyut bilinmiyor'}</span><span class="ck">${ic('check')}</span></div>
        <div class="cap"><b>${esc(x.title)}</b><span>${esc([x.license, x.creator].filter(Boolean).join(' · ') || 'Lisans bilgisi yok')}</span></div>
      </div>`).join('');
    $('im-grid').querySelectorAll('.imgc').forEach(c => c.onclick = () => {
      const id = c.dataset.id; imSel.has(id) ? imSel.delete(id) : imSel.add(id); c.classList.toggle('on'); imCount();
    });
  }
  imCount();
}
function imCount() {
  const v = imView();
  $('im-count').textContent = imAll.length ? `${v.length} görsel gösteriliyor · ${imSel.size} seçili` : '';
  $('im-dl').disabled = imSel.size === 0;
  $('im-more').disabled = imBusy || !imAll.length;
}
async function imSearch(more) {
  const q = $('im-q').value.trim();
  if (!q) { toast('Arama ifadesi boş', 'Aramak için bir ifade yazın.', [], { error: true }); return; }
  if (!more) { imAll = []; imSel.clear(); imPage = 0; }
  imBusy = true; $('im-go').disabled = true; $('im-more').disabled = true; $('im-msg').textContent = 'Aranıyor…';
  const r = await window.api.imageSearch({ q, source: $('im-src').value, page: imPage });
  imBusy = false; $('im-go').disabled = false; $('im-msg').textContent = '';
  if (!r.ok) { toast('Arama başarısız', r.error, [], { error: true }); renderImages(); return; }
  const seen = new Set(imAll.map(x => x.id));
  r.items.forEach(x => { if (!seen.has(x.id)) imAll.push(x); });
  imPage++;
  $('im-title').textContent = `“${q}” için sonuçlar`;
  renderImages();
  if (!r.more) $('im-more').disabled = true;
}
$('im-go').onclick = () => imSearch(false);
$('im-q').onkeydown = e => { if (e.key === 'Enter') imSearch(false); };
$('im-more').onclick = () => imSearch(true);
$('im-size').onchange = $('im-sort').onchange = renderImages;
$('im-all').onchange = e => { imView().forEach(x => e.target.checked ? imSel.add(x.id) : imSel.delete(x.id)); renderImages(); };
$('im-dl').onclick = async () => {
  const chosen = imAll.filter(x => imSel.has(x.id));
  if (!chosen.length) return;
  const its = chosen.map((x, i) => ({
    id: 'img-' + uid() + i, title: x.title, url: x.url, direct: true, imageSearch: true, thumb: x.thumb,
    source: [x.license, x.creator].filter(Boolean).join(' · ') || 'Görsel Arama', sel: false, status: 'queued', percent: 0, index: items.length + i + 1
  }));
  items.push(...its); renderList();
  imSel.clear(); renderImages();
  $('btnCancel').disabled = false;
  await window.api.startDownload({
    items: its.map(i => ({ id: i.id, title: i.title, url: i.url, direct: true, imageSearch: true, index: i.index })),
    opts: { folder: S.folder, mode: 'video', concurrency: +$('conc').value }
  });
  toast(`${its.length} görsel kuyruğa eklendi`, 'İlerlemeyi İndirme sayfasından izleyebilirsiniz.', [{ label: 'İndirme sayfasına git', primary: true, run: () => goto('dl') }]);
};

/* ================= Etiket düzenleyici ================= */
let tg = null; // { file, orig, coverMode, coverPath, coverOk, origCover }
const TFIELDS = { title: 't-title', artist: 't-artist', album: 't-album', album_artist: 't-albumartist', date: 't-date', genre: 't-genre', track: 't-track', comment: 't-comment' };
function setCover(src) { $('t-coverbox').innerHTML = src ? `<img src="${src}" alt="">` : ic('image'); }
async function loadTagFile(file) {
  goto('tg');
  $('t-msg').textContent = 'Dosya okunuyor…';
  const r = await window.api.tagsRead(file);
  $('t-msg').textContent = '';
  if (!r.ok) { toast('Dosya okunamadı', r.error, [], { error: true }); return; }
  tg = { file, orig: r.tags, coverMode: 'keep', coverPath: null, coverOk: r.coverOk, origCover: r.cover };
  $('t-empty').classList.add('hidden'); $('t-card').classList.remove('hidden');
  $('t-name').textContent = r.name;
  for (const [k, id] of Object.entries(TFIELDS)) $(id).value = r.tags[k] || '';
  setCover(r.cover);
  $('t-coverset').disabled = $('t-coverrm').disabled = !r.coverOk;
  $('t-covernote').textContent = r.coverOk ? '' : 'Bu dosya biçimi kapak görselini desteklemiyor.';
}
$('t-open').onclick = async () => { const f = await window.api.pickAudio(); if (f) loadTagFile(f); };
$('t-coverset').onclick = async () => {
  const img = await window.api.pickImage(); if (!img || !tg) return;
  tg.coverMode = 'new'; tg.coverPath = img.path; setCover(img.dataUrl);
};
$('t-coverrm').onclick = () => { if (!tg) return; tg.coverMode = 'remove'; tg.coverPath = null; setCover(null); };
$('t-reset').onclick = () => {
  if (!tg) return;
  for (const [k, id] of Object.entries(TFIELDS)) $(id).value = tg.orig[k] || '';
  tg.coverMode = 'keep'; tg.coverPath = null; setCover(tg.origCover);
};
$('t-fromname').onclick = () => {
  if (!tg) return;
  const base = tg.file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/^\d+\s*[-.]\s*/, '');
  const m = base.split(' - ');
  if (m.length >= 2) { $('t-artist').value = m[0].trim(); $('t-title').value = m.slice(1).join(' - ').trim(); }
  else $('t-title').value = base.trim();
};
$('t-save').onclick = async () => {
  if (!tg) return;
  const tags = {};
  for (const [k, id] of Object.entries(TFIELDS)) tags[k] = $(id).value.trim();
  $('t-save').disabled = true; $('t-msg').textContent = 'Kaydediliyor…';
  const r = await window.api.tagsWrite({ file: tg.file, tags, coverMode: tg.coverMode, coverPath: tg.coverPath });
  $('t-save').disabled = false; $('t-msg').textContent = '';
  if (r.ok) { toast('Etiketler kaydedildi', tg.file.split(/[\\/]/).pop()); loadTagFile(tg.file); }
  else toast('Kaydedilemedi', r.error, [], { error: true });
};

/* ================= Geçmiş ================= */
let histCache = [];
async function loadHistory() { histCache = await window.api.historyList(); renderHistory(); }
function renderHistory() {
  const q = $('h-search').value.trim().toLowerCase(), f = $('h-filter').value;
  const v = histCache.filter(h => (f === 'all' || h.kind === f) && (!q || (h.title || '').toLowerCase().includes(q) || (h.file || '').toLowerCase().includes(q)));
  if (!v.length) {
    $('h-list').innerHTML = `<div class="empty">${ic('clock')}<b>${histCache.length ? 'Eşleşen kayıt yok' : 'Henüz kayıt yok'}</b><span>Tamamlanan indirme ve dönüştürme işlemleri burada listelenir.</span></div>`;
    return;
  }
  const previewable = h => h.exists && (IMAGE_EXT.test(h.file) || AUDIO_EXT.test(h.file) || VIDEO_EXT.test(h.file));
  $('h-list').innerHTML = v.map(h => `
    <div class="item" data-id="${esc(h.id)}">
      <div class="ph sq">${ic(h.mode === 'audio' ? 'music' : h.mode === 'video' ? 'film' : 'download')}</div>
      <div class="info">
        <div class="t" title="${esc(h.file || h.title)}">${esc(h.title)}${h.file && !h.exists ? '<span class="badge warn">Dosya bulunamadı</span>' : ''}</div>
        <div class="meta">${h.kind === 'convert' ? 'Dönüştürme' : 'İndirme'} · ${esc((h.fmt || '').toUpperCase())} · ${fmtDate(h.date)}</div>
      </div>
      <div class="acts">
        ${previewable(h) ? `<button class="iconbtn" data-a="prev" title="Önizle">${ic('eye')}</button>` : ''}
        ${h.exists ? `<button class="iconbtn" data-a="open" title="Dosyayı aç">${ic('external')}</button>` : ''}
        ${h.exists || h.folder ? `<button class="iconbtn" data-a="show" title="Klasörde göster">${ic('folder')}</button>` : ''}
        ${h.exists && AUDIO_EXT.test(h.file || '') ? `<button class="iconbtn" data-a="tag" title="Etiketleri düzenle">${ic('tag')}</button>` : ''}
        ${h.kind === 'download' && h.url ? `<button class="iconbtn" data-a="again" title="Tekrar indir">${ic('download')}</button>` : ''}
        <button class="iconbtn danger" data-a="del" title="Kaydı sil">${ic('trash')}</button>
      </div>
    </div>`).join('');
  $('h-list').querySelectorAll('.item').forEach(row => {
    const h = histCache.find(x => x.id === row.dataset.id);
    row.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'prev') previewFile(h.file, h.title);
      else if (a === 'open') window.api.openFile(h.file);
      else if (a === 'show') (h.exists ? window.api.showFile(h.file) : window.api.openFolder(h.folder));
      else if (a === 'tag') loadTagFile(h.file);
      else if (a === 'again') { $('url').value = h.url; if (['video', 'audio'].includes(h.mode) && h.mode !== mode) setMode(h.mode); goto('dl'); updateChips(); fetchInfo(); }
      else if (a === 'del') { await window.api.historyRemove(h.id); loadHistory(); }
    });
  });
}
$('h-search').oninput = renderHistory; $('h-filter').onchange = renderHistory;
$('h-clear').onclick = () => {
  if (!histCache.length) return;
  toast('Geçmiş temizlensin mi?', 'Yalnızca kayıtlar silinir; dosyalarınıza dokunulmaz.', [
    { label: 'Temizle', primary: true, run: async () => { await window.api.historyClear(); loadHistory(); } }, { label: 'Vazgeç' }]);
};

/* ================= Kaynak takibi ================= */
async function loadFollows() {
  const fl = await window.api.followList();
  if (!fl.length) {
    $('f-list').innerHTML = `<div class="empty">${ic('radio')}<b>Takip edilen kaynak yok</b><span>Bir kanal, profil veya oynatma listesi bağlantısı ekleyin. Yeni içerik yayınlandığında otomatik indirilir.</span></div>`;
    return;
  }
  $('f-list').innerHTML = fl.map(f => `
    <div class="item" data-id="${esc(f.id)}">
      <div class="ph sq">${ic('radio')}</div>
      <div class="info">
        <div class="t" title="${esc(f.url)}">${esc(f.name)}</div>
        <div class="meta">${esc(f.url)}</div>
        <div class="meta">Son denetim: ${fmtDate(f.lastCheck)} · Eklenen içerik: ${f.count || 0}${f.lastError ? ' · Hata: ' + esc(f.lastError) : ''}</div>
      </div>
      <select data-a="mode"><option value="video" ${f.mode === 'video' ? 'selected' : ''}>Video</option><option value="audio" ${f.mode === 'audio' ? 'selected' : ''}>Ses</option></select>
      <div class="acts">
        <button class="iconbtn" data-a="check" title="Şimdi denetle">${ic('refresh')}</button>
        <button class="iconbtn danger" data-a="del" title="Takibi bırak">${ic('trash')}</button>
      </div>
    </div>`).join('');
  $('f-list').querySelectorAll('.item').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-a=mode]').onchange = e => window.api.followMode({ id, mode: e.target.value });
    row.querySelector('[data-a=check]').onclick = () => window.api.followCheck(id);
    row.querySelector('[data-a=del]').onclick = async () => { await window.api.followRemove(id); loadFollows(); };
  });
}
$('f-add').onclick = async () => {
  const url = $('f-url').value.trim();
  if (!detect(url)) { toast('Bağlantı geçersiz', 'Geçerli bir kanal veya liste bağlantısı girin.', [], { error: true }); return; }
  $('f-add').disabled = true; $('f-msg').textContent = 'Kaynak denetleniyor…';
  const r = await window.api.followAdd({ url, mode: $('f-mode').value });
  $('f-add').disabled = false;
  $('f-msg').textContent = 'Takibe alındığı anda mevcut içerikler indirilmez; yalnızca bundan sonra yayınlananlar eklenir.';
  if (!r.ok) { toast('Takibe alınamadı', r.error, [], { error: true }); return; }
  $('f-url').value = ''; loadFollows(); toast('Kaynak takibe alındı', 'Yeni içerikler otomatik olarak kuyruğa eklenecek.');
};
$('f-url').onkeydown = e => { if (e.key === 'Enter') $('f-add').click(); };
$('f-check').onclick = () => window.api.followCheck('');

/* ================= Ayarlar ================= */
function showFolders() {
  $('folder').textContent = S.folder; $('cvFolder').textContent = S.cvFolder;
  $('s-folder-t').textContent = S.folder; $('s-cvfolder-t').textContent = S.cvFolder;
}
function fillControls() {
  mode = S.mode || 'video';
  const set = (id, v) => { const e = $(id); if (e.type === 'checkbox') e.checked = !!v; else e.value = v ?? ''; };
  set('vfmt', S.vfmt); set('quality', S.quality); set('afmt', S.afmt); set('abr', S.abr); set('conc', S.conc);
  set('numbered', S.numbered); set('subs', S.subs); set('subsFile', S.subsFile); set('embedThumb', S.embedThumb);
  set('normalize', S.normalize); set('trimSilence', S.trimSilence); set('splitChapters', S.splitChapters); set('liveFromStart', S.liveFromStart);
  set('fmt', S.cvFmt); set('cvQuality', S.cvQuality); set('cvRes', S.cvRes); set('cvMb', S.cvMb || ''); set('cvNormalize', S.cvNormalize); set('cvTrim', S.cvTrimSilence);
  set('rn-tpl', S.renameTpl);
  set('s-theme', S.theme); set('s-zoom', S.zoom); set('s-nameTpl', S.nameTpl); set('s-rate', S.rate); set('s-subLang', S.subLang);
  set('s-cookies', S.cookies); set('s-notify', S.notify); set('s-openDone', S.openDone); set('s-clip', S.clipWatch);
  set('s-autoStart', S.autoStart); set('s-tray', S.tray); set('s-followMin', S.followMin); set('s-autoUpdate', S.autoUpdate); set('s-galleryMax', S.galleryMax);
  $('s-cookiefile-row').classList.toggle('hidden', S.cookies !== 'file');
  $('s-cookiefile-t').textContent = S.cookieFile || 'Seçilmedi';
  showFolders(); applyMode();
}
const sb = (id, key, conv) => { $(id).onchange = e => { const el = e.target; save({ [key]: conv ? conv(el) : (el.type === 'checkbox' ? el.checked : el.value) }); }; };
$('s-theme').onchange = async e => { await save({ theme: e.target.value }); applyDesign(); };
$('s-zoom').onchange = async e => { await save({ zoom: e.target.value }); window.api.setZoom(e.target.value); };
sb('s-nameTpl', 'nameTpl'); sb('s-notify', 'notify'); sb('s-openDone', 'openDone'); sb('s-clip', 'clipWatch');
sb('s-galleryMax', 'galleryMax', el => +el.value);
sb('s-autoStart', 'autoStart'); sb('s-tray', 'tray'); sb('s-followMin', 'followMin', el => +el.value); sb('s-autoUpdate', 'autoUpdate');
sb('s-rate', 'rate', el => el.value.trim()); sb('s-subLang', 'subLang', el => el.value.trim() || 'tr,en');
$('s-cookies').onchange = e => { save({ cookies: e.target.value }); $('s-cookiefile-row').classList.toggle('hidden', e.target.value !== 'file'); };
$('s-cookiefile').onclick = async () => { const f = await window.api.pickCookieFile(); if (f) { await save({ cookieFile: f }); $('s-cookiefile-t').textContent = f; } };
$('s-folder').onclick = $('btnFolder').onclick;
$('s-cvfolder').onclick = $('btnCvFolder').onclick;
$('s-reset').onclick = () => toast('Ayarlar sıfırlansın mı?', 'Tüm tercihler varsayılan değerlere döner. Özel ön ayarlarınız da silinir.', [{
  label: 'Sıfırla', primary: true, run: async () => {
    S = await window.api.resetSettings();
    S.folder = S.folder || defFolder; S.cvFolder = S.cvFolder || defFolder + '\\Dönüştürülen';
    fillControls(); applyDesign(); renderPresetBars();
  }
}, { label: 'Vazgeç' }]);
async function updateEngine() {
  $('btnUpd').disabled = $('s-engine').disabled = true; setStatus('Motor güncelleniyor…', 'work');
  const r = await window.api.updateYtdlp();
  setStatus(r.ok ? 'Motor güncellendi' : 'Güncelleme başarısız', r.ok ? 'ok' : 'bad');
  if (!r.ok) toast('Güncelleme başarısız', r.error, [], { error: true });
  $('btnUpd').disabled = $('s-engine').disabled = false; loadVersions();
}
$('btnUpd').onclick = updateEngine; $('s-engine').onclick = updateEngine;
async function loadVersions() {
  const v = await window.api.engineInfo();
  $('s-versions').textContent = `Uygulama ${v.app} · yt-dlp ${v.ytdlp || 'yüklü değil'} · ffmpeg ${v.ffmpeg ? 'hazır' : 'yok'} · galeri motoru ${v.gallery ? 'yüklü' : 'ilk kullanımda yüklenir'} · JavaScript çalıştırıcı ${v.js ? 'var' : 'yok'}${v.last ? ' · son denetim ' + fmtDate(v.last) : ''}`;
}

/* ================= Olaylar (ana süreçten) ================= */
window.api.on('progress', p => {
  const it = items.find(x => x.id === p.id);
  if (it) {
    const prev = it.status;
    it.status = p.state === 'done' ? 'done' : p.state === 'error' ? 'error' : p.state;
    it.percent = p.percent; it.speed = p.speed; it.eta = p.eta; it.error = p.error; it.note = p.note || '';
    if (p.file) it.file = p.file; if (p.count) it.count = p.count;
    if (prev !== it.status && ['queued', 'paused', 'done', 'error'].includes(it.status)) { renderList(); return; }   // eylem düğmeleri değişir
  }
  const bar = document.querySelector(`[data-bar="${CSS.escape(p.id)}"]`);
  const meta = document.querySelector(`[data-meta="${CSS.escape(p.id)}"]`);
  const row = document.getElementById('it-' + p.id);
  if (!bar) return;
  bar.style.width = p.percent + '%';
  row.classList.toggle('done', p.state === 'done');
  row.classList.toggle('err', p.state === 'error');
  row.classList.toggle('queued', p.state === 'queued');
  if (it) { meta.textContent = metaText(it, items.indexOf(it)); return; }
  if (p.state === 'downloading') meta.textContent = `%${p.percent.toFixed(1)}`;
  else if (p.state === 'done') meta.textContent = 'Tamamlandı';
  else if (p.state === 'error') meta.textContent = 'Hata: ' + (p.error || 'bilinmeyen');
  else meta.textContent = 'İşleniyor…';
});
window.api.on('overall', o => {
  if (o.scope === 'convert') $('cvOverall').textContent = `${o.done} / ${o.total} dosya işlendi`;
  else $('overall').textContent = `${o.done} / ${o.total} tamamlandı · ${o.running} etkin`;
});
window.api.on('status', s => setStatus(s, 'work'));
window.api.on('finished', f => {
  if (f.scope === 'convert') {
    cvBusy = false; $('btnCvCancel').disabled = true; $('btnCv').disabled = false;
    $('cvOverall').textContent += f.cancelled ? ' · iptal edildi' : ' · tamamlandı';
    document.querySelectorAll('#cvList .iconbtn').forEach(b => b.disabled = false);
  } else {
    $('btnCancel').disabled = true;
    $('overall').textContent += f.cancelled ? ' · iptal edildi' : ' · tamamlandı';
    updateCount();
    if (!f.cancelled && $('shutdownAfter').checked) beginShutdown();
  }
});
window.api.on('auto-added', list => {
  list.forEach(x => items.push(x));
  items.forEach((x, i) => x.index = i + 1);
  renderList();
  $('btnCancel').disabled = false;
  toast('Takip edilen kaynaktan yeni içerik', `${list.length} içerik indirme kuyruğuna eklendi.`);
});
window.api.on('history-updated', () => { if (activePage() === 'page-hs') loadHistory(); });
window.api.on('follows-updated', () => { if (activePage() === 'page-fw') loadFollows(); });
window.api.on('follows-checking', on => { $('f-check').disabled = on; });
window.api.on('clip-link', link => {
  const p = detect(link);
  if (!p || links().includes(link) || items.some(i => i.url === link)) return;
  let host = link; try { host = new URL(link).hostname.replace(/^www\./, ''); } catch {}
  toast('Panoda bir bağlantı algılandı', `${p} · ${host}`, [
    { label: 'Listeye ekle', primary: true, run: () => { $('url').value = link; goto('dl'); updateChips(); fetchInfo(); } },
    { label: 'Yoksay' }
  ]);
});

/* ================= Başlangıç ================= */
(async () => {
  S = await window.api.getSettings();
  defFolder = await window.api.defaultFolder();
  if (!S.folder) S.folder = defFolder;
  if (!S.cvFolder) S.cvFolder = defFolder + '\\Dönüştürülen';
  fillControls(); applyDesign();
  // varsayılan ön ayarlar (varsa) açılışta uygulanır
  for (const key of ['defaultDl', 'defaultCv']) { const p = S[key] && findPreset(S[key]); if (p) { await save(eff(p)); } }
  fillControls(); renderPresetBars(); renderRename(); renderCv(); updateChips(); schedUI(); setPausedUI(false);
  setStatus('Motor hazırlanıyor…', 'work');
  const r = await window.api.init();
  setStatus(r.ok ? 'Hazır' : 'Motor yüklenemedi', r.ok ? 'ok' : 'bad');
  if (!r.ok) toast('İndirme motoru yüklenemedi', 'İnternet bağlantınızı denetleyin. ' + (r.error || ''), [], { error: true });
})();

// Electron'dan bağımsız ffmpeg yardımcıları (test edilebilir)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ffmpeg = () => require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

function run(args, reg) {
  return new Promise(resolve => {
    const p = spawn(ffmpeg(), args, { windowsHide: true });
    if (reg) reg(p);
    let out = [], err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', e => resolve({ code: -1, stdout: '', stderr: String(e.message) }));
    p.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}
const lastLine = s => (String(s).trim().split(/\r?\n/).filter(Boolean).pop() || '').slice(0, 300);

// ffmpeg -progress ile yüzde bildirir
function runProgress(args, dur, onPct, reg) {
  return new Promise(resolve => {
    const p = spawn(ffmpeg(), [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { windowsHide: true });
    if (reg) reg(p);
    let err = '', buf = '';
    p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.stdout.on('data', d => {
      buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && dur) onPct(Math.min(99, (+m[1] / 1e6 / dur) * 100));
      }
    });
    p.on('error', e => resolve({ code: -1, lastErr: String(e.message) }));
    p.on('close', code => resolve({ code, lastErr: lastLine(err) }));
  });
}

async function probeDuration(file) {
  const r = await run(['-hide_banner', '-i', file]);
  const m = r.stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// "1:23", "01:02:03", "83", "83.5" -> saniye (boş/geçersiz -> null)
function parseTime(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (!s) return null;
  const parts = s.split(':').map(x => x.trim());
  if (parts.length > 3 || parts.some(x => !/^\d+(\.\d+)?$/.test(x))) return null;
  return parts.reduce((a, x) => a * 60 + parseFloat(x), 0);
}

function afChain({ normalize, trim } = {}) {
  const p = [];
  if (trim) {
    const sr = 'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB';
    p.push(sr, 'areverse', sr, 'areverse');
  }
  if (normalize) p.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return p.join(',');
}

// q: 'high' | 'balanced' | 'small', res: 'orig' | yükseklik
function convArgs(fmt, q = 'balanced', res = 'orig') {
  const crf = { high: '18', balanced: '22', small: '28' }[q] || '22';
  const ab = { high: '320k', balanced: '192k', small: '128k' }[q] || '192k';
  const mq = { high: '2', balanced: '4', small: '7' }[q] || '4';
  const scale = res && res !== 'orig' ? ['-vf', `scale=-2:'min(${res},ih)'`] : [];
  const h264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', ...scale, '-c:a', 'aac', '-b:a', ab];
  switch (fmt) {
    case 'mp4': case 'm4v': return [...h264, '-movflags', '+faststart'];
    case 'mkv': case 'mov': case 'flv': case 'ts': return h264;
    case 'webm': return ['-c:v', 'libvpx-vp9', '-crf', String(+crf + 10), '-b:v', '0', '-row-mt', '1', ...scale, '-c:a', 'libopus', '-b:a', ab];
    case 'avi': return ['-c:v', 'mpeg4', '-q:v', mq, ...scale, '-c:a', 'libmp3lame', '-b:a', ab];
    case 'mpg': return ['-c:v', 'mpeg2video', '-q:v', mq, ...scale, '-c:a', 'mp2', '-b:a', ab];
    case 'wmv': return ['-c:v', 'wmv2', '-q:v', mq, ...scale, '-c:a', 'wmav2', '-b:a', ab];
    case 'gif': return ['-vf', `fps=12,scale=${res && res !== 'orig' ? '-2:' + Math.min(+res, 480) : '480:-1'}:flags=lanczos`, '-an'];
    case 'mp3': return ['-vn', '-map_metadata', '0', '-c:a', 'libmp3lame', '-b:a', ab];
    case 'm4a': case 'aac': return ['-vn', '-map_metadata', '0', '-c:a', 'aac', '-b:a', ab];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'aiff': return ['-vn', '-c:a', 'pcm_s16be'];
    case 'flac': return ['-vn', '-map_metadata', '0', '-c:a', 'flac'];
    case 'ogg': return ['-vn', '-map_metadata', '0', '-c:a', 'libvorbis', '-q:a', { high: '8', balanced: '6', small: '3' }[q]];
    case 'opus': return ['-vn', '-map_metadata', '0', '-c:a', 'libopus', '-b:a', ab];
    case 'wma': return ['-vn', '-c:a', 'wmav2', '-b:a', ab];
    case 'ac3': return ['-vn', '-c:a', 'ac3', '-b:a', { high: '448k', balanced: '320k', small: '192k' }[q]];
    case 'mp2': return ['-vn', '-c:a', 'mp2', '-b:a', ab];
    default: return null;
  }
}

const H264_CONT = ['mp4', 'm4v', 'mkv', 'mov', 'flv', 'ts'];
const AUDIO_FMT = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus', 'wma', 'ac3', 'mp2'];

// Hedef boyuta (MB) sıkıştırma. dur = çıktı süresi (sn)
async function compressTo(file, out, { fmt, mb, dur, res, pre = [], af = '' }, onPct, reg, isCancelled = () => false) {
  if (!dur) return { code: 1, lastErr: 'Süre okunamadı' };
  const totalK = (mb * 8 * 1024 * 1024) / 1000 / dur * 0.96; // kbit/s, %4 pay
  if (AUDIO_FMT.includes(fmt)) {
    const k = Math.max(32, Math.min(320, Math.floor(totalK)));
    const spec = convArgs(fmt, 'balanced', 'orig').map((a, i, arr) => (arr[i - 1] === '-b:a' ? k + 'k' : a));
    return runProgress(['-y', '-hide_banner', ...pre, '-i', file, ...spec, ...(af ? ['-af', af] : []), out], dur, onPct, reg);
  }
  if (!H264_CONT.includes(fmt)) return { code: 1, lastErr: 'Hedef boyut yalnızca MP4, MKV, MOV, M4V, FLV, TS ve ses biçimlerinde kullanılabilir' };
  const audioK = 128;
  const videoK = Math.floor(totalK - audioK);
  if (videoK < 40) return { code: 1, lastErr: 'Hedef boyut bu süre için çok küçük' };
  const scale = res && res !== 'orig' ? ['-vf', `scale=-2:'min(${res},ih)'`] : [];
  const logBase = path.join(os.tmpdir(), 'sd-pass-' + Date.now());
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const vArgs = ['-c:v', 'libx264', '-preset', 'medium', '-b:v', videoK + 'k', '-maxrate', Math.floor(videoK * 1.5) + 'k', '-bufsize', videoK * 2 + 'k', '-pix_fmt', 'yuv420p', ...scale];
  const half1 = p => onPct(p / 2), half2 = p => onPct(50 + p / 2);
  const r1 = await runProgress(['-y', '-hide_banner', ...pre, '-i', file, ...vArgs, '-pass', '1', '-passlogfile', logBase, '-an', '-f', 'null', nul], dur, half1, reg);
  if (r1.code !== 0 || isCancelled()) { cleanPass(logBase); return r1; }
  const r2 = await runProgress(['-y', '-hide_banner', ...pre, '-i', file, ...vArgs, '-pass', '2', '-passlogfile', logBase, '-c:a', 'aac', '-b:a', audioK + 'k', ...(af ? ['-af', af] : []), ...(fmt === 'mp4' || fmt === 'm4v' ? ['-movflags', '+faststart'] : []), out], dur, half2, reg);
  cleanPass(logBase);
  return r2;
}
function cleanPass(base) {
  try { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(base))) fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
}

// ---------- Etiketler ----------
const TAG_KEYS = ['title', 'artist', 'album', 'album_artist', 'date', 'genre', 'track', 'comment'];
const COVER_EXT = ['.mp3', '.m4a', '.flac', '.mp4'];

function parseFFMeta(s) {
  const tags = {};
  for (const line of String(s).split(/\r?\n/)) {
    if (!line || line[0] === ';' || line[0] === '[') continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).toLowerCase();
    const v = line.slice(i + 1).replace(/\\([=;#\\\n])/g, '$1');
    if (!(k in tags)) tags[k] = v;
  }
  return tags;
}

async function readTags(file) {
  const r = await run(['-y', '-hide_banner', '-i', file, '-f', 'ffmetadata', '-']);
  const all = parseFFMeta(r.stdout.toString('utf8'));
  const tags = {};
  for (const k of TAG_KEYS) tags[k] = all[k] ?? all[k === 'album_artist' ? 'albumartist' : k] ?? '';
  return tags;
}

async function extractCover(file) {
  const tmp = path.join(os.tmpdir(), 'sd-cover-' + Date.now() + Math.random().toString(36).slice(2, 5) + '.jpg');
  const r = await run(['-y', '-hide_banner', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) return null;
  const b = fs.readFileSync(tmp); try { fs.unlinkSync(tmp); } catch {}
  return 'data:image/jpeg;base64,' + b.toString('base64');
}

// cover: { mode: 'keep'|'remove'|'new', path }
async function writeTags(file, tags, cover = { mode: 'keep' }) {
  const ext = path.extname(file).toLowerCase();
  const tmp = path.join(path.dirname(file), path.basename(file, ext) + '.~tmp' + ext);
  const args = ['-y', '-hide_banner', '-i', file];
  let coverJpg = null;
  const coverOk = COVER_EXT.includes(ext);
  if (cover.mode === 'new') {
    if (!coverOk) throw new Error('Bu biçim kapak resmini desteklemiyor (' + ext + ')');
    coverJpg = path.join(os.tmpdir(), 'sd-newcover-' + Date.now() + '.jpg');
    const c = await run(['-y', '-hide_banner', '-i', cover.path, '-frames:v', '1', '-q:v', '2', '-vf', "scale='min(1200,iw)':-2", coverJpg]);
    if (c.code !== 0) throw new Error('Kapak resmi okunamadı');
    args.push('-i', coverJpg, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v:0', 'attached_pic');
    if (ext === '.mp3') args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  } else if (cover.mode === 'remove' || !coverOk) {
    args.push('-map', '0:a', '-c', 'copy');
  } else {
    args.push('-map', '0', '-c', 'copy');
  }
  args.push('-map_metadata', '0');
  for (const k of TAG_KEYS) if (tags && k in tags) args.push('-metadata', `${k}=${tags[k] ?? ''}`);
  if (ext === '.mp3') args.push('-id3v2_version', '3', '-write_id3v1', '1');
  args.push(tmp);
  const r = await run(args);
  if (coverJpg) { try { fs.unlinkSync(coverJpg); } catch {} }
  if (r.code !== 0) { try { fs.unlinkSync(tmp); } catch {} throw new Error(lastLine(r.stderr) || 'ffmpeg hata ' + r.code); }
  fs.renameSync(tmp, file);
}

// Ses filtresi (normalleştirme / sessizlik kesme); kapak resmini korur
async function filterAudio(file, af, abr = 320) {
  const ext = path.extname(file).toLowerCase();
  const tmp = path.join(path.dirname(file), path.basename(file, ext) + '.~flt' + ext);
  const codec = {
    '.mp3': ['-c:a', 'libmp3lame', '-b:a', abr + 'k', '-id3v2_version', '3'],
    '.m4a': ['-c:a', 'aac', '-b:a', abr + 'k'],
    '.aac': ['-c:a', 'aac', '-b:a', abr + 'k'],
    '.opus': ['-c:a', 'libopus', '-b:a', Math.min(abr, 256) + 'k'],
    '.ogg': ['-c:a', 'libvorbis', '-q:a', '7'],
    '.flac': ['-c:a', 'flac'],
    '.wav': ['-c:a', 'pcm_s16le']
  }[ext];
  if (!codec) throw new Error('Desteklenmeyen ses biçimi: ' + ext);
  const hasCover = COVER_EXT.includes(ext);
  const args = ['-y', '-hide_banner', '-i', file, '-map', hasCover ? '0' : '0:a', '-af', af, ...(hasCover ? ['-c:v', 'copy'] : []), ...codec, '-map_metadata', '0', tmp];
  const r = await run(args);
  if (r.code !== 0) { try { fs.unlinkSync(tmp); } catch {} throw new Error(lastLine(r.stderr) || 'ffmpeg hata ' + r.code); }
  fs.renameSync(tmp, file);
}

// ---------- Sayfadan video kaynağı çıkarma (LinkedIn gönderileri ve yt-dlp'nin tanımadığı sayfalar) ----------
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
function extractVideoSources(html, pageUrl) {
  const text = unesc(html || '');
  const found = new Map();
  const add = (u, hint) => {
    u = String(u || '').trim().replace(/[)\]}>,;]+$/, '');
    if (!/^https?:\/\//i.test(u) && pageUrl) { try { u = new URL(u, pageUrl).href; } catch { return; } }
    if (!/^https?:\/\//i.test(u)) return;
    const kind = /\.m3u8(\?|$)/i.test(u) || /mpegurl/i.test(hint || '') ? 'hls' : (/\.mp4(\?|$)/i.test(u) || /\/playlist\/vid\//i.test(u) || /video\/mp4/i.test(hint || '') ? 'mp4' : (/\.webm(\?|$)/i.test(u) ? 'webm' : ''));
    if (!kind) return;
    if (!found.has(u)) found.set(u, { url: u, kind });
  };
  let m;
  const reSrc = /"src"\s*:\s*"(https?:[^"]+)"(?:\s*,\s*"type"\s*:\s*"([^"]+)")?/g;            // data-sources JSON (LinkedIn)
  while ((m = reSrc.exec(text))) add(m[1], m[2]);
  const reVid = /<(?:video|source)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*?(?:type\s*=\s*["']([^"']+)["'])?/gi;   // <video src>, <source src>
  while ((m = reVid.exec(text))) add(m[1], m[2]);
  const reMeta = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["'][^>]*content\s*=\s*["']([^"']+)["']/gi;
  while ((m = reMeta.exec(text))) add(m[1]);
  const reLic = /https?:\/\/dms\.licdn\.com\/[^\s"'<>\\]+/g;                                       // LinkedIn medya sunucusu
  while ((m = reLic.exec(text))) add(m[0], 'video/mp4');
  const reAny = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi;
  while ((m = reAny.exec(text))) add(m[0]);
  const t = (html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i) || html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const thumb = (html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  // mp4'ü HLS'e tercih et
  const list = [...found.values()].sort((a, b) => (a.kind === 'mp4' ? 0 : a.kind === 'webm' ? 1 : 2) - (b.kind === 'mp4' ? 0 : b.kind === 'webm' ? 1 : 2));
  return { title: unesc(t).replace(/\s+/g, ' ').trim(), thumb: unesc(thumb), sources: list };
}

// ---------- Toplu adlandırma ----------
const TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U', 'â': 'a', 'î': 'i', 'û': 'u' };
const titleCaseTR = s => s.toLocaleLowerCase('tr-TR').replace(/(^|[\s\-_(\[])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));
// v: { ad, başlık, sanatçı, albüm, yıl, tür, parça, sıra }
// opts: { caseMode: 'none'|'title'|'lower'|'upper', ascii, underscore }
function buildName(tpl, v, opts = {}) {
  const pad = (x, n) => (x === '' || x === undefined || x === null ? '' : String(x).replace(/\/.*$/, '').padStart(n, '0'));
  const map = {
    'ad': v.ad, 'başlık': v.title, 'baslik': v.title, 'sanatçı': v.artist, 'sanatci': v.artist, 'albüm': v.album, 'album': v.album,
    'yıl': v.year, 'yil': v.year, 'tür': v.genre, 'tur': v.genre,
    'parça': pad(v.track, 2), 'parca': pad(v.track, 2), 'sıra': v.index, 'sira': v.index, 'sıra3': pad(v.index, 3), 'sira3': pad(v.index, 3), 'sıra2': pad(v.index, 2), 'sira2': pad(v.index, 2)
  };
  let out = String(tpl || '{ad}').replace(/\{([^{}]+)\}/g, (m, k) => {
    const val = map[k.trim().toLocaleLowerCase('tr-TR')];
    return val === undefined || val === null ? '' : String(val);
  });
  out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  // boş kalan alanlardan doğan yinelenen/başıboş ayraçları temizle
  out = out.replace(/\s+/g, ' ').replace(/(\s*[-–_]\s*){2,}/g, ' - ').replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, '').trim();
  if (opts.caseMode === 'lower') out = out.toLocaleLowerCase('tr-TR');
  else if (opts.caseMode === 'upper') out = out.toLocaleUpperCase('tr-TR');
  else if (opts.caseMode === 'title') out = titleCaseTR(out);
  if (opts.ascii) out = out.replace(/[çğıöşüÇĞİÖŞÜâîû]/g, c => TR_MAP[c] || c);
  if (opts.underscore) out = out.replace(/\s+/g, '_');
  return out.slice(0, 180);
}

module.exports = { extractVideoSources, buildName, ffmpeg, run, runProgress, probeDuration, parseTime, afChain, convArgs, compressTo, readTags, extractCover, writeTags, filterAudio, parseFFMeta, TAG_KEYS, COVER_EXT, AUDIO_FMT, lastLine };

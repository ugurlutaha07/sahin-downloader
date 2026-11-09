// electron-builder "afterPack" kancası.
// ffmpeg-static yalnızca derlemeyi yapan makinenin mimarisi için ffmpeg indirir. macOS'ta tek komutla hem
// arm64 hem x64 DMG üretildiğinden, makineden farklı mimarideki pakete yanlış ffmpeg girerdi.
// Bu kanca hedef mimari makineden farklıysa doğru ffmpeg'i ffmpeg-static'in kendi yayın adresinden alıp pakete koyar.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ARCH = { 1: 'x64', 3: 'arm64' };   // electron-builder Arch sabitleri

async function fixFfmpeg(context, app) {
  const target = ARCH[context.arch];
  if (!target || target === process.arch) return;   // makine mimarisiyle aynıysa ffmpeg-static zaten doğrusunu indirmiştir

  const meta = require('ffmpeg-static/package.json')['ffmpeg-static'];
  const tag = process.env[meta['binary-release-tag-env-var']] || meta['binary-release-tag'];
  const base = process.env[meta['binaries-url-env-var']] || 'https://github.com/eugeneware/ffmpeg-static/releases/download';
  const url = `${base}/${tag}/ffmpeg-darwin-${target}.gz`;

  const dest = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (!fs.existsSync(dest)) throw new Error('[after-pack] pakette ffmpeg bulunamadı: ' + dest);

  console.log(`[after-pack] ffmpeg (${target}) indiriliyor: ${url}`);
  // Ağ kesintilerine karşı birkaç kez dene
  let lastErr;
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      fs.writeFileSync(dest, zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
      fs.chmodSync(dest, 0o755);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[after-pack] ffmpeg indirme denemesi ${i}/4 başarısız: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  throw new Error('[after-pack] ffmpeg indirilemedi: ' + lastErr.message);
}

// "Şahin" gibi aksanlı adlarda electron-builder dosya adlarını ve CFBundleExecutable'ı ayrışık (NFD) Unicode ile
// yazar; CFBundleName ve CFBundleDisplayName ise birleşik (NFC) kalır. Bu uyuşmazlık Electron'u açılışta
// çökertir (SIGTRAP). Dosya adlarını NFC'ye çevirmek bu macOS sürümünde codesign'ı çökerttiği için (SIGBUS)
// tersi yapılır: plist değerleri de NFD'ye çevrilir, böylece hepsi dosya adlarıyla aynı biçimde olur.
function plistNfd(plist, key) {
  const run = a => execFileSync('/usr/libexec/PlistBuddy', ['-c', a, plist], { encoding: 'utf8' });
  try {
    const v = run(`Print :${key}`).replace(/\n$/, '');
    if (v) run(`Set :${key} ${v.normalize('NFD')}`);
  } catch { /* anahtar yoksa geç */ }
}
function normalizeBundleNames(app) {
  const keys = ['CFBundleExecutable', 'CFBundleName', 'CFBundleDisplayName'];
  const contents = path.join(app, 'Contents');
  for (const k of keys) plistNfd(path.join(contents, 'Info.plist'), k);
  const fw = path.join(contents, 'Frameworks');
  for (const f of fs.readdirSync(fw)) {
    if (!f.endsWith('.app')) continue;
    for (const k of keys) plistNfd(path.join(fw, f, 'Contents', 'Info.plist'), k);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await fixFfmpeg(context, app);
  normalizeBundleNames(app);
  // Sertifika yoksa (build.mac.identity: null) paket imzasız kalır ve Apple Silicon'da başlarken çöker
  // (Info.plist ve kaynaklar değiştiği için Electron'un özgün imzası geçersizdir). Yerel (ad-hoc) imza atılır;
  // bu bir geliştirici sertifikası kullanmaz ve Gatekeeper uyarısını ortadan kaldırmaz.
  if (!context.packager.platformSpecificBuildOptions.identity) {
    // Yeni yazılan dosyalar üzerinde sistem geçici olarak meşgul olabilir; birkaç kez dene
    for (let i = 1; ; i++) {
      try {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: ['ignore', 'inherit', 'pipe'] });
        break;
      } catch (e) {
        console.warn(`[after-pack] codesign denemesi ${i}/4 başarısız: ${String(e.stderr || e.message).trim()}`);
        if (i >= 4) throw e;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    console.log('[after-pack] ad-hoc imza atıldı: ' + path.basename(app));
  }
};

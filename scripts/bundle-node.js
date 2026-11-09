// Derleme öncesi çalışır: YouTube için gereken JavaScript çalıştırıcısı olarak Node.js'i
// runtime-bundle/<mimari>/ klasörüne koyar. electron-builder hedef mimariye uygun klasörü
// uygulamanın "resources/node" klasörüne ekler (bkz. package.json > build.extraResources).
//
//   Windows / Linux : şu an çalışan Node kopyalanır (derleme makinesiyle aynı mimari).
//   macOS           : hem arm64 hem x64 hazırlanır. Çalışan Node bu mimarileri içeriyorsa
//                     lipo ile ayrılır; içermiyorsa nodejs.org'dan (sağlama toplamı doğrulanarak)
//                     indirilir. Böylece her DMG yalnızca kendi mimarisini taşır.
//
// Boyutu küçük tutmak isterseniz SKIP_NODE_BUNDLE=1 ayarlayın; uygulama bu durumda
// sistemde kurulu node veya deno bulursa onu kullanır.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', 'runtime-bundle');
fs.mkdirSync(root, { recursive: true });
// Önceki derlemelerden kalanları temizle (yalnızca bu betiğin ürettiği klasörler)
for (const n of fs.readdirSync(root)) {
  if (['arm64', 'x64', 'ia32', 'node', 'node.exe'].includes(n)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
}

if (process.env.SKIP_NODE_BUNDLE) {
  console.log('[bundle-node] SKIP_NODE_BUNDLE ayarlı, Node.js pakete eklenmeyecek.');
  process.exit(0);
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exe = isWin ? 'node.exe' : 'node';
const rel = p => path.relative(process.cwd(), p);

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function downloadMacNode(arch, dest) {
  const v = process.version;                       // örn. v22.11.0
  const base = `https://nodejs.org/dist/${v}`;
  const file = `node-${v}-darwin-${arch}.tar.gz`;
  const sums = (await fetchBuf(`${base}/SHASUMS256.txt`)).toString('utf8');
  const line = sums.split('\n').find(l => l.trim().endsWith(' ' + file));
  if (!line) throw new Error(`SHASUMS256.txt içinde ${file} bulunamadı`);
  const want = line.trim().split(/\s+/)[0];
  const buf = await fetchBuf(`${base}/${file}`);
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== want) throw new Error(`${file} sağlama toplamı uyuşmuyor`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sahin-node-'));
  try {
    fs.writeFileSync(path.join(tmp, file), buf);
    execFileSync('tar', ['-xzf', path.join(tmp, file), '-C', tmp, `node-${v}-darwin-${arch}/bin/node`]);
    fs.copyFileSync(path.join(tmp, `node-${v}-darwin-${arch}`, 'bin', 'node'), dest);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function macArchsOfCurrent() {
  try { return execFileSync('lipo', ['-archs', process.execPath], { encoding: 'utf8' }).trim().split(/\s+/).map(a => (a === 'x86_64' ? 'x64' : a)); } catch { return [process.arch]; }
}

(async () => {
  const targets = isMac ? ['arm64', 'x64'] : [process.arch];
  const have = isMac ? macArchsOfCurrent() : [process.arch];
  for (const arch of targets) {
    const dir = path.join(root, arch);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, exe);
    if (!isMac || have.includes(arch)) {
      if (isMac && have.length > 1) execFileSync('lipo', [process.execPath, '-thin', arch === 'x64' ? 'x86_64' : 'arm64', '-output', dest]);
      else fs.copyFileSync(process.execPath, dest);
      console.log(`[bundle-node] ${process.execPath} (${arch}) -> ${rel(dest)}`);
    } else {
      await downloadMacNode(arch, dest);
      console.log(`[bundle-node] nodejs.org ${process.version} (${arch}) -> ${rel(dest)}`);
    }
    if (!isWin) fs.chmodSync(dest, 0o755);
  }
})().catch(e => { console.error('[bundle-node] hata:', e.message); process.exit(1); });

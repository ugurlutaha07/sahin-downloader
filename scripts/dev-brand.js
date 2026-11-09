// Yalnızca macOS, yalnızca geliştirme (npm start): node_modules içindeki Electron.app'in adını ve simgesini
// "Şahin Downloader" yapar; böylece menü çubuğunda ve Dock'ta "Electron" görünmez.
// Paketlenmiş uygulama (npm run dist:mac) bu betiğe ihtiyaç duymaz. Başarısız olursa sessizce geçer.
if (process.platform !== 'darwin') process.exit(0);
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

try {
  const app = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');
  if (!fs.existsSync(app)) process.exit(0);
  const marker = path.join(app, 'Contents', 'Resources', '.sahin-brand');
  if (fs.existsSync(marker)) process.exit(0);

  const NAME = 'Şahin Downloader';
  const plist = path.join(app, 'Contents', 'Info.plist');
  const pb = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'ignore' });
  pb(`Set :CFBundleName ${NAME}`);
  try { pb(`Set :CFBundleDisplayName ${NAME}`); } catch { pb(`Add :CFBundleDisplayName string ${NAME}`); }

  // 1024 px PNG'den .icns üret
  const src = path.join(__dirname, '..', 'build', 'icon-mac.png');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sahin-icns-'));
  const set = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
  }
  const icns = path.join(app, 'Contents', 'Resources', 'electron.icns');
  execFileSync('iconutil', ['-c', 'icns', set, '-o', icns], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });

  fs.writeFileSync(marker, NAME);
  // Info.plist değiştiği için imza yeniden atılır (yerel, ad-hoc)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  console.log('[dev-brand] Electron.app adı ve simgesi güncellendi.');
} catch (e) {
  console.warn('[dev-brand] atlandı:', e.message);
}

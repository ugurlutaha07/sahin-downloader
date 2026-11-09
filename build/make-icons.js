// Electron ile çalıştırılır: electron build/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<html></html>');
  const src = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, 'logo-src.webp')).toString('base64');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const res = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
      // dairenin merkezi/yarıçapı (1536x1024 kaynak)
      const cx = 756, cy = 504, r = 492;
      const out = {};
      for (const s of ${JSON.stringify(sizes)}) {
        const c = document.createElement('canvas'); c.width = c.height = s;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.beginPath(); g.arc(s/2, s/2, s/2, 0, Math.PI*2); g.clip();
        g.drawImage(img, cx - r, cy - r, r*2, r*2, 0, 0, s, s);
        out[s] = c.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()
  `);
  const bufs = {};
  for (const s of sizes) { bufs[s] = Buffer.from(res[s], 'base64'); fs.writeFileSync(path.join(__dirname, `icon-${s}.png`), bufs[s]); }
  fs.copyFileSync(path.join(__dirname, 'icon-512.png'), path.join(__dirname, 'icon.png'));
  fs.copyFileSync(path.join(__dirname, 'icon-1024.png'), path.join(__dirname, 'icon-mac.png'));

  // PNG gömülü ICO
  const ico = [16, 24, 32, 48, 64, 128, 256];
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
  let offset = 6 + 16 * ico.length;
  const dir = [], data = [];
  for (const s of ico) {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(bufs[s].length, 8); e.writeUInt32LE(offset, 12);
    offset += bufs[s].length; dir.push(e); data.push(bufs[s]);
  }
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...dir, ...data]));
  console.log('ok');
  app.quit();
});

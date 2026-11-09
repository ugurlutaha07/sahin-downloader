// Çalıştırmak için: npm test   (Node.js 20 veya üzeri; ağ ve ffmpeg gerekmez)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib');

test('parseTime: sn, dk:sn ve sa:dk:sn biçimlerini çözer', () => {
  assert.equal(L.parseTime('83'), 83);
  assert.equal(L.parseTime('1:05'), 65);
  assert.equal(L.parseTime('01:00:01'), 3601);
  assert.equal(L.parseTime('12.5'), 12.5);
  assert.equal(L.parseTime(''), null);
  assert.equal(L.parseTime('abc'), null);
});

test('afChain: normalleştirme ve sessizlik kesme zinciri', () => {
  assert.equal(L.afChain({}), '');
  assert.match(L.afChain({ normalize: true }), /loudnorm/);
  const both = L.afChain({ trim: true, normalize: true });
  assert.match(both, /silenceremove.*areverse.*silenceremove.*areverse.*loudnorm/);
});

test('convArgs: desteklenen biçimler argüman üretir, bilinmeyen biçim null döner', () => {
  for (const f of ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'mpg', 'ts', 'gif',
    'mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus', 'wma', 'ac3', 'mp2']) {
    assert.ok(Array.isArray(L.convArgs(f, 'balanced', 'orig')), f);
  }
  assert.equal(L.convArgs('xyz'), null);
  assert.ok(L.convArgs('mp4', 'high', '720').join(' ').includes("min(720,ih)"));
});

test('buildName: şablon alanları, temizlik ve harf düzeni', () => {
  const v = { ad: 'eski ad', title: 'Gönül Dağı', artist: 'Ahmet Kaya', album: 'Başka', year: '1998', genre: 'Türk', track: '3/12', index: 7 };
  assert.equal(L.buildName('{sanatçı} - {başlık}', v), 'Ahmet Kaya - Gönül Dağı');
  assert.equal(L.buildName('{parça} - {başlık}', v), '03 - Gönül Dağı');
  assert.equal(L.buildName('{sıra3}. {ad}', v), '007. eski ad');
  assert.equal(L.buildName('{sanatçı} - {başlık}', { ...v, artist: '' }), 'Gönül Dağı');
  assert.equal(L.buildName('{sanatçı} - {başlık}', v, { caseMode: 'upper' }), 'AHMET KAYA - GÖNÜL DAĞI');
  assert.equal(L.buildName('{başlık}', { ...v, title: 'İSTANBUL ÇAĞRISI' }, { caseMode: 'title' }), 'İstanbul Çağrısı');
  assert.equal(L.buildName('{sanatçı} - {başlık}', v, { ascii: true, underscore: true }), 'Ahmet_Kaya_-_Gonul_Dagi');
  assert.doesNotMatch(L.buildName('{başlık}: "deneme"?', v), /[:"?]/);
  assert.equal(L.buildName('', v), 'eski ad');
});

test('extractVideoSources: LinkedIn tarzı data-sources ve genel video etiketleri', () => {
  const li = `<meta property="og:title" content="Ayşe on LinkedIn: Demo &amp; sonuç"><meta property="og:image" content="https://m.licdn.com/t.jpg?e=1&amp;v=beta">
  <video data-sources="[{&quot;src&quot;:&quot;https://dms.licdn.com/playlist/vid/v2/x/a.mp4?e=1&amp;t=2&quot;,&quot;type&quot;:&quot;video/mp4&quot;},{&quot;src&quot;:&quot;https://dms.licdn.com/playlist/vid/v2/x/m.m3u8?e=1&quot;,&quot;type&quot;:&quot;application/x-mpegURL&quot;}]"></video>`;
  const r = L.extractVideoSources(li, 'https://www.linkedin.com/posts/x');
  assert.equal(r.sources.length, 2);
  assert.equal(r.sources[0].kind, 'mp4');
  assert.ok(r.sources[0].url.includes('&t=2') && !r.sources[0].url.includes('&amp;'));
  assert.equal(r.sources[1].kind, 'hls');
  assert.equal(r.title, 'Ayşe on LinkedIn: Demo & sonuç');

  const g = L.extractVideoSources('<meta property="og:video:secure_url" content="https://cdn.s.com/v/c.mp4"><video><source src="/m/o.webm" type="video/webm"></video>', 'https://s.com/p');
  assert.ok(g.sources.some(s => s.url === 'https://cdn.s.com/v/c.mp4'));
  assert.ok(g.sources.some(s => s.url === 'https://s.com/m/o.webm'));
  assert.equal(L.extractVideoSources('<html>video yok</html>', 'https://a.com').sources.length, 0);
});

test('parseFFMeta: ffmetadata çıktısını etiketlere çevirir', () => {
  const t = L.parseFFMeta(';FFMETADATA1\ntitle=Şarkı\\=Adı\nartist=Sanatçı\nTRACK=3\n');
  assert.equal(t.title, 'Şarkı=Adı');
  assert.equal(t.artist, 'Sanatçı');
  assert.equal(t.track, '3');
});

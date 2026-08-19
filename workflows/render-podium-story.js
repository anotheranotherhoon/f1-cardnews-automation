// 포디움 스토리 로컬 렌더 (미리보기용)
// usage: node render-podium-story.js <template.html> <bg.png> <out.png>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const [tplName, bgName, outName] = process.argv.slice(2);

const css = fs.readFileSync(path.join(ROOT, 'templates/base.css'), 'utf8');
const tpl = fs.readFileSync(path.join(ROOT, 'templates', tplName), 'utf8');
const bgAbs = path.join(ROOT, bgName);

const TEAM = { McLaren: '#ff8000', 'Red Bull': '#3671c6', Ferrari: '#e8002d' };
const PODIUM = [
  { pos: 1, name: 'L. 노리스', team: 'McLaren', gap: '1:33:21.456' },
  { pos: 2, name: 'M. 베르스타펜', team: 'Red Bull', gap: '+4.312' },
  { pos: 3, name: 'C. 르클레르', team: 'Ferrari', gap: '+11.087' },
];

const rows = PODIUM.map(r => `
  <div class="sp-row${r.pos === 1 ? ' p1' : ''}">
    <div class="sp-pos">${r.pos}</div>
    <div class="sp-bar" style="--team:${TEAM[r.team]}"></div>
    <div class="sp-who"><div class="sp-name">${r.name}</div><div class="sp-team">${r.team}</div></div>
    <div class="sp-gap">${r.gap}</div>
  </div>`).join('');

const html = tpl
  .replaceAll('{{CSS}}', css)
  .replaceAll('{{BG_URL}}', 'file://' + bgAbs)
  .replaceAll('{{KICKER}}', '2026 ROUND 11 · RACE')
  .replaceAll('{{GP_NAME}}', '헝가리 그랑프리')
  .replaceAll('{{SUBTITLE}}', '노리스 시즌 4승 · 폴투윈')
  .replaceAll('{{ROWS_HTML}}', rows)
  .replaceAll('{{CTA}}', '전체 결과는 피드에서 👉');

const outDir = path.join(ROOT, '.render-out');
const htmlPath = path.join(outDir, outName.replace(/\.png$/, '.html'));
const pngPath = path.join(outDir, outName);
fs.writeFileSync(htmlPath, html);

execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--window-size=1080,1920',
  '--screenshot=' + pngPath,
  '--virtual-time-budget=3000',
  'file://' + htmlPath,
], { stdio: 'ignore' });

console.log('렌더 완료:', pngPath);

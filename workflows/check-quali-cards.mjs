// 퀄리 탈락구간·그리드 카드를 실제 2026 헝가리 데이터(22명)로 로컬 렌더해 잘림을 확인한다.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.render-out');

// WF-2의 Prepare Cards 코드를 그대로 꺼내 쓴다 (렌더 로직 중복 방지)
const wf2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'wf2-card-renderer.json'), 'utf8'));
const prep = wf2.nodes.find((n) => n.name === 'Prepare Cards').parameters.jsCode;

const qr = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-anotherhoon-Desktop-playGround-hooni-speed/ae76ddd7-bc15-415a-9ad6-2ec5a1c804c1/scratchpad/2026_11_qualifying.json', 'utf8'))
  .MRData.RaceTable.Races[0].QualifyingResults;

const row = (x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, q1: x.Q1 || null, q2: x.Q2 || null, q3: x.Q3 || null });
const cards = [
  { type: 'quali-elims', template: 'quali-elims', data: { elimQ2: qr.filter((x) => x.Q2 && !x.Q3).map(row), elimQ1: qr.filter((x) => !x.Q2).map(row) } },
  { type: 'grid', template: 'grid', data: { title: '레이스 그리드', note: '퀄리파잉 기준', rows: qr.map((x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name })) } },
];

const input = { cards, dayType: 'quali-results', season: 2026, round: 11, raceName: 'Hungarian Grand Prix', circuitId: 'hungaroring', dateKst: '2026-07-25' };
const $input = { first: () => ({ json: input }) };
// Prepare Cards는 메모리 가드에서 await를 쓰므로 async 함수로 실행해야 한다
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const out = await new AsyncFunction('$input', 'require', prep + '\n')($input, require);

out.forEach((item, i) => {
  const d = item.json;
  const htmlPath = path.join(OUT, `qc-${i}-${d.name || i}.html`);
  const pngPath = htmlPath.replace(/\.html$/, '.png');
  fs.writeFileSync(htmlPath, d.html);
  const vp = d.viewport || { width: 1080, height: 1350 };
  execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--window-size=${vp.width},${vp.height}`, '--screenshot=' + pngPath,
    '--virtual-time-budget=3000', 'file://' + htmlPath,
  ], { stdio: 'ignore' });
  console.log('렌더:', pngPath);
});

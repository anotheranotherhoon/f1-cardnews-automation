// 스타팅 그리드 카드를 실제 2026 헝가리 퀄리 데이터(22명)로 로컬 렌더한다.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ROOT = path.join(__dirname, '..');
const wf2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'wf2-card-renderer.json'), 'utf8'));
const prep = wf2.nodes.find((n) => n.name === 'Prepare Cards').parameters.jsCode;

const SCRATCH = '/private/tmp/claude-501/-Users-anotherhoon-Desktop-playGround-hooni-speed/ae76ddd7-bc15-415a-9ad6-2ec5a1c804c1/scratchpad';
const qr = JSON.parse(fs.readFileSync(SCRATCH + '/2026_11_qualifying.json', 'utf8'))
  .MRData.RaceTable.Races[0].QualifyingResults;

const input = {
  cards: [{ type: 'grid', template: 'grid', data: {
    title: '레이스 그리드', note: '퀄리파잉 결과 기준',
    rows: qr.map((x) => ({ pos: x.position, code: x.Driver.code,
      name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name })),
  } }],
  dayType: 'quali-results', season: 2026, round: 11,
  raceName: 'Hungarian Grand Prix', circuitId: 'hungaroring', dateKst: '2026-07-25',
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// n8n 런타임 전역을 로컬에서 흉내낸다
const out = await new AsyncFunction('$input', 'require', '$execution', prep + '\n')(
  { first: () => ({ json: input }) }, require, { id: 'local' });

const item = out[0].json;
const htmlPath = path.join(ROOT, '.render-out/grid-stagger.html');
const pngPath = htmlPath.replace(/\.html$/, '.png');
fs.writeFileSync(htmlPath, item.html);
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--window-size=1080,1350', '--screenshot=' + pngPath, '--virtual-time-budget=3000',
  'file://' + htmlPath,
], { stdio: 'ignore' });
console.log('렌더:', pngPath);

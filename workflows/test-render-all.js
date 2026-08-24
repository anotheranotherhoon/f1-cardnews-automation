// 모든 카드 템플릿을 실제로 렌더해 실행 오류를 잡는다.
//   node test-render-all.js
//
// 왜 필요한가: 문자열 존재 확인(`'nameFn(rows)' in code`)은 코드가 있는지만 보고
// 실행되는지는 보지 않는다. 2026-08-24 에 TDZ 오류(`Cannot access 'rows' before
// initialization`)가 이 방식을 통과해 배포됐고 월요일 총정리 렌더가 죽었다.
// 배포 전에 이 스크립트를 돌린다. 서버도 Chrome 도 필요 없다 — HTML 생성까지만 본다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const wf = JSON.parse(execFileSync('node', [path.join(__dirname, 'build-wf2.js')], { maxBuffer: 64 * 1024 * 1024 }).toString());
const code = wf.nodes.find((n) => n.name === 'Prepare Cards').parameters.jsCode;

// 이름은 두 출처 형식을 섞어 넣는다 — 어느 쪽에서 와도 같게 나와야 한다
const NAMES = ['Lando Norris', 'Max VERSTAPPEN', 'Nico HULKENBERG', 'Sergio Pérez', 'Andrea Kimi Antonelli'];
const TEAMS = ['McLaren', 'Red Bull Racing', 'Audi', 'Cadillac F1 Team', 'Mercedes'];
const CODES = ['NOR', 'VER', 'HUL', 'PER', 'ANT'];
const rows = NAMES.map((name, i) => ({
  pos: i + 1, code: CODES[i], name, team: TEAMS[i],
  metric: (25 - i * 3) + 'pt', time: '1:1' + i + '.000', points: 25 - i,
  delta: (i % 3) - 1, q1: '1:12.000', q2: '1:11.500', q3: '1:11.000',
}));

const CARDS = [
  ['cover-data', { title: 'Dutch Grand Prix', subtitle: '테스트' }],
  ['cover-preview', { title: 'Dutch Grand Prix', raceStartKst: '2026-08-24T22:00:00Z', isSprint: true }],
  ['session-result', { session: 'FP1', rows }],
  ['result-full', { title: '레이스 결과', rows }],
  ['result-full', { title: '컨스트럭터 순위', rows: [{ pos: 1, name: 'Aston Martin', team: 'Aston Martin', metric: '100pt' }], shortenNames: false }],
  ['standings', { title: '순위', rows }],
  ['grid', { title: '레이스 그리드', rows }],
  ['quali-elims', { elimQ2: rows.slice(0, 2), elimQ1: rows.slice(2) }],
  ['timetable', { sessions: [{ code: 'FP1', label: '연습주행 1', kst: '08-22 18:30' }] }],
  ['lineup', { lineup: { Mercedes: [{ name: 'Kimi ANTONELLI' }, { name: 'George Russell' }] } }],
  ['track', { circuitId: 'zandvoort', circuitName: 'Zandvoort', lengthKm: 4.259, laps: 72 }],
  ['tires', { body: '작년: C2/C3/C4' }],
  ['issue-blocks', { session: '레이스', issues: [{ head: '제목', body: '내용' }], fastestLap: { name: 'Nico HULKENBERG', time: '1:10.000' } }],
  ['dotd-card', { driver: 'lando NORRIS', team: 'McLaren', body: '사유', code: 'nor' }],
  ['podium', { season: 2025, raceName: 'Dutch Grand Prix', podium: rows.slice(0, 3) }],
  ['stints', { title: '타이어 전략', scope: '상위 10명', rows: rows.map((r) => ({ ...r, stints: [{ compound: 'MEDIUM', from: 1, to: 30 }, { compound: 'HARD', from: 31, to: 72 }] })) }],
];

// n8n Code 노드 환경 심. 자산 조회는 없는 것으로 처리한다 (템플릿이 폴백을 타야 한다).
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const missing = () => { throw new Error('ENOENT'); };
const shimFs = { readdirSync: missing, statSync: missing, readFileSync: (p, e) => fs.readFileSync(p, e), mkdirSync: () => {}, writeFileSync: () => {} };
const shimRequire = (m) => {
  if (m === 'fs') return shimFs;
  if (m === 'path') return path;
  throw new Error('허용되지 않은 모듈: ' + m);
};

(async () => {
  let fail = 0;
  for (const [template, data] of CARDS) {
    const payload = {
      dayType: 'race-recap', season: 2026, round: 12, raceName: 'Dutch Grand Prix',
      circuitId: 'zandvoort', dateKst: '2026-08-24',
      cards: [{ type: template, template, data }],
    };
    const $input = { first: () => ({ json: payload }), all: () => [{ json: payload }] };
    try {
      const items = await new AsyncFunction('$input', '$execution', 'require', code)($input, { id: 'test' }, shimRequire);
      const html = items[0].json.html;
      if (!html || html.length < 200) throw new Error('HTML 이 비었다');
      if (html.includes('{{')) throw new Error('치환되지 않은 플레이스홀더가 남았다');
      console.log(`  OK    ${template.padEnd(16)} ${(html.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      fail += 1;
      console.log(`  FAIL  ${template.padEnd(16)} ${e.message}`);
    }
  }
  console.log('\n' + (fail === 0 ? `템플릿 ${CARDS.length}종 전부 렌더 성공` : `${fail}종 실패 — 배포 금지`));
  process.exit(fail === 0 ? 0 : 1);
})();

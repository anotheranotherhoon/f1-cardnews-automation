// WF-1 main-scheduler 생성기: node build-wf1.js > wf1-main-scheduler.json
const fs = require('fs');
const { GEMINI_CRED } = require('./config');
const TRACK_INFO = fs.readFileSync(__dirname + '/track-info.json', 'utf8').trim();

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  const node = {
    parameters,
    type: 'n8n-nodes-base.' + type,
    typeVersion: typeVersion || 1,
    position: pos,
    id: 'b' + String(uid).padStart(7, '0') + '-0000-4000-8000-00000000000' + (uid % 10),
    name,
    ...(extra || {}),
  };
  nodes.push(node);
  return name;
}
function c(from, to, outIdx) {
  connections[from] = connections[from] || { main: [] };
  const main = connections[from].main;
  const idx = outIdx || 0;
  while (main.length <= idx) main.push([]);
  main[idx].push({ node: to, type: 'main', index: 0 });
}
function http(name, url, pos) {
  // executeOnce 필수: API가 배열을 돌려주면 n8n이 아이템으로 쪼개고, 다음 HTTP 노드가
  // 아이템 수만큼(20~60회) 반복 호출되어 레이트리밋에 걸린다. 모든 URL은 .first() 또는
  // 단일 아이템 소스를 참조하므로 한 번만 실행하면 된다.
  const extra = { executeOnce: true };
  if (url.includes('openf1')) Object.assign(extra, { retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 });
  return n(name, 'httpRequest', { url, options: { timeout: 25000 } }, pos, 4.2, extra);
}
function code(name, jsCode, pos) {
  return n(name, 'code', { jsCode }, pos, 2);
}

// ---------- 공용 트리거/판별 ----------
n('Daily 09:00 KST', 'scheduleTrigger', { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } }, [-1050, 0], 1.2);
n('Manual Test Trigger', 'manualTrigger', {}, [-1050, 160]);
http('Jolpica Calendar', 'https://api.jolpi.ca/ergast/f1/current.json', [-820, 0]);

const RESOLVE = [
  "// 오늘(KST)의 콘텐츠 타입 판별 — 세션 날짜 기준. OVERRIDE는 브랜치 테스트용.",
  "const OVERRIDE = null;",
  "const SESSION_KEYS = { FirstPractice: 'FP1', SecondPractice: 'FP2', ThirdPractice: 'FP3', SprintQualifying: 'SQ', Sprint: 'SPRINT', Qualifying: 'QUALI' };",
  "const DUR = { FP1: 90, FP2: 90, FP3: 90, SQ: 60, SPRINT: 60, QUALI: 90, RACE: 165 };",
  "const KST = 9 * 3600 * 1000;",
  "const kstDate = (ms) => new Date(ms + KST).toISOString().slice(0, 10);",
  "function collect(race) {",
  "  const out = [];",
  "  for (const [k, code] of Object.entries(SESSION_KEYS)) {",
  "    if (race[k] && race[k].date && race[k].time) out.push({ code, startMs: Date.parse(race[k].date + 'T' + race[k].time) });",
  "  }",
  "  if (race.date && race.time) out.push({ code: 'RACE', startMs: Date.parse(race.date + 'T' + race.time) });",
  "  for (const s of out) s.endMs = s.startMs + DUR[s.code] * 60000;",
  "  return out.sort((a, b) => a.startMs - b.startMs);",
  "}",
  "function baseOf(race, sessions) {",
  "  return {",
  "    round: parseInt(race.round), prevRound: Math.max(0, parseInt(race.round) - 1),",
  "    raceName: race.raceName, circuitId: race.Circuit ? race.Circuit.circuitId : null,",
  "    circuitName: race.Circuit ? race.Circuit.circuitName : null,",
  "    season: parseInt(race.season), prevSeason: parseInt(race.season) - 1,",
  "    isSprint: !!race.Sprint, dateKst: kstDate(Date.now()),",
  "    sessions: sessions.map((s) => ({ code: s.code, startUtc: new Date(s.startMs).toISOString(), startKst: new Date(s.startMs + KST).toISOString().replace('T', ' ').slice(0, 16) })),",
  "  };",
  "}",
  "const races = $input.first().json.MRData.RaceTable.Races;",
  "const nowMs = Date.now();",
  "if (OVERRIDE) {",
  "  const race = races.find((r) => parseInt(r.round) === parseInt(OVERRIDE.round));",
  "  if (!race) throw new Error('OVERRIDE round not found');",
  "  return [{ json: { dayType: OVERRIDE.dayType, reported: ['TEST'], ...baseOf(race, collect(race)) } }];",
  "}",
  "const todayKst = kstDate(nowMs);",
  "for (const race of races) {",
  "  const sessions = collect(race);",
  "  if (!sessions.length) continue;",
  "  const isSprint = !!race.Sprint;",
  "  const fp1 = sessions.find((s) => s.code === 'FP1');",
  "  const base = baseOf(race, sessions);",
  "  if (fp1) {",
  "    if (todayKst === kstDate(fp1.startMs - 86400000)) return [{ json: { dayType: 'preview', ...base } }];",
  "    if (todayKst === kstDate(fp1.startMs)) return [{ json: { dayType: 'guide', ...base } }];",
  "  }",
  "  const ended = sessions.filter((s) => s.endMs <= nowMs && s.endMs > nowMs - 86400000);",
  "  if (!ended.length) continue;",
  "  const codes = new Set(ended.map((s) => s.code));",
  "  const reported = [...codes];",
  "  if (codes.has('RACE')) return [{ json: { dayType: 'race-recap', reported, ...base } }];",
  "  if (isSprint) {",
  "    if (codes.has('SPRINT') || (codes.has('QUALI') && !codes.has('FP1'))) return [{ json: { dayType: 'sprint-sat-results', reported, ...base } }];",
  "    if (codes.has('SQ') || codes.has('FP1')) return [{ json: { dayType: 'sprint-fri-results', reported, ...base } }];",
  "  } else {",
  "    if (codes.has('QUALI') || codes.has('FP3')) return [{ json: { dayType: 'quali-results', reported, ...base } }];",
  "    if (codes.has('FP1') || codes.has('FP2')) return [{ json: { dayType: 'practice-results', reported, ...base } }];",
  "  }",
  "}",
  "return [{ json: { dayType: 'none' } }];",
].join('\n');
code('Resolve Day Type', RESOLVE, [-590, 0]);

const switchRule = (val, label) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ leftValue: '={{ $json.dayType }}', rightValue: val, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: label,
});
n(
  'Recipe Switch',
  'switch',
  {
    rules: {
      values: [
        switchRule('preview', '목 프리뷰'),
        switchRule('guide', '금 관전가이드'),
        switchRule('practice-results', '토 FP1·FP2'),
        switchRule('quali-results', '일 퀄리·그리드'),
        switchRule('sprint-fri-results', '토(스프린트) FP1·SQ'),
        switchRule('sprint-sat-results', '일(스프린트) 스프린트·퀄리'),
        switchRule('race-recap', '월 레이스 총정리'),
      ],
    },
    options: {},
  },
  [-360, 0],
  3.2
);
c('Daily 09:00 KST', 'Jolpica Calendar');
c('Manual Test Trigger', 'Jolpica Calendar');
c('Jolpica Calendar', 'Resolve Day Type');
c('Resolve Day Type', 'Recipe Switch');

// ---------- 브랜치 1: 목 프리뷰 ----------
http('PV LastYear Results', "=https://api.jolpi.ca/ergast/f1/{{ $json.prevSeason }}/circuits/{{ $json.circuitId }}/results.json?limit=100", [-80, -720]);
code(
  'PV Extract',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const races = $input.first().json.MRData.RaceTable.Races || [];",
    "let lastYear = null;",
    "if (races.length) {",
    "  const r = races[races.length - 1];",
    "  lastYear = { season: r.season, round: r.round, raceName: r.raceName, date: r.date,",
    "    podium: (r.Results || []).slice(0, 3).map((x) => ({ pos: x.position, name: x.Driver.givenName + ' ' + x.Driver.familyName, code: x.Driver.code, team: x.Constructor.name })) };",
    "}",
    "return [{ json: { ...meta, lastYear } }];",
  ].join('\n'),
  [140, -720]
);
n(
  'PV Research',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ contents: [{ parts: [{ text: 'F1 ' + $json.season + ' ' + $json.raceName + ' 프리뷰 자료 조사. 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"tiresLastYear\": \"작년 이 GP의 피렐리 타이어 컴파운드 배정 (예: C2/C3/C4)\", \"tiresThisYear\": \"올해 이 GP 배정 (미발표면 null)\", \"issueSummary\": \"가장 최근 이 GP에서 있었던 큰 이슈/사건을 한국어 2~3문장으로 (사고, 논란, 명장면 등)\"} 확실하지 않은 정보는 null로.' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }) }}",
    options: { timeout: 60000 },
  },
  [360, -840],
  4.2,
  { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
);
code(
  'PV Merge Research',
  [
    "const meta = $('PV Extract').first().json;",
    "let research = null;",
    "try {",
    "  const parts = $input.first().json.candidates[0].content.parts;",
    "  const text = parts.map((p) => p.text || '').join('').trim().replace(/^```(json)?/m, '').replace(/```\\s*$/m, '').trim();",
    "  research = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));",
    "} catch (e) { research = null; } // LLM 실패해도 발행은 진행 (검수 플래그로 표시)",
    "return [{ json: { ...meta, research } }];",
  ].join('\n'),
  [360, -720]
);
http('PV LastYear Sprint', "=https://api.jolpi.ca/ergast/f1/{{ $json.lastYear ? $json.lastYear.season : '1950' }}/{{ $json.lastYear ? $json.lastYear.round : '1' }}/sprint.json", [470, -720]);
code(
  'PV Cards',
  [
    'const TRACK_INFO = ' + TRACK_INFO + ';',
    "const meta = $('PV Merge Research').first().json;",
    "const rs = meta.research || {};",
    "const sr = $input.first().json.MRData.RaceTable.Races || [];",
    "const sprintPodium = sr.length && sr[0].SprintResults ? sr[0].SprintResults.slice(0, 3).map((x) => ({ pos: x.position, name: x.Driver.givenName + ' ' + x.Driver.familyName, code: x.Driver.code, team: x.Constructor.name })) : null;",
    "const track = TRACK_INFO[meta.circuitId] || null;",
    "const raceS = meta.sessions.find((s) => s.code === 'RACE');",
    "const cards = [",
    "  { type: 'cover', template: 'cover-preview', needsLlm: ['memeConcept', 'bgImage'], data: { title: meta.raceName, raceStartKst: raceS ? raceS.startKst : null, isSprint: meta.isSprint } },",
    "  { type: 'track', template: 'track', data: { circuitId: meta.circuitId, circuitName: meta.circuitName, ...(track || {}) } },",
    "  { type: 'tires', template: 'tires', needsLlm: ['compounds'], data: { raceName: meta.raceName, body: (rs.tiresLastYear ? '작년: ' + rs.tiresLastYear : '') + (rs.tiresThisYear ? '\\n올해: ' + rs.tiresThisYear : (rs.tiresLastYear ? '\\n올해: 발표 대기' : '')) || null } },",
    "  { type: 'issue', template: 'issue', needsLlm: ['issueSummary'], data: { lastYear: meta.lastYear, session: meta.lastYear ? meta.lastYear.season + ' ' + meta.raceName : meta.raceName, body: rs.issueSummary || null } },",
    "  meta.lastYear ? { type: 'podium', template: 'podium', data: { season: meta.lastYear.season, raceName: meta.lastYear.raceName, podium: meta.lastYear.podium } } : null,",
    "  sprintPodium ? { type: 'sprint-podium', template: 'podium', data: { season: meta.lastYear.season, raceName: meta.lastYear.raceName + ' 스프린트', podium: sprintPodium } } : null,",
    "].filter(Boolean);",
    "if (cards.length > 10) throw new Error('카드 10장 초과: ' + cards.length);",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [580, -720]
);
c('Recipe Switch', 'PV LastYear Results', 0);
c('PV LastYear Results', 'PV Extract');
c('PV Extract', 'PV Research');
c('PV Research', 'PV Merge Research');
c('PV Merge Research', 'PV LastYear Sprint');
c('PV LastYear Sprint', 'PV Cards');

// ---------- 브랜치 2: 금 관전가이드 ----------
http('GD Standings', "=https://api.jolpi.ca/ergast/f1/{{ $json.season }}/driverstandings.json", [-80, -480]);
code(
  'GD Cards',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const sl = $input.first().json.MRData.StandingsTable.StandingsLists || [];",
    "if (!sl.length) throw new Error('드라이버 스탠딩 데이터 없음 (시즌 개막 전이면 정상)');",
    "const lineup = {};",
    "for (const d of sl[0].DriverStandings) {",
    "  const team = d.Constructors.length ? d.Constructors[d.Constructors.length - 1].name : '?';",
    "  (lineup[team] = lineup[team] || []).push({ name: d.Driver.givenName + ' ' + d.Driver.familyName, code: d.Driver.code, number: d.Driver.permanentNumber });",
    "}",
    "const KOR = { FP1: 'FP1', FP2: 'FP2', FP3: 'FP3', SQ: '스프린트 퀄리파잉', SPRINT: '스프린트', QUALI: '퀄리파잉', RACE: '레이스' };",
    "const timetable = meta.sessions.map((s) => ({ session: KOR[s.code] || s.code, startKst: s.startKst }));",
    "const cards = [",
    "  { type: 'cover', template: 'cover-data', data: { title: meta.raceName, subtitle: (meta.isSprint ? '스프린트 주간 · ' : '') + '주말 관전 가이드' } },",
    "  { type: 'timetable', template: 'timetable', data: { raceName: meta.raceName, timetable } },",
    "  { type: 'lineup', template: 'lineup', data: { lineup } },",
    "];",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [140, -480]
);
c('Recipe Switch', 'GD Standings', 1);
c('GD Standings', 'GD Cards');

// ---------- 브랜치 3+5 공용: OpenF1 세션 결과 (토 비스프린트 / 토 스프린트) ----------
http('OF Meetings', "=https://api.openf1.org/v1/meetings?year={{ $json.season }}", [-80, -240]);
code(
  'OF Pick Meeting',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const ms = $input.all().map((i) => i.json);",
    "let m = ms.find((x) => x.meeting_name === meta.raceName) || ms.find((x) => (x.meeting_official_name || '').includes(meta.raceName));",
    "if (!m) {",
    "  const fp1 = meta.sessions.find((s) => s.code === 'FP1');",
    "  if (fp1) m = ms.find((x) => Math.abs(Date.parse(x.date_start) - Date.parse(fp1.startUtc)) < 5 * 86400000);",
    "}",
    "if (!m) throw new Error('OpenF1 미팅 매칭 실패: ' + meta.raceName);",
    "return [{ json: { ...meta, meeting_key: m.meeting_key } }];",
  ].join('\n'),
  [140, -240]
);
http('OF Sessions', "=https://api.openf1.org/v1/sessions?meeting_key={{ $json.meeting_key }}", [360, -240]);
code(
  'OF Pick Sessions',
  [
    "const meta = $('OF Pick Meeting').first().json;",
    "const ss = $input.all().map((i) => i.json);",
    "const wanted = meta.dayType === 'practice-results' ? ['Practice 1', 'Practice 2'] : ['Practice 1', 'Sprint Qualifying'];",
    "const found = wanted.map((w) => { const s = ss.find((x) => x.session_name === w); if (!s) throw new Error('OpenF1 세션 없음: ' + w); return s; });",
    "return [{ json: { ...meta, s1: { key: found[0].session_key, label: wanted[0] }, s2: { key: found[1].session_key, label: wanted[1] } } }];",
  ].join('\n'),
  [580, -240]
);
http('OF Result1', "=https://api.openf1.org/v1/session_result?session_key={{ $('OF Pick Sessions').first().json.s1.key }}", [800, -240]);
http('OF Result2', "=https://api.openf1.org/v1/session_result?session_key={{ $('OF Pick Sessions').first().json.s2.key }}", [1020, -240]);
http('OF Drivers1', "=https://api.openf1.org/v1/drivers?session_key={{ $('OF Pick Sessions').first().json.s1.key }}", [1240, -240]);
http('OF Drivers2', "=https://api.openf1.org/v1/drivers?session_key={{ $('OF Pick Sessions').first().json.s2.key }}", [1460, -240]);
code(
  'OF Cards',
  [
    "const meta = $('OF Pick Sessions').first().json;",
    "const dmap = {};",
    "for (const src of ['OF Drivers1', 'OF Drivers2']) for (const i of $(src).all()) dmap[i.json.driver_number] = { code: i.json.name_acronym, name: i.json.full_name, team: i.json.team_name };",
    "const fmt = (sec) => { if (sec == null) return null; if (Array.isArray(sec)) sec = sec.filter(Boolean).pop(); if (typeof sec !== 'number') return String(sec); const m = Math.floor(sec / 60); return m + ':' + (sec - m * 60).toFixed(3).padStart(6, '0'); };",
    "const shape = (src) => $(src).all().map((i) => i.json).filter((r) => !r.dns).sort((a, b) => (a.position || 99) - (b.position || 99)).map((r) => ({ pos: r.position, ...(dmap[r.driver_number] || { code: '#' + r.driver_number }), time: fmt(r.duration), gap: Array.isArray(r.gap_to_leader) ? fmt(r.gap_to_leader) : r.gap_to_leader, dnf: !!r.dnf }));",
    "const r1 = shape('OF Result1');",
    "const r2 = shape('OF Result2');",
    "if (!r1.length || !r2.length) throw new Error('세션 결과 미반영 — 수동 재실행 필요');",
    "let cards;",
    "if (meta.dayType === 'practice-results') {",
    "  cards = [",
    "    { type: 'cover', template: 'cover-data', data: { title: meta.raceName, subtitle: '연습주행 FP1 · FP2 결과' } },",
    "    { type: 'session-result', template: 'session-result', data: { session: 'FP1', rows: r1.slice(0, 10) } },",
    "    { type: 'session-result', template: 'session-result', data: { session: 'FP2', rows: r2.slice(0, 10) } },",
    "  ];",
    "} else {",
    "  cards = [",
    "    { type: 'cover', template: 'cover-data', data: { title: meta.raceName, subtitle: '연습주행 FP1 · 스프린트 퀄리파잉' } },",
    "    { type: 'session-result', template: 'session-result', data: { session: 'FP1', rows: r1.slice(0, 5), brief: true } },",
    "    { type: 'session-result', template: 'session-result', data: { session: '스프린트 퀄리파잉', rows: r2.slice(0, 10) } },",
    "    { type: 'grid', template: 'grid', data: { title: '스프린트 그리드', rows: r2.map((x) => ({ pos: x.pos, code: x.code, name: x.name, team: x.team })) } },",
    "  ];",
    "}",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [1680, -240]
);
c('Recipe Switch', 'OF Meetings', 2);
c('Recipe Switch', 'OF Meetings', 4);
c('OF Meetings', 'OF Pick Meeting');
c('OF Pick Meeting', 'OF Sessions');
c('OF Sessions', 'OF Pick Sessions');
c('OF Pick Sessions', 'OF Result1');
c('OF Result1', 'OF Result2');
c('OF Result2', 'OF Drivers1');
c('OF Drivers1', 'OF Drivers2');
c('OF Drivers2', 'OF Cards');

// ---------- 브랜치 4: 일 퀄리·그리드 ----------
http('QL Quali', "=https://api.jolpi.ca/ergast/f1/{{ $json.season }}/{{ $json.round }}/qualifying.json?limit=40", [-80, 0]);
code(
  'QL Cards',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const races = $input.first().json.MRData.RaceTable.Races || [];",
    "if (!races.length || !races[0].QualifyingResults || !races[0].QualifyingResults.length) throw new Error('퀄리파잉 결과 미반영 — 수동 재실행 필요');",
    "const qr = races[0].QualifyingResults;",
    "const row = (x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, q1: x.Q1 || null, q2: x.Q2 || null, q3: x.Q3 || null });",
    "const q3 = qr.filter((x) => x.Q3).map(row);",
    "const elimQ2 = qr.filter((x) => x.Q2 && !x.Q3).map(row);",
    "const elimQ1 = qr.filter((x) => !x.Q2).map(row);",
    "const cards = [",
    "  { type: 'cover', template: 'cover-data', data: { title: meta.raceName, subtitle: '퀄리파잉 · 폴 ' + (q3[0] ? q3[0].name : '?') } },",
    "  { type: 'quali-top', template: 'session-result', data: { session: 'Q3 Top 10', rows: q3.map((x) => ({ pos: x.pos, code: x.code, name: x.name, team: x.team, time: x.q3 })) } },",
    "  { type: 'quali-elims', template: 'quali-elims', data: { elimQ2, elimQ1 } },",
    "  { type: 'grid', template: 'grid', data: { title: '레이스 그리드', note: '퀄리파잉 결과 기준', rows: qr.map((x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name })) } },",
    "];",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [140, 0]
);
c('Recipe Switch', 'QL Quali', 3);
c('QL Quali', 'QL Cards');

// ---------- 브랜치 6: 일(스프린트) 스프린트·퀄리 ----------
http('SS Sprint', "=https://api.jolpi.ca/ergast/f1/{{ $json.season }}/{{ $json.round }}/sprint.json?limit=40", [-80, 240]);
http('SS Quali', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ $('Resolve Day Type').first().json.round }}/qualifying.json?limit=40", [140, 240]);
http('SS DrvPrev', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ Math.max(1, $('Resolve Day Type').first().json.prevRound) }}/driverstandings.json?limit=40", [360, 240]);
http('SS ConPrev', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ Math.max(1, $('Resolve Day Type').first().json.prevRound) }}/constructorstandings.json?limit=20", [580, 240]);
n(
  'SS Research',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ contents: [{ parts: [{ text: '어제 열린 F1 ' + $('Resolve Day Type').first().json.season + ' ' + $('Resolve Day Type').first().json.raceName + ' 스프린트 레이스에 대해 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"issues\": [{\"head\": \"이슈 제목 한국어 12자 이내\", \"body\": \"그 이슈만 다룬 한국어 설명 1~2문장, 60자 이내\"}], \"photoKeyword\": \"이슈 분위기에 맞는 영어 스톡사진 검색어 2~3단어\"} issues는 서로 다른 주제로 2~3개. 본 레이스가 아니라 스프린트 레이스만 다룰 것. photoKeyword는 추상적인 장면만 — 팀명/대회명/드라이버명은 절대 넣지 말 것. 반드시 최상위는 위 키들을 가진 JSON 객체여야 한다 — 응답 전체를 null로 출력하지 말 것. 정보를 못 찾은 개별 필드만 null로 두고, issues를 못 찾으면 빈 배열 []로 둘 것.' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }) }}",
    options: { timeout: 60000 },
  },
  [800, 340],
  4.2,
  { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
);
code(
  'SS Merge Research',
  [
    "// 실패해도 나머지 카드는 발행되어야 하므로 삼키되, 원인 추적용으로 원문을 남긴다",
    "let research = null; let diag = null;",
    "const raw = $input.first().json;",
    "try {",
    "  const parts = raw.candidates[0].content.parts;",
    "  const text = parts.map((p) => p.text || '').join('').trim();",
    "  if (!text) throw new Error('텍스트 파트 없음');",
    "  if (text === 'null') throw new Error('모델이 최상위 null 반환 — 프롬프트 확인 필요');",
    "  research = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));",
    "} catch (e) {",
    "  research = null;",
    "  diag = { at: new Date().toISOString(), reason: String(e.message), raw: JSON.stringify(raw).slice(0, 1200) };",
    "}",
    "try { require('fs').writeFileSync('/data/hooni_speed/last-research.json', JSON.stringify({ ok: !!research, branch: 'sprint-sat', diag, research }, null, 1)); } catch (e) {}",
    "return [{ json: { research } }];",
  ].join('\n'),
  [1020, 340]
);
n(
  'SS Pexels',
  'httpRequest',
  {
    url: "=https://api.pexels.com/v1/search?orientation=landscape&per_page=15&query={{ encodeURIComponent(($json.research && $json.research.photoKeyword) || 'motorsport asphalt') }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: { timeout: 20000 },
  },
  [1240, 340],
  4.2,
  { executeOnce: true, onError: 'continueRegularOutput', credentials: { httpHeaderAuth: { id: 'PexelsApiKey0001', name: 'Pexels API' } } }
);
code(
  'SS Pick Photo',
  [
    "const research = $('SS Merge Research').first().json.research || null;",
    "const meta = $('Resolve Day Type').first().json;",
    "let photo = null;",
    "try {",
    "  const ps = $input.first().json.photos || [];",
    "  if (ps.length) { const x = ps[meta.round % ps.length]; photo = { url: x.src.large, credit: x.photographer }; }",
    "} catch (e) { photo = null; }",
    "return [{ json: { research, photo } }];",
  ].join('\n'),
  [1460, 340]
);
code(
  'SS Cards',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const sprintRaces = $('SS Sprint').first().json.MRData.RaceTable.Races || [];",
    "if (!sprintRaces.length || !sprintRaces[0].SprintResults) throw new Error('스프린트 결과 미반영 — 수동 재실행 필요');",
    "const sp = sprintRaces[0].SprintResults;",
    "const qRaces = $('SS Quali').first().json.MRData.RaceTable.Races || [];",
    "if (!qRaces.length) throw new Error('퀄리파잉 결과 미반영 — 수동 재실행 필요');",
    "// 표지 부제가 두 줄로 넘치지 않도록 이름을 'A. Antonelli' 형태로 줄인다",
    "const short = (n) => { const q = String(n || '').trim().split(/\\s+/); return q.length > 1 ? q[0][0] + '. ' + q[q.length - 1] : (q[0] || ''); };",
    "const spFinished = (st) => /^(Finished|Lapped)$/.test(String(st || '')) || /^\\+\\d+ Lap/.test(String(st || ''));",
    "const qrow = (x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, q1: x.Q1 || null, q2: x.Q2 || null });",
    "const rs = $('SS Pick Photo').first().json.research || {};",
    "const photo = $('SS Pick Photo').first().json.photo || null;",
    "const qr = qRaces[0].QualifyingResults;",
    "const spRows = sp.map((x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, points: parseFloat(x.points || '0'), status: x.status, time: x.Time ? x.Time.time : null }));",
    "const fl = sp.find((x) => x.FastestLap && x.FastestLap.rank === '1');",
    "// 등락: 직전 라운드 스탠딩 + 스프린트 포인트",
    "const hasPrev = meta.prevRound >= 1;",
    "const dPrev = hasPrev ? ($('SS DrvPrev').first().json.MRData.StandingsTable.StandingsLists[0] || {}).DriverStandings || [] : [];",
    "const cPrev = hasPrev ? ($('SS ConPrev').first().json.MRData.StandingsTable.StandingsLists[0] || {}).ConstructorStandings || [] : [];",
    "const dPts = {}; const cPts = {};",
    "for (const x of sp) { dPts[x.Driver.driverId] = parseFloat(x.points || '0'); cPts[x.Constructor.constructorId] = (cPts[x.Constructor.constructorId] || 0) + parseFloat(x.points || '0'); }",
    "function delta(prev, idOf, nameOf, addPts, teamOf) {",
    "  const rows = prev.map((x) => ({ id: idOf(x), name: nameOf(x), team: teamOf ? teamOf(x) : '', points: parseFloat(x.points) + (addPts[idOf(x)] || 0), prevPos: parseInt(x.position) }));",
    "  rows.sort((a, b) => b.points - a.points);",
    "  return rows.map((r, i) => ({ pos: i + 1, name: r.name, team: r.team, points: r.points, delta: r.prevPos - (i + 1) }));",
    "}",
    "const dNew = hasPrev ? delta(dPrev, (x) => x.Driver.driverId, (x) => x.Driver.givenName + ' ' + x.Driver.familyName, dPts, (x) => (x.Constructors && x.Constructors.length ? x.Constructors[x.Constructors.length - 1].name : '')) : [];",
    "const cNew = hasPrev ? delta(cPrev, (x) => x.Constructor.constructorId, (x) => x.Constructor.name, cPts) : [];",
    "const q3 = qr.filter((x) => x.Q3);",
    "const poleName = q3[0] ? q3[0].Driver.givenName + ' ' + q3[0].Driver.familyName : '?';",
    "const cards = [",
    "  { type: 'cover', template: 'cover-data', data: { title: meta.raceName, subtitle: (poleName === spRows[0].name ? '스프린트 우승 · 폴 포지션\\n' + poleName : ('스프린트 우승 ' + spRows[0].name + '\\n폴 포지션 ' + poleName)) } },",
    "  { type: 'sprint-result', template: 'result-full', data: { title: '스프린트 결과', subtitle: meta.raceName, rows: spRows.map((r) => ({ pos: r.pos, name: r.name, team: r.team, metric: spFinished(r.status) ? (r.points ? r.points + 'pt' : '—') : 'RET', out: !spFinished(r.status) })) } },",
    "  { type: 'issue', template: 'issue-blocks', needsLlm: ['issues'], data: { session: '스프린트', issues: rs.issues || null, photo, fastestLap: fl ? { name: fl.Driver.givenName + ' ' + fl.Driver.familyName, time: fl.FastestLap.Time ? fl.FastestLap.Time.time : null } : null } },",
    "  dNew.length ? { type: 'standings-drivers', template: 'result-full', data: { title: '드라이버 순위', subtitle: '스프린트 포인트 반영 · 등락은 직전 라운드 대비', note: '챔피언십 스탠딩', rows: dNew.map((r) => ({ pos: r.pos, name: r.name, team: r.team, metric: r.points + 'pt', delta: r.delta })) } } : null,",
    "  cNew.length ? { type: 'standings-constructors', template: 'result-full', data: { title: '컨스트럭터 순위', subtitle: '스프린트 포인트 반영 · 등락은 직전 라운드 대비', note: '챔피언십 스탠딩', shortenNames: false, singleColumn: true, rows: cNew.map((r) => ({ pos: r.pos, name: r.name, team: r.name, metric: r.points + 'pt', delta: r.delta })) } } : null,",
    "  { type: 'quali-top', template: 'session-result', data: { session: 'Q3 Top 10', rows: q3.map((x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, time: x.Q3 })) } },",
    "  { type: 'quali-elims', template: 'quali-elims', data: { elimQ2: qr.filter((x) => x.Q2 && !x.Q3).map(qrow), elimQ1: qr.filter((x) => !x.Q2).map(qrow) } },",
    "  { type: 'grid', template: 'grid', data: { title: '레이스 그리드', note: '퀄리파잉 결과 기준', rows: qr.map((x) => ({ pos: x.position, code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name })) } },",
    "].filter(Boolean);",
    "if (cards.length > 10) throw new Error('카드 10장 초과: ' + cards.length);",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [800, 240]
);
c('Recipe Switch', 'SS Sprint', 5);
c('SS Sprint', 'SS Quali');
c('SS Quali', 'SS DrvPrev');
c('SS DrvPrev', 'SS ConPrev');
c('SS ConPrev', 'SS Research');
c('SS Research', 'SS Merge Research');
c('SS Merge Research', 'SS Pexels');
c('SS Pexels', 'SS Pick Photo');
c('SS Pick Photo', 'SS Cards');

// ---------- 브랜치 7: 월 레이스 총정리 ----------
http('RC Results', "=https://api.jolpi.ca/ergast/f1/{{ $json.season }}/{{ $json.round }}/results.json?limit=40", [-80, 520]);
http('RC DrvNow', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ $('Resolve Day Type').first().json.round }}/driverstandings.json?limit=40", [140, 520]);
http('RC DrvPrev', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ Math.max(1, $('Resolve Day Type').first().json.prevRound) }}/driverstandings.json?limit=40", [360, 520]);
http('RC ConNow', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ $('Resolve Day Type').first().json.round }}/constructorstandings.json?limit=20", [580, 520]);
http('RC ConPrev', "=https://api.jolpi.ca/ergast/f1/{{ $('Resolve Day Type').first().json.season }}/{{ Math.max(1, $('Resolve Day Type').first().json.prevRound) }}/constructorstandings.json?limit=20", [800, 520]);
http('RC OFMeet', "=https://api.openf1.org/v1/meetings?year={{ $('Resolve Day Type').first().json.season }}", [1020, 520]);
code(
  'RC OFPick',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const ms = $input.all().map((i) => i.json);",
    "let m = ms.find((x) => x.meeting_name === meta.raceName) || ms.find((x) => (x.meeting_official_name || '').includes(meta.raceName));",
    "if (!m) { const fp1 = meta.sessions.find((s) => s.code === 'FP1'); if (fp1) m = ms.find((x) => Math.abs(Date.parse(x.date_start) - Date.parse(fp1.startUtc)) < 5 * 86400000); }",
    "if (!m) throw new Error('OpenF1 미팅 매칭 실패: ' + meta.raceName);",
    "return [{ json: { ...meta, meeting_key: m.meeting_key } }];",
  ].join('\n'),
  [1240, 520]
);
http('RC OFSess', "=https://api.openf1.org/v1/sessions?meeting_key={{ $json.meeting_key }}", [1460, 520]);
code(
  'RC OFRace',
  [
    "const meta = $('RC OFPick').first().json;",
    "const ss = $input.all().map((i) => i.json);",
    "const race = ss.find((x) => x.session_name === 'Race');",
    "if (!race) throw new Error('OpenF1 레이스 세션 없음');",
    "return [{ json: { ...meta, race_session_key: race.session_key } }];",
  ].join('\n'),
  [1680, 520]
);
http('RC Stints', "=https://api.openf1.org/v1/stints?session_key={{ $json.race_session_key }}", [1900, 520]);
http('RC OFDrv', "=https://api.openf1.org/v1/drivers?session_key={{ $('RC OFRace').first().json.race_session_key }}", [2120, 520]);
n(
  'RC Research',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ contents: [{ parts: [{ text: '어제 열린 F1 ' + $('Resolve Day Type').first().json.season + ' ' + $('Resolve Day Type').first().json.raceName + ' 레이스에 대해 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"issues\": [{\"head\": \"이슈 제목 한국어 12자 이내\", \"body\": \"그 이슈만 다룬 한국어 설명 1~2문장, 60자 이내\"}], \"headline\": \"레이스를 한 줄로 요약한 한국어 후킹 문구 16자 이내\", \"dotd\": \"Driver of the Day 수상 드라이버 이름 (공식 발표 기준, 못 찾으면 null)\", \"dotdComment\": \"그 드라이버가 뽑힌 이유 한국어 1~2문장 (dotd가 null이면 null)\", \"photoKeyword\": \"이슈 분위기에 맞는 영어 스톡사진 검색어 2~3단어\"} issues는 서로 다른 주제로 2~4개. photoKeyword는 추상적인 장면만 (예: tyre smoke, wet asphalt, night pit lane, racing helmet) — 팀명/대회명/드라이버명은 절대 넣지 말 것. 반드시 최상위는 위 키들을 가진 JSON 객체여야 한다 — 응답 전체를 null로 출력하지 말 것. 정보를 못 찾은 개별 필드만 null로 두고, issues를 못 찾으면 빈 배열 []로 둘 것.' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }) }}",
    options: { timeout: 60000 },
  },
  [2340, 640],
  4.2,
  { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
);
code(
  'RC Merge Research',
  [
    "// 리서치가 비는 원인을 추적할 수 있도록 응답 원문을 남긴다 (onError가 실패를 삼켜 눈에 안 보였다)",
    "let research = null; let diag = null;",
    "const raw = $input.first().json;",
    "try {",
    "  const parts = raw.candidates[0].content.parts;",
    "  const text = parts.map((p) => p.text || '').join('').trim();",
    "  if (!text) throw new Error('텍스트 파트 없음');",
    "  if (text === 'null') throw new Error('모델이 최상위 null 반환 — 프롬프트 확인 필요');",
    "  research = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));",
    "} catch (e) {",
    "  research = null;",
    "  diag = { at: new Date().toISOString(), reason: String(e.message), keys: Object.keys(raw || {}), raw: JSON.stringify(raw).slice(0, 1500) };",
    "}",
    "try { require('fs').writeFileSync('/data/hooni_speed/last-research.json', JSON.stringify({ ok: !!research, diag, research }, null, 1)); } catch (e) {}",
    "return [{ json: { research } }];",
  ].join('\n'),
  [2450, 520]
);
n(
  'RC Pexels',
  'httpRequest',
  {
    // 이슈 카드 배경용 분위기 사진. 특정 장면을 주장하지 않는 추상적 검색어만 들어온다.
    url: "=https://api.pexels.com/v1/search?orientation=landscape&per_page=15&query={{ encodeURIComponent(($json.research && $json.research.photoKeyword) || 'motorsport asphalt') }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: { timeout: 20000 },
  },
  [2560, 640],
  4.2,
  { executeOnce: true, onError: 'continueRegularOutput', credentials: { httpHeaderAuth: { id: 'PexelsApiKey0001', name: 'Pexels API' } } }
);
code(
  'RC Pick Photo',
  [
    "const research = $('RC Merge Research').first().json.research || null;",
    "const meta = $('Resolve Day Type').first().json;",
    "let photo = null;",
    "try {",
    "  const ps = $input.first().json.photos || [];",
    "  if (ps.length) { const x = ps[meta.round % ps.length]; photo = { url: x.src.large, credit: x.photographer }; }",
    "} catch (e) { photo = null; /* 사진 없어도 카드는 만든다 */ }",
    "return [{ json: { research, photo } }];",
  ].join('\n'),
  [2670, 640]
);
code(
  'RC Cards',
  [
    "const meta = $('Resolve Day Type').first().json;",
    "const rs = $('RC Pick Photo').first().json.research || {};",
    "const photo = $('RC Pick Photo').first().json.photo || null;",
    "const races = $('RC Results').first().json.MRData.RaceTable.Races || [];",
    "if (!races.length || !races[0].Results || !races[0].Results.length) throw new Error('레이스 결과 미반영 — 수동 재실행 필요');",
    "const res = races[0].Results;",
    "const rows = res.map((x) => ({ pos: parseInt(x.position), code: x.Driver.code, name: x.Driver.givenName + ' ' + x.Driver.familyName, team: x.Constructor.name, points: parseFloat(x.points || '0'), status: x.status, grid: parseInt(x.grid) }));",
    "const fl = res.find((x) => x.FastestLap && x.FastestLap.rank === '1');",
    "function standings(nowSrc, prevSrc, kind) {",
    "  const get = (src) => { const l = $(src).first().json.MRData.StandingsTable.StandingsLists || []; return l.length ? l[0][kind] || [] : []; };",
    "  const now = get(nowSrc); const prev = meta.prevRound >= 1 ? get(prevSrc) : [];",
    "  const prevPos = {}; for (const x of prev) prevPos[kind === 'DriverStandings' ? x.Driver.driverId : x.Constructor.constructorId] = parseInt(x.position);",
    "  return now.map((x) => { const id = kind === 'DriverStandings' ? x.Driver.driverId : x.Constructor.constructorId; const name = kind === 'DriverStandings' ? x.Driver.givenName + ' ' + x.Driver.familyName : x.Constructor.name; const team = kind === 'DriverStandings' ? (x.Constructors.length ? x.Constructors[x.Constructors.length - 1].name : '') : x.Constructor.name; const pp = prevPos[id]; return { pos: parseInt(x.position), name, team, points: parseFloat(x.points), delta: pp ? pp - parseInt(x.position) : null }; });",
    "}",
    "const dRows = standings('RC DrvNow', 'RC DrvPrev', 'DriverStandings');",
    "const cRows = standings('RC ConNow', 'RC ConPrev', 'ConstructorStandings');",
    "if (!dRows.length) throw new Error('스탠딩 미반영 — 수동 재실행 필요');",
    "// 타이어 스틴트 (상위 5명)",
    "const dmap = {}; for (const i of $('RC OFDrv').all()) dmap[i.json.driver_number] = i.json.name_acronym;",
    "const byDrv = {}; for (const i of $('RC Stints').all()) { const s = i.json; (byDrv[s.driver_number] = byDrv[s.driver_number] || []).push({ compound: s.compound, from: s.lap_start, to: s.lap_end }); }",
    "const codeToStints = {}; for (const [num, st] of Object.entries(byDrv)) { const c = dmap[num]; if (c) codeToStints[c] = st.sort((a, b) => a.from - b.from); }",
    "const stintRows = rows.slice(0, 5).map((r) => ({ pos: r.pos, code: r.code, name: r.name, stints: codeToStints[r.code] || [] }));",
    "// DOTD 수상자를 레이스 결과에서 찾아 코드/팀을 붙인다 (캐릭터 이미지 조회용)",
    "const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');",
    "const dotdRow = rs.dotd ? rows.find((r) => norm(r.name).includes(norm(String(rs.dotd).split(' ').pop()))) : null;",
    "// Jolpica status: 'Finished' | 'Lapped' | '+N Lap' 은 완주. 그 외(Retired/Accident/Engine…)만 RET.",
    "const finished = (st) => /^(Finished|Lapped)$/.test(String(st || '')) || /^\\+\\d+ Lap/.test(String(st || ''));",
    "const metricOf = (r) => (finished(r.status) ? (r.points ? r.points + 'pt' : '—') : 'RET');",
    "const cards = [",
    "  { type: 'cover', template: 'cover-recap', needsLlm: ['memeConcept', 'bgImage'], data: { title: meta.raceName, subtitle: rs.headline || ('총정리 · 우승 ' + rows[0].name) } },",
    "  { type: 'race-result', template: 'result-full', data: { title: '레이스 결과', subtitle: meta.raceName, rows: rows.map((r) => ({ pos: r.pos, code: r.code, name: r.name, team: r.team, metric: metricOf(r), out: metricOf(r) === 'RET' })) } },",
    "  { type: 'issue', template: 'issue-blocks', needsLlm: ['issues'], data: { session: '레이스', issues: rs.issues || null, photo, fastestLap: fl ? { name: fl.Driver.givenName + ' ' + fl.Driver.familyName, time: fl.FastestLap.Time ? fl.FastestLap.Time.time : null } : null } },",
    "  { type: 'dotd', template: 'dotd-card', needsLlm: ['dotd'], data: { driver: rs.dotd || null, team: dotdRow ? dotdRow.team : '', code: dotdRow ? String(dotdRow.code || '').toLowerCase() : null, body: rs.dotdComment || null } },",
    "  { type: 'stints', template: 'stints', data: { title: '타이어 전략 (Top 5)', rows: stintRows } },",
    "  { type: 'standings-drivers', template: 'result-full', data: { title: '드라이버 순위', subtitle: '등락은 직전 라운드 대비', rows: dRows.map((r) => ({ pos: r.pos, name: r.name, team: r.team, metric: r.points + 'pt', delta: r.delta })), note: '챔피언십 스탠딩' } },",
    "  { type: 'standings-constructors', template: 'result-full', data: { title: '컨스트럭터 순위', subtitle: '등락은 직전 라운드 대비', note: '챔피언십 스탠딩', shortenNames: false, singleColumn: true, rows: cRows.map((r) => ({ pos: r.pos, name: r.name, team: r.name, metric: r.points + 'pt', delta: r.delta })) } },",
    "];",
    "if (cards.length > 10) throw new Error('카드 10장 초과: ' + cards.length);",
    "return [{ json: { dayType: meta.dayType, season: meta.season, round: meta.round, raceName: meta.raceName, circuitId: meta.circuitId, dateKst: meta.dateKst, cards } }];",
  ].join('\n'),
  [2340, 520]
);
c('Recipe Switch', 'RC Results', 6);
c('RC Results', 'RC DrvNow');
c('RC DrvNow', 'RC DrvPrev');
c('RC DrvPrev', 'RC ConNow');
c('RC ConNow', 'RC ConPrev');
c('RC ConPrev', 'RC OFMeet');
c('RC OFMeet', 'RC OFPick');
c('RC OFPick', 'RC OFSess');
c('RC OFSess', 'RC OFRace');
c('RC OFRace', 'RC Stints');
c('RC Stints', 'RC OFDrv');
c('RC OFDrv', 'RC Research');
c('RC Research', 'RC Merge Research');
c('RC Merge Research', 'RC Pexels');
c('RC Pexels', 'RC Pick Photo');
c('RC Pick Photo', 'RC Cards');

// ---------- 공통 꼬리: 렌더 → 승인 → 발행 ----------
n(
  'Render (WF-2)',
  'executeWorkflow',
  { workflowId: { __rl: true, value: 'HooniWF2Rndr0001', mode: 'id', cachedResultName: 'HooniSpeed WF-2 card-renderer' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [2700, 0],
  1.2
);
n(
  'Approve (WF-3)',
  'executeWorkflow',
  { workflowId: { __rl: true, value: 'HooniWF3Appr0001', mode: 'id', cachedResultName: 'HooniSpeed WF-3 approval-loop' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [2920, 0],
  1.2
);
n(
  'IF Publish',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: '={{ $json.approved }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [3140, 0],
  2.2
);
code(
  'Build Caption',
  [
    "const p = $input.first().json;",
    "const TYPE_LABEL = { preview: '프리뷰', guide: '관전 가이드', 'practice-results': '연습주행 결과', 'quali-results': '퀄리파잉 결과', 'sprint-fri-results': '스프린트 퀄리파잉', 'sprint-sat-results': '스프린트 & 퀄리파잉', 'race-recap': '레이스 총정리' };",
    "const caption = p.season + ' ' + p.raceName + ' ' + (TYPE_LABEL[p.dayType] || '') + '\\n\\n#후니스피드 #F1 #Formula1 #' + String(p.raceName || '').replace(/\\s+/g, '');",
    "return [{ json: { ...p, caption } }];",
  ].join('\n'),
  [3360, -80]
);
n(
  'Publish (WF-4)',
  'executeWorkflow',
  { workflowId: { __rl: true, value: 'HooniWF4Publ0001', mode: 'id', cachedResultName: 'HooniSpeed WF-4 publisher' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [3580, -80],
  1.2
);
n(
  'Meme Story (WF-6)',
  'executeWorkflow',
  { workflowId: { __rl: true, value: 'HooniWF6Meme00001', mode: 'id', cachedResultName: 'HooniSpeed WF-6 meme-story' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [2480, -300],
  1.2,
  { onError: 'continueRegularOutput' } // 스토리 생성 실패해도 피드 발행은 계속
);
// 목 프리뷰·월 총정리만 밈 스토리를 거친다 (나머지는 피드만)
for (const cardsNode of ['PV Cards', 'RC Cards']) {
  c(cardsNode, 'Meme Story (WF-6)');
}
c('Meme Story (WF-6)', 'Render (WF-2)');
for (const cardsNode of ['GD Cards', 'OF Cards', 'QL Cards', 'SS Cards']) {
  c(cardsNode, 'Render (WF-2)');
}
c('Render (WF-2)', 'Approve (WF-3)');
c('Approve (WF-3)', 'IF Publish');
c('IF Publish', 'Build Caption', 0);
c('Build Caption', 'Publish (WF-4)');

const workflow = {
  id: 'HooniWF1Sched001',
  name: 'HooniSpeed WF-1 main-scheduler',
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', errorWorkflow: 'HooniWFErr00001' },
  active: false,
};
process.stdout.write(JSON.stringify(workflow, null, 2) + '\n');

// WF-1 main-scheduler 생성기: node build-wf1.js > wf1-main-scheduler.json
const fs = require('fs');
const { GEMINI_CRED, REPUBLISH_PATH, REPUBLISH_KEY, TG_CHAT_ID, TG_CRED } = require('./config');
// 화풍은 style.js 가 단일 출처다 — gen-assets.js 와 같은 값을 쓴다 (복사본 금지)
const { STYLE_V2 } = require('./style');
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

// ---------- LLM 리서치 (의미상 실패 재시도) ----------
// HTTP 노드의 retryOnFail 은 통신 실패(타임아웃·5xx)만 잡는다. 모델이 200 OK 로 최상위 null 이나
// 깨진 JSON 을 돌려주면 노드는 "성공"으로 통과하고, 실패는 다음 Code 노드에서야 드러난다.
// 그 지점에는 재시도가 없어서 2026-08-20 프리뷰의 타이어·이슈 카드가 빈 채로 발행됐다.
// n8n 에는 루프가 없으므로 시도 횟수만큼 노드를 펼친다. 재시도마다 temperature 를 올려
// 같은 프롬프트에서 다른 응답이 나올 여지를 준다.
const RESEARCH_TEMPS = [0.1, 0.45, 0.8];
const RETRY_DIRECTIVE =
  ' 이전 시도에서 형식이 잘못된 응답이 나왔다. 다른 말 없이 위 키를 가진 순수 JSON 객체 하나만 출력할 것.';

function researchBody(promptExpr, temp, isRetry) {
  const prompt = isRetry ? promptExpr + " + '" + RETRY_DIRECTIVE + "'" : promptExpr;
  return (
    '={{ JSON.stringify({ contents: [{ parts: [{ text: ' +
    prompt +
    ' }] }], tools: [{ google_search: {} }], generationConfig: { temperature: ' +
    temp +
    ' } }) }}'
  );
}

// 시도 k 의 응답을 판정한다. 실패면 retry:'yes' 를 달아 IF 노드가 다음 시도로 보낸다.
function researchParse(attempt) {
  return [
    '// 200 OK 라도 모델이 null·깨진 JSON 을 줄 수 있다. 성공 판정은 여기서만 한다.',
    'let research = null; let diag = null;',
    'const raw = $input.first().json;',
    'try {',
    '  const parts = raw.candidates[0].content.parts;',
    "  const text = parts.map((p) => p.text || '').join('').trim().replace(/^```(json)?/m, '').replace(/```\\s*$/m, '').trim();",
    "  if (!text) throw new Error('텍스트 파트 없음');",
    "  if (text === 'null') throw new Error('모델이 최상위 null 반환');",
    "  research = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));",
    "  if (!research || typeof research !== 'object') throw new Error('최상위가 객체가 아님');",
    '} catch (e) {',
    '  research = null;',
    '  diag = { at: new Date().toISOString(), attempt: ' + attempt + ', reason: String(e.message), raw: JSON.stringify(raw).slice(0, 1200) };',
    '}',
    "return [{ json: { research, diag, attempt: " + attempt + ", retry: research ? 'no' : 'yes' } }];",
  ].join('\n');
}

// prefix: 브랜치 접두사(PV/SS/RC) · entry: 앞 노드 · next: 뒤 노드
// returnLine: 최종 노드의 return 문 (브랜치마다 출력 모양이 다르다)
function researchChain({ prefix, promptExpr, entry, next, branchLabel, returnLine, pos }) {
  const attempts = RESEARCH_TEMPS.length;
  const [x, y] = pos;
  const R = (k) => prefix + ' Research' + (k > 1 ? ' ' + k : '');
  const P = (k) => prefix + ' Parse ' + k;
  const IF = (k) => prefix + ' Retry? ' + k;
  const FINAL = prefix + ' Merge Research';

  for (let k = 1; k <= attempts; k += 1) {
    const dy = (k - 1) * 150;
    n(
      R(k),
      'httpRequest',
      {
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googlePalmApi',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: researchBody(promptExpr, RESEARCH_TEMPS[k - 1], k > 1),
        options: { timeout: 60000 },
      },
      [x, y + dy],
      4.2,
      { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
    );
    code(P(k), researchParse(k), [x + 180, y + dy]);
    c(R(k), P(k));

    if (k < attempts) {
      n(
        IF(k),
        'if',
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
            conditions: [
              {
                id: prefix.toLowerCase() + '-retry-' + k,
                leftValue: '={{ $json.retry }}',
                rightValue: 'yes',
                operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        [x + 360, y + dy],
        2.3
      );
      c(P(k), IF(k));
      c(IF(k), R(k + 1), 0); // 실패 → 다음 시도
      c(IF(k), FINAL, 1); // 성공 → 확정
    } else {
      c(P(k), FINAL); // 마지막 시도는 성공·실패 무관하게 확정 (발행은 계속된다)
    }
  }

  code(
    FINAL,
    [
      '// 재시도 결과 확정. 실패해도 나머지 카드는 발행되므로 삼키되 원인을 남긴다.',
      'const inp = $input.first().json;',
      'const research = inp.research || null;',
      "try { require('fs').writeFileSync('/data/hooni_speed/last-research.json', JSON.stringify({ ok: !!research, branch: '" +
        branchLabel +
        "', attempts: inp.attempt || 1, diag: inp.diag || null, research }, null, 1)); } catch (e) {}",
      returnLine,
    ].join('\n'),
    [x + 540, y]
  );

  c(entry, R(1));
  c(FINAL, next);
}

// ---------- 공용 트리거/판별 ----------
n('Daily 09:00 KST', 'scheduleTrigger', { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } }, [-1050, 0], 1.2);
n('Manual Test Trigger', 'manualTrigger', {}, [-1050, 160]);

// ---------- 재요청 진입점 ----------
// WF-4 발행 완료 알림의 "다시 만들기" 버튼이 이 웹훅을 GET 으로 호출한다.
// 파이프라인이 12분 이상 걸리므로 즉시 응답하고(onReceived) 나머지는 백그라운드로 돈다.
// 버튼 URL 은 텔레그램 대화에 남으므로 키를 확인해 아무나 발행을 트리거하지 못하게 막는다.
n(
  'Republish Webhook',
  'webhook',
  { httpMethod: 'GET', path: REPUBLISH_PATH, responseMode: 'onReceived', options: {} },
  [-1050, 320],
  2,
  { webhookId: 'b9000001-republish-000-0000-000000000000' }
);
n(
  'IF Republish Auth',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      conditions: [
        {
          id: 'republish-key',
          leftValue: '={{ $json.query.k }}',
          rightValue: REPUBLISH_KEY,
          operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  [-880, 320],
  2.3
);
// 재요청은 "무엇을 다시 만들지"를 마지막 발행 기록에서 읽는다. 버튼 URL 에 회차를 실어
// 보내지 않으므로, 링크를 재사용해도 항상 최근 발행분만 다시 만들어진다.
code(
  'Load Last Publish',
  [
    "const fs = require('fs');",
    'let lp = null;',
    "try { lp = JSON.parse(fs.readFileSync('/data/hooni_speed/last-publish.json', 'utf8')); } catch (e) {}",
    "if (!lp || !lp.dayType) throw new Error('재요청할 발행 기록이 없다 (last-publish.json)');",
    'const ageH = (Date.now() - Date.parse(lp.publishedAt)) / 3600000;',
    "if (!(ageH < 12)) throw new Error('마지막 발행이 ' + Math.round(ageH) + '시간 전이라 재요청 대상이 아니다');",
    "const DAY = { preview: '프리뷰', guide: '관전 가이드', 'practice-results': '연습주행', 'quali-results': '퀄리파잉', 'sprint-fri-results': '스프린트 퀄리파잉', 'sprint-sat-results': '스프린트 & 퀄리파잉', 'race-recap': '총정리' };",
    'return [{ json: { ...lp, dayLabel: DAY[lp.dayType] || lp.dayType } }];',
  ].join('\n'),
  [-700, 320]
);
// 버튼을 눌러도 12분 동안 아무 소식이 없으면 접수됐는지 알 수 없다. 즉시 확인을 보낸다.
// 인증 실패는 여기까지 오지 않으므로 조용히 무시된다 (외부 노출 웹훅이라 의도된 동작).
n(
  'Notify Republish Queued',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text: "=🔄 다시 만들기 접수됐습니다.\n\n🆔 {{ $json.dirName }}  ·  {{ $json.raceName }}\n같은 회차({{ $json.dayLabel }})를 처음부터 다시 만듭니다.\n카드가 준비되면 승인 요청을 보냅니다 (12분 정도 소요).",
    additionalFields: {},
  },
  [-520, 320],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'b9000002-notify-requeue-0-000000000000' }
);
http('Jolpica Calendar', 'https://api.jolpi.ca/ergast/f1/current.json', [-820, 0]);

const RESOLVE = [
  "// 오늘(KST)의 콘텐츠 타입 판별 — 세션 날짜 기준. OVERRIDE는 브랜치 테스트용.",
  "// 아래 줄은 글자 그대로 유지한다 — test-wf1/test-branches/sim-weekend 가 문자열 치환·assert 로 쓴다.",
  "const OVERRIDE = null;",
  "// 재요청 버튼(WF-4 발행 완료 알림)으로 들어오면 마지막 발행과 같은 회차를 다시 만든다.",
  "// 평소 경로에서는 Load Last Publish 가 실행되지 않아 참조가 던지므로 try 로 감싼다.",
  "let REPUBLISH = null;",
  "try {",
  "  const lp = $('Load Last Publish').first().json;",
  "  if (lp && lp.dayType) REPUBLISH = { dayType: lp.dayType, round: lp.round };",
  "} catch (e) {}",
  "const EFF = OVERRIDE || REPUBLISH;",
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
  "if (EFF) {",
  "  const race = races.find((r) => parseInt(r.round) === parseInt(EFF.round));",
  "  if (!race) throw new Error('OVERRIDE round not found');",
  "  return [{ json: { dayType: EFF.dayType, reported: [OVERRIDE ? 'TEST' : 'REPUBLISH'], ...baseOf(race, collect(race)) } }];",
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
// 재요청 경로: 키 확인 → 마지막 발행 기록 로드 → 평소와 같은 본선으로 합류.
// 이후 흐름이 동일하므로 승인 요청도 처음과 똑같이 온다.
c('Republish Webhook', 'IF Republish Auth');
c('IF Republish Auth', 'Load Last Publish', 0);
c('Load Last Publish', 'Notify Republish Queued');
c('Notify Republish Queued', 'Jolpica Calendar');
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
// 프롬프트는 $json 이 아니라 PV Extract 를 직접 참조한다 — 재시도 2회차부터는 입력이
// IF 노드 출력이라 $json 에 season/raceName 이 없다.
researchChain({
  prefix: 'PV',
  branchLabel: 'preview',
  entry: 'PV Extract',
  next: 'PV LastYear Sprint',
  pos: [360, -840],
  promptExpr:
    "'F1 ' + $('PV Extract').first().json.season + ' ' + $('PV Extract').first().json.raceName + ' 프리뷰 자료 조사. 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"tiresLastYear\": \"작년 이 GP의 피렐리 타이어 컴파운드 배정 (예: C2/C3/C4)\", \"tiresThisYear\": \"올해 이 GP 배정 (미발표면 null)\", \"issues\": [{\"head\": \"이슈 제목 한국어 12자 이내\", \"body\": \"그 이슈만 다룬 한국어 설명 1~2문장, 60자 이내\"}]} issues는 이 GP와 관련된 서로 다른 주제로 2~3개 — 한 항목에 여러 주제를 섞지 말 것. 반드시 최상위는 위 키들을 가진 JSON 객체여야 한다 — 응답 전체를 null로 출력하지 말 것. 정보를 못 찾은 개별 필드만 null로 두고, issues를 못 찾으면 빈 배열 []로 둘 것.'",
  returnLine: "return [{ json: { ...$('PV Extract').first().json, research } }];",
});
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
    "  // 주제가 여러 개면 한 문단에 몰지 않는다 — issue-blocks 가 주제별 블록으로 나눠 렌더한다.",
    "  { type: 'issue', template: 'issue-blocks', needsLlm: ['issues'], data: { lastYear: meta.lastYear, session: meta.lastYear ? meta.lastYear.season + ' ' + meta.raceName : meta.raceName, issues: rs.issues || [] } },",
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
// PV Extract → 리서치 체인 → PV LastYear Sprint 연결은 researchChain 이 만든다
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
researchChain({
  prefix: 'SS',
  branchLabel: 'sprint-sat',
  entry: 'SS ConPrev',
  next: 'SS Pexels',
  pos: [800, 340],
  promptExpr:
    "'어제 열린 F1 ' + $('Resolve Day Type').first().json.season + ' ' + $('Resolve Day Type').first().json.raceName + ' 스프린트 레이스에 대해 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"issues\": [{\"head\": \"이슈 제목 한국어 12자 이내\", \"body\": \"그 이슈만 다룬 한국어 설명 1~2문장, 60자 이내\"}], \"photoKeyword\": \"이슈 분위기에 맞는 영어 스톡사진 검색어 2~3단어\"} issues는 서로 다른 주제로 2~3개. 본 레이스가 아니라 스프린트 레이스만 다룰 것. photoKeyword는 추상적인 장면만 — 팀명/대회명/드라이버명은 절대 넣지 말 것. 반드시 최상위는 위 키들을 가진 JSON 객체여야 한다 — 응답 전체를 null로 출력하지 말 것. 정보를 못 찾은 개별 필드만 null로 두고, issues를 못 찾으면 빈 배열 []로 둘 것.'",
  returnLine: 'return [{ json: { research } }];',
});
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
// SS ConPrev → 리서치 체인 → SS Pexels 연결은 researchChain 이 만든다
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
researchChain({
  prefix: 'RC',
  branchLabel: 'race-recap',
  entry: 'RC OFDrv',
  next: 'RC Pexels',
  pos: [2340, 640],
  promptExpr:
    "'어제 열린 F1 ' + $('Resolve Day Type').first().json.season + ' ' + $('Resolve Day Type').first().json.raceName + ' 레이스에 대해 웹검색으로 확인해서 순수 JSON만 출력 (코드펜스 금지): {\"issues\": [{\"head\": \"이슈 제목 한국어 12자 이내\", \"body\": \"그 이슈만 다룬 한국어 설명 1~2문장, 60자 이내\"}], \"headline\": \"레이스를 한 줄로 요약한 한국어 후킹 문구 16자 이내\", \"dotd\": \"Driver of the Day 수상 드라이버 이름 (공식 발표 기준, 못 찾으면 null)\", \"dotdComment\": \"그 드라이버가 뽑힌 이유 한국어 1~2문장 (dotd가 null이면 null)\", \"photoKeyword\": \"이슈 분위기에 맞는 영어 스톡사진 검색어 2~3단어\"} issues는 서로 다른 주제로 2~4개. photoKeyword는 추상적인 장면만 (예: tyre smoke, wet asphalt, night pit lane, racing helmet) — 팀명/대회명/드라이버명은 절대 넣지 말 것. 반드시 최상위는 위 키들을 가진 JSON 객체여야 한다 — 응답 전체를 null로 출력하지 말 것. 정보를 못 찾은 개별 필드만 null로 두고, issues를 못 찾으면 빈 배열 []로 둘 것.'",
  returnLine: 'return [{ json: { research } }];',
});
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
// RC OFDrv → 리서치 체인 → RC Pexels 연결은 researchChain 이 만든다
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
// ---------- 캐릭터 자산 승인 게이트 (월 총정리 전용) ----------
// 대체 드라이버(부상 교체 등)가 포디움이나 DOTD에 들면 캐릭터 자산이 없다. 그대로 두면
// 포디움 스토리가 조용히 일반 스토리로 대체된다 — 명세에 확정한 카드가 경고 없이 사라진다.
// 그래서 생성 여부를 먼저 묻고, 생성물도 눈으로 확인받은 뒤 라이브러리에 넣는다.
//
// 프리뷰는 게이트를 타지 않는다: 밈 표지의 드라이버는 WF-6 안에서 LLM이 정하므로
// 이 시점에 알 수 없고, 참조가 없어도 인물 오표기가 아니라 화풍 흔들림에 그친다.
const WAIT_PAGE = (msg) =>
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b14;' +
  'color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center"><div>' +
  '<div style="font-size:64px">✅</div><h1 style="font-size:24px;margin:16px 0 8px">' + msg + '</h1>' +
  '<p style="color:#9a9aa8;font-size:16px;margin:0">텔레그램으로 돌아가세요</p>' +
  '<p style="color:#5a5a68;font-size:13px;margin-top:24px">HOONI.SPEED</p></div></body></html>';

code(
  'Detect Missing Assets',
  [
    '// 캐릭터가 필요한 대상: 포디움 3인(스토리 참조) + DOTD 수상자(카드 이미지).',
    '// 감지가 실패하면 게이트를 건너뛴다 (fail-open) — 게이트 버그로 발행이 멈추는 것이 최악이다.',
    "const fs = require('fs');",
    'const p = $input.first().json;',
    'let missing = [];',
    'try {',
    '  const cards = p.cards || [];',
    "  const rr = cards.find((c) => c.type === 'race-result');",
    '  const podium = ((rr && rr.data && rr.data.rows) || []).slice(0, 3);',
    "  const dotd = cards.find((c) => c.type === 'dotd');",
    "  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');",
    '  const want = new Map();',
    '  for (const r of podium) {',
    '    const c = norm(r.code);',
    "    if (c) want.set(c, { code: c, name: r.name || c.toUpperCase(), team: r.team || '', need: ['podium'] });",
    '  }',
    '  if (dotd && dotd.data && dotd.data.code) {',
    '    const c = norm(dotd.data.code);',
    '    if (c) {',
    "      const e = want.get(c) || { code: c, name: dotd.data.driver || c.toUpperCase(), team: dotd.data.team || '', need: [] };",
    "      e.need = e.need.concat('dotd');",
    '      want.set(c, e);',
    '    }',
    '  }',
    '  const exists = (fp) => { try { return fs.statSync(fp).size > 0; } catch (e) { return false; } };',
    "  const hasBase = (c) => ['characters-v2', 'characters'].some((d) => ['base.png', '_pending.png']",
    "    .some((f) => exists('/data/hooni_speed/assets/' + d + '/' + c + '/' + f)));",
    "  // AppleDouble 부산물('._x.png')은 포즈가 아니다 — 자산 보유로 오판하면 안 된다",
    "  const hasPose = (c) => { try { return fs.readdirSync('/data/cards/dotd/' + c).some((f) => f.endsWith('.png') && !f.startsWith('.')); } catch (e) { return false; } };",
    '  for (const e of want.values()) {',
    "    const lackBase = e.need.includes('podium') && !hasBase(e.code);",
    "    const lackPose = e.need.includes('dotd') && !hasPose(e.code);",
    '    if (lackBase || lackPose) missing.push({ ...e, lackBase, lackPose });',
    '  }',
    '} catch (e) { missing = []; }',
    '// 한 번에 한 명만 생성한다 — 교체 드라이버는 보통 1명이고, 여러 명을 돌리면 노드가 아이템마다 반복된다.',
    "return [{ json: { ...p, missingAssets: missing, assetTarget: missing[0] || null, assetGate: missing.length ? 'ask' : 'skip' } }];",
  ].join('\n'),
  [2480, -560]
);
n(
  'IF Assets Missing',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      conditions: [
        {
          id: 'asset-gate',
          leftValue: '={{ $json.assetGate }}',
          rightValue: 'ask',
          operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  [2660, -560],
  2.3
);
n(
  'Ask Asset Gen',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text:
      "=🎭 캐릭터 자산이 없는 드라이버가 있습니다.\n\n🆔 {{ $json.season }}-r{{ $json.round }} · {{ $json.raceName }}\n" +
      '대상: {{ $json.assetTarget.name }} ({{ $json.assetTarget.code.toUpperCase() }}){{ $json.assetTarget.team ? " · " + $json.assetTarget.team : "" }}\n' +
      '{{ $json.missingAssets.length > 1 ? "\\n(다른 " + ($json.missingAssets.length - 1) + "명도 자산이 없습니다 — 이번엔 위 1명만 생성합니다)\\n" : "" }}\n' +
      '지금 생성하면 확인을 거쳐 포디움 스토리에 씁니다.\n생성하지 않으면 캐릭터 없이 텍스트로 스토리를 만듭니다.\n\n⏳ 6시간 내 응답이 없으면 텍스트로 진행합니다.',
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        { row: { buttons: [{ text: '🎨 캐릭터 생성', additionalFields: { url: '={{ $execution.resumeUrl }}&text=gen' } }] } },
        { row: { buttons: [{ text: '📝 텍스트로 진행', additionalFields: { url: '={{ $execution.resumeUrl }}&text=skip' } }] } },
      ],
    },
    additionalFields: {},
  },
  [2840, -560],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'b9100001-ask-asset-000-000000000000' }
);
n(
  'Wait Asset Decision',
  'wait',
  { resume: 'webhook', limitWaitTime: true, resumeAmount: 6, resumeUnit: 'hours', options: { webhookSuffix: '', responseData: WAIT_PAGE('접수되었습니다') } },
  [3020, -560],
  1.1,
  { webhookId: 'b9100002-wait-asset-00-000000000000' }
);
code(
  'Route Asset Decision',
  [
    '// Wait 가 타임아웃으로 자동 재개되면 query 가 비어 있다 — 그것을 무응답으로 본다.',
    "const p = $('Detect Missing Assets').first().json;",
    'const r = $input.first().json || {};',
    'const q = (r.query && Object.keys(r.query).length ? r.query : r.body) || {};',
    "const t = String(q.text || '').trim();",
    "const decision = t === 'gen' ? 'gen' : t === 'skip' ? 'skip' : 'timeout';",
    'return [{ json: { ...p, assetDecision: decision } }];',
  ].join('\n'),
  [3200, -560]
);
n(
  'IF Gen Approved',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      conditions: [
        {
          id: 'asset-gen-approved',
          leftValue: '={{ $json.assetDecision }}',
          rightValue: 'gen',
          operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  [3380, -560],
  2.3
);
// 공식 포트레이트를 참조로 넣으면 실물 특징 설명 없이도 인물이 닮는다.
// 없으면(신인 등) 참조 없이 생성하고, 품질 판단은 아래 2단 확인이 맡는다.
n(
  'Fetch Portrait',
  'httpRequest',
  {
    url:
      "=https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_1320/content/dam/fom-website/drivers/{{ $json.season }}Drivers/{{ $json.assetTarget.name.trim().split(/\\s+/).pop().toLowerCase() }}",
    options: { timeout: 25000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
  },
  [3560, -560],
  4.2,
  { executeOnce: true, onError: 'continueRegularOutput' }
);
code(
  'Build Char Request',
  [
    '// 화풍은 style.js 가 단일 출처다 (gen-assets.js 와 같은 값).',
    'const STYLE = ' + JSON.stringify(STYLE_V2) + ';',
    "const p = $('Route Asset Decision').first().json;",
    'const t = p.assetTarget;',
    'const parts = [];',
    '// 포트레이트를 받았으면 레퍼런스로 넣는다 (n8n 은 바이너리를 base64 로 보관한다)',
    'try {',
    '  const b = ($input.first().binary || {}).data;',
    "  if (b && b.data) parts.push({ inlineData: { mimeType: b.mimeType || 'image/jpeg', data: b.data } });",
    '} catch (e) {}',
    'const hasRef = parts.length > 0;',
    'const who = hasRef',
    "  ? 'Redraw the person in the reference photo as a stylized caricature. Keep their exact face, hair and skin tone.'",
    "  : 'Stylized caricature of the Formula 1 driver ' + t.name + '.';",
    "const team = t.team ? ' Suit accent colours follow the team ' + t.team + ', but as abstract colour choices for a blank suit — never reproduce the real livery.' : '';",
    "parts.push({ text: who + team + '\\n\\n' + STYLE });",
    "return [{ json: { ...p, hasRef, geminiBody: { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } } } }];",
  ].join('\n'),
  [3740, -560]
);
n(
  'Gen Character',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.geminiBody) }}',
    options: { timeout: 120000 },
  },
  [3920, -560],
  4.2,
  { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
);
code(
  'Save Char Pending',
  [
    '// 라이브러리에 바로 넣지 않는다 — 확인을 통과해야 들어간다 (한 번 들어가면 매주 재사용된다).',
    "const fs = require('fs');",
    "const p = $('Build Char Request').first().json;",
    'const parts = ((($input.first().json.candidates || [])[0] || {}).content || {}).parts || [];',
    'const img = parts.find((x) => x.inlineData || x.inline_data);',
    'if (!img) return [{ json: { ...p, charUrl: null, charPending: null } }];',
    'const d = img.inlineData || img.inline_data;',
    "const dir = '/data/cards/meme';",
    'fs.mkdirSync(dir, { recursive: true });',
    "const file = 'pending-char-' + p.assetTarget.code + '.png';",
    "fs.writeFileSync(dir + '/' + file, Buffer.from(d.data, 'base64'));",
    "return [{ json: { ...p, charPending: dir + '/' + file, charUrl: 'https://xrp-admin.p-e.kr/hooni-cards/meme/' + file + '?v=' + Date.now() } }];",
  ].join('\n'),
  [4100, -560]
);
// 생성이 실패하면 보여줄 그림이 없다. 확인을 묻지 않고 바로 텍스트 폴백으로 보낸다.
n(
  'IF Char Generated',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      conditions: [
        {
          id: 'char-generated',
          leftValue: '={{ $json.charPending }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true, name: 'filter.operator.notEmpty' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  [4190, -560],
  2.3
);
n(
  'Send Char Preview',
  'telegram',
  {
    operation: 'sendPhoto',
    chatId: TG_CHAT_ID,
    file: '={{ $json.charUrl }}',
    binaryData: false,
    additionalFields: { caption: '={{ $json.assetTarget.name }} ({{ $json.assetTarget.code.toUpperCase() }}) — 생성된 캐릭터{{ $json.hasRef ? " · 공식 포트레이트 참조" : " · 참조 사진 없음" }}' },
  },
  [4280, -560],
  1.2,
  { onError: 'continueRegularOutput', credentials: { telegramApi: TG_CRED }, webhookId: 'b9100003-char-photo-0-000000000000' }
);
n(
  'Ask Asset Confirm',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text:
      "=위 캐릭터를 쓸까요?\n\n승인하면 자산 라이브러리에 저장되어 다음 주부터도 재사용됩니다.\n로고가 새어 나왔거나 인물이 닮지 않았다면 버려주세요.\n\n⏳ 6시간 내 응답이 없으면 텍스트로 진행합니다.",
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        { row: { buttons: [{ text: '✅ 이대로 사용', additionalFields: { url: '={{ $execution.resumeUrl }}&text=use' } }] } },
        { row: { buttons: [{ text: '🗑 버리고 텍스트로', additionalFields: { url: '={{ $execution.resumeUrl }}&text=drop' } }] } },
      ],
    },
    additionalFields: {},
  },
  [4460, -560],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'b9100004-ask-confirm-000000000000' }
);
n(
  'Wait Asset Confirm',
  'wait',
  { resume: 'webhook', limitWaitTime: true, resumeAmount: 6, resumeUnit: 'hours', options: { webhookSuffix: '', responseData: WAIT_PAGE('확인되었습니다') } },
  [4640, -560],
  1.1,
  { webhookId: 'b9100005-wait-confirm-00000000000' }
);
code(
  'Commit Asset',
  [
    "const fs = require('fs');",
    "const p = $('Save Char Pending').first().json;",
    'const r = $input.first().json || {};',
    'const q = (r.query && Object.keys(r.query).length ? r.query : r.body) || {};',
    "const t = String(q.text || '').trim();",
    "const accepted = t === 'use' && !!p.charPending;",
    "let outcome = accepted ? 'saved' : t === 'use' ? 'gen-failed' : t === 'drop' ? 'dropped' : 'timeout';",
    'try {',
    '  if (accepted && p.charPending) {',
    "    const base = '/data/hooni_speed/assets/characters-v2/' + p.assetTarget.code;",
    '    fs.mkdirSync(base, { recursive: true });',
    "    fs.copyFileSync(p.charPending, base + '/base.png');",
    '    // DOTD 포즈도 없으면 같은 그림을 한 장 넣어둔다 (dotd-card 는 있는 파일 중에서 고른다)',
    '    if (p.assetTarget.lackPose) {',
    "      const dd = '/data/cards/dotd/' + p.assetTarget.code;",
    '      fs.mkdirSync(dd, { recursive: true });',
    "      fs.copyFileSync(p.charPending, dd + '/base.png');",
    '    }',
    '  }',
    '  if (p.charPending) { try { fs.unlinkSync(p.charPending); } catch (e) {} }',
    "} catch (e) { outcome = 'error:' + String(e.message).slice(0, 80); }",
    'return [{ json: { ...p, assetOutcome: outcome } }];',
  ].join('\n'),
  [4820, -560]
);
code(
  'Asset Gate Done',
  [
    '// 모든 경로가 여기로 모인다. 카드 payload 를 복원해 WF-6 에 그대로 넘긴다.',
    "const src = $('Detect Missing Assets').first().json;",
    'const j = $input.first().json || {};',
    "const outcome = j.assetOutcome || (j.assetDecision === 'skip' ? 'user-skip' : j.assetDecision === 'timeout' ? 'no-answer' : j.charUrl === null ? 'gen-failed' : 'none');",
    'const { missingAssets, assetTarget, assetGate, assetDecision, geminiBody, charPending, charUrl, hasRef, ...rest } = src;',
    'return [{ json: { ...rest, assetOutcome: outcome, assetMissingCodes: (missingAssets || []).map((m) => m.code) } }];',
  ].join('\n'),
  [5000, -560]
);
n(
  'Notify Asset Outcome',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text:
      "={{ ({ saved: '✅ 캐릭터를 자산 라이브러리에 저장했습니다. 포디움 스토리에 반영됩니다.', dropped: '🗑 캐릭터를 버렸습니다. 텍스트로 스토리를 만듭니다.', timeout: '⏳ 확인 시간이 지나 텍스트로 스토리를 만듭니다.', 'user-skip': '📝 캐릭터 없이 텍스트로 스토리를 만듭니다.', 'no-answer': '⏳ 응답이 없어 텍스트로 스토리를 만듭니다.', 'gen-failed': '⚠️ 캐릭터 생성에 실패해 텍스트로 스토리를 만듭니다.' }[$json.assetOutcome]) || ('ℹ️ 자산 처리 결과: ' + $json.assetOutcome) }}\n\n🆔 {{ $json.season }}-r{{ $json.round }} · {{ $json.raceName }}\n자산 없는 드라이버: {{ ($json.assetMissingCodes || []).join(', ').toUpperCase() }}\n{{ $json.assetOutcome === 'saved' ? '\\n📦 새 자산은 서버에만 있습니다. 저장소 백업은 별도로 필요합니다:\\n   python3 workflows/sync-assets.py --apply\\n' : '' }}\n나중에 자산을 준비했다면 발행 완료 알림의 🔄 다시 만들기로 다시 만들 수 있습니다.",
    additionalFields: {},
  },
  [5180, -560],
  1.2,
  { onError: 'continueRegularOutput', credentials: { telegramApi: TG_CRED }, webhookId: 'b9100006-notify-asset-0000000000' }
);

// 프리뷰는 게이트 없이 바로 스토리로
c('PV Cards', 'Meme Story (WF-6)');
// 총정리는 자산 게이트를 통과한다
c('RC Cards', 'Detect Missing Assets');
c('Detect Missing Assets', 'IF Assets Missing');
c('IF Assets Missing', 'Ask Asset Gen', 0); // 누락 있음 → 물어본다
c('IF Assets Missing', 'Meme Story (WF-6)', 1); // 누락 없음 → 평소대로
c('Ask Asset Gen', 'Wait Asset Decision');
c('Wait Asset Decision', 'Route Asset Decision');
c('Route Asset Decision', 'IF Gen Approved');
c('IF Gen Approved', 'Fetch Portrait', 0); // 생성 승인
c('IF Gen Approved', 'Asset Gate Done', 1); // 텍스트로 / 무응답
c('Fetch Portrait', 'Build Char Request');
c('Build Char Request', 'Gen Character');
c('Gen Character', 'Save Char Pending');
c('Save Char Pending', 'IF Char Generated');
c('IF Char Generated', 'Send Char Preview', 0); // 그림 있음 → 확인 요청
c('IF Char Generated', 'Asset Gate Done', 1); // 생성 실패 → 텍스트 폴백
c('Send Char Preview', 'Ask Asset Confirm');
c('Ask Asset Confirm', 'Wait Asset Confirm');
c('Wait Asset Confirm', 'Commit Asset');
c('Commit Asset', 'Asset Gate Done');
c('Asset Gate Done', 'Notify Asset Outcome');
c('Notify Asset Outcome', 'Meme Story (WF-6)');
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

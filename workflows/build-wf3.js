// WF-3 approval-loop (채팅 기반): node build-wf3.js > wf3-approval-loop.json
// 입력(WF-2 출력): {cards, urls, dirName, baseDirName, cardCount, needsReview, ...}
// 흐름: 카드 전송 → 안내 메시지 → Wait(웹훅 재개) → WF-7이 채팅 답장을 넣어줌
//       → "발행"이면 승인 / 그 외 텍스트는 수정 지시로 해석 → Gemini가 카드 수정 → WF-2 재렌더 → 반복
// 링크를 열 필요가 없다 (사용자가 카드를 보면서 채팅에 바로 입력).
const { TG_CHAT_ID, TG_CRED, GEMINI_CRED } = require('./config');
const WF2_ID = 'HooniWF2Rndr0001';
const PENDING = '/data/hooni_speed/pending-approval.json';

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'a3' + String(uid).padStart(6, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to, outIdx) {
  connections[from] = connections[from] || { main: [] };
  const main = connections[from].main;
  const idx = outIdx || 0;
  while (main.length <= idx) main.push([]);
  main[idx].push({ node: to, type: 'main', index: 0 });
}

n('When Executed by Another Workflow', 'executeWorkflowTrigger', {}, [0, 0]);
n('Init Loop', 'code', { jsCode: "const p = $input.first().json;\nreturn [{ json: { ...p, revision: p.revision || 0 } }];" }, [200, 0], 2);
n('Loop State', 'code', { jsCode: "// 루프의 현재 payload를 보관 — 수정 회차마다 갱신됨\nreturn [{ json: $input.first().json }];" }, [300, 0], 2);
n(
  'Explode Photos',
  'code',
  {
    jsCode: [
      "const p = $input.first().json;",
      "const review = new Set(p.needsReview || []);",
      "// empty 는 본문이 실제로 빈 카드다. review(LLM 사용 선언)는 상시 켜지므로 구분해서 표시한다.",
      "const empty = new Set(p.emptyCards || []);",
      "const mark = (i) => (empty.has(i) ? ' 🛑 본문 없음 — 이대로 발행하면 빈 카드가 올라갑니다' : review.has(i) ? ' ⚠️ 검수 필요(LLM 생성)' : '');",
      "const items = p.urls.map((u, i) => ({ json: { photoUrl: u + '?v=' + p.revision, caption: '카드 ' + (i + 1) + '/' + p.urls.length + mark(i + 1) } }));",
      "if (p.storyUrl) items.push({ json: { photoUrl: p.storyUrl + '?v=' + p.revision, caption: '📱 인스타 스토리 (9:16)' } });",
      "return items;",
    ].join('\n'),
  },
  [400, 0],
  2
);
n(
  'Send Cards',
  'telegram',
  { operation: 'sendPhoto', chatId: TG_CHAT_ID, file: '={{ $json.photoUrl }}', binaryData: false, additionalFields: { caption: '={{ $json.caption }}' } },
  [600, 0],
  1.2,
  // 텔레그램이 연속 전송을 순간적으로 거부하면 실행 전체가 날아간다 — 재시도로 넘긴다.
  // 카드 1장 실패가 8장 전부를 버리게 만드는 구조였다.
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a3000001-send-cards-0000-000000000000',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }
);
// 재개 URL을 파일에 기록 → 텔레그램 리스너(WF-7)가 채팅 답장을 이 URL로 전달
n(
  'Arm Chat Reply',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $('Loop State').first().json;",
      "fs.writeFileSync('" + PENDING + "', JSON.stringify({",
      "  resumeUrl: $execution.resumeUrl,",
      "  raceName: p.raceName,",
      "  revision: p.revision,",
      "  armedAt: new Date().toISOString(),",
      "}));",
      "// 편집 페이지가 읽을 초안. 편집 가능한 값(문구)과 미리보기 이미지만 담는다.",
      "// 순위·포인트 같은 자동 산출값은 재렌더 때 원본 payload에서 다시 채워진다.",
      "const CDN = 'https://xrp-admin.p-e.kr/hooni-cards/';",
      "const DAY = { preview: '프리뷰', guide: '관전 가이드', 'practice-results': '연습주행', 'quali-results': '퀄리파잉', 'sprint-fri-results': '스프린트 퀄리파잉', 'sprint-sat-results': '스프린트 & 퀄리파잉', 'race-recap': '총정리' };",
      "const REGEN = { 'issue-blocks': '배경 사진 다시 검색', 'story': '스토리 이미지 다시 생성', 'story-podium': '포디움 이미지 다시 생성', 'cover-recap': '표지 이미지 다시 생성', 'cover-preview': '표지 이미지 다시 생성' };",
      "const LOCK = { 'result-full': '순위·포인트·등락은 공식 데이터에서 자동으로 들어갑니다.', standings: '순위·포인트·등락은 공식 데이터에서 자동으로 들어갑니다.', 'session-result': '순위·랩타임은 공식 데이터에서 자동으로 들어갑니다.', grid: '출발 순서는 퀄리파잉 결과에서 자동으로 들어갑니다.', 'quali-elims': '탈락자 명단은 공식 데이터에서 자동으로 들어갑니다.', 'dotd-card': '캐릭터 그림은 저장된 자산에서 라운드별로 자동 선택됩니다.', stints: '스틴트 데이터는 OpenF1에서 자동으로 들어갑니다.', timetable: '세션 시각은 자동으로 들어갑니다.', lineup: '라인업은 스탠딩에서 자동으로 들어갑니다.' };",
      "const draft = {",
      "  dirName: p.dirName, raceName: p.raceName, dayType: p.dayType,",
      "  dayLabel: DAY[p.dayType] || '', revision: p.revision,",
      "  createdKst: new Date(Date.now() + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' '),",
      "  resumeUrl: $execution.resumeUrl,",
      "  cards: (p.cards || []).map((c, i) => ({",
      "    type: c.type, template: c.template, data: c.data || {},",
      "    image: CDN + p.dirName + '/card-' + (i + 1) + '-' + c.type + '.png?v=' + p.revision,",
      "    regenerable: !!REGEN[c.template], regenLabel: REGEN[c.template] || null, lockedNote: LOCK[c.template] || null,",
      "  })),",
      "  story: p.story ? {",
      "    type: 'story', template: p.story.template || 'story', data: p.story.data || {},",
      "    image: CDN + p.dirName + '/story.png?v=' + p.revision,",
      "    regenerable: true, regenLabel: REGEN[p.story.template] || '스토리 이미지 다시 생성',",
      "  } : null,",
      "};",
      "try { fs.writeFileSync('/data/cards/' + p.dirName + '/draft.json', JSON.stringify(draft)); } catch (e) {}",
      "const editUrl = CDN + 'edit.html?d=' + p.dirName;",
      "return [{ json: { ...p, resumeUrl: $execution.resumeUrl, editUrl } }];",
    ].join('\n'),
  },
  [800, 0],
  2
);
n(
  'Ask In Chat',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text: "=📋 카드 {{ $json.cardCount }}장 확인해주세요 (수정 {{ $json.revision }}회차)\n\n🆔 {{ $json.dirName }}  ·  {{ new Date(Date.now() + 9*3600000).toISOString().slice(5,16).replace('T',' ') }} 생성\n{{ ($json.emptyCards && $json.emptyCards.length) ? '\\n🛑 본문이 빈 카드: ' + $json.emptyCards.join(', ') + '번 — 발행 전 확인하세요.\\n' : '' }}\n• 그대로 발행 / 취소 → 아래 버튼\n• 수정하려면 → 이 채팅에 수정 내용을 그대로 입력\n  예) 1번 제목을 '노리스 폴!'로 바꿔줘\n\n⏳ 24시간 내 응답이 없으면 자동 만료됩니다.",
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        { row: { buttons: [{ text: '✏️ 편집하기', additionalFields: { url: "={{ $('Arm Chat Reply').first().json.editUrl }}" } }] } },
        { row: { buttons: [{ text: '✅ 그대로 발행', additionalFields: { url: "={{ $('Arm Chat Reply').first().json.resumeUrl }}&text=%EB%B0%9C%ED%96%89" } }] } },
        // 취소는 채팅에 '취소'를 입력해야만 가능했다. 발행 버튼과 다른 줄에 둬 오탭을 막는다.
        // %EC%B7%A8%EC%86%8C = '취소' (Route Reply 의 isCancel 정규식이 받는다)
        { row: { buttons: [{ text: '🚫 이번 발행 취소', additionalFields: { url: "={{ $('Arm Chat Reply').first().json.resumeUrl }}&text=%EC%B7%A8%EC%86%8C" } }] } },
      ],
    },
    additionalFields: {},
  },
  [1000, 0],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a3000002-ask-chat-0000-000000000000' }
);
n('Wait For Reply', 'wait', { resume: 'webhook', limitWaitTime: true, resumeAmount: 24, resumeUnit: 'hours', options: { webhookSuffix: '', responseData: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b14;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center"><div><div style="font-size:64px">✅</div><h1 style="font-size:24px;margin:16px 0 8px">접수되었습니다</h1><p style="color:#9a9aa8;font-size:16px;margin:0">텔레그램으로 돌아가세요</p><p style="color:#5a5a68;font-size:13px;margin-top:24px">HOONI.SPEED</p></div></body></html>' } }, [1200, 0], 1.1, { webhookId: 'a3000003-wait-reply-000-000000000000' });
n(
  'Route Reply',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $('Loop State').first().json;",
      "// GET 재개는 query, POST 재개는 body에 담긴다. 빈 객체가 truthy라 순서가 아닌 값으로 판단해야 함",
      "const j = $input.first().json || {};",
      "const text = String((j.query && j.query.text) || (j.body && j.body.text) || j.text || '').trim();",
      "try { fs.unlinkSync('" + PENDING + "'); } catch (e) {}",
      "// 편집 페이지는 JSON을 POST한다 — 텍스트 파싱 이전에 먼저 판별한다",
      "const form = (j.body && j.body.action) ? j.body : null;",
      "if (form) {",
      "  return [{ json: { ...p, form, decision: form.action === 'publish' ? 'form-publish' : 'form-revise' } }];",
      "}",
      "const norm = text.replace(/\\s+/g, '');",
      "const isPublish = /^(발행|승인|ok|OK|네|고고|ㄱㄱ)$/.test(norm);",
      "const isExpired = text === '';",
      "const isCancel = /^(취소|중단|cancel|그만)$/.test(norm);",
      "return [{ json: { ...p, replyText: text, decision: isExpired ? 'expired' : isPublish ? 'publish' : isCancel ? 'cancel' : 'edit' } }];",
    ].join('\n'),
  },
  [1400, 0],
  2
);
n(
  'Switch Decision',
  'switch',
  {
    rules: {
      values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.decision }}', rightValue: 'publish', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: '발행' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.decision }}', rightValue: 'cancel', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: '취소' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.decision }}', rightValue: 'edit', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: '수정' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.decision }}', rightValue: 'expired', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: '만료' },
      ],
    },
    options: {},
  },
  [1600, 0],
  3.2
);
n(
  'Notify Publishing',
  'telegram',
  // 후속 알림에는 반드시 🆔 를 붙인다 — 승인 요청이 여러 건 쌓이면 어느 건에 대한 응답인지 알 수 없다.
  { chatId: TG_CHAT_ID, text: "=✅ 발행 승인됐습니다. 인스타그램에 올리는 중…\n\n🆔 {{ $json.dirName }}  ·  {{ $json.raceName }}", additionalFields: {} },
  [1820, -260],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a3000006-notify-pub-000-000000000000' }
);
n('Result Approved', 'code', { jsCode: "return [{ json: { ...$('Route Reply').first().json, approved: true } }];" }, [2040, -260], 2);
n(
  'Apply Form',
  'code',
  { jsCode: [
    "// 편집 페이지가 보낸 문구를 원본 payload에 덮어쓴다. 자동 산출값(rows/photo/bgFile 등)은 보존한다.",
    "const p = $('Loop State').first().json;",
    "const f = $('Route Reply').first().json.form || {};",
    "const regen = [];",
    "const merge = (orig, edit) => {",
    "  const out = { ...(orig || {}) };",
    "  const d = { ...(orig.data || {}) };",
    "  for (const k in (edit.data || {})) {",
    "    if (k === 'issues' && Array.isArray(edit.data.issues)) {",
    "      d.issues = edit.data.issues.map((x, i) => ({ ...((d.issues || [])[i] || {}), head: x.head, body: x.body }));",
    "    } else if (typeof edit.data[k] !== 'object') {",
    "      d[k] = edit.data[k];",
    "    }",
    "  }",
    "  out.data = d;",
    "  return out;",
    "};",
    "const cards = (p.cards || []).map((c, i) => {",
    "  const e = (f.cards || [])[i];",
    "  if (!e) return c;",
    "  if (e.regen) regen.push(c.type);",
    "  return merge(c, e);",
    "});",
    "let story = p.story || null;",
    "if (story && f.story) { story = merge(story, f.story); if (f.story.regen) regen.push('story'); }",
    "// 자연어 코멘트가 하나라도 있으면 Gemini를 거친다. 없으면 문구 입력만 반영해 무료로 끝낸다.",
    "const notes = [];",
    "if (f.note) notes.push('[전체] ' + f.note);",
    "(f.cards || []).forEach((e, i) => { if (e && e.comment) notes.push('[카드 ' + (i + 1) + ' ' + (e.type || '') + '] ' + e.comment); });",
    "if (f.story && f.story.comment) notes.push('[스토리] ' + f.story.comment);",
    "const revision = (p.revision || 0) + 1;",
    "return [{ json: { ...p, cards, story, regen, revision, dirSuffix: '-rev' + revision, replyText: notes.join('\\n'), hasNotes: notes.length > 0 } }];",
  ].join('\n') },
  [2340, 420],
  2
);
n(
  'IF Form Publish',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: "={{ $('Route Reply').first().json.decision }}", rightValue: 'form-publish', operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  },
  [2560, 420],
  2.2
);
n(
  'Re-render Form',
  'executeWorkflow',
  { workflowId: { __rl: true, value: WF2_ID, mode: 'id', cachedResultName: 'HooniSpeed WF-2 card-renderer' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [2780, 420],
  1.2
);
n('Bump Form', 'code', { jsCode: "// 폼 경로는 Apply Form이 회차를 올렸으므로 그 값을 그대로 이어받는다\nconst p = $input.first().json;\nreturn [{ json: { ...p, revision: $('Apply Form').first().json.revision } }];" }, [3000, 420], 2);
n(
  'IF Has Notes',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: '={{ $json.hasNotes }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [2700, 560],
  2.2
);
n(
  'Cleanup Cards',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $input.first().json;",
      "const base = p.baseDirName || p.dirName;",
      "let removed = 0;",
      "try {",
      "  for (const d of fs.readdirSync('/data/cards')) {",
      "    if (d === base || d.startsWith(base + '-rev')) { fs.rmSync('/data/cards/' + d, { recursive: true, force: true }); removed++; }",
      "  }",
      "} catch (e) {}",
      "return [{ json: { ...p, approved: false, removedDirs: removed } }];",
    ].join('\n'),
  },
  [1820, 0],
  2
);
n(
  'Notify Expired',
  'telegram',
  // 취소(Switch 출력 1)와 만료(출력 3)가 같은 노드로 들어온다 — decision 으로 문구를 구분한다.
  {
    chatId: TG_CHAT_ID,
    text:
      "={{ $json.decision === 'cancel' ? '🚫 요청하신 대로 이번 발행을 취소했습니다.' : '⏳ 승인 없이 24시간이 지나 이번 발행을 취소했습니다.' }}" +
      ' (카드 파일 {{ $json.removedDirs }}개 정리)\n다음 발행은 예정대로 진행됩니다.\n\n🆔 {{ $json.dirName }}  ·  {{ $json.raceName }}',
    additionalFields: {},
  },
  [2040, 0],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a3000005-notify-exp-000-000000000000' }
);
n(
  'IF Max Revisions',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: '={{ $json.revision }}', rightValue: 3, operator: { type: 'number', operation: 'gte' } }],
      combinator: 'and',
    },
    options: {},
  },
  [1820, 180],
  2.2
);
n(
  'Notify Max',
  'telegram',
  { chatId: TG_CHAT_ID, text: "=⛔ 수정 3회를 초과했습니다. 이번 발행은 수동 처리로 전환합니다.\n\n🆔 {{ $json.dirName }}  ·  {{ $json.raceName }}", additionalFields: {} },
  [2040, 320],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a3000004-notify-max-000-000000000000' }
);
n('Result Rejected', 'code', { jsCode: "return [{ json: { ...$input.first().json, approved: false } }];" }, [2260, 320], 2);
n(
  'Gemini Edit Cards',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ contents: [{ parts: [{ text: '다음은 F1 인스타그램 발행분의 정의 JSON이다. cards 키는 피드 캐러셀 카드 배열, story 키는 인스타 스토리(없으면 null)다. 사용자의 수정 지시를 반영해 cards와 story 두 키를 가진 객체 하나만 순수 JSON으로 출력하라. 규칙: (1) cards 배열 길이와 순서 유지 (2) 순위·랩타임·포인트 등 수치 데이터는 절대 변경 금지 (3) 지시가 없는 항목은 그대로 (4) story.data.bgFile 경로는 절대 변경 금지 (5) 마크다운 코드펜스 없이 순수 JSON만.\\n\\n[수정 지시]\\n' + $json.replyText + '\\n\\n[현재 JSON]\\n' + JSON.stringify({ cards: $json.cards, story: $json.story || null }) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 16384 } }) }}",
    options: { timeout: 60000 },
  },
  [2040, 180],
  4.2,
  { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, credentials: { googlePalmApi: GEMINI_CRED } }
);
n(
  'Parse Edited',
  'code',
  {
    jsCode: [
      "// 폼 경로에서는 Apply Form이 이미 문구를 병합해 두었으므로 그 결과를 기준으로 삼는다",
      "let p = $('Route Reply').first().json;",
      "try { const af = $('Apply Form').first().json; if (af && af.hasNotes !== undefined) p = af; } catch (e) {}",
      "let text = $input.first().json.candidates[0].content.parts.map((x) => x.text || '').join('').trim();",
      "text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);",
      "let out;",
      "try { out = JSON.parse(text); } catch (e) { throw new Error('LLM 응답 JSON 파싱 실패: ' + e.message); }",
      "const cards = out.cards;",
      "if (!Array.isArray(cards) || cards.length !== p.cards.length) throw new Error('카드 개수 불일치');",
      "// 스토리는 카피만 수정 허용 — 이미지 경로는 원본 유지 (재생성 비용 방지)",
      "let story = p.story || null;",
      "if (story && out.story && out.story.data) {",
      "  story = { ...story, data: { ...out.story.data, bgFile: story.data.bgFile } };",
      "}",
      "const revision = p.hasNotes !== undefined ? p.revision : (p.revision || 0) + 1;",
      "return [{ json: { ...p, cards, story, revision, dirSuffix: '-rev' + revision } }];",
    ].join('\n'),
  },
  [2260, 180],
  2
);
n(
  'Re-render (WF-2)',
  'executeWorkflow',
  { workflowId: { __rl: true, value: WF2_ID, mode: 'id', cachedResultName: 'HooniSpeed WF-2 card-renderer' }, workflowInputs: { mappingMode: 'passthrough' }, options: {} },
  [2480, 180],
  1.2
);
n('Bump Loop', 'code', { jsCode: "const p = $input.first().json;\nreturn [{ json: { ...p, revision: $('Parse Edited').first().json.revision } }];" }, [2700, 180], 2);

c('When Executed by Another Workflow', 'Init Loop');
c('Init Loop', 'Loop State');
c('Loop State', 'Explode Photos');
c('Explode Photos', 'Send Cards');
c('Send Cards', 'Arm Chat Reply');
c('Arm Chat Reply', 'Ask In Chat');
c('Ask In Chat', 'Wait For Reply');
c('Wait For Reply', 'Route Reply');
n(
  'IF From Form',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ leftValue: '={{ $json.form }}', rightValue: '', operator: { type: 'object', operation: 'exists', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [1620, 120],
  2.2
);
c('Route Reply', 'IF From Form');
c('IF From Form', 'Apply Form', 0);
c('IF From Form', 'Switch Decision', 1);
c('Apply Form', 'IF Form Publish');
c('IF Form Publish', 'Notify Publishing', 0);
c('IF Form Publish', 'IF Has Notes', 1);
c('IF Has Notes', 'Gemini Edit Cards', 0);
c('IF Has Notes', 'Re-render Form', 1);
c('Re-render Form', 'Bump Form');
c('Bump Form', 'Loop State');
c('Switch Decision', 'Notify Publishing', 0);
c('Notify Publishing', 'Result Approved');
c('Switch Decision', 'Cleanup Cards', 1);
c('Switch Decision', 'Cleanup Cards', 3);
c('Cleanup Cards', 'Notify Expired');
c('Switch Decision', 'IF Max Revisions', 2);
c('IF Max Revisions', 'Notify Max', 0);
c('Notify Max', 'Result Rejected');
c('IF Max Revisions', 'Gemini Edit Cards', 1);
c('Gemini Edit Cards', 'Parse Edited');
c('Parse Edited', 'Re-render (WF-2)');
c('Re-render (WF-2)', 'Bump Loop');
c('Bump Loop', 'Loop State');

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWF3Appr0001', name: 'HooniSpeed WF-3 approval-loop', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', errorWorkflow: 'HooniWFErr00001' }, active: true },
    null,
    2
  ) + '\n'
);

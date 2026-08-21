// WF-7 telegram-listener: node build-wf7.js > wf7-telegram-listener.json
// 외부 입력(텔레그램 채팅 / 편집 페이지 폼)을 받아 대기 중인 WF-3 실행을 재개시키는 다리.
//
// 왜 다리가 필요한가: WF-3 의 대기 웹훅은 GET 만 받는다. 텔레그램 인라인 버튼이 GET 밖에
// 못 보내기 때문에 그쪽을 POST 로 바꿀 수 없다. 반면 편집 페이지는 카드 전체 데이터를
// 보내야 해서 URL 쿼리에 담을 수 없다. 그래서 폼은 여기로 POST 하고, 여기서 파일로
// 저장한 뒤 GET 으로 재개시킨다.
const { TG_CHAT_ID, TG_CRED, FORM_PATH } = require('./config');
const PENDING = '/data/hooni_speed/pending-approval.json';

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'a7' + String(uid).padStart(6, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to, outIdx) {
  connections[from] = connections[from] || { main: [] };
  const main = connections[from].main;
  const idx = outIdx || 0;
  while (main.length <= idx) main.push([]);
  main[idx].push({ node: to, type: 'main', index: 0 });
}

n('Telegram Trigger', 'telegramTrigger', { updates: ['message'], additionalFields: {} }, [0, 0], 1.2, {
  credentials: { telegramApi: TG_CRED },
  webhookId: 'a7000001-tg-trigger-000-000000000000',
});
n(
  'Load Pending',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const msg = $input.first().json.message || {};",
      "const text = String(msg.text || '').trim();",
      "const chatId = String((msg.chat || {}).id || '');",
      "if (chatId !== '" + TG_CHAT_ID + "') return [];  // 다른 대화방 무시",
      "if (!text) return [];",
      "let pending = null;",
      "try { pending = JSON.parse(fs.readFileSync('" + PENDING + "', 'utf8')); } catch (e) { pending = null; }",
      "return [{ json: { text, hasPending: !!(pending && pending.resumeUrl), resumeUrl: pending ? pending.resumeUrl : null, raceName: pending ? pending.raceName : null } }];",
    ].join('\n'),
  },
  [220, 0],
  2
);
n(
  'IF Pending',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: '={{ $json.hasPending }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [440, 0],
  2.2
);
n(
  'Ack Received',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text: "=✏️ 수정 요청을 접수했습니다.\n\n« {{ $json.text }} »\n\n카드를 다시 만드는 중입니다 (약 2~3분 소요)",
    additionalFields: {},
  },
  [660, -200],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a7000003-ack-recv-0000-000000000000' }
);
n(
  'Resume Workflow',
  'httpRequest',
  {
    method: 'GET',
    // Ack 노드가 중간에 있어 $json이 텔레그램 응답으로 바뀌므로 원본 노드를 직접 참조
    url: "={{ $('Load Pending').first().json.resumeUrl }}&text={{ encodeURIComponent($('Load Pending').first().json.text) }}",
    options: { timeout: 20000 },
  },
  [660, -80],
  4.2,
  { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 }
);
n(
  'Notify No Pending',
  'telegram',
  { chatId: TG_CHAT_ID, text: '지금은 대기 중인 승인 요청이 없습니다.', additionalFields: {} },
  [660, 100],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'a7000002-no-pending-000-000000000000' }
);

// ---------- 편집 페이지 폼 경로 ----------
// 페이로드가 커서(카드 전체 data) URL 에 실을 수 없다. 파일로 넘긴 뒤 GET 으로 재개한다.
n(
  'Form Webhook',
  'webhook',
  { httpMethod: 'POST', path: FORM_PATH, responseMode: 'lastNode', options: {} },
  [0, 320],
  2,
  { webhookId: 'a7000004-form-hook-00-000000000000' }
);
n(
  'Save Form',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      'const body = $input.first().json.body || {};',
      "if (!body.action || !body.dirName) throw new Error('폼 본문에 action/dirName 이 없다');",
      "let pending = null;",
      "try { pending = JSON.parse(fs.readFileSync('" + PENDING + "', 'utf8')); } catch (e) { pending = null; }",
      "if (!pending || !pending.resumeUrl) throw new Error('대기 중인 승인 요청이 없다');",
      '// Route Reply 가 이 파일을 읽는다. 폴더명은 폼이 보낸 값을 그대로 쓴다.',
      "fs.writeFileSync('/data/cards/' + body.dirName + '/form.json', JSON.stringify(body));",
      'return [{ json: { ok: true, action: body.action, dirName: body.dirName, resumeUrl: pending.resumeUrl } }];',
    ].join('\n'),
  },
  [220, 320],
  2
);
n(
  'Resume From Form',
  'httpRequest',
  {
    method: 'GET',
    url: "={{ $json.resumeUrl }}&text=form",
    options: { timeout: 20000 },
  },
  [440, 320],
  4.2,
  { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 }
);
n(
  'Form Accepted',
  'code',
  { jsCode: "// 편집 페이지가 이 응답의 상태코드로 성공을 판단한다\nreturn [{ json: { ok: true } }];" },
  [660, 320],
  2
);

c('Telegram Trigger', 'Load Pending');
c('Load Pending', 'IF Pending');
c('IF Pending', 'Ack Received', 0);
c('Ack Received', 'Resume Workflow');
c('IF Pending', 'Notify No Pending', 1);
c('Form Webhook', 'Save Form');
c('Save Form', 'Resume From Form');
c('Resume From Form', 'Form Accepted');

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWF7TgList001', name: 'HooniSpeed WF-7 telegram-listener', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul' }, active: true },
    null,
    2
  ) + '\n'
);

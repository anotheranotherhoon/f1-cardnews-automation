// WF-7 telegram-listener: node build-wf7.js > wf7-telegram-listener.json
// 텔레그램 채팅 답장을 받아 대기 중인 WF-3 실행을 재개시킨다.
// (링크를 열지 않고 채팅에 바로 입력할 수 있게 하는 다리 역할)
const { TG_CHAT_ID, TG_CRED } = require('./config');
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

c('Telegram Trigger', 'Load Pending');
c('Load Pending', 'IF Pending');
c('IF Pending', 'Ack Received', 0);
c('Ack Received', 'Resume Workflow');
c('IF Pending', 'Notify No Pending', 1);

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWF7TgList001', name: 'HooniSpeed WF-7 telegram-listener', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul' }, active: true },
    null,
    2
  ) + '\n'
);

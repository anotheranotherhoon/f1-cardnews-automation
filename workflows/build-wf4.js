// WF-4 publisher 생성기: node build-wf4.js > wf4-publisher.json
// 입력(Execute Workflow): {urls: [...], caption, dirName}
// 기존 carousel_feed.json의 발행 구간 이관 — 토큰은 httpQueryAuth 자격증명(config.js 의 IG_CRED) 참조
const { IG_USER_ID, TG_CHAT_ID, TG_CRED, IG_CRED } = require('./config');

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'f' + String(uid).padStart(7, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to, outIdx) {
  connections[from] = connections[from] || { main: [] };
  const main = connections[from].main;
  const idx = outIdx || 0;
  while (main.length <= idx) main.push([]);
  main[idx].push({ node: to, type: 'main', index: 0 });
}
const igAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

n('When Executed by Another Workflow', 'executeWorkflowTrigger', {}, [0, 0]);
n('Split URLs', 'splitOut', { fieldToSplitOut: 'urls', options: {} }, [220, 0]);
n(
  'Create Item Container',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://graph.instagram.com/v24.0/' + IG_USER_ID + '/media',
    ...igAuth,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ image_url: $json.urls, is_carousel_item: true }) }}',
    options: { timeout: 60000 },
  },
  [440, 0],
  4.2,
  { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, credentials: { httpQueryAuth: IG_CRED } }
);
n(
  'Collect Children',
  'code',
  { jsCode: "const input = $('When Executed by Another Workflow').first().json;\nconst ids = $input.all().map((i) => i.json.id);\nif (!ids.length || ids.some((x) => !x)) throw new Error('아이템 컨테이너 생성 실패');\nreturn [{ json: { children: ids.join(','), caption: input.caption || '#후니스피드 #F1', dirName: input.dirName, baseDirName: input.baseDirName || input.dirName } }];" },
  [660, 0],
  2
);
n('Wait Items', 'wait', { amount: 15 }, [880, 0], 1.1, { webhookId: 'f1000001-wait-items-0000-000000000000' });
n(
  'Create Carousel',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://graph.instagram.com/v24.0/' + IG_USER_ID + '/media',
    ...igAuth,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ media_type: 'CAROUSEL', children: $json.children, caption: $json.caption }) }}",
    options: { timeout: 60000 },
  },
  [1100, 0],
  4.2,
  { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, credentials: { httpQueryAuth: IG_CRED } }
);
n('Wait Carousel', 'wait', { amount: 20 }, [1320, 0], 1.1, { webhookId: 'f1000002-wait-carousel-00-000000000000' });
n(
  'Publish',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://graph.instagram.com/v24.0/' + IG_USER_ID + '/media_publish',
    ...igAuth,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ creation_id: $json.id }) }}',
    options: { timeout: 60000 },
  },
  [1540, 0],
  4.2,
  { retryOnFail: true, maxTries: 3, waitBetweenTries: 10000, credentials: { httpQueryAuth: IG_CRED }, onError: 'continueErrorOutput' }
);
n(
  'IF Has Story',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ leftValue: "={{ $('When Executed by Another Workflow').first().json.storyUrl }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [1760, -260],
  2.2
);
n(
  'Create Story Container',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://graph.instagram.com/v24.0/' + IG_USER_ID + '/media',
    ...igAuth,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ media_type: 'STORIES', image_url: $('When Executed by Another Workflow').first().json.storyUrl }) }}",
    options: { timeout: 60000 },
  },
  [1980, -340],
  4.2,
  { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, credentials: { httpQueryAuth: IG_CRED } }
);
n('Wait Story', 'wait', { amount: 15 }, [2200, -340], 1.1, { webhookId: 'f1000005-wait-story-00-000000000000' });
n(
  'Publish Story',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://graph.instagram.com/v24.0/' + IG_USER_ID + '/media_publish',
    ...igAuth,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ creation_id: $json.id }) }}',
    options: { timeout: 60000 },
  },
  [2420, -340],
  4.2,
  { retryOnFail: true, maxTries: 2, waitBetweenTries: 10000, credentials: { httpQueryAuth: IG_CRED }, onError: 'continueRegularOutput' }
);
n(
  'Cleanup Cards',
  'code',
  { jsCode: "const fs = require('fs');\nconst base = $('Collect Children').first().json.baseDirName;\nif (base) {\n  for (const d of fs.readdirSync('/data/cards')) {\n    if (d === base || d.startsWith(base + '-rev')) fs.rmSync('/data/cards/' + d, { recursive: true, force: true });\n  }\n}\nreturn $input.all();" },
  [1760, -100],
  2
);
n(
  'Notify Success',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text: "=✅ 인스타그램 발행 완료!\n피드 게시물: {{ $('Publish').first().json.id }}\n스토리: {{ $('When Executed by Another Workflow').first().json.storyUrl ? '발행됨' : '없음' }}\n카드 파일은 정리했습니다.",
    additionalFields: {},
  },
  [1980, -100],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'f1000003-notify-succ-0000-000000000000' }
);
n(
  'Notify Failure',
  'telegram',
  {
    chatId: TG_CHAT_ID,
    text: "=❌ 인스타그램 발행 실패\n오류: {{ $json.error ? ($json.error.message || JSON.stringify($json.error)) : '알 수 없음' }}\n카드 파일은 보존했습니다 — n8n에서 수동 재시도 가능합니다.",
    additionalFields: {},
  },
  [1760, 140],
  1.2,
  { credentials: { telegramApi: TG_CRED }, webhookId: 'f1000004-notify-fail-0000-000000000000' }
);

c('When Executed by Another Workflow', 'Split URLs');
c('Split URLs', 'Create Item Container');
c('Create Item Container', 'Collect Children');
c('Collect Children', 'Wait Items');
c('Wait Items', 'Create Carousel');
c('Create Carousel', 'Wait Carousel');
c('Wait Carousel', 'Publish');
c('Publish', 'IF Has Story', 0);
c('IF Has Story', 'Create Story Container', 0);
c('IF Has Story', 'Cleanup Cards', 1);
c('Create Story Container', 'Wait Story');
c('Wait Story', 'Publish Story');
c('Publish Story', 'Cleanup Cards');
c('Publish', 'Notify Failure', 1);
c('Cleanup Cards', 'Notify Success');

process.stdout.write(
  JSON.stringify(
    {
      id: 'HooniWF4Publ0001',
      name: 'HooniSpeed WF-4 publisher',
      nodes,
      connections,
      settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', errorWorkflow: 'HooniWFErr00001' },
      active: false,
    },
    null,
    2
  ) + '\n'
);

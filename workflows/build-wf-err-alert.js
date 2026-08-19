// WF-ERR alert 생성기: node build-wf-err-alert.js > wf-err-alert.json
// 다른 워크플로가 실패하면 Error Trigger가 받아 텔레그램으로 알린다.
const { TG_CHAT_ID, TG_CRED } = require('./config');

const nodes = [
  {
    parameters: {},
    type: 'n8n-nodes-base.errorTrigger',
    typeVersion: 1,
    position: [0, 0],
    id: 'c0000001-0000-4000-8000-000000000001',
    name: 'Error Trigger',
  },
  {
    parameters: {
      chatId: TG_CHAT_ID,
      text:
        '=⚠️ 후니스피드 워크플로우 오류\n\n' +
        '워크플로우: {{ $json.workflow.name }}\n' +
        "노드: {{ $json.execution && $json.execution.lastNodeExecuted ? $json.execution.lastNodeExecuted : '?' }}\n" +
        "오류: {{ $json.execution && $json.execution.error ? $json.execution.error.message : '?' }}\n\n" +
        '데이터 미반영이면 잠시 후 n8n에서 수동 재실행 해주세요.',
      additionalFields: {},
    },
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: [220, 0],
    id: 'c0000002-0000-4000-8000-000000000002',
    name: 'Telegram Alert',
    credentials: { telegramApi: TG_CRED },
  },
];

const connections = {
  'Error Trigger': { main: [[{ node: 'Telegram Alert', type: 'main', index: 0 }]] },
};

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWFErr00001', name: 'HooniSpeed WF-ERR alert', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul' }, active: false },
    null,
    2
  ) + '\n'
);

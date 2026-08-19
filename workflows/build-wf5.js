// WF-5 asset-gen 생성기: node build-wf5.js > wf5-asset-gen.json
// POST /webhook/<ASSET_GEN_PATH> {prompt, outPath, refImageB64?} → Gemini 이미지 생성(레퍼런스 선택) → /data/hooni_speed/<outPath> 저장
const { GEMINI_CRED, ASSET_GEN_PATH } = require('./config');

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'a5' + String(uid).padStart(6, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to) {
  connections[from] = { main: [[{ node: to, type: 'main', index: 0 }]] };
}

n('Webhook', 'webhook', { httpMethod: 'POST', path: ASSET_GEN_PATH, responseMode: 'lastNode', options: {} }, [0, 0], 2, { webhookId: 'a5000001-webhook-000-0000-000000000000' });
n(
  'Gen Image',
  'httpRequest',
  {
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ contents: [{ parts: ($json.body.refImageB64 ? [{ inlineData: { mimeType: 'image/png', data: $json.body.refImageB64 } }] : []).concat([{ text: $json.body.prompt }]) }], generationConfig: { responseModalities: ['IMAGE'] } }) }}",
    options: { timeout: 120000 },
  },
  [220, 0],
  4.2,
  { retryOnFail: true, maxTries: 2, waitBetweenTries: 10000, credentials: { googlePalmApi: GEMINI_CRED } }
);
n(
  'Save Image',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const path = require('path');",
      "const req = $('Webhook').first().json.body;",
      "const outPath = String(req.outPath || '');",
      "if (!outPath || outPath.includes('..')) throw new Error('outPath 불량: ' + outPath);",
      "const resp = $input.first().json;",
      "const parts = (((resp.candidates || [])[0] || {}).content || {}).parts || [];",
      "const img = parts.find((p) => p.inlineData || p.inline_data);",
      "if (!img) throw new Error('이미지 응답 없음: ' + JSON.stringify(resp).slice(0, 300));",
      "const d = img.inlineData || img.inline_data;",
      "const buf = Buffer.from(d.data, 'base64');",
      "const full = '/data/hooni_speed/' + outPath;",
      "fs.mkdirSync(path.dirname(full), { recursive: true });",
      "fs.writeFileSync(full, buf);",
      "return [{ json: { saved: outPath, bytes: buf.length, mime: d.mimeType || d.mime_type } }];",
    ].join('\n'),
  },
  [440, 0],
  2
);
c('Webhook', 'Gen Image');
c('Gen Image', 'Save Image');

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWF5Asset001', name: 'HooniSpeed WF-5 asset-gen', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul' }, active: true },
    null,
    2
  ) + '\n'
);

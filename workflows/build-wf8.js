// WF-8 ig-token-refresh 생성기: node build-wf8.js > wf8-ig-token-refresh.json
//
// 인스타그램 장기 토큰은 60일이면 죽고, 만료 전에만 갱신 API로 연장할 수 있다. 갱신할 때마다
// 새 문자열이 나오는데 n8n 은 워크플로 안에서 자기 Credentials 값을 바꾸지 못한다. 그래서
// 토큰을 /data/hooni_speed/ig-token.json 에 두고 매일 갱신해 덮어쓴다. WF-4 는 이 파일을 읽는다.
// 2026-08-30 토큰이 조용히 만료돼 발행이 실패한 뒤 만들었다.
//
// 실패는 throw 로 끝낸다 → errorWorkflow(WF-ERR) 가 텔레그램으로 알린다. 60일 여유가 있으니
// 며칠 실패해도 손으로 고칠 시간은 충분하다. 수동 실행용 웹훅은 키를 확인한다.
const { TOKEN_REFRESH_PATH, REPUBLISH_KEY } = require('./config');

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'e' + String(uid).padStart(7, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to) {
  connections[from] = connections[from] || { main: [[]] };
  connections[from].main[0].push({ node: to, type: 'main', index: 0 });
}

n('Daily 08:30 KST', 'scheduleTrigger', { rule: { interval: [{ field: 'cronExpression', expression: '30 8 * * *' }] } }, [0, 0], 1.2);
n(
  'Manual Webhook',
  'webhook',
  { httpMethod: 'GET', path: TOKEN_REFRESH_PATH, responseMode: 'lastNode', options: {} },
  [0, 200],
  2,
  { webhookId: 'e9000001-tokenrefresh-0000-000000000000' }
);
n(
  'Refresh IG Token',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const FILE = '/data/hooni_speed/ig-token.json';",
      'const inp = $input.first().json;',
      '// 웹훅으로 들어온 호출만 키를 검사한다 (스케줄 아이템에는 query 가 없다)',
      "if (inp.query !== undefined && inp.query.k !== '" + REPUBLISH_KEY + "') throw new Error('토큰 갱신 웹훅: 키 불일치');",
      "const cur = JSON.parse(fs.readFileSync(FILE, 'utf8'));",
      'const daysLeft = Math.round((new Date(cur.expiresAt) - Date.now()) / 86400000);',
      'let res;',
      'try {',
      "  res = await this.helpers.httpRequest({ method: 'GET', url: 'https://graph.instagram.com/v24.0/refresh_access_token', qs: { grant_type: 'ig_refresh_token', access_token: cur.token }, json: true });",
      '} catch (e) {',
      "  throw new Error('인스타그램 토큰 갱신 실패 (현재 토큰 만료까지 ' + daysLeft + '일): ' + (e.message || e));",
      '}',
      "if (!res || !res.access_token) throw new Error('갱신 응답에 access_token 없음: ' + JSON.stringify(res).slice(0, 200));",
      'const next = { token: res.access_token, expiresAt: new Date(Date.now() + res.expires_in * 1000).toISOString(), refreshedAt: new Date().toISOString(), source: "auto-refresh" };',
      'fs.writeFileSync(FILE, JSON.stringify(next));',
      '// 응답에 토큰은 싣지 않는다 — 웹훅 응답이 그대로 브라우저에 찍힌다',
      'return [{ json: { ok: true, expiresAt: next.expiresAt, permissions: res.permissions || null } }];',
    ].join('\n'),
  },
  [260, 100],
  2
);
c('Daily 08:30 KST', 'Refresh IG Token');
c('Manual Webhook', 'Refresh IG Token');

process.stdout.write(
  JSON.stringify(
    {
      id: 'HooniWF8IgTok0001',
      name: 'HooniSpeed WF-8 ig-token-refresh',
      nodes,
      connections,
      settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', errorWorkflow: 'HooniWFErr00001' },
      active: true,
    },
    null,
    2
  ) + '\n'
);

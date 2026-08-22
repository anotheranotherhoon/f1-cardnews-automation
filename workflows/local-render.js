// 로컬 카드 렌더링: WF-2의 'Prepare Cards' jsCode를 그대로 추출해 실행 → 로컬 Chrome으로 스크린샷
// 사용법: node local-render.js <payload.json> [출력디렉토리]
// 서버(browserless) 없이 템플릿을 검증할 수 있고, 프로덕션과 동일한 코드 경로를 쓴다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const payloadPath = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, '../.render-out');
if (!payloadPath) {
  console.error('사용법: node local-render.js <payload.json> [출력디렉토리]');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'wf2-card-renderer.json'), 'utf8'));
const prepareCode = wf.nodes.find((n) => n.name === 'Prepare Cards').parameters.jsCode;

// n8n Code 노드 환경 심 ($input, $execution, require)
const $input = { first: () => ({ json: payload }), all: () => [{ json: payload }] };
// 폴더명의 실행 식별자로 쓰인다. 로컬에서는 고정값이면 충분하다.
const $execution = { id: 'local' };
const shimRequire = (m) => {
  if (m === 'fs') {
    // 서버의 자산 경로(/data/hooni_speed/...)를 로컬 assets/로 매핑
    const remap = (p) => String(p).replace('/data/hooni_speed/assets/', path.join(__dirname, '../assets/') + '').replace('/data/hooni_speed/', path.join(__dirname, '../') + '');
    return { readdirSync: (p) => fs.readdirSync(remap(p)), readFileSync: (p, e) => fs.readFileSync(remap(p), e), mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync };
  }
  if (m === 'path') return path;
  throw new Error('허용되지 않은 모듈: ' + m);
};

// Prepare Cards 는 생성 이미지를 기다리느라 await 를 쓴다 — 동기 Function 으로는 실행되지 않는다
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

(async () => {
  const items = await new AsyncFunction('$input', '$execution', 'require', prepareCode)($input, $execution, shimRequire);
  console.log(`카드 ${items.length}장 준비 완료`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const { json: card } of items) {
    const htmlPath = path.join(outDir, card.fileName.replace(/\.png$/, '.html'));
    const pngPath = path.join(outDir, card.fileName);
    fs.writeFileSync(htmlPath, card.html);
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=' + (card.viewport ? card.viewport.width + ',' + card.viewport.height : '1080,1350'),
      '--screenshot=' + pngPath,
      'file://' + htmlPath,
    ], { stdio: 'ignore', timeout: 60000 });
    const kb = Math.round(fs.statSync(pngPath).size / 1024);
    console.log(`✓ ${card.fileName} (${kb}KB)`);
  }
  console.log('\n출력:', outDir);
})().catch((e) => {
  console.error('렌더 실패:', e.message);
  process.exit(1);
});

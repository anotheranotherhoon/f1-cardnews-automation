// WF-6 meme-story 생성기: node build-wf6.js > wf6-meme-story.json
// 입력(WF-1이 목/월에만 호출): {cards, season, round, raceName, dayType, ...}
// 처리: 밈 컨셉 LLM → 캐릭터 자산 확보 → 9:16 i2i 스토리 이미지 생성 → 파일 저장
// 출력: 입력 + story:{template,data:{title,subtitle,cta,bgFile}}  (피드 카드는 그대로 통과)
// 실패해도 발행은 계속된다 (스토리만 생략).
const { GEMINI_CRED } = require('./config');
const STYLE_GUIDE =
  'Consistent art style: chibi caricature, big head on small body, bold clean black outlines, ' +
  'flat cel shading, vivid saturated colors, stylized cartoon (not photorealistic). ' +
  'No sponsor logos, no brand marks, no text, no lettering, no watermark';

const nodes = [];
const connections = {};
let uid = 0;
function n(name, type, parameters, pos, typeVersion, extra) {
  uid += 1;
  nodes.push({ parameters, type: 'n8n-nodes-base.' + type, typeVersion: typeVersion || 1, position: pos, id: 'a6' + String(uid).padStart(6, '0') + '-0000-4000-8000-000000000000', name, ...(extra || {}) });
  return name;
}
function c(from, to, outIdx) {
  connections[from] = connections[from] || { main: [] };
  const main = connections[from].main;
  const idx = outIdx || 0;
  while (main.length <= idx) main.push([]);
  main[idx].push({ node: to, type: 'main', index: 0 });
}
function gemini(name, model, jsonBody, pos) {
  return n(
    name,
    'httpRequest',
    {
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googlePalmApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody,
      options: { timeout: 120000 },
    },
    pos,
    4.2,
    { retryOnFail: true, maxTries: 2, waitBetweenTries: 15000, credentials: { googlePalmApi: GEMINI_CRED }, onError: 'continueRegularOutput' }
  );
}

n('When Executed by Another Workflow', 'executeWorkflowTrigger', {}, [0, 0]);

// 1) 밈 컨셉: 한국어 카피 + 주인공 드라이버 + 영어 이미지 프롬프트
gemini(
  'Meme Concept',
  'gemini-3.6-flash',
  "={{ JSON.stringify({ contents: [{ parts: [{ text: 'F1 인스타그램 스토리(9:16)를 만든다. 아래 데이터를 보고 순수 JSON만 출력 (코드펜스 금지):\\n{\"title\": \"한국어 후킹 문구 (14자 이내, 밈/드립 허용, 과장은 OK지만 허위사실 금지)\", \"subtitle\": \"한국어 부제 (22자 이내)\", \"driverCode\": \"주인공 드라이버 3글자 코드 (예: VER, NOR, LEC, HAM, RUS, ANT, PIA, ALO). 특정 인물이 주인공이 아니면 null\", \"imagePrompt\": \"영어 이미지 프롬프트: 카툰 F1 장면. 인물은 그 드라이버의 팀 컬러 레이싱슈트. 세로 9:16 구도. 인물과 핵심 요소는 상단 55% 안에 배치하고, 하단부는 같은 장면이 자연스럽게 이어지도록(트랙 노면, 흐릿한 배경) 그릴 것. 어두운 띠나 단색 블록, 뚜렷한 수평 경계선은 절대 넣지 말 것(자막은 나중에 덮어씀). 텍스트와 로고 없이.\"}\\n\\n[유형] ' + ($json.dayType === 'preview' ? '주말 프리뷰 — 기대감' : '레이스 총정리 — 결과 화제') + '\\n[대회] ' + $json.season + ' ' + $json.raceName + '\\n[카드 데이터] ' + JSON.stringify(($json.cards || []).map(function(c) { return { type: c.type, data: c.data }; })).slice(0, 2500) }] }], generationConfig: { temperature: 0.9 } }) }}",
  [220, 0]
);
n(
  'Parse Concept',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $('When Executed by Another Workflow').first().json;",
      "let concept = null;",
      "try {",
      "  const parts = $input.first().json.candidates[0].content.parts || [];",
      "  const text = parts.map((x) => x.text || '').join('').trim();",
      "  concept = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));",
      "} catch (e) { concept = null; }",
      "// 컨셉 실패 시 스토리 없이 진행 (피드는 정상 발행)",
      "if (!concept || !concept.imagePrompt) return [{ json: { ...p, skipStory: true } }];",
      "const charPath = (c) => {",
      "  for (const dir of ['characters-v2', 'characters']) {",
      "    for (const f of ['base.png', '_pending.png']) {",
      "      const fp = '/data/hooni_speed/assets/' + dir + '/' + c + '/' + f;",
      "      try { if (fs.statSync(fp).size > 0) return fp; } catch (e) {}",
      "    }",
      "  }",
      "  return null;",
      "};",
      "const code = String(concept.driverCode || '').toLowerCase().replace(/[^a-z]/g, '');",
      "// 총정리는 포디움 3명을 함께 그린다 (레이스 결과 카드의 상위 3명)",
      "let podium = [];",
      "if (p.dayType === 'race-recap') {",
      "  const rc = (p.cards || []).find((c) => c.type === 'race-result');",
      "  podium = ((rc && rc.data && rc.data.rows) || []).slice(0, 3).map((r) => ({",
      "    pos: r.pos, name: r.name, team: r.team,",
      "    code: String(r.code || '').toLowerCase().replace(/[^a-z]/g, ''),",
      "    gap: r.metric || '',",
      "  }));",
      "}",
      "const refPaths = podium.length === 3 ? podium.map((r) => charPath(r.code)).filter(Boolean) : [];",
      "const refPath = code ? charPath(code) : null;",
      "return [{ json: { ...p, concept, driverCode: code || null, refPath, refPaths, podium, skipStory: false } }];",
    ].join('\n'),
  },
  [440, 0],
  2
);
n(
  'IF Story',
  'if',
  {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: '={{ $json.skipStory }}', rightValue: true, operator: { type: 'boolean', operation: 'false', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
  [660, 0],
  2.2
);
// 2) 9:16 스토리 이미지 생성 (캐릭터가 있으면 i2i로 동일 인물 유지)
n(
  'Build Image Req',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $input.first().json;",
      "const parts = [];",
      "const usePodium = (p.refPaths || []).length === 3;",
      "const srcs = usePodium ? p.refPaths : (p.refPath ? [p.refPath] : []);",
      "for (const f of srcs) {",
      "  try { parts.push({ inlineData: { mimeType: 'image/png', data: fs.readFileSync(f).toString('base64') } }); } catch (e) {}",
      "}",
      "let text;",
      "if (usePodium) {",
      "  const names = p.podium.map((r, i) => 'reference image ' + (i + 1) + ' = P' + r.pos + ' ' + r.code.toUpperCase()).join(', ');",
      "  text = 'Draw a Formula 1 PODIUM CELEBRATION with all THREE drivers together (' + names + '), ' +",
      "    'keeping each one\\'s exact face, hair, skin tone, suit colours and art style from their reference image. ' +",
      "    'COMPOSITION: the P1 winner stands on the tallest centre step, drawn LARGEST and slightly forward with the ' +",
      "    'brightest light on him — he is clearly the main subject. P2 stands on the lower step to his left and P3 on ' +",
      "    'the lower step to his right, both noticeably smaller and a little behind. All three spray champagne and cheer. ' +",
      "    'CHAMPAGNE COLOUR (important): the liquid and spray are PALE GOLDEN AMBER, translucent and sparkling like real ' +",
      "    'champagne. Do NOT make it ivory, cream, milky white or opaque — no white paint-like streaks. ' +",
      "    'Bottles are dark green glass. Confetti and a blurred cheering crowd behind. ' +",
      "    'No numbers, no text, no letters, no logos anywhere in the image. ' +",
      "    'Vertical 9:16 framing: keep all three figures and the podium steps inside the TOP 60 percent of the frame. ' +",
      "    'The lower portion continues the same scene naturally (podium base, blurred crowd) with NO dark band, ' +",
      "    'NO solid colour block and NO hard horizontal edge — a caption overlay is applied later.';",
      "} else {",
      "  const ref = p.refPath ? ' The reference image defines the character: keep the exact same face, hair and art style.' : '';",
      "  text = p.concept.imagePrompt + ref;",
      "}",
      "parts.push({ text: text + ' " + STYLE_GUIDE + "' });",
      "return [{ json: { ...p, geminiBody: { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } } } } }];",
    ].join('\n'),
  },
  [880, -80],
  2
);
gemini('Gen Story Image', 'gemini-2.5-flash-image', '={{ JSON.stringify($json.geminiBody) }}', [1100, -80]);
n(
  'Save Story',
  'code',
  {
    jsCode: [
      "const fs = require('fs');",
      "const p = $('Build Image Req').first().json;",
      "const out = { ...p };",
      "delete out.geminiBody;",
      "const parts = ((($input.first().json.candidates || [])[0] || {}).content || {}).parts || [];",
      "const img = parts.find((x) => x.inlineData || x.inline_data);",
      "let bgFile = null; // HTTP URL (렌더러가 직접 로드)",
      "if (img) {",
      "  const d = img.inlineData || img.inline_data;",
      "  // 공개 경로에 저장해 렌더러가 HTTP로 불러가게 한다 (base64 임베드는 1080x1920에서 타임아웃)",
      "  const dir = '/data/cards/meme';",
      "  fs.mkdirSync(dir, { recursive: true });",
      "  const name = p.season + '-r' + p.round + '-' + p.dayType + '.png';",
      "  fs.writeFileSync(dir + '/' + name, Buffer.from(d.data, 'base64'));",
      "  bgFile = 'https://xrp-admin.p-e.kr/hooni-cards/meme/' + name;",
      "}",
      "// 이미지가 없어도 카피는 살려 스토리를 만든다 (서킷 배경으로 대체)",
      "const usePodium = (p.podium || []).length === 3 && (p.refPaths || []).length === 3;",
      "out.story = {",
      "  template: usePodium ? 'story-podium' : 'story',",
      "  podiumRows: usePodium ? p.podium : undefined,",
      "  needsLlm: ['memeConcept'],",
      "  data: {",
      "    title: p.concept.title || p.raceName,",
      "    subtitle: p.concept.subtitle || '',",
      "    cta: p.dayType === 'preview' ? '주말 일정은 피드에서 👉' : '전체 결과는 피드에서 👉',",
      "    bgFile,",
      "    podium: usePodium ? p.podium : undefined,",
      "  },",
      "};",
      "return [{ json: out }];",
    ].join('\n'),
  },
  [1320, -80],
  2
);
n('Skip Story', 'code', { jsCode: "const p = { ...$input.first().json };\ndelete p.skipStory;\nreturn [{ json: p }];" }, [880, 120], 2);

c('When Executed by Another Workflow', 'Meme Concept');
c('Meme Concept', 'Parse Concept');
c('Parse Concept', 'IF Story');
c('IF Story', 'Build Image Req', 0);
c('IF Story', 'Skip Story', 1);
c('Build Image Req', 'Gen Story Image');
c('Gen Story Image', 'Save Story');

process.stdout.write(
  JSON.stringify(
    { id: 'HooniWF6Meme00001', name: 'HooniSpeed WF-6 meme-story', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Seoul', errorWorkflow: 'HooniWFErr00001' }, active: true },
    null,
    2
  ) + '\n'
);

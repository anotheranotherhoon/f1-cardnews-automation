// 로컬 Gemini 이미지 생성 (서버 불필요)
// 키 조회 순서: 환경변수 GEMINI_API_KEY → ~/.gemini-key 파일
// 사용법:
//   node gen-assets.js styles                     # 화풍 후보 3종
//   node gen-assets.js char <드라이버코드> <설명>  # 캐릭터 base 생성 (선택된 화풍 적용)
//   node gen-assets.js bg <circuitId> <설명>       # 서킷 배경 생성
//   node gen-assets.js edit <입력png> <출력경로> <지시>   # 레퍼런스 기반 편집(i2i)
const fs = require('fs');
const path = require('path');
const os = require('os');

const KEY = process.env.GEMINI_API_KEY || (() => {
  const p = path.join(os.homedir(), '.gemini-key');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
})();
if (!KEY) {
  console.error('Gemini API 키가 없습니다. 다음 중 하나로 제공하세요:');
  console.error('  export GEMINI_API_KEY=...   또는   echo "키" > ~/.gemini-key');
  process.exit(1);
}

const ASSETS = path.join(__dirname, '../assets');
const NEW_COMPOSITION = "Vertical 9:16 composition: place the character and key elements in the TOP 55 percent. The lower portion must continue the same scene naturally (track asphalt, blurred scenery) with NO dark band, NO solid color block and NO hard horizontal edge — a text overlay is applied later";
const MODEL = 'gemini-2.5-flash-image';

// 확정 화풍: 치비 캐리커처 (2026-08-12 2차 피드백 — 비율 통일 + 실물 특징 정확도 강화)
const STYLE_GUIDE =
  'STRICT PROPORTIONS (identical for every character, non-negotiable): total height = 3 head-lengths. ' +
  'Head is a gently rounded oval — never a perfect circle, never elongated. Same head size and same body ' +
  'build for all characters. Young adult, smooth skin, no wrinkles, no jowls, no aged look. ' +
  'LIKENESS: capture the real driver\'s actual facial structure and hairstyle accurately, then push those ' +
  'specific traits about 30% further for caricature charm. The person must be recognizable at a glance; ' +
  'do NOT default to a generic handsome anime face. ' +
  'RENDERING: bold clean black outlines of even weight, flat cel shading, vivid saturated colors, ' +
  'stylized cartoon (not photorealistic, not 3D). ' +
  'SUITS MUST BE COMPLETELY UNBRANDED: plain solid team-colour racing overalls with simple colour blocking only. ' +
  'Absolutely no sponsor logos, no brand emblems, no team badges, no shields, no manufacturer marks, ' +
  'no lettering or numbers anywhere on the suit, helmet, or image. No text, no watermark';


// v2 화풍 (2026-08-16 피드백: 의상 디테일 강화 + 조금 더 현실적으로)
// 화풍(공용) / 구도·배경(용도별)을 분리한다 — DOTD는 상반신+어두운 배경이라 전신·흰배경 규정과 충돌한다
// 화풍은 style.js 가 단일 출처다 (build-wf1.js 의 즉석 자산 생성도 같은 값을 쓴다).
const { STYLE_CORE, STYLE_V2, STYLE_V2_BUST } = require('./style');

// 드라이버 식별자: 팀 컬러 + 캐리커처로 과장할 개인 특징
const DRIVERS = {
  nor: 'papaya orange and black racing suit. Signature traits: thick DARK BROWN tightly curly hair, short at the sides and voluminous on top; a SMALL DARK BEAUTY MARK (mole) on his LEFT cheek, just below and outside his left eye — do not omit it; wide open-mouthed grin showing large prominent upper front teeth; round full cheeks that dimple when smiling; small rounded nose; light patchy stubble with a faint moustache; cheerful crinkled blue-grey eyes; thick straight dark eyebrows',
  pia: 'papaya orange and black racing suit. Straight dark brown hair with neat side part, calm deadpan expression, narrow relaxed eyes, subtle smirk',
  lec: 'red racing suit with white accents. Signature traits: tall curly dark-brown quiff swept upward and back with visible waves; very thick straight dark eyebrows sitting low; large dark eyes with heavy droopy lower lids giving a permanently soft sad puppy look; long straight narrow nose; sharp high cheekbones with a narrow jaw; short dark stubble along the jawline; slightly crooked closed-lip smile',
  ham: 'red racing suit with white accents. Signature traits: brown skin; dark hair in tight neat cornrow braids running straight back from the hairline; full trimmed black beard and mustache connected to sideburns; diamond stud earrings in both ears; narrow almond-shaped eyes with a relaxed confident gaze; high cheekbones; slim straight nose; calm closed-lip half-smile. Keep the head the same size as the other characters',
  ant: 'dark teal and black racing suit. Signature traits: youngest driver on the grid, 19 years old with a LEAN slim face (not chubby, no baby fat) and slim build; medium-length dark brown hair, messy and loosely curly, parted in the middle and falling to the sides; thick dark eyebrows; wide-set calm brown eyes; slightly long straight nose; narrow chin; shy small closed-lip smile',
  rus: 'dark teal and black racing suit. Signature traits: DEEP PRONOUNCED DOUBLE EYELID CREASES over large expressive eyes (his most distinctive feature — draw the crease line clearly); dark-brown hair with natural wave and volume, medium-short, side-swept with loose curls at the temples and a normal hairline (do NOT make it receding); straight thin nose; full lips in a calm closed-mouth expression; narrow face with high cheekbones and a defined jaw tapering to a slightly pointed chin, NORMAL face length; neat medium-thick eyebrows with a gentle arch; clean-shaven, youthful and posh',
  ver: 'navy blue and red racing suit. Signature traits: short brown hair, full on top, hairline slightly higher at the temples; LIGHT STUBBLE around the mouth and chin (a thin moustache and short beard shadow — do not omit); long prominent straight nose; narrow-set blue-grey eyes with slightly heavy upper lids for a calm cool gaze; longish face with a defined smooth jaw; calm neutral closed mouth with the faintest smirk — absolutely NO frown, NO furrowed brow, NO wrinkles between the eyebrows, NO angry look; relaxed level eyebrows',
  had: 'navy blue and red racing suit. Black hair, expressive animated eyebrows, wide-open startled eyes, boyish narrow face',
  alo: 'dark green racing suit, dark brown hair',
  str: 'dark green racing suit, dark hair',
  gas: 'pink and blue racing suit, dark brown hair',
  col: 'pink and blue racing suit, dark hair',
  sai: 'light blue and white racing suit, dark brown hair',
  alb: 'light blue and white racing suit, black hair',
  hul: 'bright green and black racing suit, blonde short hair',
  bor: 'bright green and black racing suit, dark curly hair',
  oco: 'white and grey racing suit, dark brown hair',
  bea: 'white and grey racing suit, light brown hair',
  per: 'gold and black racing suit, black hair',
  bot: 'gold and black racing suit, blonde hair with mustache',
  lin: 'navy blue and white racing suit, light brown hair',
  law: 'navy blue and white racing suit, dark brown hair',
};

async function generate(prompt, outPath, refPngPath, aspectRatio) {
  const parts = [];
  for (const p of [].concat(refPngPath || [])) {
    parts.push({ inlineData: { mimeType: 'image/png', data: fs.readFileSync(p).toString('base64') } });
  }
  parts.push({ text: prompt });
  const generationConfig = { responseModalities: ['IMAGE'] };
  if (aspectRatio) generationConfig.imageConfig = { aspectRatio };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
  const json = JSON.parse(body);
  const cand = ((json.candidates || [])[0] || {}).content || {};
  const img = (cand.parts || []).find((p) => p.inlineData || p.inline_data);
  if (!img) throw new Error('이미지 응답 없음: ' + body.slice(0, 300));
  const d = img.inlineData || img.inline_data;
  const buf = Buffer.from(d.data, 'base64');
  const full = path.join(ASSETS, outPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  console.log(`✓ ${outPath} (${Math.round(buf.length / 1024)}KB)`);
  return full;
}

// 사진(있으면) + 화풍 레퍼런스로 캐릭터 1명 생성 — photo / photo-all 공용
async function runPhotoGen(code, photos) {
  const look = DRIVERS[code] || 'plain red racing suit';
  const styleRef = path.join(ASSETS, 'characters/nor/base.png');
  const refs = [fs.existsSync(styleRef) && code !== 'nor' ? styleRef : null, ...photos].filter(Boolean);
  const hasPhoto = photos.length > 0;
  const prompt = hasPhoto
    ? `The FIRST reference image defines the ART STYLE. The REMAINING reference images are photographs of the ` +
      `real person to draw. Redraw that person as a chibi caricature in EXACTLY the art style of the first image ` +
      `(same proportions, same line weight, same eye drawing style, same flat shading). ` +
      `Study the photographs carefully and reproduce this person's actual face: hairstyle and hair volume, ` +
      `eye shape and eyelid crease, eyebrow shape, nose length and width, mouth shape, facial hair, skin tone, ` +
      `face outline. Then exaggerate those real traits about 30% for caricature charm. ` +
      `IMPORTANT: use the photographs ONLY as reference for the face, hair and skin tone. Do NOT copy anything ` +
      `from the clothing in the photographs — ignore every sponsor logo, badge, lettering and pattern on the ` +
      `real racing suit and instead draw a completely plain unbranded racing suit in the team colours only. ` +
      `Full body, standing, holding a plain white helmet under one arm, plain white background. ` +
      `Team colours and notes: ${look}\n\n${STYLE_GUIDE}`
    : `Chibi caricature of a Formula 1 racing driver, holding a plain white helmet under one arm, standing pose, ` +
      `full body, centered, plain white background. Character details to exaggerate: ${look}. ${STYLE_GUIDE}`;
  return generate(prompt, `characters/${code}/base.png`, refs.length ? refs : null, '1:1');
}

const STYLE_CANDIDATES = [
  ['a-chibi', 'Cute chibi cartoon character of a Formula 1 racing driver, 2.5-head-tall proportions, big head, generic red racing suit and gloves, holding a white helmet under one arm, thumbs up, bold clean outlines, flat cel shading, plain white background, full body, centered, no text'],
  ['b-flat', 'Flat vector cartoon illustration of a Formula 1 racing driver, modern minimal geometric style, adult proportions, generic red racing suit, holding a white helmet under one arm, confident stance, bold clean outlines, plain white background, full body, centered, no text'],
  ['c-caricature', 'Stylized caricature of a Formula 1 racing driver, slightly exaggerated head-to-body ratio, semi-realistic painterly shading with clean linework, generic red racing suit, holding a white helmet under one arm, plain white background, full body, centered, no text'],
];

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'styles') {
      for (const [name, prompt] of STYLE_CANDIDATES) {
        await generate(prompt, `style-candidates/${name}.png`);
      }
      console.log('\n화풍 후보 3종 완료 → assets/style-candidates/');
    } else if (cmd === 'photo-all') {
      // 22명 일괄: /tmp/f1ref/faces/<code>.png 사진이 있으면 사진 기반, 없으면 텍스트 설명만으로 생성
      const FACES = '/tmp/f1ref/faces';
      const only = new Set(args.map((x) => x.toLowerCase()));
      const codes = Object.keys(DRIVERS).filter((c) => !only.size || only.has(c));
      const done = [];
      const skipped = [];
      for (const code of codes) {
        const out = path.join(ASSETS, `characters/${code}/base.png`);
        if (fs.existsSync(out) && !only.size) {
          skipped.push(code);
          continue; // 이미 있는 캐릭터는 건너뜀 (재생성은 코드를 명시)
        }
        const face = path.join(FACES, `${code}.png`);
        const hasFace = fs.existsSync(face);
        try {
          await runPhotoGen(code, hasFace ? [face] : []);
          done.push(code + (hasFace ? '' : '(텍스트)'));
        } catch (e) {
          console.error(`✗ ${code}: ${e.message}`);
        }
      }
      console.log(`\n생성 ${done.length}명: ${done.join(' ')}`);
      if (skipped.length) console.log(`기존 유지 ${skipped.length}명: ${skipped.join(' ')}`);
    } else if (cmd === 'photo') {
      // 실사진 기반 캐릭터 생성: [화풍 레퍼런스(승인된 캐릭터), 실제 사진들] + 지시
      // 사용법: node gen-assets.js photo <코드> <사진경로...>
      const [rawCode, ...photos] = args;
      if (!rawCode || !photos.length) throw new Error('사용법: photo <코드> <사진경로...>');
      const code = rawCode.toLowerCase();
      const styleRef = path.join(ASSETS, 'characters/nor/base.png'); // 승인된 화풍 기준
      const refs = [fs.existsSync(styleRef) ? styleRef : null, ...photos].filter(Boolean);
      const look = DRIVERS[code] || '';
      await generate(
        `The FIRST reference image defines the ART STYLE. The REMAINING reference images are photographs of the ` +
          `real person to draw. Redraw that person as a chibi caricature in EXACTLY the art style of the first image ` +
          `(same proportions, same line weight, same eye drawing style, same flat shading). ` +
          `Study the photographs carefully and reproduce this person's actual face: hairstyle and hair volume, ` +
          `eye shape and eyelid crease, eyebrow shape, nose length and width, mouth shape, facial hair, face outline. ` +
          `Then exaggerate those real traits about 30% for caricature charm. ` +
          `IMPORTANT: use the photographs ONLY as reference for the face, hair and skin tone. Do NOT copy anything ` +
          `from the clothing in the photographs — ignore every sponsor logo, badge, lettering and pattern on the ` +
          `real racing suit and instead draw a completely plain unbranded racing suit in the team colours only. ` +
          `Full body, standing, holding a plain white helmet under one arm, plain white background.` +
          (look ? ` Additional notes: ${look}` : '') +
          `\n\n${STYLE_GUIDE}`,
        `characters/${code}/base.png`,
        refs,
        '1:1' // 레퍼런스 사진의 종횡비가 결과에 전이되는 것을 막는다
      );
    } else if (cmd === 'sheet') {
      // 캐릭터 시트: 여러 명을 한 장에 그려 화풍·비율을 자동 통일 → 이후 개별 생성의 스타일 레퍼런스로 사용
      const codes = (args.length ? args : ['nor', 'ver', 'lec', 'rus', 'ham', 'ant']).map((x) => x.toLowerCase());
      const lineup = codes
        .map((c, i) => `${i + 1}) ${c.toUpperCase()}: ${DRIVERS[c] || 'red racing suit'}`)
        .join('\n');
      await generate(
        `Character design sheet for a Formula 1 cartoon series: ${codes.length} DIFFERENT chibi caricature drivers ` +
          `standing side by side in one row, evenly spaced, all drawn at the SAME scale with IDENTICAL head size, ` +
          `IDENTICAL body proportions and the SAME eye drawing style, full body, front view, plain white background.\n` +
          `Each character from left to right:\n${lineup}\n\n${STYLE_GUIDE}`,
        'style-candidates/sheet.png',
        null,
        '16:9'
      );
    } else if (cmd === 'char') {
      const codes = args.length ? args : Object.keys(DRIVERS);
      for (const raw of codes) {
        const code = raw.toLowerCase();
        const look = DRIVERS[code] || 'red racing suit, dark hair';
        await generate(
          `Chibi caricature of a Formula 1 racing driver, holding a white helmet under one arm, standing pose, ` +
            `full body, centered, plain white background. Character details to exaggerate: ${look}. ${STYLE_GUIDE}`,
          `characters/${code}/base.png`
        );
      }
    } else if (cmd === 'bg') {
      const [circuitId, ...desc] = args;
      if (!circuitId) throw new Error('circuitId 필요 (예: zandvoort)');
      await generate(
        `${desc.join(' ')}. Wide atmospheric background illustration for a sports graphic, dark moody tone, ` +
          'cinematic depth, no text, no people, no logos, vertical 4:5 composition, subtle enough to place text over',
        `backgrounds/${circuitId}/bg.png`
      );
    } else if (cmd === 'dotd') {
      // DOTD 카드용 역동 포즈 → assets/dotd/<code>.png (한 번 만들어 매주 재사용)
      // 카드 우측 패널(3:4)에 그대로 얹으므로 배경까지 포함해 생성한다.
      const FACES = '/tmp/f1ref/faces';
      // 팔을 머리 위로 뻗게 하면 모델이 전신으로 그려버리므로, 제스처는 어깨 높이 안에서 끝낸다.
      // 프레임 밖으로 잘려나가는 팔(T포즈 등)은 괜찮다 — 오히려 구도가 산다.
      const POSES = [
        { id: 'fist', text: 'one fist clenched and pulled in tight at chest height in a compact fist pump, elbow bent and close to the body, roaring open-mouthed shout of triumph' },
        { id: 'point', text: 'pointing straight at the viewer with the index finger of one hand, other fist at the waist, cocky confident grin' },
        { id: 'arms-folded', text: 'arms folded across the chest, chin slightly lowered, calm self-assured smirk' },
        { id: 'thumbs', text: 'both thumbs up held at chest height, head tilted, cheeky wide grin' },
        { id: 'kiss', text: 'blowing a celebratory kiss toward the viewer with one hand, other fist clenched at the chest, playful smile' },
        { id: 'v-one', text: 'one hand raised beside the face making a V peace sign with index and middle fingers, other hand on the hip, bright grin' },
        { id: 'v-two', text: 'both hands raised to shoulder height making V peace signs with index and middle fingers, beaming open-mouthed smile' },
        { id: 'salute', text: 'a crisp military-style salute with the right hand at the temple, back straight, confident closed-lip smile' },
        { id: 'heart', text: 'making a KOREAN FINGER HEART held up beside the cheek — thumb and index finger crossed at the tips to form a tiny heart, the other three fingers curled down; warm smile' },
        { id: 'shhh', text: 'index finger pressed vertically against the pursed lips in a silencing "shhh" gesture, eyebrows raised, sly triumphant look' },
        { id: 'punch', text: 'punching one fist straight toward the camera so it is much larger than the head in exaggerated foreshortening, other arm pulled back, fierce open-mouthed roar' },
      ];
      // 실제로 널리 알려진 시그니처 세리머니는 그 드라이버에게 고정한다
      const POSE_OVERRIDES = {
        rus: 'his signature T-POSE celebration: both arms stretched out perfectly straight and horizontal to the ' +
          'left and right at shoulder height, palms flat and facing down, body upright and symmetrical, chin up ' +
          'with a proud closed-lip smile. The outstretched arms run off the left and right edges of the frame — ' +
          'that is intended, keep the head and torso centred.',
      };
      // 인자는 `코드[:장수]` — 장수를 생략하면 1장. 포즈는 드라이버별로 중복 없이 무작위 배정한다.
      // 이미 파일이 있는 포즈는 건너뛰므로, 같은 명령을 다시 돌려도 부족한 만큼만 채워진다.
      const specs = (args.length ? args : Object.keys(DRIVERS)).map((a) => {
        const [code, n] = String(a).toLowerCase().split(':');
        return { code, want: Math.max(1, parseInt(n || '1', 10)) };
      });
      const jobs = [];
      for (const { code, want } of specs) {
        const dir = path.join(ASSETS, 'dotd', code);
        const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')) : [];
        const own = POSE_OVERRIDES[code] ? [{ id: 'tpose', text: POSE_OVERRIDES[code] }] : [];
        const pool = [...own, ...POSES].filter((p) => !have.includes(p.id));
        // 셔플 후 필요한 개수만
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const need = Math.max(0, want - have.length);
        if (need > pool.length) console.log(`! ${code}: 포즈 부족 — ${pool.length}장만 생성`);
        jobs.push(...pool.slice(0, need).map((pose) => ({ code, pose })));
      }
      console.log(`생성 예정: ${jobs.length}장 (약 ${jobs.length * 55}원)`);
      for (const { code, pose: poseObj } of jobs) {
        // 참조는 v2 캐릭터(로고 없는 깨끗한 수트)를 1순위로 쓴다.
        // 실제 사진을 참조하면 사진 속 수트의 스폰서 로고를 따라 그려버린다.
        const v2 = path.join(ASSETS, `characters-v2/${code}/base.png`);
        const face = path.join(FACES, `${code}.png`);
        const fromV2 = fs.existsSync(v2);
        const src = fromV2 ? v2 : (fs.existsSync(face) ? face : null);
        const look = DRIVERS[code] || 'plain red racing suit';
        const refs = src ? [src] : null;
        const pose = poseObj.text;
        const scene =
          `DYNAMIC ACTION PORTRAIT for a "Driver of the Day" graphic. Waist-up composition, low camera angle ` +
          `looking slightly up at the driver so they feel heroic. Pose: ${pose}. ` +
          `BACKGROUND: a dark charcoal (#12121c) backdrop with bold diagonal motion streaks and a soft glow ` +
          `behind the figure, tinted with the driver's colours listed below. Sparse confetti specks. ` +
          `No crowd, no cars, no track furniture, no text, no numbers, no logos anywhere. ` +
          `Keep the figure fully inside the frame with breathing room around the raised arms.`;
        const promptFromV2 =
          `The reference image is an existing ILLUSTRATION of this character. Keep his face, hair, skin tone, ` +
          `suit colours and art style EXACTLY as in the reference. The suit in the reference is already blank and ` +
          `unbranded — keep it that way and do not add any logo, emblem or marking. ` +
          `Only change the pose and the background as described.\n\n${scene}\n\n${STYLE_V2_BUST}`;
        const prompt = fromV2 ? promptFromV2 : refs
          ? `The reference image is a photograph of the real person to draw. Redraw them as a stylized ` +
            `semi-realistic caricature illustration, reproducing this person's actual face: bone structure, ` +
            `hairstyle and hair volume, eye shape, eyebrows, nose, mouth, facial hair and skin tone. ` +
            `Use the photo ONLY for face, hair and skin. The clothing in the photograph is a sponsored race suit — ` +
            `copy NOTHING from it, especially the chevron/arrow shaped logos on its shoulders. ` +
            `Instead draw a detailed but completely unbranded racing suit in the colours listed below. ` +
            `Treat these strictly as abstract colour choices for a blank suit, NOT as a team livery to reproduce. ` +
            `Colours and personal features: ${look}\n\n${scene}\n\n${STYLE_V2_BUST}`
          : `Stylized semi-realistic caricature of a Formula 1 racing driver. Details: ${look}\n\n${scene}\n\n${STYLE_V2_BUST}`;
        await generate(prompt, `dotd/${code}/${poseObj.id}.png`, refs, '3:4');
      }
      console.log(`\nDOTD 액션 포즈 ${jobs.length}장 → assets/dotd/<코드>/<포즈>.png`);
    } else if (cmd === 'char2') {
      // v2 화풍으로 생성 → characters-v2/ (기존 v1은 보존)
      const FACES = '/tmp/f1ref/faces';
      const codes = (args.length ? args : ['nor', 'ver', 'lec', 'rus', 'ham', 'ant']).map((x) => x.toLowerCase());
      for (const code of codes) {
        const face = path.join(FACES, `${code}.png`);
        const look = DRIVERS[code] || 'plain red racing suit';
        const refs = fs.existsSync(face) ? [face] : null;
        const promptFromV2 =
          `The reference image is an existing ILLUSTRATION of this character. Keep his face, hair, skin tone, ` +
          `suit colours and art style EXACTLY as in the reference. The suit in the reference is already blank and ` +
          `unbranded — keep it that way and do not add any logo, emblem or marking. ` +
          `Only change the pose and the background as described.\n\n${scene}\n\n${STYLE_V2_BUST}`;
        const prompt = fromV2 ? promptFromV2 : refs
          ? `The reference image is a photograph of the real person to draw. Redraw them as a stylized ` +
            `semi-realistic caricature illustration. Study the photo and reproduce this person's actual face: ` +
            `bone structure, hairstyle and hair volume, eye shape and eyelid crease, eyebrows, nose, mouth, ` +
            `facial hair and skin tone. Full body, standing, holding a plain white helmet under one arm, ` +
            `plain white background. Use the photo ONLY for face, hair and skin — ignore all sponsor logos and ` +
            `patterns on the real suit and instead draw a detailed but completely unbranded racing suit in the ` +
            `colours listed below. Treat these strictly as abstract colour choices for a blank suit, NOT as a team livery to reproduce. Colours and personal features: ${look}\n\n${STYLE_V2}`
          : `Stylized semi-realistic caricature of a Formula 1 racing driver, full body, standing, holding a ` +
            `plain white helmet, plain white background. Details: ${look}\n\n${STYLE_V2}`;
        await generate(prompt, `characters-v2/${code}/base.png`, refs, '1:1');
      }
      console.log('\nv2 캐릭터 → assets/characters-v2/ (기존 v1은 그대로)');
    } else if (cmd === 'scene') {
      // 여러 캐릭터가 등장하는 장면: node gen-assets.js scene <출력경로> <비율> <코드,코드,...> <프롬프트>
      const [outPath, ratio, codeList, ...instr] = args;
      if (!outPath || !codeList) throw new Error('사용법: scene <출력> <비율> <코드목록> <프롬프트>');
      const codes = codeList.split(',').map((x) => x.trim().toLowerCase());
      const refs = codes.map((c) => {
        for (const dir of ['characters-v2', 'characters']) {
          const f = path.join(ASSETS, `${dir}/${c}/base.png`);
          if (fs.existsSync(f)) return f;
        }
        throw new Error('캐릭터 없음: ' + c);
      });
      const roster = codes.map((c, i) => `reference image ${i + 1} = ${c.toUpperCase()}`).join(', ');
      await generate(
        `The reference images define the characters (${roster}). Draw ALL of them together in one scene, ` +
          `keeping each character's exact face, hair, skin tone, suit colours and art style from their reference. ` +
          `${instr.join(' ')}\n\n${STYLE_V2}`,
        outPath, refs, ratio
      );
    } else if (cmd === 'editraw') {
      // 레퍼런스 기반 편집 (캐릭터 화풍 가이드 미적용 — 로고/그래픽용)
      const [inPath, outPath, ratio, ...instr] = args;
      if (!inPath || !outPath) throw new Error('사용법: editraw <입력png> <출력경로> <비율> <지시>');
      const full = inPath.startsWith('/') ? inPath : path.join(ASSETS, inPath);
      await generate(instr.join(' '), outPath, [full], ratio);
    } else if (cmd === 'custom') {
      // 임의 프롬프트 1장: node gen-assets.js custom <출력경로> <비율> <프롬프트...>
      const [outPath, ratio, ...rest] = args;
      if (!outPath || !rest.length) throw new Error('사용법: custom <출력경로> <비율> <프롬프트>');
      await generate(rest.join(' '), outPath, null, ratio);
    } else if (cmd === 'logo') {
      // 로고 심볼 후보 (텍스트 없이 심볼만 — 워드마크는 폰트로 별도 조판)
      const BRAND =
        'Brand colors: deep near-black #0b0b14 background and vivid racing red #e10600 as the single accent, ' +
        'plus white. Flat vector logo, bold clean shapes, thick even strokes, high contrast, no gradients, ' +
        'no photorealism, no drop shadows. MUST read clearly when shrunk to a 110px circular profile picture: ' +
        'simple silhouette, generous negative space, no fine detail, no thin lines. ' +
        'ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS anywhere in the image. ' +
        'Centered composition inside a circle, safe margin around the edge.';
      const CONCEPTS = [
        ['a-monogram', 'A bold abstract monogram mark formed from the letterforms H and S fused into a single ' +
          'geometric shape that also suggests forward motion and speed lines. Treat it as an abstract emblem, not readable text.'],
        ['b-helmet', 'A minimal front-facing racing helmet silhouette with a wide dark visor, reduced to its simplest ' +
          'iconic geometric form, with two short speed streaks behind it.'],
        ['c-checker', 'A circular emblem built from a checkered-flag pattern curving into a speed swoosh, ' +
          'forming a dynamic badge shape.'],
        ['d-mascot', 'A circular badge containing the head of a cute chibi caricature racing driver mascot wearing ' +
          'a helmet pushed up, big friendly grin, drawn in the same bold-outline flat cartoon style as our characters.'],
      ];
      for (const [name, concept] of CONCEPTS) {
        await generate(`${concept} ${BRAND}`, `logo-candidates/${name}.png`, null, '1:1');
      }
      console.log('\n로고 후보 4종 → assets/logo-candidates/');
    } else if (cmd === 'story') {
      // 9:16 스토리 이미지 (캐릭터 레퍼런스로 연속성 유지)
      const [code, outPath, ...instr] = args;
      if (!code || !outPath) throw new Error('사용법: story <드라이버코드> <출력경로> <장면설명>');
      const ref = path.join(ASSETS, `characters/${code.toLowerCase()}/base.png`);
      await generate(
        `${instr.join(' ')} The reference image defines the character: keep the exact same face, hair and art style. ` +
          `${NEW_COMPOSITION} ${STYLE_GUIDE}`,
        outPath,
        fs.existsSync(ref) ? [ref] : null,
        '9:16'
      );
    } else if (cmd === 'edit') {
      const [inPath, outPath, ...instr] = args;
      if (!inPath || !outPath) throw new Error('사용법: edit <입력png> <출력경로> <지시>');
      await generate(`${instr.join(' ')}. Keep the exact same character identity and art style as the reference image. ${STYLE_GUIDE}`, outPath, inPath);
    } else {
      console.log('명령: styles | char <코드> <설명> | bg <circuitId> <설명> | edit <입력> <출력> <지시>');
    }
  } catch (e) {
    console.error('✗', e.message);
    process.exit(1);
  }
})();

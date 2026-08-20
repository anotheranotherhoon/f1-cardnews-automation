// 캐릭터 화풍의 단일 출처.
//
// gen-assets.js(로컬 생성)와 build-wf1.js(즉석 자산 생성)가 함께 참조한다.
// 화풍을 바꿀 때는 이 파일만 고친다 — 복사본을 만들면 두 경로가 서로 다른 그림을 만든다.
// 배경: 스폰서 로고가 반복적으로 새어 나왔고, 금지 문구 강화로는 네 번 실패했다.
// 효과가 있었던 것은 아래 CHEST DESIGN — 대각선 스트라이프로 가슴을 채워 로고가 들어갈
// 빈 공간을 없애는 방식이다. 이 문단을 지우면 로고가 다시 나타난다.

const STYLE_CORE =
  'MEDIUM: a HAND-DRAWN ILLUSTRATION with visible clean linework and painted cel shading — ' +
  'NEVER a photograph, never photo-realistic skin texture, never a photo face pasted onto a drawn body. ' +
  "LIKENESS: reproduce the real person's bone structure, hairstyle, eye shape, nose, mouth, facial hair and " +
  'skin tone faithfully, then exaggerate the most distinctive traits only slightly (about 15%). ' +
  'RENDERING: refined semi-realistic illustration, soft three-tone cel shading with subtle gradients, ' +
  'gentle rim light, restrained thin clean outlines, controlled rich color. ' +
  'RACING SUIT — DETAILED BUT COMPLETELY BLANK: draw a fitted modern FIA racing coverall showing its ' +
  'construction: panel seams, shoulder and elbow articulation, raised collar, zip flap, waist belt, padded knees, ' +
  'ribbed cuffs, matching gloves with knuckle panels, subtle fabric sheen and folds, plain racing boots. ' +
  'CRITICAL BRANDING RULE: this is an UNSPONSORED PLAIN TEST SUIT. Do NOT reproduce any real Formula 1 team livery. ' +
  'There must be ZERO logos, ZERO sponsor patches, ZERO brand marks, ZERO emblems, ZERO shields, ZERO badges, ' +
  'ZERO lettering, ZERO numbers and ZERO flags anywhere on the suit, gloves, boots or helmet. ' +
  'The SHOULDERS and CHEST must stay completely bare of any mark — no chevrons, no arrows, no winged shapes, ' +
  'no star or bird motifs, and above all NO leaping cat or animal silhouette of any kind on the chest or ' +
  'shoulders. Do not invent decorative emblems to fill empty space. ' +
  'CHEST DESIGN (fills the space so there is no empty panel): across the chest draw ONE bold diagonal stripe of ' +
  'the accent colour running from the left shoulder down to the right hip, plus a matching thinner stripe along ' +
  'each outer sleeve. These stripes are the ONLY decoration — they replace any logo. The chest must have no ' +
  'other shape on it whatsoever. ' +
  'Use only flat solid colour blocking and seam lines to shape the suit. The helmet is plain matte white, unmarked. ' +
  'NO artist signature, NO watermark, NO handwriting, NO scribble in any corner of the image.';

const STYLE_V2 =
  'PROPORTIONS (strict, identical for every character): total body height = exactly 4 head-heights. ' +
  'The head is enlarged for caricature but the body has real human structure and correct anatomy. ' +
  'Full figure standing upright, head-to-toe, same camera distance and same scale for every character. ' +
  STYLE_CORE +
  ' BACKGROUND: plain pure white, no shadow ground, no props, no text anywhere in the image.';

// DOTD 카드용: 표정이 읽혀야 하므로 전신이 아니라 상반신으로 고정한다
const STYLE_V2_BUST =
  'FRAMING (strict, non-negotiable, identical for every character): a CHEST-UP PORTRAIT. The bottom edge of ' +
  'the image cuts the body just below the chest. Legs, hips, knees and boots are OUTSIDE the frame and must ' +
  'never appear. The head occupies about one third of the image height so the facial expression reads clearly. ' +
  'This is a tight portrait crop, NOT a full-body figure. The head is enlarged for caricature but anatomy stays correct. ' +
  STYLE_CORE;

module.exports = { STYLE_CORE, STYLE_V2, STYLE_V2_BUST };

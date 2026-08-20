// 인스턴스별 설정. config.js 로 복사한 뒤 자기 값으로 채운다.
//
//   cp config.example.js config.js
//
// config.js 는 커밋되지 않는다. 값이 바뀌면 build-wf*.js 를 다시 돌려 JSON을 재생성한다.
module.exports = {
  // 승인 요청을 받을 텔레그램 대화방 ID
  TG_CHAT_ID: '<텔레그램 chat id>',

  // 발행 대상 인스타그램 비즈니스 계정 ID
  IG_USER_ID: '<인스타그램 계정 id>',

  // WF-5 에셋 생성 웹훅 경로. 외부에서 호출 가능하므로 추측하기 어려운 값을 쓴다
  ASSET_GEN_PATH: 'asset-gen-<임의문자열>',

  // 재요청(발행 후 다시 만들기) 버튼용. n8n 공개 웹훅 주소 + 경로 + 인증 키.
  // 버튼 URL 이 텔레그램 대화에 남으므로 KEY 는 반드시 추측 불가능한 값으로 둔다.
  N8N_WEBHOOK_BASE: 'https://<n8n 공개주소>/',
  REPUBLISH_PATH: 'republish-<임의문자열>',
  REPUBLISH_KEY: '<임의문자열>',

  // n8n Credentials 에 등록한 항목들의 id/name (실제 키는 n8n 안에만 있다)
  TG_CRED: { id: '<n8n telegram credential id>', name: 'Telegram account' },
  IG_CRED: { id: '<n8n ig token credential id>', name: 'Instagram access token' },
  GEMINI_CRED: { id: '<n8n gemini credential id>', name: 'Google Gemini(PaLM) Api account' },
  BROWSERLESS_CRED: { id: '<n8n browserless credential id>', name: 'browserless token' },
};

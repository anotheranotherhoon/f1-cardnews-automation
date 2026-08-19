# Tasks: f1-weekend-cardnews

## 1. 인프라 준비 (OCI 서버)

- [x] 1.1 browserless 도커 컨테이너 추가 및 n8n에서 `/screenshot` 호출 확인 ✅ ghcr.io/browserless/chromium, n8n_default 네트워크, 토큰 ~/hooni_speed/.browserless_token, 한글 렌더링 검증 완료 (1080×1350, ~39초/장)
- [x] 1.2 공개 HTTPS 서빙 구성 ✅ 기존 flutter-web nginx의 정적 루트 재활용 — 호스트 `/home/ubuntu/flutter-web/web/hooni-cards` = `https://xrp-admin.p-e.kr/hooni-cards/...` (nginx 무변경). n8n 컨테이너에 `/data/cards`, `/data/hooni_speed` 마운트 추가 + uid 그룹 권한(1000) 정리, 쓰기 검증 완료
- [x] 1.3 자산 디렉토리 구조 생성 ✅ 서버 `~/hooni_speed/` 하위에 assets/{characters,backgrounds,templates}, cards, test 생성
- [x] 1.4 Google AI Studio에서 Gemini API 키 발급 → n8n Credentials 등록 **(사용자 작업: 키 발급)** ✅ 2026-08-11 완료 (Google Gemini(PaLM) Api credential)
- [x] 1.5 기존 IG·Telegram 토큰을 n8n Credentials로 이전 ✅ IG 토큰 → httpQueryAuth `HooniIgToken00001` (서버 내부에서 추출·등록, 외부 미노출), Telegram은 기존 credential 재사용. 잔여: 구 carousel_feed 워크플로우의 평문 토큰은 해당 워크플로우 은퇴 시 제거

## 2. WF-1 스케줄러 + 데이터 수집

- [x] 2.1 Schedule Trigger(09:00 KST) + Jolpica 캘린더 조회 + 요일/스프린트 판별 Code 노드 ✅ 로직 로컬 12케이스 검증(스프린트/비스프린트/베이거스) + n8n 임포트 후 실제 실행 성공 (`HooniWF1Sched001`, 비활성 상태)
- [x] 2.2 Switch 노드로 레시피 분기 ✅ 7개 출력 (목/금/토×2/일×2/월) + 미매칭(none)은 드롭으로 조용히 종료, 각 분기에 TODO NoOp 플레이스홀더
- [x] 2.3 프리뷰(목) 데이터 브랜치 ✅ 트랙 JSON 임베드 + 작년 서킷 결과·스프린트 포디움 (실행 검증) — 타이어 컴파운드·이슈 LLM 웹서치는 3.5와 함께 (카드에 needsLlm 플래그로 스텁)
- [x] 2.4 관전 가이드(금) 데이터 브랜치 ✅ KST 시간표 + 스탠딩 기반 라인업 (실행 검증)
- [x] 2.5 토요일 브랜치 ✅ OpenF1 `session_result`(공식 순위, 랩 집계 불필요) — 비스프린트 FP1·FP2 / 스프린트 FP1+SQ, 실데이터 검증 (헝가리 R11, 중국 R2)
- [x] 2.6 일요일 브랜치 ✅ 퀄리·탈락·그리드 / 스프린트 결과·등락(직전+스프린트 포인트)·퀄리·그리드, 실행 검증
- [x] 2.7 월요일 브랜치 ✅ 레이스 Top10·FL·스틴트(compound null 대응)·드라이버/컨스트럭터 등락, 실데이터 검증 — 이슈·DOTD LLM 요약은 스텁 (needsLlm)
- [x] 2.8 데이터 미반영 감지 ✅ 각 Cards 노드에 빈 데이터 throw 가드 + WF-ERR(에러 트리거→텔레그램) 연결 — 텔레그램 알림 실발송은 통합 테스트(7.x)에서 확인
- [x] 2.9 서킷 트랙 설명 정적 JSON 작성 ✅ 2026 캘린더 23개 서킷 한국어 설명 (`workflows/track-info.json`, PV Cards Code 노드에 인라인 임베드) — 사용자 검수는 실발행 전 권장

## 3. 카드 템플릿 + WF-2 렌더러

- [x] 3.1 캐릭터 화풍 확정 ✅ 치비 캐리커처로 확정(2026-08-12), 드라이버 22명 전원 생성 완료. F1 공식 포트레이트 21장을 얼굴 크롭해 레퍼런스로 사용, 스폰서 로고 제거 확인
- [x] 3.1b 로컬 이미지 생성 스크립트 ✅ `gen-assets.js` — styles(화풍 후보) / char(캐릭터 base) / bg(서킷 배경) / edit(레퍼런스 i2i) 4개 명령, 서버 불필요. 키만 있으면 바로 실행
- [x] 3.1a WF-5 asset-gen 워크플로우 (웹훅 → Gemini 이미지 생성/레퍼런스 i2i → assets/ 저장) ✅ 구축·배포 완료, 결제 연결되면 즉시 사용 가능
- [x] 3.2 카드 HTML 템플릿 제작 ✅ `templates/` 11종 (base.css + session-result/standings공용, cover-data, cover-meme, grid 2열, quali-elims, timetable, lineup, track, text-card(이슈·타이어·DOTD 공용), podium, stints) — 퀄리 카드 실렌더링으로 디자인 검증
- [x] 3.3 WF-2 렌더러 서브워크플로우 ✅ 템플릿 인라인 바인딩 → browserless(배칭 8초, 페일패스트 120초, 재시도 4회) → Code(fs) 저장 → URL 수집. 갤러리 10종 전체 렌더링 실검증 (readWriteFile 노드 불가로 fs 직접 쓰기, 10장 초과 가드 포함)
- [x] 3.4 배경 재사용 경로 ✅ WF-2가 `assets/backgrounds/<circuitId>/` 이미지를 base64 data URI로 임베드 (없으면 단색 배경). browserless가 `file://` 차단하므로 data URI 필수. 배경 생성 자체는 WF-5로 (Gemini 결제 후)
- [x] 3.6 로컬 렌더 하네스 ✅ `local-render.js` — WF-2의 Prepare Cards 코드를 그대로 추출해 맥 Chrome으로 렌더링 (10장 수초, 서버 불필요). 템플릿 반복 작업을 서버와 분리
- [x] 3.7 렌더링 메모리 프리플라이트 가드 ✅ WF-2가 `/proc/meminfo` 확인해 여유 220MB 미만이면 중단 + 텔레그램 알림 (서버 다운 재발 방지)
- [x] 3.5 **밈 스토리 구현 완료** ✅ WF-6(meme-story): Gemini 3.6이 밈 컨셉(한국어 카피+주인공 드라이버+영어 프롬프트) → 캐릭터 base.png를 i2i 레퍼런스로 9:16 이미지 생성 → `story` 템플릿(1080×1920)에 카피+피드 유도 버튼 오버레이. 로컬 렌더로 디자인 검증, 캐릭터 연속성 확인. 실패 시 스토리만 생략하고 피드는 정상 발행
- [x] 3.8 스토리 발행 경로 ✅ WF-4에 `media_type=STORIES` 분기 추가 (피드 캐러셀 발행 성공 후 실행, storyUrl 없으면 건너뜀), WF-3 승인에 스토리 미리보기 포함, WF-2가 피드/스토리를 뷰포트별로 렌더하고 `urls`·`storyUrl`로 분리
- [x] 3.9 WF-1 연결 ✅ 목 프리뷰·월 총정리만 WF-6을 거치고(onError: 계속), 나머지 5개 요일은 피드만 렌더
- [x] 4.1 캐릭터 자산 ✅ 22명 전원 생성 후 서버 동기화 완료 (lazy 생성 대신 사전 일괄 생성 채택 — 시즌 중 신규 드라이버만 개별 추가)

## 4. 캐릭터 자산 라이브러리

- [x] 4.1 캐릭터 자산 ✅ 22명 사전 일괄 생성 + 서버 동기화 (lazy 생성 불필요)
- [~] 4.2 파생 포즈 축적 — v1에서는 매 발행 시 base.png로 i2i 생성(연속성 검증됨). 포즈 재사용 캐시는 운영하며 필요성 판단

## 5. WF-3 승인 피드백 루프

- [x] 5.1 카드 세트 텔레그램 전송 + ✅발행/✏️수정 sendAndWait ✅ **E2E 실검증 완료 (2026-08-12)** — 웹훅→WF-2 렌더 3장→WF-3 전송→사용자 ✅발행 클릭→`approved:true` 반환까지 전 구간 성공 (실행 76·77·78 모두 success). 서버 여유 메모리 307MB 유지
- [x] 5.2 자유 텍스트 수정 지시 → Gemini가 cards JSON 수정 → 재렌더 — **채팅 방식으로 재설계·배포 완료(WF-3 + WF-7 텔레그램 리스너)**, 실동작 테스트 남음. 수정은 일회성(템플릿·화풍 불변)
- [x] 5.3 수정 루프 3회 상한 + 12시간 만료 자동 정리 ✅ 채팅 방식 실검증 (누적 수정 2회 확인)

## 6. WF-4 발행 + 정리

- [x] 6.1 발행 구간 ✅ **인스타 실발행 성공 (2026-08-13)** — 피드 캐러셀 + 스토리(media_type=STORIES) 동시 발행 확인
- [x] 6.2 발행 후 정리 ✅ 실검증 — 발행분·수정판 디렉토리 전부 삭제(잔여 0), 밈 이미지는 보관, 텔레그램 완료 알림

## 7. 통합 검증

- [x] 7.1 과거 라운드 데이터로 7개 레시피 전부 드라이런 ✅ 목/금/일/일S는 n8n 실행, 토/토S/월은 실데이터 로컬 시뮬레이션 (`test-branches-local.js`) + 갤러리 10종 템플릿 렌더링 눈 검수 완료
- [x] 7.2 스프린트 주간 분기 + 변칙 일정 판별 검증 ✅ 로컬 12케이스 (더치 스프린트 주간 5일 + 일본 비스프린트 + 라스베이거스 토요일 레이스)
- [x] 7.3 수정 루프 왕복 ✅ 채팅 지시 → Gemini 해석 → 지목 카드만 수정 → 재렌더 → 재승인 실검증. 스토리 카피도 수정 대상(이미지는 재사용해 비용 0)
- [x] 7.4 IG 실발행 ✅ 피드 캐러셀 + 밈 스토리 발행 성공, 파일 자동 정리 확인 (테스트 게시물은 수동 삭제 필요)
- [ ] 7.5 첫 실전 주말 모니터링: FP 집계 정확성 공식 결과와 대조

- [x] 8.1 브랜드 로고 ✅ HS 모노그램(H 흰색·S 레드 — 워드마크 규칙과 통일), 프로필/뱃지/가로형 3종 + 투명 심볼. 글자는 폰트 조판이라 깨짐 없음
- [x] 8.2 카드 워드마크 소문자화 ✅ 템플릿 13종 `hooni.speed`
- [ ] 8.3 WF-1 스케줄러 활성화 → 매일 09:00 KST 자동 실행 (첫 실전: 8/20 목 더치 GP 프리뷰)

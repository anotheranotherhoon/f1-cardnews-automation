# Proposal: f1-weekend-cardnews

## Why

후니스피드 인스타그램 계정의 F1 카드뉴스(그랑프리 주말 목~월 5회 발행)를 매번 수작업으로 만드는 대신, n8n으로 데이터 수집 → 카드 이미지 생성 → 텔레그램 승인 → 인스타그램 캐러셀 발행까지 자동화한다. 발행 파이프라인의 뒷단(캐러셀 생성/발행 + 텔레그램 승인)은 기존 `carousel_feed.json` 워크플로우로 이미 검증되어 있고, 이번 변경은 그 앞단(콘텐츠 생성)을 완성하는 것이다.

## What Changes

- 매일 09:00 KST cron 트리거로 F1 캘린더(Jolpica-F1 API)를 조회해 레이스 주간 여부, 요일(목/금/토/일/월), 스프린트 여부를 판별하고 해당 콘텐츠 레시피로 분기
- 요일 × 스프린트 여부에 따른 콘텐츠 레시피 (비스프린트 5종 + 스프린트 변형 3종):
  - 목: 프리뷰 (트랙, 타이어 컴파운드, 최근 이슈, 당시 포디움; 스프린트 주간이면 스프린트 포디움 추가)
  - 금: 관전 가이드 (KST 세션 시간표, 팀별 드라이버 라인업)
  - 토: 비스프린트 = FP1·FP2 결과 / 스프린트 = FP1 요약 + 스프린트 퀄리 결과
  - 일: 비스프린트 = 퀄리 결과 + 그리드 / 스프린트 = 스프린트 결과 + 순위 등락 + 퀄리 + 그리드
  - 월: 레이스 총정리 (Top 10, 이슈 + Fastest Lap, DOTD, 타이어 전략, 드라이버/컨스트럭터 순위 등락)
- 하이브리드 카드 렌더링: Gemini(나노바나나) 생성 배경/밈 표지 + HTML/CSS 데이터 오버레이 → browserless(Puppeteer) 스크린샷 → PNG
- 캐릭터 자산 라이브러리: 드라이버 캐릭터를 통일된 화풍으로 1회 생성 후 OCI 서버에 영구 보관, 밈 표지는 저장된 캐릭터를 레퍼런스로 이미지 편집(i2i), 승인된 파생 포즈는 라이브러리에 축적
- 이미지 호스팅: OCI 서버 nginx 정적 서빙 (공개 HTTPS URL), IG 발행(media_publish) 성공 확인 후 파일 삭제
- 텔레그램 승인 업그레이드: 전체 OK/NO → 카드 단위 피드백 루프 (자유 텍스트 수정 지시 → LLM 파싱 → 해당 카드만 재생성/편집 → 재승인, 최대 3회)
- 보안 개선: 기존 워크플로우에 평문 하드코딩된 IG 액세스 토큰을 n8n Credentials로 이전 (토큰 재발급은 하지 않음 — 사용자 결정)

## Capabilities

### New Capabilities

- `race-week-scheduler`: 매일 KST 아침 캘린더를 판독해 레이스 주간/요일/스프린트 여부를 판별하고 콘텐츠 레시피로 분기하는 능력
- `content-data-collection`: Jolpica-F1, OpenF1, 웹서치/LLM에서 요일별 레시피에 필요한 데이터(결과, 순위, 등락, 스틴트, 이슈, DOTD 등)를 수집·정형화하는 능력
- `card-rendering`: 데이터를 하이브리드 방식(생성 배경 + HTML 오버레이)으로 1080×1350 카드 PNG로 렌더링하는 능력
- `character-asset-library`: 드라이버 캐릭터의 화풍 일관성과 재사용을 보장하는 자산 관리 능력
- `approval-feedback-loop`: 텔레그램에서 카드 단위 수정 지시를 받아 선택적 재생성 후 재승인받는 능력
- `image-hosting-lifecycle`: 렌더링된 카드를 공개 URL로 서빙하고 발행 완료 후 정리하는 능력
- `instagram-publishing`: 승인된 카드 세트를 IG 캐러셀로 발행하는 능력 (기존 워크플로우 기반, Credentials 이전 포함)

### Modified Capabilities

(없음 — 기존 OpenSpec 스펙이 존재하지 않는 신규 프로젝트)

## Impact

- **신규 n8n 워크플로우**: 기존 `carousel_feed.json`의 발행 구간을 재사용·확장
- **외부 API**: Jolpica-F1 (무료, 키 불필요), OpenF1 (무료, 키 불필요), Gemini API (키 필요, 운영비 연 3~5만 원 수준), Instagram Graph API, Telegram Bot API
- **인프라**: OCI 서버에 browserless 컨테이너 + nginx 정적 경로 추가, 캐릭터/배경 자산 디렉토리
- **보안**: 모든 시크릿(IG, Telegram, Gemini)의 n8n Credentials 이전 (기존 토큰 유지)
- **미결(v2로 보류)**: 잔여 타이어 카드(FIA PDF 소스), 데이터 카드 피드백의 템플릿 영구 반영 자동화

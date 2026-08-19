# Design: f1-weekend-cardnews

## Context

대상 계정은 인스타그램 `hooni.speed`(후니스피드). 기존 `carousel_feed.json` n8n 워크플로우에 발행 구간(캐러셀 아이템 생성 → 컨테이너 → media_publish + 텔레그램 sendAndWait 승인)이 이미 동작한다. 이번 설계는 그 앞단인 콘텐츠 생성 구간을 채우고, 승인 구간을 카드 단위 피드백 루프로 확장한다.

**환경**: n8n은 OCI 서버에 셀프호스팅 (공개 HTTPS URL 보유 — 텔레그램 웹훅 동작이 증거). 산출물은 n8n 워크플로우 JSON + HTML 템플릿 + 서버 설정이며, 별도 애플리케이션 코드베이스는 만들지 않는다.

**확정된 결정 사항** (탐색 대화에서 합의):
- 하이브리드 렌더링 (Gemini 배경 + HTML 데이터 오버레이)
- OCI 정적 서빙 + 발행 후 삭제
- 매일 09:00 KST 발행, "전날 끝난 세션의 결과" 원칙
- 공식 GP 명칭 사용 (Jolpica `raceName`)
- 카피 톤: 간결 데이터형, 표지만 밈/후킹형
- 캐릭터 연속성: 자산 라이브러리 + 레퍼런스 기반 편집

## Goals / Non-Goals

**Goals:**
- 목~월 5회, 스프린트/비스프린트 분기까지 사람 개입 없이 카드 초안이 텔레그램에 도착
- 순위/데이터 카드의 수치 정확성 100% (LLM이 숫자를 만들지 않음 — API 데이터를 HTML에 그대로 바인딩)
- 캐릭터·화풍의 주간 연속성
- 승인자가 폰에서 자유 텍스트로 카드별 수정 지시 가능

**Non-Goals:**
- 잔여 타이어 카드 (FIA PDF 파싱 — v2)
- 데이터 카드 피드백의 템플릿 영구 반영 자동화 (반복 피드백은 수동으로 템플릿 수정)
- 스토리/릴스 등 캐러셀 외 포맷
- 다국어 지원 (한국어 전용)

## Decisions

### D1. 워크플로우 분할: 메인 1개 + 서브워크플로우 3개

단일 거대 워크플로우 대신 Execute Workflow 노드로 호출되는 구조로 분할한다. n8n에서 반복 사용 구간(렌더링, 승인 루프)을 서브워크플로우로 빼면 테스트·수정이 국소화된다.

```
[WF-1 main-scheduler]        Schedule Trigger 09:00 KST
  ├─ HTTP Request: Jolpica /current.json
  ├─ Code: 요일/스프린트 판별 (전날 세션 기준, 고정 오프셋 아님)
  ├─ Switch: 레시피 분기 (목/금/토-일반/토-스프린트/일-일반/일-스프린트/월/해당없음→종료)
  ├─ [요일별 데이터 수집 브랜치: HTTP Request 노드군 + Code 정형화]
  ├─ Execute Workflow → WF-2 (카드 렌더링)
  ├─ Execute Workflow → WF-3 (승인 루프)
  └─ Execute Workflow → WF-4 (발행 + 정리)

[WF-2 card-renderer]         입력: 카드 정의 배열 [{type, template, data, bgPrompt?}]
  ├─ IF: 생성 배경 필요? → Gemini API 호출 (HTTP Request) → 배경 PNG 저장
  ├─ Code: HTML 템플릿 + 데이터 → 완성 HTML
  ├─ HTTP Request: browserless /screenshot (1080×1350)
  └─ Write Binary File: /var/www/cards/<gp>/<날짜>/card-N.png

[WF-3 approval-loop]         입력: 카드 URL 배열
  ├─ Telegram: 카드 N장 전송 + sendAndWait [✅ 발행 / ✏️ 수정]
  ├─ IF 수정 → Telegram sendAndWait (자유 텍스트)
  │    ├─ Gemini(텍스트): 지시 파싱 → [{card, instruction}]
  │    ├─ 카드 타입별 재생성: 생성이미지 → Gemini i2i 편집 / HTML → 데이터·카피 수정 후 WF-2 재호출
  │    └─ 루프 카운터 (Code): 3회 초과 시 중단 알림 → 종료
  └─ ✅ → 승인된 URL 배열 반환

[WF-4 publisher]             기존 carousel_feed.json 이관·확장
  ├─ Split Out → 아이템 컨테이너 생성 → Wait → 캐러셀 컨테이너 → Wait → media_publish
  ├─ IF publish 성공 → SSH/Execute Command: 카드 파일 삭제
  └─ Telegram: 발행 완료/실패 알림
```

**대안 고려**: 단일 워크플로우 — 노드 60개 이상으로 비대해져 기각. 코드 서비스 분리(Express 등) — n8n 셀프호스팅 + browserless로 충분하며 운영 대상만 늘어나 기각.

### D2. 요일 판별은 "고정 오프셋"이 아니라 "세션 날짜 기준"

`레이스일 - 3 = 목요일` 같은 계산은 라스베이거스 GP(현지 토요일 레이스) 등 변칙 일정에서 깨진다. 대신 Jolpica 캘린더의 각 세션 실제 날짜(FirstPractice, Qualifying, Sprint, ...)를 KST로 변환해 **"어제 KST에 끝난 세션이 무엇인가"**로 오늘의 레시피를 정한다. 목요일 프리뷰만 "FP1 전날"로 정의. 스프린트 여부는 `Sprint` 필드 존재로 판별.

### D3. 데이터 소스 매핑

| 데이터 | 소스 | 비고 |
|---|---|---|
| 캘린더/세션 시각/공식 GP명 | Jolpica `/current.json` | 키 불필요 |
| 과거 포디움·스프린트 포디움 | Jolpica `/{year}/{round}/results.json`, `/sprint.json` | |
| 퀄리·레이스 결과, 그리드, Fastest Lap | Jolpica | |
| 드라이버/컨스트럭터 순위 + 등락 | Jolpica standings — 이번 라운드 vs 직전 라운드 비교 (Code 노드) | |
| FP1·FP2·FP3 순위 | OpenF1 `/sessions` + `/laps` (베스트랩 집계) | Jolpica에 FP 없음 |
| 타이어 스틴트 | OpenF1 `/stints` | |
| 팀별 라인업 | Jolpica drivers + OpenF1 세션 참가자 (FP1 루키 대타 반영) | |
| 트랙 설명 | 정적 JSON (서킷 24개, 1회 작성해 OCI에 보관) | |
| 타이어 컴파운드(작년/올해) | Gemini 웹서치 요약 → 승인 단계 검수 | Pirelli 공식 API 없음 |
| 최근 GP 이슈, DOTD | Gemini 웹서치 요약 → 승인 단계 검수 | LLM 생성 텍스트는 반드시 사람 검수 통과 |

원칙: **숫자·순위는 API에서만, LLM은 문장 요약만.** LLM 산출 텍스트가 들어가는 카드는 승인 단계에서 걸러진다.

### D4. 렌더링: browserless + HTML 템플릿, 1080×1350

- browserless(도커 컨테이너)를 OCI에 추가, n8n에서 `/screenshot` REST 호출 — Puppeteer 코드 관리 불필요
- 템플릿은 self-contained HTML 파일(인라인 CSS, 로컬 폰트)로 `/assets/templates/`에 보관, 약 12종 (표지/트랙/타이어/이슈/포디움/시간표/라인업/세션결과표/그리드/스틴트차트/등락표 × 2)
- 생성 배경은 **base64 data URI로 인라인 임베드** — browserless가 페이지 내 `file://` 요청을 차단하는 것을 확인(구현 중 발견)했고, data URI는 네트워크·파일시스템 의존이 모두 없음
- 사이즈는 IG 세로형 4:5 (1080×1350)

**대안 고려**: 템플릿 SaaS(Bannerbear 등) — 구독료와 외부 의존 대비 이점 없음(셀프호스팅 가능하므로) 기각. 이미지 생성만으로 전체 카드 제작 — 한글·수치 정확성 보장 불가로 기각(탐색 단계 합의).

### D5. 캐릭터 자산 라이브러리

```
/var/www/assets/characters/<driver-id>/
  ├─ base.png          # 승인된 원본 (투명배경, 통일 화풍)
  └─ poses/*.png       # 승인된 파생 포즈 (자산 축적)
/var/www/assets/backgrounds/<circuit-id>/*.png   # 재사용 배경
```

- 모든 캐릭터 생성에 동일한 스타일 가이드 프롬프트 상수를 접두 (화풍 통일)
- 밈 표지: base.png(또는 적합한 pose)를 Gemini에 레퍼런스 이미지로 전달 + 상황 지시 → i2i 편집
- 승인 루프에서 OK된 신규 포즈는 poses/에 자동 저장 → 생성 의존도 점진 감소
- 신규 드라이버 첫 등장 시: base 없으면 생성 → 텔레그램 승인 → 저장 (lazy 생성, 시즌 전 일괄 구축 불요)

### D6. 이미지 라이프사이클

(구현 확정) 기존 flutter-web nginx 컨테이너의 정적 루트를 재활용 — 호스트 `/home/ubuntu/flutter-web/web/hooni-cards/`가 `https://xrp-admin.p-e.kr/hooni-cards/...`로 서빙됨 (nginx 설정 변경 없음). n8n 컨테이너에는 `/data/cards`(발행분)와 `/data/hooni_speed`(자산·템플릿)로 마운트. IG는 media_publish 시점에 이미지를 자체 복사하므로, **publish 성공 응답 확인 후** 해당 발행분 디렉토리를 삭제한다 (assets는 영구 보관). 실패 시 삭제하지 않고 텔레그램 알림 — 수동 재시도 가능하게 파일 유지. 참고: 서버 ubuntu는 uid 1001, n8n node는 uid 1000이라 공유 디렉토리는 그룹 1000 + setgid로 관리.

### D7. 시크릿 관리

IG 액세스 토큰(현재 워크플로우 JSON에 평문), Telegram 봇, Gemini API 키를 전부 n8n Credentials로 이전. 기존 IG 토큰은 재발급하지 않고 그대로 이전한다(사용자 결정 — 워크플로우 파일이 외부 공유된 적 없어 노출 리스크 낮음). 워크플로우 JSON 내 Set 노드에는 비밀이 아닌 설정값(igUserId, chatId, 도메인, 경로)만 남긴다.

## Risks / Trade-offs

- [Jolpica 데이터 반영 지연 (커뮤니티 운영)] → 09:00 KST는 세션 종료 후 8시간 이상 여유. 그래도 데이터가 비어 있으면(직전 라운드와 동일 등) 발행 중단 + 텔레그램 알림, 수동 재실행
- [OpenF1 FP 베스트랩 집계 부정확 (트래픽/삭제랩)] → 공식 FP 결과와 초기 몇 주 수동 대조, 필요시 보정 로직 추가
- [Gemini 캐릭터 편집의 일관성 드리프트] → 항상 base/pose 레퍼런스 첨부 + 승인 루프가 최종 방어선. 승인된 포즈 축적으로 생성 빈도 자체를 감소
- [LLM 요약(이슈/DOTD/컴파운드)의 사실 오류] → 해당 카드는 승인 단계 필수 검수 대상으로 명시, 프롬프트에 출처 표기 요구
- [n8n sendAndWait 다중 왕복(수정 루프)의 상태 관리 복잡성] → 루프 상태(회차, 카드별 상태)를 workflow static data가 아닌 아이템 JSON으로 전달해 단순화, 최대 3회 하드리밋
- [browserless 컨테이너 다운] → 렌더링 실패 시 텔레그램 알림, WF-1 재실행으로 복구 (멱등: 같은 날 재실행하면 덮어쓰기)
- [캐러셀 10장 제한] → 레시피 설계상 최대 7장. Code 노드에서 10장 초과 시 하드 에러

## Migration Plan

1. OCI 서버: browserless 컨테이너 + nginx `/cards`, `/assets` 경로 추가 (기존 n8n 무중단)
2. WF-4를 기존 `carousel_feed.json` 복제로 시작 — 기존 워크플로우는 전체 검증 완료까지 보존
3. 시크릿 이전 및 IG 토큰 재발급은 신규 워크플로우 전환 시점에 수행
4. 롤백: 신규 워크플로우 비활성화 + 기존 수동 프로세스 복귀 (파괴적 변경 없음)

## Open Questions

- 캐릭터 화풍 (치비/플랫 카툰/캐리커처) — 구현 초기에 동일 프롬프트로 후보 생성 후 사용자가 선택
- 토요일 "관찰 포인트" 카드(LLM 한 줄 분석) 포함 여부 — v1에서는 제외하고 시작, 운영하며 판단
- Gemini API 유료 전환 시점 — 무료 티어로 개발, 실운영 첫 주 전에 결제 연결

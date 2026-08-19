# Spec: card-rendering

## ADDED Requirements

### Requirement: 하이브리드 카드 렌더링
시스템은 카드를 HTML 템플릿(데이터/텍스트 레이어) + 선택적 Gemini 생성 배경으로 구성하고, browserless 스크린샷으로 1080×1350 PNG를 산출해야 한다(SHALL).

#### Scenario: 데이터 카드 렌더링
- **WHEN** 퀄리 결과 데이터와 템플릿 ID가 렌더러에 전달됨
- **THEN** 데이터가 바인딩된 HTML이 browserless로 렌더링되어 1080×1350 PNG가 생성된다

#### Scenario: 밈 표지 렌더링
- **WHEN** 표지 카드에 생성 배경 프롬프트가 지정됨
- **THEN** Gemini로 배경을 생성한 뒤 HTML 레이어와 합성해 렌더링한다

### Requirement: 렌더링의 외부 네트워크 독립성
렌더링 시점의 HTML은 self-contained여야 하며(MUST) — 인라인 CSS, 로컬 폰트, 파일시스템 경로의 이미지 — 외부 URL 로딩에 의존해서는 안 된다(MUST NOT).

#### Scenario: 외부 CDN 불가용 상황
- **WHEN** 렌더링 시점에 외부 네트워크가 느리거나 불가용함
- **THEN** 카드 렌더링 결과물은 영향 없이 동일하게 산출된다

### Requirement: 카피 톤 규칙
데이터 카드의 텍스트는 간결 데이터형(표·수치 중심, 문장 최소화)이어야 하고(SHALL), 밈/후킹형 비주얼은 표지 카드(목요일 프리뷰, 월요일 총정리)에만 적용되어야 한다(SHALL).

#### Scenario: 월요일 카드 세트
- **WHEN** 총정리 카드 세트를 생성
- **THEN** 표지 1장만 밈 스타일이고 나머지 카드는 데이터 중심 레이아웃이다

### Requirement: 캐러셀 장수 상한
한 발행분의 카드 수는 10장을 초과해서는 안 된다(MUST NOT). 초과가 감지되면 렌더링 단계에서 하드 에러로 중단한다.

#### Scenario: 레시피 오류로 11장 생성 시도
- **WHEN** 카드 정의 배열이 11개로 전달됨
- **THEN** 렌더링 전에 에러로 중단되고 텔레그램 알림이 전송된다

### Requirement: 재사용 배경 우선
데이터 카드 배경은 서킷별 저장 배경(`assets/backgrounds/<circuit-id>/`)이 있으면 재사용해야 하며(SHALL), 없을 때만 신규 생성 후 저장한다.

#### Scenario: 두 번째 시즌의 같은 서킷
- **WHEN** 해당 서킷의 승인된 배경이 이미 존재
- **THEN** Gemini 호출 없이 저장된 배경으로 렌더링한다

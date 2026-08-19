# Spec: instagram-publishing

## ADDED Requirements

### Requirement: 승인된 카드의 캐러셀 발행
시스템은 승인된 카드 URL 배열을 순서대로 IG 캐러셀(아이템 컨테이너 → 캐러셀 컨테이너 → media_publish)로 발행해야 한다(SHALL). 캡션에는 공식 GP 명칭과 계정 해시태그가 포함된다.

#### Scenario: 7장 캐러셀 발행
- **WHEN** 월요일 총정리 7장이 승인됨
- **THEN** hooni.speed 계정에 7장 캐러셀이 카드 순서대로 발행된다

### Requirement: 발행 결과 통보
발행 성공/실패 여부는 텔레그램으로 통보되어야 한다(SHALL). 실패 시 오류 응답 내용을 포함한다.

#### Scenario: 발행 성공
- **WHEN** media_publish 성공
- **THEN** 게시물 정보가 포함된 완료 알림이 전송된다

### Requirement: 시크릿의 Credentials 관리
IG 액세스 토큰, Telegram 봇 토큰, Gemini API 키는 n8n Credentials(또는 환경변수)로 관리되어야 하며(MUST), 워크플로우 JSON에 평문으로 포함되어서는 안 된다(MUST NOT). 기존 IG 토큰은 재발급 없이 Credentials로 이전한다(사용자 결정).

#### Scenario: 워크플로우 내보내기
- **WHEN** 워크플로우 JSON을 내보내 공유
- **THEN** JSON에는 어떤 시크릿도 평문으로 포함되지 않는다

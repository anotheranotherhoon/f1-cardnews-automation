# Spec: image-hosting-lifecycle

## ADDED Requirements

### Requirement: 공개 HTTPS URL 서빙
렌더링된 카드는 OCI 서버의 nginx 정적 경로를 통해 공개 HTTPS URL로 접근 가능해야 한다(MUST). Instagram Graph API가 해당 URL에서 이미지를 가져갈 수 있어야 한다.

#### Scenario: IG 컨테이너 생성
- **WHEN** 카드 URL이 IG media 엔드포인트에 전달됨
- **THEN** 인스타그램 서버가 URL에 접근해 이미지를 성공적으로 가져간다

### Requirement: 발행 완료 후 삭제
발행분 카드 파일은 media_publish 성공 응답을 확인한 뒤에만 삭제되어야 한다(MUST). 발행 실패 시 파일을 유지하고 텔레그램으로 알린다(SHALL).

#### Scenario: 정상 발행
- **WHEN** media_publish가 성공 응답을 반환
- **THEN** 해당 발행분 디렉토리가 삭제되고 완료 알림이 전송된다

#### Scenario: 발행 실패
- **WHEN** media_publish가 실패
- **THEN** 카드 파일은 삭제되지 않고 수동 재시도가 가능한 상태로 유지된다

### Requirement: 자산과 발행물의 분리
캐릭터·배경 자산(`assets/`)은 영구 보관 대상이며 발행 후 삭제 대상은 발행분 카드(`cards/<gp>/<날짜>/`)에 한정되어야 한다(MUST).

#### Scenario: 발행 후 정리
- **WHEN** 발행 완료 후 정리 단계가 실행됨
- **THEN** cards/ 하위 해당 발행분만 삭제되고 assets/는 변경되지 않는다

### Requirement: 재실행 멱등성
같은 날짜의 발행분을 재실행하면 기존 파일을 덮어써야 하며(SHALL) 중복 디렉토리·파일이 누적되어서는 안 된다(MUST NOT).

#### Scenario: 데이터 지연 후 수동 재실행
- **WHEN** 오전 실행이 데이터 미반영으로 중단된 뒤 오후에 수동 재실행됨
- **THEN** 동일 경로에 카드가 새로 생성되어 이전 부분 산출물을 대체한다

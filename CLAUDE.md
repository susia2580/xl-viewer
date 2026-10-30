# xl-viewer

브라우저용 읽기 전용 xlsx 뷰어 라이브러리. Canvas(셀 그리드) + DOM 오버레이(메모, 이미지, 차트, 탭).

- 설계: [docs/01-design.md](docs/01-design.md) — 구현의 기준. 설계와 다르게 구현해야 하면 먼저 문서를 고치고 이유를 남긴다.
- 공개 절차: [docs/02-open-source-guide.md](docs/02-open-source-guide.md)
- 기준 파일: `fixtures/numbers/sales-report.xlsx` (Apple Numbers 생성, 가짜 데이터, 분석은 설계 5.6절). Excel 캡처: `fixtures/reference/sales-report.*.excel.png`
  - 이 파일들은 한글이 들어 있어 git에서 제외했다(`.gitignore`). 로컬에만 있고, 없으면 관련 테스트와 시각 회귀 케이스는 건너뛴다.
- 진행 단계: 0~4단계 기능 구현 완료, 시각 회귀 기준 이미지 승인과 5단계(배포) 남음 (설계 13장 진행 상태 표)

## 작업 방식

- 한 세션에 설계 13장의 한 단계(또는 그 일부)만 다룬다.
- 렌더링을 바꾸면 스크린샷을 찍어 `fixtures/reference/`의 Excel 캡처와 직접 비교한 뒤 완료라고 말한다.
- 파서를 바꾸면 해당 fixture의 스냅샷 테스트를 먼저 쓰거나 갱신한다.

## 명령어

- `pnpm dev` (playground, http://localhost:5199), `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`
- `pnpm shot <fixture> [--sheet N] [--mouse x,y] [--scroll x,y] [--browser webkit]` → `.shots/`에 PNG. Chromium은 `channel: "chromium"`으로 실행
- `pnpm size`, `pnpm perf`(먼저 `pnpm fixtures -- --large`), `node scripts/consumer-check.mjs`
- `pnpm fixtures` (fixture 재생성), `pnpm visual:docker` (시각 회귀, Docker 필요)
- 이 Mac에서는 Playwright Firefox가 실행되지 않는다(프로필 폴더 오류). Firefox는 CI 컨테이너에서 확인

## 코드 규칙

- 코드, 주석, 커밋 메시지, 이슈·PR은 영어. 응답과 설계 문서는 한국어.
- 주석은 짧게, 필요한 곳에만. 코드를 다시 설명하는 주석이나 AI가 쓴 티가 나는 주석(장황한 설명, 단계 번호 나열)을 쓰지 않는다. 이 규칙은 전역 규칙의 "코드 주석 한국어"보다 우선한다.
- 이모지 금지 (코드, 주석, 로그, UI).
- TypeScript strict. 공개 API 변경은 설계 10장과 맞춘다.
- 화면에 보이는 문구는 언어셋(`packages/core/src/locales/`)으로만 넣는다. 하드코딩 금지. 오류·경고 메시지는 영어 고정 + `code` (설계 10.4, 11장).

## 반드시 지킬 것

- 수식을 계산하지 않는다. 저장된 `<v>`만 쓴다.
- XML 요소는 네임스페이스 URI + 로컬 이름으로 식별한다. 접두어(`c:`, `x:`)에 의존하지 않는다.
- 파트 경로를 하드코딩하지 않는다. 항상 rels를 따라간다.
- 파일 내용(셀, 메모, 차트 제목, 시트 이름)은 `textContent`로만 DOM에 넣는다. `innerHTML` 금지.
- XML의 DTD와 외부 엔티티를 처리하지 않는다.
- 클린룸: SpreadJS 등 상용 라이브러리의 코드를 열람·분석·역분석하지 않는다(리버스 엔지니어링 도구 포함). 참고 자료는 ECMA-376, Microsoft 공개 문서([MS-OI29500] 등), 허용형 라이선스 오픈소스로 한정한다.

## 보안 (설계 5.7)

- ZIP 결과는 `Object.keys`로만 순회한다(`for...in` 금지).
- 파일에서 온 문자열은 CSS(글꼴 이름 등)나 HTML(툴팁)에 넣기 전에 `fontFamily`/`escapeHtml` 같은 정화 함수를 거친다.
- 파일 크기에 비례하지 않는 비용(범위 증폭, 병합·규칙 수)은 상한을 둔다. `security.test.ts`에 회귀 테스트를 추가한다.

## 데이터와 의존성

- xlsx는 `fixtures/generated/`(스크립트로 만든 가짜 데이터)만 커밋한다. 나머지는 `.gitignore`가 막는다. 예외를 추가하려면 사용자 확인을 받는다.
- 실제 업무 파일의 내용을 fixture, 테스트, 문서로 옮기지 않는다.
- 의존성 추가 전: 라이선스 확인(GPL·AGPL 금지), `pnpm audit`, 번들 크기 목표(설계 3.5절) 영향 확인.
- fixture 생성 스크립트는 `.venv/bin/python`으로 실행한다(openpyxl 설치됨).

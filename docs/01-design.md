# xl-viewer 설계 문서

xlsx 파일을 브라우저에서 "보기만" 하는 경량 뷰어 라이브러리의 설계 문서.

| 항목 | 내용 |
|---|---|
| 패키지 이름(가칭) | `xl-viewer` — 코어 `@xl-viewer/core`, Vue 래퍼 `@xl-viewer/vue` |
| 문서 상태 | v0.4 (2026-10-28, 0~4단계 구현 후 실측과 구현 결과 반영. 변경 이력은 16장) |
| 대상 독자 | 이 패키지를 구현하고 유지보수할 개발자 |

> 이름에 "Excel"을 넣지 않는다. Microsoft 상표이므로 오픈소스 배포 시 문제가 될 수 있다.
> npm에서 `xl-viewer`, `@xl-viewer/core` 이름이 비어 있음을 확인했다(2026-10-28). 스코프(`@xl-viewer`)는 npm 조직을 만들어야 확보된다.

---

## 1. 목표와 범위

### 1.1 목표
- xlsx 파일을 열어 셀 값, 서식, 병합, 메모(주석), 이미지, 차트를 그린다.
- 편집 기능 없이 보기 기능만 제공해서 가능한 한 가볍게 만든다.
- Excel 화면과 눈으로 비교했을 때 위화감이 없는 수준을 목표로 한다. 픽셀 단위 일치는 목표가 아니다.

### 1.2 확정된 결정

| # | 항목 | 결정 |
|---|---|---|
| D1 | 렌더링 방식 | 혼합. 셀 그리드(배경, 눈금선, 테두리, 텍스트, 머리글, 메모 표시)는 Canvas, 메모 상자·이미지·차트·시트 탭은 DOM 오버레이 |
| D2 | 차트 라이브러리 | Apache ECharts (필요한 모듈만, 동적 import) |
| D3 | 지원 형식 | `.xlsx`만 (`.xlsm`은 매크로를 무시하고 xlsx로 처리) |
| D4 | 재현 수준 | 눈으로 비교했을 때 위화감 없는 수준 |
| D5 | 상호작용 | 셀 선택, 복사, 검색, 확대·축소, 하이퍼링크 클릭 모두 없음. 메모 확인용 마우스 오버만 지원 |
| D6 | 배포 형태 | 별도 npm 패키지, 오픈소스 공개 |
| D7 | 라이선스 | MIT |
| D8 | 지원 브라우저 | Chrome, Edge, Safari, Firefox 각각 최근 2개 메이저 버전. browserslist: `last 2 Chrome versions, last 2 Edge versions, last 2 Safari major versions, last 2 Firefox versions`. 빌드 대상 `es2022` |
| D9 | Worker 배포 | 기본은 인라인 Worker(Blob URL), 옵션으로 별도 파일 지정, 실패 시 메인 스레드 파싱 (10.3절) |
| D10 | 화면 문구 언어 | 언어셋 파일을 분리하고 `locale` 옵션으로 적용. 영어(기본), 한국어 제공 (10.4절) |
| D11 | 코드 주석 | 영어. 짧고 간결하게, 필요한 곳에만 |

A3에서 `ssf`를 쓰지 않는 이유: npm의 `ssf` 최신 버전은 0.11.2이고 2022-06 이후 갱신이 없다(2026-10-28 확인). SheetJS 계열은 npm 배포를 중단하고 자체 CDN으로 옮겼다.

D1을 혼합 방식으로 정한 이유:
- D5로 선택, 복사, 검색을 뺐기 때문에 DOM 방식의 주된 장점(브라우저 기본 텍스트 선택·복사·찾기)이 필요 없어졌다.
- Canvas는 셀 수와 관계없이 화면 크기만큼만 그리므로 대용량 시트에서도 성능이 일정하다. 셀 경계를 넘는 눈금선, 테두리, 텍스트 넘침도 픽셀 단위로 그릴 수 있다.
- 이미지와 차트는 브라우저와 ECharts가 이미 잘 그리므로 DOM으로 띄운다. 메모 상자와 시트 탭도 DOM이 구현하기 쉽다.
- 주요 스프레드시트 제품(SpreadJS, Univer, Google Sheets 등)도 셀 영역을 Canvas로 그린다.

### 1.3 이 문서에서 정한 기본값 (변경 가능)

| # | 항목 | 기본값 | 이유 |
|---|---|---|---|
| A1 | XML 파서 | 자체 토크나이저 `parser/xml-scan.ts` (스트리밍, 네임스페이스 인식, DTD 거부) | Web Worker에서는 `DOMParser`를 쓸 수 없음. `saxes`는 10만 행 시트(75MB XML) 토큰화에 1.3초가 걸려 A5를 넘겼다. 자체 토크나이저는 같은 작업이 약 0.6초다(16장) |
| A2 | ZIP 해제 | `fflate` | 약 8KB, MIT |
| A3 | 숫자 서식 | `numfmt` | Excel 서식 코드 구현체, MIT, 활발히 관리됨(4.1.1, 2026-10). 로케일 지원. 내부 인터페이스(`format/number.ts`)로 감싸 교체 가능하게 둠. gzip 27KB이고 로케일 데이터를 떼어낼 수 없다(진입점이 하나뿐). 3.5절 예산을 이에 맞춰 조정 |
| A4 | 파일 크기 상한 | 입력 20MB, 압축 해제 합계 200MB | ZIP 폭탄 방어. 옵션으로 조정 가능 |
| A5 | 성능 목표 | 10만 행 × 20열 파일을 일반 노트북에서 3초 이내 파싱, 스크롤 60fps | 실측(M1 Pro, Chromium, 1920×1080): 열기(파싱 + Worker 전송 + 첫 그리기) 2.5~2.7초, 프레임 그리기 평균 3.8ms·최대 5ms. `pnpm perf`로 재측정 |
| A6 | 1차 지원 차트 | 세로/가로 막대(묶은·누적·100% 누적), 꺾은선, 원형, 도넛, 영역, 분산형 | 업무 문서에서 가장 흔한 종류 |

### 1.4 범위 밖 (명시적으로 하지 않음)
- 편집, 수식 계산, 저장
- `.xls`(BIFF 바이너리), `.xlsb`, `.ods`, `.csv`
- 암호화된 파일, Strict OOXML 형식 (감지해서 안내 메시지만 표시)
- 매크로(VBA), 외부 데이터 연결, 피벗 테이블 재계산
- 인쇄 레이아웃, 머리글/바닥글
- 오른쪽에서 왼쪽(RTL) 시트

---

## 2. 핵심 원칙

1. **계산하지 않는다.** 수식 셀은 Excel이 저장해 둔 결과값(`<v>`)을 그대로 보여준다. 수식 엔진이 없으므로 가볍다.
2. **보이는 것만 그린다.** 셀 그리드는 화면 크기의 Canvas 하나에 보이는 영역만 그린다. 이미지와 차트도 화면에 걸친 것만 DOM에 붙인다.
3. **무거운 것은 필요할 때만 불러온다.** 차트 모듈(ECharts)은 파일에 차트가 있을 때만 동적 import 한다.
4. **파싱은 메인 스레드 밖에서 한다.** Web Worker에서 파싱해서 화면이 멈추지 않게 한다.
5. **생성 도구마다 다른 파일을 가정한다.** Excel뿐 아니라 openpyxl, exceljs, Google Sheets, LibreOffice가 만든 파일도 열려야 한다(5.6절 참고).

---

## 3. 프로젝트 구성

### 3.1 저장소 구조 (pnpm workspace 모노레포)

```
xl-viewer/
├── packages/
│   ├── core/                  @xl-viewer/core  (프레임워크 무관, TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts           공개 API
│   │   │   ├── parse.ts           parseXlsx (렌더링 없이 모델만)
│   │   │   ├── errors.ts          오류 타입, Worker 경계용 직렬화
│   │   │   ├── parser/            xlsx → WorkbookModel
│   │   │   │   ├── index.ts       파트 조립, 참조 해석, 경고
│   │   │   │   ├── zip.ts         형식 검사, 해제, 크기 상한
│   │   │   │   ├── package.ts     OPC 파트, rels 경로 해석
│   │   │   │   ├── xml-scan.ts    자체 XML 토크나이저
│   │   │   │   ├── xml.ts         트리 빌더, 네임스페이스 상수
│   │   │   │   ├── workbook.ts    시트 목록, date1904, 이름 정의
│   │   │   │   ├── shared-strings.ts  서식 있는 텍스트 수집기(공유·인라인·메모 공용)
│   │   │   │   ├── styles.ts / theme.ts
│   │   │   │   ├── sheet.ts       시트 스트리밍 파싱, 셀 서식 적용
│   │   │   │   ├── cf.ts          조건부 서식 평가
│   │   │   │   ├── comments.ts    메모, VML, 스레드 댓글
│   │   │   │   ├── drawing.ts     이미지/차트 앵커
│   │   │   │   ├── drawingml.ts   DrawingML 색·선·글꼴
│   │   │   │   └── chart.ts       chartN.xml → ChartModel
│   │   │   ├── model/types.ts     데이터 모델 (6장의 원본)
│   │   │   ├── format/            숫자 서식, 색상, 단위, 셀 주소, 글꼴 대체
│   │   │   ├── render/
│   │   │   │   ├── viewer.ts      조립, 스크롤·크기·배율 변경, 메모 오버 판정
│   │   │   │   ├── layout.ts      행/열 누적 위치, 이진 탐색, 앵커 → 좌표
│   │   │   │   ├── panes.ts       틀 고정 영역(최대 4개) 계산
│   │   │   │   ├── mdw.ts         기본 글꼴 숫자 폭(MDW)
│   │   │   │   ├── theme.ts       ViewerTheme 기본값
│   │   │   │   ├── tabs.ts        시트 탭 (DOM)
│   │   │   │   ├── canvas/        painter.ts, text.ts, border.ts, icons.ts
│   │   │   │   └── overlay/       panes.ts(영역별 잘라내기 층), notes.ts, drawings.ts(이미지·차트)
│   │   │   ├── chart/             options.ts(ECharts 옵션), scale.ts(Excel 축 눈금), render.ts (동적 import 대상)
│   │   │   ├── locales/           en.ts(기본 포함), ko.ts(별도 진입점), types.ts
│   │   │   └── worker/            parser.worker.ts, client.ts(로딩·폴백), protocol.ts
│   │   ├── build/worker-plugin.ts 인라인 Worker 번들링 Vite 플러그인
│   │   └── styles/xl-viewer.css
│   └── vue/                   @xl-viewer/vue  (Vue 3 래퍼)
├── apps/
│   └── playground/            Vite + Vue 데모, 시각 회귀 테스트(tests/)
├── fixtures/
│   ├── scripts/               생성 스크립트 (openpyxl)
│   ├── generated/             스크립트로 만든 xlsx (perf/는 git 제외)
│   ├── excel/, numbers/       기준 파일 sales-report (가짜 데이터, git 예외)
│   └── reference/             Excel 화면 캡처
├── scripts/                   shot, perf, size, consumer-check, visual-docker
├── tests/visual.Dockerfile    시각 회귀 고정 환경
├── local/                     git 제외. 공개할 수 없는 파일과 그 캡처
└── docs/
```

### 3.2 코어와 래퍼를 나누는 이유
- 코어는 Vue에 의존하지 않으므로 React, 순수 JS에서도 쓸 수 있다.
- Vue 래퍼는 코어의 `createViewer`를 마운트하고 해제하는 얇은 컴포넌트다.

### 3.3 개발 도구

| 용도 | 도구 |
|---|---|
| 패키지 관리 | pnpm workspace |
| 빌드 | Vite 라이브러리 모드 (ESM 출력, `.d.ts` 생성) |
| 단위 테스트 | Vitest |
| 시각 회귀 테스트 | Playwright 스크린샷 비교 |
| 버전/변경 기록 | Changesets |
| 린트/포맷 | ESLint, Prettier |

### 3.4 배포 형태
- ESM만 배포한다. CJS는 제공하지 않는다.
- `package.json`의 `sideEffects`는 CSS 파일만 지정해서 트리 셰이킹이 되게 한다.
- `echarts`는 `@xl-viewer/core`의 의존성으로 두되, 차트 모듈 안에서만 동적 import 한다. 차트 없는 파일을 열 때는 ECharts가 로드되지 않는다.

### 3.5 번들 크기 목표 (gzip 기준)

| 청크 | 예산 | 실측 (2026-10-28) |
|---|---|---|
| 코어 (파서 + 렌더러, 차트 제외. 인라인 Worker 문자열 포함) | 68KB 이하 (최초 목표 60KB) | 66.0KB |
| 차트 청크 (ECharts 필요 모듈 포함) | 250KB 이하 | 189.5KB |
| Vue 래퍼 | 3KB 이하 | 0.6KB |
| 메인 스레드 폴백용 파서 청크 (Worker 실패 시에만 로드) | 예산 없음 | 46.6KB |

- 코어 예산을 68KB로 올린 이유(최초 60KB → 65KB → 68KB): v0.4.2에서 도형·텍스트 상자 렌더링과 행·열 크기 조절을 넣어 1.5KB가 늘었다. 기존 항목: 인라인 Worker(gzip 54KB) 중 `numfmt`가 27KB이고, `numfmt`는 로케일 데이터를 떼어낼 수 없다. 나머지는 렌더러(약 8KB), 파서(약 12KB), `fflate`.
- `pnpm size`가 사용하는 쪽 프로젝트처럼 번들링한 뒤 gzip 크기를 재고, 예산을 넘으면 CI를 실패시킨다.

---

## 4. 전체 흐름

```
 [File/ArrayBuffer]
        │
        ▼
 ┌──────────── Web Worker ────────────┐
 │ 1. 형식 검사 (ZIP 시그니처, 암호화) │
 │ 2. ZIP 해제 (fflate, 크기 상한)     │
 │ 3. rels 따라가며 파트 파싱          │
 │ 4. WorkbookModel 생성              │
 └──────────────┬─────────────────────┘
                │ postMessage (구조화 복제, 이미지는 ArrayBuffer transfer)
                ▼
 ┌──────────── 메인 스레드 ────────────┐
 │ 5. 스타일 → Canvas 글꼴·색 캐시    │
 │ 6. 레이아웃 계산 (행/열 누적 위치)  │
 │ 7. Canvas에 가시 영역 그리기        │
 │ 8. DOM 오버레이 (메모, 이미지)      │
 │ 9. 차트 있으면 ECharts 동적 로드    │
 └────────────────────────────────────┘
```

시트는 처음 열 때 첫 번째 보이는 시트만 렌더링한다. 다른 시트는 탭을 누를 때 렌더링한다. 파싱은 전체 시트를 한 번에 한다(v1). 시트별 지연 파싱은 성능 측정 후 검토한다.

---

## 5. 파서 설계

### 5.1 파일 형식 검사
| 앞 4바이트 | 의미 | 처리 |
|---|---|---|
| `50 4B 03 04` | ZIP (xlsx) | 계속 진행 |
| `D0 CF 11 E0` | CFB 컨테이너 (`.xls` 또는 암호화된 xlsx) | `UnsupportedFormatError` |
| 그 외 | 알 수 없음 | `InvalidFileError` |

`[Content_Types].xml`과 `_rels/.rels`가 없으면 `InvalidFileError`. 문서 요소(루트)의 네임스페이스가 `http://purl.oclc.org/ooxml/`로 시작하면 Strict OOXML이므로 `UnsupportedFormatError`. 파트 이름은 대소문자를 구분하지 않으므로 소문자로 정규화해 찾는다.

### 5.2 파트 탐색 순서
경로를 하드코딩하지 않고 항상 rels 파일을 따라간다. 생성 도구마다 경로가 다르기 때문이다(예: openpyxl로 만든 파일은 메모가 `xl/comments/comment1.xml`에 있지만 Excel과 Numbers는 `xl/comments1.xml`에 둔다).

```
_rels/.rels → xl/workbook.xml
xl/_rels/workbook.xml.rels → sharedStrings, styles, theme, 각 worksheet
xl/worksheets/_rels/sheetN.xml.rels → comments, vmlDrawing(메모), drawing, hyperlink
xl/drawings/_rels/drawingN.xml.rels → chart, image
```

### 5.3 XML 처리 원칙
- 요소는 네임스페이스 URI + 로컬 이름으로 식별한다. 접두어(`c:`, `x:`)에 의존하지 않는다.
  - 근거: Excel은 `<c:lineChart>`, openpyxl은 접두어 없이 `<lineChart>`로 쓴다(이전 테스트 파일에서 확인).
- 자체 토크나이저(`xml-scan.ts`)로 스트리밍 파싱한다. 시트 XML은 수십 MB가 될 수 있으므로 DOM 트리를 만들지 않는다. 작은 파트(workbook, styles, theme, drawing, chart, rels)만 가벼운 트리로 만든다.
- 토크나이저는 검증하지 않는(non-validating) 파서다. 처리하는 것: 네임스페이스 범위, 미리 정의된 엔티티와 문자 참조, CDATA, 주석·처리 명령 건너뛰기, XML 1.0 줄바꿈 정규화(`\r\n` → `\n`), 태그 짝 검사. 알 수 없는 엔티티는 글자 그대로 둔다.
- DTD와 외부 엔티티는 처리하지 않는다. `<!DOCTYPE`를 만나면 `ParseError`(보안).

### 5.4 파트별 처리

**workbook.xml**
- 시트 목록: 이름, `r:id`, `state` (`hidden`, `veryHidden`이면 탭에 표시하지 않음).
- `workbookPr/@date1904`: 날짜 기준(1900/1904) 결정.
- `definedNames`: 차트 참조가 이름 정의를 쓸 때 해석용.

**sharedStrings.xml**
- `<si>`의 `<t>` 또는 `<r>`(서식 있는 텍스트 조각) 목록.
- `<rPh>`(일본어 후리가나 등 발음 표기)는 반드시 건너뛴다. 포함하면 글자가 중복된다.
- `_xHHHH_` 이스케이프(예: `_x000D_`)를 실제 문자로 복원한다.
- sharedStrings가 없는 파일도 정상이다(openpyxl로 만든 파일은 inlineStr만 사용).

**styles.xml**
- `numFmts`, `fonts`, `fills`, `borders`, `cellXfs`를 읽는다.
- `cellXfs`의 각 항목을 "해석된 스타일"(색은 최종 RGB, 글꼴은 CSS 값)로 변환해 `StyleTable`을 만든다. 셀은 스타일 인덱스만 갖는다.
- `cellStyleXfs` 상속: `cellXfs`에서 `applyXxx="0"`이 명시된 경우에만 부모 스타일의 값을 쓴다. 속성이 없으면 `cellXfs` 자신의 값을 쓴다.
- `dxfs`(조건부 서식용): 단색 채우기의 색이 `fgColor`가 아니라 `bgColor`에 있다(일반 `fills`와 반대).
- 패턴 채우기(`gray125`, `darkGray` 등)는 무늬를 그리지 않고 전경·배경색을 농도만큼 섞은 단색으로 근사한다. 그라데이션 채우기는 양 끝 색의 중간색.

**theme1.xml**
- `clrScheme`의 12색(dk1, lt1, dk2, lt2, accent1~6, hlink, folHlink)과 주 글꼴(major/minor font)을 읽는다.

**sheetN.xml**
- `sheetFormatPr`: 기본 행 높이, 기본 열 너비.
- `cols`: 열 너비, 숨김, 열 단위 기본 스타일. `min`~`max` 범위 그대로 보관하고 열마다 펼치지 않는다. `max="16384"`(시트 끝까지)인 파일이 흔하다(sales-report에서 확인). `colCount`는 `cols`가 아니라 셀 데이터와 병합, 도형 위치로 정한다.
- `sheetData/row`: 행 높이(`ht`), 숨김, 행 단위 기본 스타일(`customFormat="1"`일 때만). Excel은 자동 맞춤된 높이도 `ht`에 저장하므로 `customHeight`와 관계없이 `ht`를 쓴다.
- `c` 셀: 주소(`r`), 스타일(`s`), 타입(`t`), 값(`v`), 인라인 문자열(`is`). 수식(`f`)은 무시하고 `v`만 쓴다. 동적 배열 수식의 `cm` 속성과 `metadata.xml`도 무시한다.
- `mergeCells`, `sheetViews`(눈금선 표시 여부, 틀 고정, 배율, 활성 셀), `hyperlinks`(스타일만 표시), `legacyDrawing`, `drawing`, `conditionalFormatting`(4단계).
- 셀 주소(`r`)가 생략된 파일도 있다. 이전 셀 다음 열로 계산한다.

셀 타입 처리:

| `t` 값 | 의미 | 표시 |
|---|---|---|
| 없음 또는 `n` | 숫자 | 숫자 서식 적용 |
| `s` | 공유 문자열 인덱스 | sharedStrings에서 조회 |
| `inlineStr` | 셀 안 문자열 | `<is>` 내용 |
| `str` | 수식 결과 문자열 | `<v>` 그대로 |
| `b` | 불리언 | `TRUE` / `FALSE` |
| `e` | 오류 | `#DIV/0!` 등 그대로 |
| `d` | ISO 8601 날짜 | 일련번호로 변환 후 서식 적용 |

수식이 있는데 `<v>`가 없으면 빈 셀로 표시한다. `onWarning`으로 "결과값 없는 수식 N개"를 알린다.

**comments + VML (메모)**
- `commentsN.xml`: 셀 주소, 작성자, 서식 있는 텍스트. Excel과 Numbers는 작성자 이름(`작성자:` + 줄바꿈)을 본문 텍스트 안에 이미 넣어 저장한다. 렌더러가 작성자를 따로 덧붙이지 않는다.
- `vmlDrawingN.vml`: 메모 상자의 크기와 위치(`x:Anchor`), 항상 표시 여부(`visibility:visible`).
- VML은 엄밀한 XML이 아닌 경우가 있다(닫히지 않은 `<br>` 등). 파싱 오류 시 VML 없이 기본 크기로 표시한다.
- 스레드 댓글(`threadedComments`, Microsoft 365 형식)은 2단계에서 처리. 그전에는 같은 셀의 레거시 메모(Excel이 호환용으로 함께 저장함)를 보여준다.

**drawingN.xml (이미지·차트 위치)**
- 앵커 3종류를 처리한다.
  - `twoCellAnchor`: 시작 셀(`from`)과 끝 셀(`to`) + 각 오프셋
  - `oneCellAnchor`: 시작 셀 + 크기(`ext`)
  - `absoluteAnchor`: 절대 위치(`pos`) + 크기
- 오프셋 단위는 EMU. 1px = 9525 EMU (96 DPI 기준).
- `pic`이면 이미지(rels로 `xl/media/*` 연결), `graphicFrame`에 chart 참조가 있으면 차트.

**chartN.xml**
- 5.5절 참고.

### 5.5 차트 파싱
- `chartSpace/chart`에서 제목, 범례 위치, `plotArea`의 차트 종류 요소들을 읽는다. 하나의 `plotArea`에 여러 종류가 있으면 콤보 차트다.
- 계열(`ser`)마다 이름(`tx`), 항목(`cat` 또는 분산형의 `xVal`), 값(`val` 또는 `yVal`), 색(`spPr`)을 읽는다.
- **데이터 출처는 두 가지를 모두 지원한다. 셀 참조를 먼저 해석하고, 해석할 수 없을 때 캐시를 쓴다.**
  1. 셀 참조: `'매출현황'!$B$27:$B$32` 같은 참조를 파싱이 끝난 시트 모델에서 꺼낸다. Excel은 파일을 열 때 차트를 셀 값으로 다시 그리므로, 이 방식이 Excel 화면과 같다. openpyxl처럼 캐시를 쓰지 않는 생성기도 이 경로로 처리된다.
  2. 캐시 값(`numCache`/`strCache`): 참조가 다른 통합 문서(`[1]Sheet1!A1`)를 가리키거나, 시트가 없거나, 범위가 10만 칸을 넘을 때 쓴다.
  3. 리터럴(`numLit`/`strLit`): 참조 없이 값만 있는 경우. Numbers 파일의 항목 축이 이 형태다.
- 값 범위의 문자열 셀은 0, 빈 셀은 빈칸(`null`)으로 둔다. Excel이 막대를 그리는 방식과 같다.
- 참조 해석: 시트 이름의 작은따옴표와 `''` 이스케이프, 절대 참조 `$`, 이름 정의(definedName, 시트 범위 우선) 참조를 처리한다.
- 3D 차트(`bar3DChart` 등)는 같은 종류의 2D 차트로 그린다. `ofPieChart`는 원형으로 근사한다.
- 지원하지 않는 차트 종류(방사형, 거품형, 주식형, 표면형, `chartex` 형식의 새 차트)는 `ChartModel.kind = "unsupported"`로 두고, 렌더러가 같은 위치에 언어셋의 `unsupportedChart` 문구 상자를 그린다. 파싱에 실패한 차트는 `error: true`와 `chartError` 문구.
- Excel 화면에 맞추기 위해 더 읽는 것: 그림 영역 위치(`plotArea/layout/manualLayout`), 축의 `delete`·`tickLblPos`·`majorUnit`·`min`·`max`·`orientation`·축선과 눈금선 색·굵기·글꼴(`txPr`), 계열 테두리, 데이터 요소별 색(`dPt`), 데이터 레이블(`dLbls/showVal`), 차트 영역 배경·테두리.
- 제목: `title` 요소가 있으면 그 텍스트, 텍스트가 없고 계열이 하나면 계열 이름. `title`이 없어도 `autoTitleDeleted`가 1이 아니고 계열이 하나면 계열 이름을 제목으로 쓴다(Excel 동작).

### 5.6 생성 도구별 차이 (실제로 확인했거나 알려진 것)

| 차이 | 예 | 대응 |
|---|---|---|
| XML 접두어 유무 | Excel `<c:barChart>` / openpyxl `<barChart>` | 네임스페이스로 식별 |
| 차트 캐시 유무 | openpyxl은 캐시 없음 | 셀 참조 해석 |
| 문자열 저장 방식 | Excel은 sharedStrings / openpyxl은 inlineStr | 둘 다 처리 |
| 파트 경로 | `xl/comments1.xml` / `xl/comments/comment1.xml` | rels 따라가기 |
| 셀 주소 생략 | 일부 생성기 | 순서로 계산 |
| 수식 결과값 없음 | 일부 생성기 | 빈칸 + 경고 |
| 열 범위 | Numbers는 `<col min="6" max="16384">`로 나머지 열 전체에 스타일 지정 | 범위 그대로 보관 (5.4절) |
| 기본 서식 재정의 | Numbers는 `numFmtId="0"`을 `numFmts`에 다시 선언 | 파일의 `numFmts`가 기본 서식보다 우선 |
| 색 지정 방식 | Numbers는 테마 색 대신 `indexed` 색을 주로 사용 | 7.2절 indexed 팔레트 |
| 메모 작성자 | 작성자 이름이 본문 텍스트에 포함됨 | 본문 그대로 표시 (5.4절) |
| 함수 접두어 | 새 함수는 수식에 `_xlfn.` 접두어 | 수식을 읽지 않으므로 영향 없음 |

**기준 파일 `fixtures/numbers/sales-report.xlsx`** (이하 sales-report) (Apple Numbers 생성, 2026-10-28 분석)

| 항목 | 내용 |
|---|---|
| 시트 | `매출현황`, `항목정의` 2개. 둘 다 `showGridLines="0"` |
| 문자열 | sharedStrings 사용 (27개) |
| 수식 | 동적 배열 수식(`t="array"`, `cm="1"`), `SUMIFS`, `ROUND`, `SUM`. 모두 `<v>` 결과값 있음 |
| 메모 | `매출현황` A1~E1 머리글에 5개. VML 위치 있음, 모두 숨김(마우스 오버로 표시) |
| 차트 | 묶은 세로 막대 2개(`매출현황`). 데이터는 캐시(`numCache`)와 셀 참조 모두 있음 |
| 차트 특이점 | 제목 삭제(`autoTitleDeleted`), 범례 요소 없음, 가로축 레이블 숨김(`tickLblPos="none"`), 값 축 눈금선 있음. 참조 범위에 머리글 행이 포함돼 첫 항목이 비어 보임. 차트1의 첫 계열(A열)은 문자열이라 막대가 안 보임. 항목 캐시는 Numbers 자리표시자(`무제 1` 등). Excel 캡처가 이 상태 그대로이므로 그대로 재현한다 |
| 글꼴 | Helvetica Neue, Arial, Calibri |
| 열 | 1~5열 개별 너비, 6~16384열 범위 지정 |
| Excel 캡처 | `fixtures/reference/sales-report.sheet1.excel.png`(매출현황), `sheet1.note-C1.excel.png`(C1 메모 표시 상태), `sheet2.excel.png`(항목정의). Windows Excel로 추정 |

Excel 캡처에서 확인할 재현 포인트: 머리글 셀 오른쪽 위 빨간 삼각형(A1~E1), 23행 회색 기울임 텍스트가 E열 밖까지 넘침, 시트 눈금선 없이 셀 테두리만 표시, 메모 상자(노란 배경, 첫 줄 `작성자:`)가 셀 오른쪽에 붙어 표시.

### 5.7 보안
- 입력 파일 크기 상한(기본 20MB)과 압축 해제 합계 상한(기본 200MB)을 둔다. 압축 해제 전에 ZIP 헤더에 적힌 원본 크기를 누적해 검사한다.
- ZIP 결과 객체는 `Object.keys`(자기 속성)로만 순회한다. `__proto__`라는 이름의 항목이 결과 객체의 프로토타입을 바꾸면 `for...in`이 그 바이트 하나하나를 키로 열거해, 압축하면 몇 KB인 파일이 수백만 개 항목을 만든다(2026-10-28 재현, `security.test.ts`).
- 셀 수 상한(기본 500만, 통합 문서 전체)을 둔다.
- 조건부 서식은 모든 규칙을 합쳐 평가하는 셀 수에 상한(200만)을 두고, 같은 `sqref` 안의 중복 범위는 한 번만 센다. 초과하면 나머지 규칙을 건너뛰고 `CF_RULE_UNSUPPORTED` 경고를 낸다.
- 병합 셀 조회는 끝 행의 누적 최댓값을 이진 탐색해 화면 근처 병합만 훑는다. 병합이 수십만 개여도 행마다 전체를 도는 일이 없다.
- 셀 텍스트, 메모, 차트 제목은 항상 `textContent`로 넣는다. `innerHTML`을 쓰지 않는다.
- 파일에서 온 글꼴 이름은 문자·숫자·공백·`._-`만 남기고 64자로 자른 뒤 따옴표로 감싸 CSS 글꼴 목록에 넣는다(`fontFamily`, 테마의 한글 보조 글꼴 포함). 글꼴 이름이 Canvas 글꼴 문자열이나 ECharts가 만드는 SVG 스타일 속성에서 구문으로 해석되지 않게 하기 위해서다. 색은 항상 `#RRGGBB`로 정규화한 값만 쓴다.
- 차트 툴팁은 ECharts 기본 HTML 포맷터에 기대지 않고 직접 만든 포맷터(`chart/options.ts`의 `tooltipHtml`)를 쓴다. 파일에서 온 계열·항목 이름은 모두 이스케이프하고, ECharts가 만드는 색 표시(marker)만 그대로 넣는다.
- 하이퍼링크는 링크로 만들지 않는다(D5). 텍스트로만 표시한다.
- 이미지는 `image/png`, `image/jpeg`, `image/gif`만 `Blob` URL로 표시한다. EMF/WMF/SVG는 표시하지 않고 빈 상자로 둔다. 뷰어를 해제할 때 `URL.revokeObjectURL`을 호출한다.
- 외부 링크(`externalLinks`), 매크로(`vbaProject.bin`), ActiveX는 읽지 않는다.

---

## 6. 데이터 모델

파서와 렌더러 사이의 약속이다. Worker에서 메인 스레드로 넘어가므로 함수나 클래스 인스턴스 없이 순수 데이터로만 구성한다. **원본은 `packages/core/src/model/types.ts`이고, 아래는 주요 부분의 요약이다.** `parseXlsx`의 반환 타입이기도 하므로 공개 API에 속한다.

```ts
interface WorkbookModel {
  sheets: SheetModel[];          // 숨김 시트 포함, 순서 유지
  styles: ResolvedStyle[];       // 인덱스 = 셀의 styleId
  dxfs: DiffStyle[];             // 조건부 서식용 차등 스타일
  date1904: boolean;
  defaultFont: ResolvedFont;     // Normal 스타일 글꼴. 열 너비 계산(MDW)과 머리글에 사용
  warnings: XlViewerWarning[];
}

interface SheetModel {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  defaultRowHeight: number;      // px
  defaultColWidth?: number;      // 파일 값(문자 단위). px 변환은 렌더러에서 (7.3절)
  baseColWidth: number;          // defaultColWidth가 없을 때 사용
  rowCount: number;              // 셀·병합·메모·도형이 있는 마지막 행 + 1
  colCount: number;              // 같은 기준. cols 범위는 반영하지 않음
  rows: Record<number, RowInfo>;         // 높이·숨김·스타일이 지정된 행만
  cols: ColRange[];                      // 파일의 <col> 범위 그대로, min 오름차순
  cells: Record<number, Record<number, CellModel>>; // [row][col], 희소 구조
  merges: CellRange[];
  notes: NoteModel[];
  images: ImageModel[];
  charts: ChartModel[];
  cf: Record<number, Record<number, CfResult>>;     // 조건부 서식 평가 결과 (Worker에서 계산)
  view: {
    showGridLines: boolean;
    showHeaders: boolean;        // 파일의 showRowColHeaders. 옵션 showHeaders와 둘 다 참일 때 표시
    frozenRows: number;
    frozenCols: number;
    zoom: number;                // 100 = 100%
    topRow: number;              // 처음 보일 스크롤 위치 (sheetView/pane의 topLeftCell)
    leftCol: number;
  };
}

interface CellModel {
  text: string;                  // 서식이 적용된 최종 표시 문자열
  type: "number" | "string" | "boolean" | "error";
  styleId: number;
  value?: number | boolean;      // 숫자·불리언의 원본 값 (차트 참조, 조건부 서식용)
  rich?: RichRun[];              // 셀 안 일부만 다른 서식인 경우
  fmtColor?: string;             // 서식 코드의 색 구간([Red] 등)
}

interface RowInfo { height?: number; hidden?: boolean; styleId?: number }
interface ColRange { min: number; max: number; width?: number; hidden?: boolean; styleId?: number } // 0부터, max 포함
interface CellRange { r1: number; c1: number; r2: number; c2: number }                         // 0부터, 끝 포함

interface XlViewerWarning {
  code: string;                  // 예: "FORMULA_WITHOUT_VALUE", "CHART_PARSE_FAILED", "CF_RULE_UNSUPPORTED"
  message: string;               // 개발자용 영어 문장
  sheet?: string;
  ref?: string;                  // 셀 주소나 파트 경로
}

interface Anchor {
  from: { row: number; col: number; dx: number; dy: number }; // dx, dy는 px
  to?: { row: number; col: number; dx: number; dy: number };  // twoCellAnchor. 크기는 렌더러가 셀 위치로 계산
  width: number;                 // oneCellAnchor, absoluteAnchor의 크기 (px)
  height: number;
  x?: number; y?: number;        // absoluteAnchor 위치 (px)
}

interface NoteModel {
  row: number; col: number;
  author?: string;
  rich: RichRun[];               // 작성자 이름은 본문에 이미 포함 (5.4절)
  box?: { width: number; height: number };          // VML style의 width/height (px)
  from?: { col: number; dx: number; row: number; dy: number }; // VML x:Anchor의 상자 위치
  fill?: string; border?: string;                   // VML fillcolor, strokecolor
  alwaysVisible: boolean;
  threaded?: { author: string; text: string; date?: string }[]; // 스레드 댓글이 있으면 이것을 표시
}

interface ImageModel { anchor: Anchor; mime: string; data: ArrayBuffer } // 지원하지 않는 형식은 mime "" + 빈 버퍼

interface ChartModel {
  anchor: Anchor;
  kind: "bar" | "line" | "pie" | "doughnut" | "area" | "scatter" | "combo" | "unsupported";
  error?: boolean;               // 파싱 실패
  title?: string;
  legend: "top" | "bottom" | "left" | "right" | "none";
  series: ChartSeries[];         // 이름, 종류, 항목, 값, 색, 보조 축, 테두리, 선 굵기, 데이터 레이블
  axes: { category: ChartAxis; value: ChartAxis; secondary?: ChartAxis };
  area: { fill?: string; border?: string; borderWidth?: number };
  plot?: { x: number; y: number; w: number; h: number; fill?: string }; // manualLayout (비율)
  titleFont?: ChartFont; legendFont?: ChartFont;
  options: { horizontal?; grouping?; gapWidth?; overlap?; holeSize?; firstSliceAngle?; varyColors?; palette: string[] };
}

interface ResolvedStyle {
  font: ResolvedFont;
  fill?: string;                 // 배경색 #RRGGBB
  border?: { top?; right?; bottom?; left?; diagonalUp?; diagonalDown?: BorderSide };
  hAlign: "general" | "left" | "center" | "right" | "justify" | "fill" | "centerContinuous" | "distributed";
  vAlign: "top" | "middle" | "bottom" | "justify" | "distributed";
  wrap: boolean;
  shrink: boolean;
  indent: number;
  rotation: number;              // 0~180(파일 값) 또는 255(세로 쓰기)
  numFmt: string;                // 서식 코드
}

interface ResolvedFont {
  name: string;                  // 파일의 글꼴 이름
  family: string;                // CSS font-family (대체 글꼴 포함)
  sizePx: number;
  bold: boolean; italic: boolean;
  underline: "none" | "single" | "double";
  strike: boolean;
  color: string;
  vertAlign?: "superscript" | "subscript";
}

interface CfResult {             // 여러 규칙이 겹치면 우선순위가 높은 규칙의 값이 속성별로 이긴다
  fill?: string;
  font?: { bold?; italic?; strike?; underline?; color? };
  border?: Borders;
  dataBar?: { from: number; to: number; color: string; gradient: boolean; showValue: boolean; negative: boolean };
  icon?: { set: string; index: number; showValue: boolean };
}
```

- 정렬 기본값(숫자는 오른쪽, 문자열은 왼쪽 등)은 `type`으로 렌더러가 정한다. 그래서 초안의 `CellModel.align`은 두지 않는다.
- 문자열 셀은 `value`를 두지 않는다(`text`와 같으므로). 구조화 복제 비용을 줄이기 위해서다.
- 숫자 서식 적용(`text` 생성)과 조건부 서식 평가는 Worker에서 한다. 메인 스레드는 표시만 한다. 열 너비가 모자랄 때 숫자를 `###`로 바꾸거나 "일반" 서식 숫자의 자릿수를 줄이는 처리는 실제 텍스트 폭이 필요하므로 렌더러에서 한다.
- 성능 메모: 10만 행 × 20열(셀 200만 개) 모델의 구조화 복제는 약 1.2초다. A5 안에 들어오므로 v1은 객체 구조를 유지한다. 더 큰 파일이 필요하면 열 단위 배열(typed array + 문자열 표) 전송을 검토한다.

---

## 7. 서식 계산 규칙

### 7.1 숫자 서식
- 기본 서식 ID 0~49는 표준에 정의된 코드를 쓴다. 로케일마다 달라지는 ID(14 등 날짜, 한국어의 27~36, 50~58)는 언어셋 파일의 `builtinFormats`로 덮어쓴다(10.4절).
- 파일의 `numFmts`에 같은 ID가 있으면 기본 서식보다 우선한다.
- 사용자 지정 서식은 `numfmt`로 처리한다. 색 지정(`[Red]`), 조건(`[>100]`), 구간(`;`) 포함. 월·요일 이름은 언어셋의 `code`를 `numfmt`의 로케일로 넘겨 정한다.
- 날짜: 1900 기준에서 일련번호 60(존재하지 않는 1900-02-29)을 Excel과 같게 처리한다. `date1904`면 1904 기준.
- "일반" 서식 숫자: Worker에서 `numfmt`의 일반 서식(최대 11자, 넘치면 지수 표기)으로 만든다. 정수와 11자 이하의 짧은 소수는 `numfmt`를 거치지 않는 빠른 경로로 같은 결과를 만든다. 열이 좁으면 렌더러가 유효숫자를 10자리부터 줄여 보고, 그래도 넘치면 `#`으로 채운다.
- 서식 코드의 색 구간(`[Red]`, `[Color10]`)은 `CellModel.fmtColor`로 넘겨 글자색으로 쓴다.

### 7.2 색상
- `rgb`: `AARRGGBB`에서 앞 2자리(알파)를 버린다.
- `theme`: 테마 색 인덱스. **0과 1, 2와 3이 뒤바뀌어 매핑된다**(0→lt1, 1→dk1, 2→lt2, 3→dk2). Excel의 알려진 특성이다.
- `indexed`: 기본 64색 팔레트. 파일에 `colors/indexedColors`가 있으면 그것을 쓴다. 64는 시스템 전경색, 65는 시스템 배경색.
- `tint`: RGB를 HSL로 바꿔 밝기(L, 0~1)만 조정한다. tint < 0이면 `L × (1 + tint)`, tint > 0이면 `L × (1 − tint) + tint`.
- `auto`: 글자색은 검정, 테두리는 검정.

### 7.3 크기 단위
- 열 너비: 파일 값은 "기본 글꼴 숫자 폭(MDW)의 몇 배"다.
  - 픽셀 = `Truncate(((256 × width + Truncate(128 / MDW)) / 256) × MDW)`
  - MDW는 기본 글꼴(styles의 `fonts[0]`)의 숫자 최대 폭이다. Excel이 쓰는 값이 알려진 글꼴(Calibri 11pt, Arial 10pt, Aptos Narrow 11pt → 7, 맑은 고딕 11pt → 8)은 표의 값을 쓴다. 보는 PC에 그 글꼴이 없어도 열 너비가 Excel과 같게 하기 위해서다. 그 외 글꼴은 `0`~`9`의 폭을 `canvas.measureText`로 재서 최댓값을 반올림한다(`render/mdw.ts`).
  - 열 너비 확인: sales-report의 A~E열(12, 14, 16, 15, 15)은 MDW 7에서 84, 98, 112, 105, 105px이고, Excel 캡처(80% 배율)의 열 너비와 비율이 일치했다.
  - `defaultColWidth` 없이 `baseColWidth`만 있으면 `baseColWidth × MDW + 8`px (Calibri 11에서 64px).
- 행 높이: 포인트 단위. 픽셀 = `pt × 96 / 72`를 반올림한 정수(Excel 화면과 같음). 지정이 없으면 `sheetFormatPr/@defaultRowHeight`, 그것도 없으면 15pt(20px). 배율이 있으면 행·열마다 배율을 곱한 뒤 반올림한다.
- 글꼴 크기: 포인트 → 픽셀 같은 식.
- 자동 맞춤 행 높이: Excel은 줄바꿈 셀이 있는 행의 높이를 저장 시 계산해 둔다. 기본 동작은 저장된 값을 그대로 쓰는 것이다. 저장된 높이가 내용보다 작아 글자가 잘리는 파일이 있으므로(예: 고정 높이 행의 여러 줄 메모) 아래 두 가지를 제공한다.
  - `autoFitRows: true`: 파일을 열 때 줄바꿈 셀의 내용이 잘리는 행만 키운다. 줄이지는 않는다. 사용자가 직접 바꾼 행은 건드리지 않고, 열 너비가 바뀌면 다시 계산한다.
  - 머리글 경계 조작(7.5절).

### 7.5 행·열 크기 조절
- 열 머리글의 오른쪽 경계, 행 머리글의 아래쪽 경계를 드래그하면 크기를 바꾸고, 더블클릭하면 내용에 맞춘다. 경계 4px 안에서 커서가 `col-resize`/`row-resize`로 바뀐다. 드래그 중에는 가이드 선만 움직이고, 놓을 때 한 번만 다시 배치한다(10만 행 시트에서 프레임마다 레이아웃을 만들지 않기 위해).
- 변경값은 화면에만 적용한다. 파일과 `getModel()` 결과는 바뀌지 않는다. 100% 배율 기준 px로 시트마다 보관하고, 같은 문서를 연 동안 시트를 오가도 유지한다. 새 파일을 열면 버린다. 저장하지 않는 읽기 전용 뷰어이므로 이 방침을 바꾸지 않는다.
- 맞춤 계산: 행은 줄바꿈 셀을 열 너비 안에서 나눠 줄 수만큼, 줄바꿈이 없는 셀은 한 줄로 센다. 열은 가장 긴 줄의 너비에 여백을 더한다(최대 800px). 병합 셀과 회전 셀은 제외한다. 내용이 없는 열을 더블클릭하면 파일의 너비로 되돌린다.
- 최소 4px, 행 최대 409px(Excel 한도). `resizable: false`로 끌 수 있고, 머리글을 숨기면 조작할 곳이 없다.
- 터치는 아직 지원하지 않는다.

### 7.4 글꼴 대체
Excel 글꼴이 사용자 PC에 없을 수 있으므로 대체 목록을 붙인다.

| 파일의 글꼴 | CSS font-family |
|---|---|
| 맑은 고딕 / Malgun Gothic | `"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif` |
| Helvetica Neue (Numbers 기본) | `"Helvetica Neue", Helvetica, Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif` |
| 굴림 / 돋움 | `Gulim, Dotum, "Apple SD Gothic Neo", sans-serif` |
| 바탕 / 궁서 | `Batang, "AppleMyungjo", "Noto Serif KR", serif` |
| Calibri / Aptos | `Calibri, Carlito, "Segoe UI", …한글 글꼴, sans-serif` |
| Cambria | `Cambria, Caladea, Georgia, "Noto Serif KR", serif` |
| Arial / Helvetica | `Arial, "Liberation Sans", Helvetica, …한글 글꼴, sans-serif` |
| Times New Roman / Courier New | Liberation 계열 대체 |
| 그 외 | `"<원래 이름>", [테마의 한글 보조 글꼴], "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif` |

- 라틴 글꼴 뒤에도 한글 글꼴을 붙인다. 한글이 섞인 셀에서 브라우저가 임의의 글꼴로 대체하지 않게 하기 위해서다. 테마의 `minorFont`에 한글 글꼴(`script="Hang"`)이 있으면 그것을 먼저 쓴다.
- 라이브러리는 웹 폰트를 내장하지 않는다(용량). Canvas는 CSS 변수를 읽지 않으므로, 대체 목록은 `theme.fontFallback` 옵션으로 덮어쓴다(일반 글꼴 이름 앞에 끼워 넣음).

---

## 8. 렌더러 설계 (Canvas + DOM 혼합)

### 8.1 레이어 구조

```
div.xv-root
├── div.xv-scroll                     네이티브 스크롤 컨테이너 (overflow: auto)
│   └── div.xv-content                시트 전체 크기(머리글 포함). 스크롤바 길이를 만듦
│       │                             display: grid, 자식은 모두 같은 칸(grid-area: 1 / 1)에 겹침
│       ├── canvas.xv-grid            화면 크기, position: sticky; top: 0; left: 0
│       │                             배경, 눈금선, 테두리, 텍스트, 행/열 머리글, 메모 삼각형
│       └── div.xv-panes              화면 크기, position: sticky. overflow: hidden, pointer-events: none
│           └── div.xv-pane × 1~4     틀 고정 영역마다 하나(corner/top/left/main). 영역 크기로 잘라냄
│               └── div.xv-layer      시트 좌표계. 그 영역의 스크롤 위치만큼 transform으로 이동
│                   ├── 이미지 (div.xv-image > img)
│                   ├── 차트 (div.xv-chart + ECharts SVG)
│                   └── 메모 상자 (div.xv-note)
└── div.xv-tabs                       시트 탭 (DOM, role="tablist")
```

- sticky 레이어들을 같은 그리드 칸에 겹쳐 두는 이유: 일반 흐름에 쌓으면 Canvas 높이만큼 스크롤 길이가 늘어난다. 같은 칸에 겹치면 스크롤 길이는 `xv-content`에 지정한 시트 크기로만 정해진다.
- 검증 결과(2026-10-28): Chromium과 WebKit에서 스크롤, 틀 고정, 메모 오버, 차트가 같은 화면으로 동작함을 스크린샷으로 확인했다. 개발 PC(macOS)에서는 Playwright용 Firefox가 실행되지 않아, Firefox는 CI의 Linux 컨테이너에서 시각 회귀로 확인한다.
- `xv-scroll`은 `tabindex="0"`이라 키보드(방향키, Page Up/Down)로도 스크롤된다.

- 스크롤은 브라우저 기본 스크롤을 쓴다. 스크롤바, 마우스 휠, 터치패드, 모바일 관성 스크롤을 직접 구현하지 않아도 된다.
- Canvas는 스크롤 영역 안에서 `sticky`로 화면에 고정되고, 스크롤 위치에 맞춰 내용만 다시 그린다.
- 오버레이는 Canvas를 다시 그리는 같은 `requestAnimationFrame`에서 `transform`을 갱신한다. Canvas와 오버레이가 한 프레임이라도 어긋나 보이지 않게 하기 위해서다.
- 오버레이 잘라내기 상자(`xv-pane`)는 머리글 영역을 제외한 각 틀 고정 영역만 보여준다. 이미지와 차트가 머리글 위로 올라가지 않게 하기 위해서다. 항목은 시작 셀이 속한 영역에 놓인다.
- 스크롤 위치는 장치 픽셀 단위로 반올림해서 쓴다. 고해상도 화면에서 선이 번지지 않게 하기 위해서다.
- 행/열 머리글은 옵션 `showHeaders`(기본 true)로 끌 수 있다.

### 8.2 레이아웃 계산
- 행 위치 배열 `rowTop[i]`와 열 위치 배열 `colLeft[j]`를 누적합으로 만든다. 숨김 행·열은 크기 0.
- 데이터가 없는 영역도 Excel처럼 빈 격자가 보이도록, 그리는 범위는 `max(데이터 범위, 화면 크기를 채우는 행/열 수)`로 잡는다.
- 스크롤 위치에서 보이는 첫 행/열과, 마우스 좌표가 가리키는 셀은 이진 탐색으로 찾는다.
- Canvas는 화면에 보이는 셀만 그리면 되므로 overscan(여유분)이 필요 없다. 단 텍스트 넘침과 병합은 화면 밖 셀도 확인한다(8.6, 8.7절).

### 8.3 Canvas 기본 처리
- **고해상도 화면**: Canvas 실제 크기 = CSS 크기 × `devicePixelRatio`, 그린 뒤 `ctx.scale(dpr, dpr)`. 창 크기 변화는 `ResizeObserver`로, 배율 변화(모니터 이동, 브라우저 확대)는 `matchMedia("(resolution: …dppx)")`로 감지해 다시 맞춘다.
- **선명한 선**: 선 좌표를 장치 픽셀 격자에 맞춘다. 1px 선은 장치 픽셀 기준 0.5 위치에 그려 번지지 않게 한다.
- **다시 그리는 시점**: 스크롤, 크기 변경, 시트 전환, 글꼴 로드 완료, 이미지 로드 완료 때만 그린다. 여러 요청이 한 프레임에 몰리면 한 번만 그린다(`requestAnimationFrame` 하나로 합침).
- **전체 다시 그리기**: 매번 화면 전체를 다시 그린다. 화면 크기만큼의 셀(대략 수백~수천 개)이라 감당할 수 있다고 보고, 성능 측정에서 프레임이 밀리면 그때 타일 캐시(미리 그린 조각 재사용)를 도입한다.
- **글꼴 로드**: 웹 폰트가 아직 로드되지 않았으면 Canvas는 대체 글꼴로 그린 뒤 스스로 갱신하지 않는다. `document.fonts.ready`와 `loadingdone` 이벤트에서 측정 캐시를 비우고 다시 그린다.

### 8.4 그리는 순서 (한 프레임)

1. 흰 배경
2. 셀 배경색(채우기)
3. 눈금선. 배경색이 있는 셀 위에는 그리지 않는다(Excel과 동일). `showGridLines=false`면 생략
4. 셀 텍스트 (8.5절)
5. 명시적 테두리 (8.8절)
6. 메모 삼각형
7. 행/열 머리글과 좌상단 모서리 (항상 맨 위)

병합 셀은 2·4·5단계에서 병합 영역 전체를 한 셀처럼 다룬다.

### 8.5 텍스트 그리기
Canvas는 줄바꿈과 서식 있는 텍스트를 지원하지 않으므로 직접 처리한다.

- **스타일 캐시**: `ResolvedStyle`마다 `ctx.font` 문자열(`"bold 14.67px 'Malgun Gothic', …"`)과 색을 미리 만들어 둔다.
- **측정 캐시**: `measureText` 결과를 (글꼴 문자열, 텍스트) 기준으로 캐시한다. 크기 상한을 둔 LRU로 관리한다.
- **줄바꿈**: `wrap`인 셀만 처리한다. 영문은 공백에서 끊고, 한글·한자·일본어는 글자 사이에서도 끊을 수 있다. 한 단어가 셀보다 길면 글자 단위로 끊는다. 줄바꿈 결과도 (스타일, 텍스트, 너비) 기준으로 캐시한다. 명시적 줄바꿈 문자(`\n`)는 항상 줄을 바꾼다.
- **세로 정렬**: `actualBoundingBoxAscent/Descent`가 아닌 글꼴 기준 높이(`fontBoundingBoxAscent/Descent`)를 써서 줄 높이를 일정하게 한다. 지원하지 않는 브라우저는 글꼴 크기 × 1.2로 근사한다.
- **서식 있는 텍스트**: 조각(run)마다 글꼴을 바꿔 가며 이어 그린다. 줄바꿈도 조각을 넘나들며 계산한다.
- **밑줄, 취소선**: Canvas에 없으므로 텍스트 폭만큼 선을 직접 그린다.
- **들여쓰기**: 1단계당 MDW × 3 정도로 시작하고, Excel 화면과 비교해 보정한다.
- **회전**: `ctx.rotate`로 처리. 세로 쓰기(`textRotation=255`)는 글자를 한 줄에 하나씩 쌓는다.
- **잘라내기**: 셀마다 `ctx.save()` → 사각형 `clip()` → 그리기 → `ctx.restore()`. 넘침 텍스트는 넘침 범위 전체를 잘라내기 영역으로 쓴다.
- **정렬 기본값**: 가로 정렬이 "일반"이면 숫자·날짜는 오른쪽, 문자열은 왼쪽, 불리언·오류는 가운데.
- **`###` 표시**: 숫자·날짜가 열 너비보다 길면 열 너비를 채우는 `#`으로 그린다.

### 8.6 텍스트 넘침
- 줄바꿈이 없고 왼쪽 정렬된 문자열은, 오른쪽 셀들이 비어 있는 동안 그 위로 넘쳐 그린다. 오른쪽 정렬은 왼쪽으로, 가운데 정렬은 양쪽으로 넘친다.
- 넘친 텍스트가 지나가는 셀의 눈금선은 그리지 않는다(Excel과 동일).
- 화면 왼쪽 밖의 셀에서 넘쳐 들어오는 텍스트도 보이도록, 보이는 첫 열 왼쪽의 같은 행 셀을 최대 20열까지 확인한다. 오른쪽도 같다.
- 숫자는 넘치지 않는다(8.5절 `###`).

### 8.7 병합 셀
- 병합 목록을 시작 행 기준으로 정렬해 두고, 가시 영역과 겹치는 병합만 찾는다.
- 병합 영역을 하나의 셀로 보고 배경, 텍스트, 테두리를 그린다. 병합에 덮인 셀은 그리지 않고, 병합 내부에는 눈금선을 그리지 않는다.
- 병합의 시작 셀이 화면 밖에 있어도 영역이 화면에 걸치면 그린다. 텍스트는 병합 영역 전체 기준으로 정렬한 뒤 화면에 보이는 부분만 잘라 그린다.

### 8.8 테두리
- 눈금선 색은 `theme.gridColor`(기본 `#e2e2e2`).
- 명시적 테두리는 셀 경계선 단위로 모아 그린다. 인접한 두 셀이 같은 경계에 테두리를 가지면 더 굵은 쪽을 쓴다.
- 선 종류 대응: `thin` 1px, `medium` 2px, `thick` 3px, `dashed`/`dotted`/`dashDot` 계열은 `setLineDash`, `hair`는 1px 점선, `double`은 1px 선 두 개(간격 1px).
- 대각선 테두리(`diagonalUp/Down`)도 Canvas로 그린다.

### 8.9 메모
- 메모가 있는 셀의 오른쪽 위에 빨간 삼각형(6px)을 Canvas에 그린다.
- 마우스 이동 시 좌표 → 영역(틀 고정) → 셀을 이진 탐색으로 판정한다(`viewer.ts`). 메모가 있는 셀(병합 셀이면 병합 영역 안의 메모)이면 메모 상자(DOM)를 띄운다. 이 판정만을 위해 `.xv-scroll`에서 `mousemove`를 받는다.
- 상자 위치는 VML `x:Anchor`(열, 픽셀 오프셋, 행, 픽셀 오프셋)를 쓴다. Excel도 마우스 오버 때 이 위치에 띄운다(sales-report의 C1 메모가 D1 시작 위치에 뜨는 것을 Excel 캡처로 확인). VML이 없으면 셀 오른쪽 12px, 위로 7px.
- 상자 크기는 VML 값, 없으면 기본 144 × 79px. 배경·테두리 색도 VML의 `fillcolor`·`strokecolor`를 쓰고, 없으면 CSS 변수 기본값.
- 스레드 댓글이 있으면 레거시 메모 본문 대신 작성자별 댓글 목록을 보여준다. 상자 안 텍스트는 서식 있는 텍스트 조각을 `<span>`으로 표현한다. 작성자 이름은 본문에 이미 들어 있으므로 따로 붙이지 않는다(5.4절).
- `alwaysVisible`인 메모는 처음부터 오버레이에 표시한다.
- 메모 상자는 DOM이므로 텍스트에 `textContent`만 쓴다(5.7절).

### 8.10 이미지와 차트 (DOM 오버레이)
- 앵커를 시트 좌표로 바꿔 해당 영역의 `div.xv-layer` 안에 절대 위치로 둔다. 셀 오프셋이 셀 크기보다 크면 셀 크기로 자른다(Excel과 같음).
- 레이아웃 계산으로 화면과 겹치는 것만 DOM에 붙이고, 벗어나면 뗀다.
- 이미지: 처음 화면에 들어올 때 `Blob` URL을 만들어 `<img>`에 넣는다. 지원하지 않는 형식이나 로드 실패는 회색 상자에 언어셋의 `imageError` 문구.
- 차트: 처음 화면에 들어올 때 ECharts를 동적 import 하고 그린다. 그 뒤로는 화면을 벗어나도 인스턴스를 유지하고 DOM에서만 뗀다. 뷰어 해제나 시트 전환 시 `dispose()` 한다. 차트 영역 테두리는 차트 `div`의 CSS 테두리로 그린다.
- 차트의 마우스 오버 툴팁은 ECharts 기본값을 따른다(보기 기능으로 간주). 이를 위해 차트 요소만 `pointer-events: auto`로 둔다.

### 8.11 틀 고정 (2단계)
- `frozenRows`/`frozenCols`가 있으면 Canvas를 4개 영역(고정 모서리, 고정 행, 고정 열, 본문)으로 나눠 각각 잘라내기 영역과 스크롤 오프셋을 달리해서 그린다.
- 오버레이도 같은 4개 영역으로 나눈 잘라내기 상자에 배치한다.
- 고정선(고정 영역 경계)은 Excel처럼 진한 회색 1px로 그린다.

### 8.12 배율 (2단계)
- 파일에 저장된 `zoomScale`(10~400)을 적용한다. 레이아웃 계산, 글꼴 크기, 선 굵기에 배율을 곱한다. 오버레이 항목은 배율이 적용된 레이아웃 좌표로 놓고, 차트는 배율을 곱한 크기와 글꼴로 그린다(`transform: scale`을 쓰지 않아 흐려지지 않음). 저장된 배율이 너무 작아 기본 글꼴이 `minFontSize`(기본 12px)보다 작게 그려지면 배율을 그 크기까지 올린다(예: 기본 글꼴 14.67px이면 약 82%). 글꼴만 따로 키우면 열 너비와 행 높이가 어긋나므로 배율 전체를 올린다. `minFontSize: 0`이면 파일의 배율을 그대로 쓴다. 사용자가 배율을 바꾸는 기능은 없다(D5).

### 8.13 접근성
- Canvas 내용은 화면 낭독기가 읽지 못한다. v1에서는 Canvas에 `role="img"`와 `aria-label`(파일 이름, 시트 이름, 데이터 범위. 문구 틀은 언어셋의 `gridLabel`)만 제공한다.
- 셀 내용을 읽어야 하는 요구가 생기면, 보이는 영역의 셀을 화면 밖 `<table>`로 함께 출력하는 방식을 검토한다.

### 8.14 성능 목표와 측정
- 스크롤 중 한 프레임 그리기 시간 8ms 이내(1920×1080 화면, 일반 노트북 기준). 실측 평균 3.8ms, 최대 5ms(10만 행 파일, M1 Pro, Chromium). ①~③은 아직 필요 없다.
- 텍스트 배치의 고정 비용을 줄이기 위해: 셀이 칸에 들어가면 잘라내기(`clip`)를 하지 않고, 화면 범위의 병합 정보는 프레임마다 한 번만 계산해 둔다.
- 주요 비용은 `measureText`와 `clip`이다. 측정 캐시 적중률과 프레임 시간을 playground의 개발용 패널에 표시해서 확인한다.
- 목표를 넘으면 순서대로 도입한다: ① 행 단위 텍스트 배치 결과 캐시 → ② 타일 캐시(OffscreenCanvas) → ③ 스크롤 중 낮은 품질로 그리고 멈추면 다시 그리기.

---

## 9. 차트 변환 (ChartModel → ECharts)

| Excel | ECharts | 비고 |
|---|---|---|
| `barChart`, `barDir=col` | `bar` + 세로 축 | `grouping`: clustered → 기본, stacked → `stack`, percentStacked → 100% 정규화 후 `stack` |
| `barChart`, `barDir=bar` | `bar` + 축 교환 | 위와 같음 |
| `lineChart` | `line` | `marker` 유무 반영, `smooth` 반영 |
| `areaChart` | `line` + `areaStyle` | 누적 방식은 막대와 같음 |
| `pieChart` | `pie` | 첫 계열만 사용 |
| `doughnutChart` | `pie` + `radius: [안, 밖]` | `holeSize` 반영 |
| `scatterChart` | `scatter` (선 스타일이면 `line` + value 축) | |
| 여러 종류 혼합 | 계열별 `type` 지정 | 보조 축(`secondary axis`) 반영 |

- 값 축 자동 눈금은 Excel 규칙을 근사한다(`chart/scale.ts`): 데이터가 모두 0 이상이면 0부터, 눈금 단위는 `majorUnit`이 있으면 그 값, 없으면 1·2·5 × 10ⁿ 중 5~10칸이 되는 값, 최대값은 "최대 데이터 + 범위의 5%"를 넘는 첫 눈금. sales-report의 두 차트에서 Excel과 같은 2250, 11250이 나온다.
- 막대 간격: Excel `gapWidth`(막대 폭 대비 %)와 `overlap`을 ECharts의 `barCategoryGap = g / (n + g)`, `barGap = -overlap`으로 바꾼다(n은 한 항목의 막대 수, g = gapWidth / 100).
- 그림 영역: `manualLayout`이 있으면 그 비율로 `grid` 위치를 고정하고(`containLabel: false`), 없으면 ECharts가 레이블 공간을 계산한다.
- 축 레이블 서식은 `numFmt`의 천 단위 구분, 소수 자릿수, `%`만 해석한다(차트 청크에 `numfmt`를 넣지 않기 위해서).

- 계열 색이 지정되지 않으면 테마의 accent1~6을 순서대로 쓴다. Excel과 같은 기본 색이 나오게 하기 위해서다.
- 제목, 범례 위치, 축 제목, 데이터 레이블 표시 여부를 반영한다.
- ECharts는 `echarts/core`에서 필요한 차트(`BarChart`, `LineChart`, `PieChart`, `ScatterChart`)와 컴포넌트(`Grid`, `Legend`, `Title`, `Tooltip`), SVG 렌더러만 등록한다. 차트는 DOM 오버레이에 놓이므로 SVG가 자연스럽고, Canvas 렌더러보다 용량이 작다.
- 애니메이션은 끈다(`animation: false`). 뷰어이므로 정적인 표시가 자연스럽다.

---

## 10. 공개 API

### 10.1 @xl-viewer/core

```ts
import { createViewer, parseXlsx } from "@xl-viewer/core";
import "@xl-viewer/core/styles.css";

const viewer = createViewer(containerElement, {
  showHeaders: true,            // 행/열 머리글
  showTabs: true,               // 시트 탭
  resizable: true,              // 머리글 경계 드래그·더블클릭으로 크기 조절 (7.5절)
  autoFitRows: false,           // true면 잘리는 줄바꿈 행을 열 때 키움 (7.3절)
  minFontSize: 12,              // 기본 글꼴의 최소 표시 크기(px). 저장된 배율이 작으면 이 크기까지 올림, 0이면 끔 (8.12절)
  useWorker: true,              // false면 메인 스레드에서 파싱 (10.3절)
  workerUrl: undefined,         // 별도 Worker 파일 경로. 지정하지 않으면 인라인 Worker
  locale: undefined,            // 언어셋. 지정하지 않으면 영어 (10.4절)
  maxFileSize: 20 * 1024 * 1024,
  maxUncompressedSize: 200 * 1024 * 1024,
  maxCells: 5_000_000,          // 통합 문서 전체 셀 수 상한 (5.7절)
  theme: {},                    // Canvas 색 (10.5절)
  onWarning: (warning) => {},   // XlViewerWarning (6장)
});

await viewer.open(file);        // File | Blob | ArrayBuffer | Uint8Array. 실패하면 reject + error 이벤트
viewer.setActiveSheet(1);       // 보이는 시트 기준 인덱스. 숨김 시트는 지정 불가(RangeError)
viewer.getActiveSheet();        // 보이는 시트 기준 인덱스
viewer.getSheetNames();         // 보이는 시트 이름 목록
viewer.getModel();              // 마지막으로 연 WorkbookModel
const off = viewer.on("load", (info) => {}); // { sheetNames, activeSheet, warnings }. 반환값으로 해제
viewer.on("error", (error) => {});           // XlViewerError
viewer.on("sheetchange", (index) => {});     // 보이는 시트 기준 인덱스
viewer.off("load", handler);
viewer.getStats();              // { frameMs, measureHitRate }. playground 개발 패널용
viewer.destroy();               // DOM, 이벤트, Worker, Blob URL, ECharts 인스턴스 해제

// 렌더링 없이 모델만 필요할 때
const model = await parseXlsx(arrayBuffer, { useWorker: true, locale: ko });
```

- 여러 번 `open()`을 연달아 부르면 마지막 호출의 결과만 화면에 반영한다.
- 오류 타입: `InvalidFileError`, `UnsupportedFormatError`, `FileTooLargeError`, `ParseError`. 모두 `XlViewerError`를 상속하고 `code` 속성(`INVALID_FILE`, `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`, `PARSE_ERROR`)을 갖는다. Worker에서 난 오류도 같은 타입으로 복원된다.

### 10.2 @xl-viewer/vue

```vue
<script setup lang="ts">
import { XlViewer } from "@xl-viewer/vue";
import "@xl-viewer/core/styles.css";
</script>

<template>
  <XlViewer
    :src="file"
    :show-headers="true"
    style="height: 600px"
    @load="onLoad"
    @error="onError"
  />
</template>
```

- props: `src`, `showHeaders`, `showTabs`, `resizable`, `autoFitRows`, `minFontSize`, `useWorker`, `workerUrl`, `locale`, `theme`, `maxFileSize`, `maxUncompressedSize`, `maxCells`. 이벤트: `load`, `error`, `warning`, `sheetchange`. `expose`로 내부 `viewer` 인스턴스를 노출한다.
- `src`가 바뀌면 다시 연다. 컴포넌트가 해제되면 `destroy()`를 호출한다.
- `theme`이 바뀌면 `setTheme()`만 부르고, 나머지 옵션(`locale` 포함)이 바뀌면 뷰어를 새로 만든다.
- 루트 요소는 `div.xl-viewer-vue`이고, 높이는 사용하는 쪽이 지정한다.
- Vue는 `peerDependencies`(`vue@^3.3`)로 둔다.

### 10.3 Worker 로딩

| 순서 | 방식 | 조건 |
|---|---|---|
| 1 | `workerUrl`로 지정한 파일 | 옵션을 준 경우 |
| 2 | 인라인 Worker (빌드 시 Worker 코드를 하나의 파일로 묶어 문자열로 넣고 `Blob` URL로 실행) | 기본 |
| 3 | 메인 스레드 파싱 (파서 청크를 동적 import) | `useWorker: false`, 또는 1·2가 실패한 경우. 실패 시 `WORKER_UNAVAILABLE` 경고 |

- 인라인을 기본으로 하는 이유: 라이브러리 안에서 `new Worker(new URL("./worker.js", import.meta.url))`를 쓰면 Vite 개발 서버의 의존성 사전 번들링이 경로를 깨뜨려 사용자가 `optimizeDeps.exclude`를 설정해야 한다. 번들러마다 처리도 다르다. 인라인은 사용자 설정 없이 Vite, webpack 5, Rollup, esbuild에서 같게 동작한다.
- 인라인 Worker는 의존성까지 하나로 묶은 classic Worker로 만든다(`import` 없음).
- CSP가 `worker-src blob:`을 막는 환경을 위해 같은 Worker를 별도 파일로도 배포한다(`@xl-viewer/core/worker`, 실제 파일 `dist/parser.worker.js`). 사용자는 이 파일을 정적 경로에 두고 `workerUrl`로 지정한다. README에 CSP 안내를 넣는다.
- 메인 스레드 파싱용 파서 청크는 별도 청크로 두어 Worker가 정상일 때는 내려받지 않는다.
- 0단계 완료 조건에 Vite, webpack 5에서 인라인 Worker와 `workerUrl` 방식이 모두 동작하는지 확인을 넣는다.

### 10.4 언어셋 (locale)

화면에 나오는 문구와 로케일별 숫자 서식을 언어셋 파일로 분리한다. 영어는 코어에 기본 포함하고, 다른 언어는 별도 진입점으로 가져와 옵션으로 넘긴다. 쓰지 않는 언어는 번들에 들어가지 않는다.

```ts
import { createViewer } from "@xl-viewer/core";
import { ko } from "@xl-viewer/core/locales/ko";

createViewer(el, { locale: ko });

// 일부 문구만 바꿀 때
createViewer(el, { locale: { ...ko, messages: { ...ko.messages, unsupportedChart: "미지원 차트" } } });
```

```ts
interface XlViewerLocale {
  code: string;                         // BCP 47. 예: "en-US", "ko-KR". numfmt 로케일로도 사용
  messages: {
    unsupportedChart: string;           // 지원하지 않는 차트 자리 상자
    chartError: string;                 // 파싱 실패한 차트 자리 상자
    imageError: string;                 // 표시할 수 없는 이미지 자리 상자
    gridLabel: string;                  // Canvas aria-label 틀. "{file}", "{sheet}", "{range}" 치환
    sheetTabsLabel: string;             // 시트 탭 목록 aria-label
  };
  builtinFormats: Record<number, string>; // 로케일마다 다른 기본 서식 ID의 서식 코드
}
```

- 제공 언어: `en`(기본), `ko`. 파일 위치는 `packages/core/src/locales/{en,ko}.ts`.
- `package.json`의 `exports`에 언어별 경로(`./locales/en`, `./locales/ko`)를 하나씩 추가한다. 와일드카드를 쓰면 `locales/types`까지 노출되기 때문이다.
- 언어셋 객체는 순수 데이터이므로 Worker로 그대로 넘긴다(숫자 서식이 Worker에서 적용되기 때문).
- 오류·경고 메시지(11장)는 언어셋에 넣지 않는다. 개발자용 영어 메시지와 `code`로 내고, 사용자에게 보여줄 문구는 쓰는 쪽에서 `code`로 정한다.
- 새 언어 추가 방법(파일 하나 추가, `exports` 갱신, 테스트)은 `CONTRIBUTING.md`에 적는다.

### 10.5 스타일 사용자 정의
- Canvas는 CSS를 직접 읽지 않으므로, Canvas에 그리는 요소의 색은 `createViewer`의 `theme` 옵션으로 받는다.

```ts
createViewer(el, {
  theme: {
    gridColor: "#e2e2e2",
    headerBg: "#f3f3f3",
    headerColor: "#555",
    headerBorderColor: "#d0d0d0",
    frozenLineColor: "#9b9b9b",   // 틀 고정선
    noteIndicatorColor: "#ff0000", // 메모 삼각형
    fontFallback: '"Pretendard"',  // 일반 글꼴 이름(sans-serif 등) 앞에 끼워 넣음
  },
});
viewer.setTheme({ headerBg: "#2b2b2b" }); // 바꾸면 다시 그림. fontFallback을 바꾸면 글꼴 캐시도 다시 만듦
```

- DOM 요소(시트 탭, 메모 상자, 대체 상자)는 CSS 변수로 바꾼다: `--xv-tab-bg`, `--xv-tab-color`, `--xv-tab-active-bg`, `--xv-tab-active-color`, `--xv-tab-border`, `--xv-note-bg`, `--xv-note-border`, `--xv-placeholder-bg`, `--xv-placeholder-color`.
- 다크 모드는 라이브러리가 강제하지 않는다. 시트 내용은 파일의 색 그대로 보여야 하기 때문이다. 머리글과 탭만 바꿀 수 있다.

---

## 11. 오류 처리와 부분 실패
- 파일 전체를 열 수 없는 경우(형식 오류, 크기 초과)만 `error` 이벤트를 낸다.
- 일부 파트가 깨진 경우는 그 부분만 건너뛰고 `onWarning`으로 알린다. 예: 차트 하나 파싱 실패 → 그 차트 자리에 언어셋의 `chartError` 문구 상자.
- 경고는 `XlViewerWarning`(6장)으로, 개발자용 영어 메시지 + 코드로 낸다. 화면 표시 문구는 사용하는 쪽에서 정한다.

| 경고 코드 | 상황 |
|---|---|
| `FORMULA_WITHOUT_VALUE` | 결과값 없는 수식(빈 `<v/>` 포함). 빈칸으로 표시 |
| `CHART_PARSE_FAILED` | 차트 파싱 실패. 자리에 `chartError` 상자 |
| `CF_RULE_UNSUPPORTED` | 평가하지 않은 조건부 서식 규칙(`expression` 등) |
| `COMMENTS_PARSE_FAILED`, `VML_PARSE_FAILED`, `THREADED_COMMENTS_PARSE_FAILED` | 메모 일부를 읽지 못함 |
| `SHEET_TYPE_UNSUPPORTED` | 차트 시트, 대화 상자 시트 등. 빈 시트로 표시 |
| `PART_MISSING` | rels가 가리키는 시트 파트가 없음 |
| `RTL_UNSUPPORTED` | 오른쪽에서 왼쪽 시트. 왼쪽에서 오른쪽으로 표시 |
| `WORKER_UNAVAILABLE` | Worker를 띄우지 못해 메인 스레드에서 파싱 |

---

## 12. 테스트 전략

### 12.1 테스트 파일(fixtures)
- 생성 도구별로 모은다: Excel(Windows/Mac), Google Sheets 내보내기, LibreOffice, openpyxl, exceljs. 현재 있는 것: Excel(Windows, `fixtures/excel/`), Numbers(`fixtures/numbers/`), openpyxl(`fixtures/generated/`).
- 기능별로 작게 만든다: 숫자 서식, 테마 색, 테두리, 병합, 메모, 이미지, 차트 종류별, 숨김 행·열, 틀 고정, 대용량.
- 생성 스크립트(openpyxl, exceljs)를 저장소에 함께 두어 다시 만들 수 있게 한다.
- 실제 업무 파일은 넣지 않는다. 공개 저장소이므로 개인정보와 영업 정보가 노출될 수 있다.
- `.gitignore`는 모든 xlsx를 막고 `fixtures/generated/`만 허용한다. 생성 스크립트로 만들 수 없는 파일(Numbers, Excel이 직접 저장한 파일)은 공개해도 되는지 확인한 뒤 경로별로 예외를 추가한다.
- 기준 파일 `fixtures/numbers/sales-report.xlsx`(5.6절)는 가짜 데이터로 확인되어(2026-10-28) git 예외로 포함한다. 같은 파일을 Windows Excel에서 다시 저장한 `fixtures/excel/sales-report.xlsx`도 포함한다(`docProps/core.xml`의 작성자 실명은 지움). Excel 캡처는 `fixtures/reference/sales-report.*.excel.png`.
- 두 생성 도구의 sales-report가 모든 셀에서 같은 표시 문자열을 내는지 파서 테스트로 비교한다.

### 12.2 테스트 종류

| 종류 | 대상 | 도구 / 위치 |
|---|---|---|
| 단위 | 색 계산, 단위 변환, 셀 주소, 숫자 서식, 축 눈금, XML 토크나이저, 레이아웃, 틀 고정 영역 | Vitest, `packages/core/test/` |
| 파서 | fixture별 모델 검사(값, 서식, 메모, 차트, 조건부 서식), 생성 도구 간 결과 비교, 오류·보안(크기 상한, DTD, Strict) | Vitest |
| Canvas 그리기 | 가짜 2D 컨텍스트(`fake-canvas.ts`)로 그리기 명령을 기록해 순서, 좌표, 넘침, 병합 확인 | Vitest |
| 차트 변환 | ChartModel → ECharts 옵션 (축 눈금, 간격, 누적, 보조 축) | Vitest |
| Vue 래퍼 | 열기, 다시 열기, 해제, 이벤트 전달, 옵션 변경 | Vitest + happy-dom |
| 시각 회귀 | playground에서 fixture별 화면, 메모 오버, 틀 고정 스크롤 | Playwright (`apps/playground/tests/`), 3개 브라우저 |
| 성능 | 10만 행 파일 열기 시간, 스크롤 프레임 | `pnpm perf` |
| 번들 크기 | 3.5절 예산 | `pnpm size` (CI) |
| 소비자 번들러 | Vite, webpack 5 앱에 `npm pack` 결과를 설치해 인라인 Worker와 `workerUrl` 확인 | `scripts/consumer-check.mjs` (CI) |

### 12.3 시각 회귀 기준
- 기준 이미지는 사람이 Excel 화면과 나란히 놓고 "위화감 없음"을 승인한 뒤 등록한다.
- 이후 변경은 기준 이미지와의 차이로 검출한다.
- Canvas의 글자 렌더링은 운영체제와 브라우저마다 조금씩 다르다. 시각 회귀는 CI의 고정된 환경(Linux + Chromium, 글꼴 고정 설치)에서만 비교하고, 기준 이미지도 그 환경에서 만든다.
- 로컬에서도 같은 환경을 쓰기 위해 Playwright 공식 Docker 이미지(버전 고정)로 시각 회귀를 실행한다. macOS에서 직접 찍은 이미지는 기준으로 쓰지 않는다.
- Excel 화면 캡처는 `fixtures/reference/<fixture 이름>.excel.png`로 둔다. 개발 중에는 렌더링 결과와 이 캡처를 나란히 놓고 비교한다. 개발 PC에 Excel이 없으면(2026-10-28 현재 없음, Numbers만 있음) 다른 PC에서 찍어 넣는다. Numbers 화면은 Excel과 다르므로 임시 참고로만 쓴다.
- playground에 fixture 하나를 열어 PNG로 저장하는 명령: `pnpm shot <fixture> [--sheet N] [--mouse x,y] [--scroll x,y] [--browser chromium|webkit|firefox]`. 결과는 `.shots/`(git 제외).
- 기준 이미지 만들기: `pnpm visual:docker -- --update-snapshots` 또는 GitHub Actions의 "Visual baselines" 워크플로. 결과를 Excel 캡처와 비교해 승인한 뒤 `apps/playground/tests/__screenshots__/`에 커밋한다. 커밋되기 전까지 CI의 시각 회귀 작업은 건너뛴다.

---

## 13. 단계별 계획과 완료 조건

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| 0 | 저장소, 빌드, 테스트, CI, playground, 스크린샷 명령, 시각 회귀 Docker 환경, Worker 로딩(10.3절), 언어셋 진입점(10.4절) | 빈 패키지가 빌드·배포 리허설(`npm pack`)까지 통과. Vite와 webpack 5 빈 프로젝트에서 인라인 Worker와 `workerUrl` 방식 모두 동작. `numfmt` 포함 번들 크기 측정 |
| 1a | 파서(workbook, sharedStrings, styles, theme, sheet), 숫자 서식, 언어셋 en/ko | fixture 기본 세트와 sales-report 파서 스냅샷 통과, 10만 행 파싱 목표 충족 |
| 1b | Canvas 그리드(값, 서식, 줄바꿈, 병합, 크기, 숨김, 눈금선, 테두리, 머리글, 고해상도 대응) + 시트 탭 + Vue 래퍼 | fixture 기본 세트의 시각 회귀 통과, sales-report 두 시트가 표시됨, 8.14절 프레임 목표 충족 |
| 2 | DOM 오버레이(메모, 이미지), 텍스트 넘침, `###` 표시, 틀 고정, 배율, 스레드 댓글 | sales-report `매출현황` 시트 A1~E1의 메모 5개가 마우스 오버로 표시됨 |
| 3 | 차트 (A6의 종류), 캐시/참조 두 방식 모두 | sales-report의 묶은 세로 막대 차트 2개가 표시됨. 캐시를 지운 같은 차트(셀 참조만)도 같게 표시됨 |
| 4 | 조건부 서식(색조, 데이터 막대, 아이콘 집합, 규칙 기반 서식) | 조건부 서식 fixture 시각 회귀 통과 |
| 5 | 0.x 공개, 오픈소스 배포 | `02-open-source-guide.md`의 공개 전 점검 목록 완료 |

진행 상태 (2026-10-28):

| 단계 | 상태 | 근거 / 남은 것 |
|---|---|---|
| 0 | 완료 | 빌드, `npm pack`, Vite·webpack 5 × 인라인·`workerUrl` 4가지 모두 통과, 크기 측정(3.5절) |
| 1a | 완료 | 파서 테스트 통과, 10만 행 열기 2.5~2.7초 |
| 1b | 기능 완료, 기준 이미지 대기 | sales-report 두 시트가 Excel 캡처와 같게 표시됨(로컬 스크린샷). 프레임 평균 3.8ms. 시각 회귀 기준 이미지는 Docker에서 만든 뒤 사람이 승인해야 함 |
| 2 | 기능 완료, 기준 이미지 대기 | 메모 5개 마우스 오버 표시(Chromium, WebKit), 틀 고정, 배율, 이미지, 넘침, `###` |
| 3 | 완료 | 막대 차트 2개 표시. 캐시를 지운 파일과 참조를 깨뜨린 파일 모두 같은 값(파서 테스트) |
| 4 | 기능 완료, 기준 이미지 대기 | 색조, 데이터 막대, 아이콘, 값·상위·평균·중복·텍스트 규칙 |
| 5 | 준비 완료, 배포 전 | 공개 문서와 CI·배포 워크플로 작성. npm 조직, 2FA, Trusted Publishing 설정, GitHub 저장소 생성은 관리자가 해야 함 |

1단계가 끝나면 `vue-tree` 프로젝트의 `/excel`(SpreadJS)과 `/univer` 화면을 xl-viewer로 대체해서 실제 사용성을 확인한다.

---

## 14. 알려진 제한 (v1)
- 셀 텍스트를 마우스로 선택하거나 복사할 수 없고, 브라우저 찾기(Ctrl+F)로 셀 내용을 찾을 수 없다(D5, Canvas 방식).
- 화면 낭독기가 셀 내용을 읽지 못한다(8.13절).
- 글꼴이 사용자 PC에 없으면 대체 글꼴로 표시되어 줄바꿈 위치와 넘침 길이가 Excel과 달라질 수 있다.
- 줄바꿈 셀의 행 높이를 파일이 저장하지 않았다면 Excel처럼 자동으로 늘어나지 않는다.
- 결과값 없이 저장된 수식은 빈칸으로 보인다.
- 셀 회전 텍스트는 0°, 90°, −90°, 세로 쓰기만 정확히 맞춘다. 그 외 각도는 근사한다.
- 사각형·둥근 사각형·타원과 텍스트 상자는 그룹 안에 있어도 표시한다(채우기 색, 테두리, 글꼴, 정렬, 줄 간격, 자간). 그 외 도형(화살표 등)은 윤곽을 그리지 않고 글자만 남기며, 회전·뒤집기·그림 자르기·그라데이션(첫 색만 사용)·SmartArt·스파크라인은 표시하지 않는다.
- 조건부 서식: 수식 규칙(`expression`)과 수식으로 정한 기준값(`cfvo type="formula"`)은 평가하지 않는다(`CF_RULE_UNSUPPORTED` 경고). `timePeriod` 규칙은 보는 PC의 오늘 날짜 기준이다. 데이터 막대는 음수 축을 따로 그리지 않는다. 아이콘은 Excel 아이콘을 모양과 색으로 근사한다. x14 확장(`extLst`)의 조건부 서식은 읽지 않는다.
- 들여쓰기 폭(단계당 MDW × 3)은 Excel 화면과 비교해 보정하지 않았다.
- 패턴 채우기는 단색으로 근사한다(5.4절).
- 차트 축 레이블 서식은 천 단위 구분, 소수 자릿수, `%`만 반영한다. 차트 안 글꼴은 차트에 지정된 글꼴이 없으면 Calibri 계열로 그린다.
- `centerContinuous` 정렬은 가운데 정렬로 근사한다(오른쪽 빈 셀로 넘쳐 가운데에 놓임).
- 차트가 숨긴 행·열의 데이터를 제외하는 설정(`plotVisOnly`)은 반영하지 않는다. 셀 참조 범위의 값을 모두 쓴다.
- 조건부 서식의 `timePeriod` 날짜 비교는 1904 날짜 체계를 따로 고려하지 않는다.

---

## 15. 남은 결정 사항

| # | 질문 | 영향 |
|---|---|---|
| Q1 | 패키지 이름을 `xl-viewer`로 확정할지 | npm 조직 생성, 저장소 이름 |
| Q4 | 도형·텍스트 상자를 향후 범위에 넣을지 | 5단계 이후 계획 |

확정된 질문: Q2 → D7(MIT), Q3 → D8, Q5(기준 파일 공개) → 12.1절.

---

## 16. 변경 이력

| 버전 | 내용 |
|---|---|
| v0.3 | 라이선스(MIT)·지원 브라우저·Worker 로딩·언어셋 확정, `ssf` → `numfmt`, 기준 파일 반영 |
| v0.4 | 구현 후 반영. A1 XML 파서를 `saxes`에서 자체 토크나이저로 교체(10만 행 시트 토큰화 1.3초 → 0.6초, 전체 파싱 3.3초 → 1.7초). 3.5절 코어 예산 60KB → 65KB(실측 62.3KB). 차트 데이터는 셀 참조 우선·캐시 폴백(5.5절). 6장 모델을 구현에 맞춤(`type`, `fmtColor`, `cf`, `dxfs`, `defaultFont`, `view.topRow/leftCol/showHeaders`, 메모 VML 위치·색, 차트 축·그림 영역 상세). MDW 표(7.3절). 오버레이를 틀 고정 영역별 층으로 구성(8.1절). 공개 API에 `getActiveSheet`, `getModel`, `off`, `getStats`, `maxCells`, `theme.frozenLineColor`·`noteIndicatorColor` 추가(10장). 경고 코드 표(11장) |
| v0.4.1 | 독립 코드 리뷰 3건(파서, 렌더러, 패키징)의 확인된 문제와 보안 점검에서 재현된 문제를 수정. 파서: 앵커 전체가 `mc:AlternateContent`로 감싸진 차트가 사라지던 문제, 값 없는 `t="s"` 셀이 첫 공유 문자열로 표시되던 문제, 1904 통합 문서의 `t="d"` 날짜가 4년 밀리던 문제, 조건부 서식이 빈 셀을 건너뛰던 문제(Excel은 0으로 비교), 범위가 많은 조건부 서식의 O(범위 × 전체 행) 비용, `<c:delete/>`(값 없는 불리언)를 거짓으로 읽던 문제. 렌더러: 한쪽만 틀 고정한 시트의 행·열 머리글 누락·중복, 스크롤 후 병합 셀 글자가 병합 밖으로 넘치던 문제, 줄바꿈 캐시가 다른 셀의 글자색·밑줄을 섞던 문제, 열기 도중 `destroy()` 시 Worker 누수, 웹 폰트 로드 후 열 너비 미갱신, 차트 생성 실패 시 ECharts 인스턴스 누수. 보안(5.7절): `__proto__` ZIP 항목, 조건부 서식 범위 증폭, 병합 셀 조회 비용, 글꼴 이름 정화, 툴팁 이스케이프. 패키징: 소스 import에 `.js` 확장자를 붙여 `nodenext` 사용자도 `.d.ts`를 해석, `./locales/<언어>` 개별 export와 `./package.json` export, 배포 빌드의 소스맵 제거, CI의 job 단위 `hashFiles` 조건 제거 |
| v0.4.2 | 사용자 요청 반영. 그룹(`grpSp`) 안의 그림과 도형·텍스트 상자를 표시(5.5절 근처 드로잉 파서, 한계는 14장). 행·열 크기 조절과 내용 맞춤(7.5절), `resizable`·`autoFitRows` 옵션(10장). 코어 예산 65KB → 68KB(3.5절, 실측 66.0KB). 7.3절의 "자동 맞춤 행 높이 v1 제한"을 옵션으로 대체 |
| v0.4.3 | 사용자 요청 반영. 저장된 배율이 작은 문서가 알아보기 힘들게 열리는 문제. `minFontSize`(기본 12px) 옵션으로 배율 하한을 둔다(8.12절, 10장) |
| v0.4.4 | 이름을 `sheetlens`에서 `xl-viewer`로 변경. npm 범위 `@xl-viewer/core`·`@xl-viewer/vue`, 타입 `XlViewerError`·`XlViewerWarning`·`XlViewerLocale`, Vue 컴포넌트 `XlViewer`, CSS 접두어 `sl-` → `xv-`(변수 `--xv-*`), 스타일 파일 `xl-viewer.css`, 디버그 훅 `window.__xlViewer` |

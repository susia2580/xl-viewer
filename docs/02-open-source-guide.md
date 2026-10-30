# xl-viewer 오픈소스 공개 가이드

`01-design.md`로 만든 패키지를 npm에 배포하고 GitHub에서 오픈소스로 운영하기 위한 절차와 점검 목록.

| 항목 | 내용 |
|---|---|
| 문서 상태 | 초안 v0.2 (2026-10-28, MIT 확정, ssf → numfmt) |
| 대상 독자 | 패키지 관리자(메인테이너) |

> npm과 GitHub의 화면 구성과 정책은 자주 바뀐다. 실제 설정할 때는 각 서비스의 공식 문서를 함께 확인한다.

---

## 1. 전체 흐름

```
이름 확보 → 라이선스 결정 → 저장소 공개 준비 → CI 구성 → 첫 배포(0.1.0) → 홍보·운영
```

---

## 2. 라이선스 선택

### 2.1 후보

| | MIT | Apache-2.0 |
|---|---|---|
| 특징 | 짧고 단순, JS 생태계에서 가장 흔함 | 특허 사용 허락 조항이 명시됨, 변경 사항 표시 의무 |
| 사용자 입장 | 가장 부담 없음 | 기업 법무팀이 선호하는 경우가 있음 |
| 의무 | 저작권 고지 유지 | 저작권 고지 + NOTICE 파일 유지 + 변경 표시 |

### 2.2 의존성과의 호환
설계상 의존성의 라이선스는 다음과 같다(2026-10-28 npm 기준).

| 패키지 | 라이선스 |
|---|---|
| fflate | MIT |
| numfmt | MIT |
| echarts | Apache-2.0 |

모두 허용형 라이선스라서 MIT와 Apache-2.0 어느 쪽으로 배포해도 문제없다. 의존성을 번들에 포함해 배포하지 않고 npm 의존성으로 두므로, 각 패키지의 고지는 해당 패키지가 스스로 유지한다. 의존성을 추가할 때마다 라이선스를 확인하고, GPL·AGPL 계열은 넣지 않는다.

### 2.3 결정
**MIT**로 확정했다(2026-10-28). 개인이 운영하는 경량 라이브러리에는 관리 부담이 가장 적고, 사용자도 가장 쉽게 받아들인다.

### 2.4 OOXML 사양 사용
xlsx 형식은 공개 표준(ECMA-376, ISO/IEC 29500)이다. Microsoft는 이 사양의 구현에 대해 Open Specification Promise로 특허권을 행사하지 않겠다고 약속했다. 공개 전에 해당 약속이 현재도 유효한지 Microsoft 공식 페이지에서 한 번 확인한다.

### 2.5 클린룸 원칙
- 상용 라이브러리(SpreadJS 등)의 코드를 분석하거나 옮겨 오지 않는다. 대부분의 상용 약관은 역분석을 금지한다.
- 참고 자료는 ECMA-376 문서, Microsoft의 공개 문서([MS-OI29500] 등), 허용형 라이선스의 오픈소스 구현으로 한정한다.
- 이 원칙을 `CONTRIBUTING.md`에 명시해서 기여자도 지키게 한다.

---

## 3. 이름과 계정 확보
1. npm 계정에 **2단계 인증(2FA)** 을 켠다.
2. npm에서 조직 `xl-viewer`를 만든다(무료 공개 조직). 그래야 `@xl-viewer/*` 스코프를 쓸 수 있다.
3. GitHub에 같은 이름의 조직이나 저장소를 만든다(예: `github.com/<계정>/xl-viewer`).
4. 이름에 "Excel", "Microsoft"를 넣지 않는다(상표).

---

## 4. 저장소 공개 준비

### 4.1 필수 파일

| 파일 | 내용 |
|---|---|
| `LICENSE` | 2절에서 정한 라이선스 전문, 저작권자 이름과 연도 |
| `README.md` | 한 줄 소개, 데모 링크, 설치, 최소 사용 예(코어, Vue), 지원 기능 표, 알려진 제한, 브라우저 지원 범위 |
| `CONTRIBUTING.md` | 개발 환경 구성, 테스트 실행, fixture 추가 방법, 커밋 규칙, 클린룸 원칙 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 사용 |
| `SECURITY.md` | 취약점 제보 방법(GitHub의 비공개 취약점 제보 기능 사용), 지원 버전 |
| `CHANGELOG.md` | Changesets가 자동 생성 |
| `.github/ISSUE_TEMPLATE/` | 버그 제보 양식: 재현 파일(민감 정보 제거), 생성 도구, 브라우저, 기대 화면 vs 실제 화면 캡처 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 변경 요약, 테스트 여부, changeset 추가 여부 |

README는 영어로 쓰고, 한국어 README(`README.ko.md`)를 함께 두는 것을 권장한다. 사용자층을 넓히기 위해서다.

### 4.2 package.json 필수 항목

```json
{
  "name": "@xl-viewer/core",
  "version": "0.1.0",
  "description": "Lightweight read-only xlsx viewer for the browser",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./styles.css": "./dist/xl-viewer.css",
    "./worker": "./dist/parser.worker.js",
    "./locales/en": { "types": "./dist/locales/en.d.ts", "import": "./dist/locales/en.js" },
    "./locales/ko": { "types": "./dist/locales/ko.d.ts", "import": "./dist/locales/ko.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "sideEffects": ["*.css"],
  "repository": { "type": "git", "url": "git+https://github.com/<계정>/xl-viewer.git", "directory": "packages/core" },
  "homepage": "https://<계정>.github.io/xl-viewer/",
  "bugs": "https://github.com/<계정>/xl-viewer/issues",
  "keywords": ["xlsx", "spreadsheet", "viewer", "ooxml"],
  "publishConfig": { "access": "public", "provenance": true }
}
```

- `files`로 `dist`만 배포해서 테스트 파일과 소스가 패키지에 섞이지 않게 한다.
- 스코프 패키지는 기본이 비공개이므로 `publishConfig.access: "public"`이 필요하다.
- `<계정>`은 3절에서 만든 GitHub 계정/조직 이름으로 바꾼다.

### 4.3 공개 전에 저장소에서 빼야 할 것
- 실제 업무 xlsx 파일(개인정보, 매출 등). fixture는 생성 스크립트로 만든 가짜 데이터만 쓴다.
- `.env`, 토큰, 개인 경로가 들어간 설정 파일.
- git 기록에 한 번이라도 들어갔다면 파일 삭제만으로는 부족하다. 기록을 정리하거나 새 저장소로 시작한다.

---

## 5. 버전과 변경 기록
- Semantic Versioning을 따른다. 공개 API가 안정될 때까지는 `0.x`로 배포한다. `0.x`에서는 마이너 버전(0.1 → 0.2)에 호환이 깨지는 변경을 넣을 수 있다.
- 공개 API(`01-design.md` 10절)가 확정되고 실제 사용 사례가 쌓이면 `1.0.0`을 낸다.
- Changesets 흐름:
  1. 기능 PR마다 `pnpm changeset`으로 변경 내용과 버전 단계(patch/minor/major)를 기록한다.
  2. main에 병합되면 CI가 "버전 올리기 PR"을 자동으로 만든다.
  3. 그 PR을 병합하면 CI가 npm에 배포하고 GitHub Release를 만든다.
- `@xl-viewer/core`와 `@xl-viewer/vue`는 버전을 함께 올린다(Changesets의 `fixed` 설정). 사용자가 두 패키지의 버전 조합을 고민하지 않게 하기 위해서다.

---

## 6. CI/CD (GitHub Actions)

### 6.1 PR마다 실행
- 타입 체크, 린트, 단위 테스트
- 시각 회귀 테스트(Playwright). 차이가 나면 결과 이미지를 아티팩트로 올린다.
- 번들 크기 검사(`01-design.md` 3.5절 목표)
- `npm audit --audit-level=high`

### 6.2 배포
- 로컬 PC에서 `npm publish`를 하지 않고 GitHub Actions에서만 배포한다.
- npm의 **Trusted Publishing**(GitHub Actions OIDC)을 설정해서 npm 토큰을 저장소 비밀값에 두지 않는다. 이 방식으로 배포하면 출처 증명(provenance)이 패키지에 함께 기록되어, 사용자가 어떤 커밋에서 빌드됐는지 확인할 수 있다.
- 워크플로에는 `permissions: id-token: write`가 필요하다. 세부 설정은 npm 공식 문서의 Trusted Publishing 항목을 따른다.

### 6.3 데모 사이트
- `apps/playground`를 GitHub Pages로 배포한다. 사용자가 자기 파일을 올려 바로 확인할 수 있게 한다.
- 데모는 파일을 서버로 보내지 않고 브라우저 안에서만 처리한다는 점을 화면에 명시한다.

---

## 7. 첫 배포 전 점검 목록
- [x] 라이선스 결정 (MIT)
- [x] `LICENSE` 파일 추가 (저작권자 "xl-viewer contributors". 실명으로 바꾸려면 루트와 두 패키지의 `LICENSE`를 함께 수정)
- [ ] npm 2FA, npm 조직, GitHub 저장소 준비 (관리자 작업)
- [x] README(영어/한국어), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY 작성
- [x] `npm pack --dry-run`으로 패키지에 `dist`만 들어가는지 확인 (`dist`, `LICENSE`, `README.md`, `package.json`)
- [x] 빈 Vite 프로젝트에서 설치해 Worker 로딩 확인 (`scripts/consumer-check.mjs`. Vue 래퍼는 playground에서 확인)
- [x] Vite 외 번들러(webpack 5)에서도 Worker가 로드되는지 확인
- [ ] 저장소와 git 기록에 실제 업무 파일과 비밀값이 없는지 확인 (첫 커밋 전에 `git status`로 확인. `docs/2.xlsx` 원본은 git 제외 상태)
- [ ] 시각 회귀 기준 이미지 승인과 커밋 (설계 12.3절)
- [ ] 배포 워크플로 검증: `release.yml`의 `setup-node`에 `registry-url`을 주면 자리표시용 `NODE_AUTH_TOKEN`이 설정되어 OIDC(Trusted Publishing)와 충돌할 수 있다. 첫 배포는 `0.1.0-beta.0`으로 리허설하고, 인증 오류가 나면 `registry-url` 줄을 빼 본다. `pnpm/action-setup`이 pnpm 12를 설치하는지도 이때 확인한다.
- [ ] Trusted Publishing 설정 후 테스트 배포(예: `0.1.0-beta.0`, `next` 태그). 워크플로는 `.github/workflows/release.yml`
- [ ] 데모 사이트 배포 (`.github/workflows/pages.yml`, 저장소 설정에서 Pages 소스를 GitHub Actions로 지정)
- [ ] `0.1.0` 배포, GitHub Release 작성

---

## 8. 공개 후 운영
- **이슈 분류**: 라벨을 `bug`, `rendering-diff`(Excel과 다르게 보임), `parser`(파일이 안 열림), `feature`, `good first issue`로 나눈다.
- **재현 파일**: 버그 제보 시 재현 파일을 요청하되, 민감 정보를 지운 파일만 받는다. 받은 파일을 fixture로 쓸 때는 제보자의 동의를 받는다.
- **범위 관리**: "뷰어 전용, 가벼움"이 프로젝트의 정체성이다. 편집, 수식 계산 요청은 범위 밖임을 README에 명시하고 정중히 거절한다.
- **의존성 관리**: Dependabot 또는 Renovate로 의존성 업데이트 PR을 자동으로 받는다.
- **지원 정책**: 최신 마이너 버전만 보안 수정을 한다는 내용을 `SECURITY.md`에 적는다.
- **알리기**: 첫 공개 후 GitHub Topics(`xlsx`, `spreadsheet`, `viewer`) 설정, 관련 커뮤니티에 소개 글 작성.

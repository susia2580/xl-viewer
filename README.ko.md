# xl-viewer

브라우저에서 xlsx 파일을 "보기만" 하는 경량 뷰어입니다. 셀 영역은 Canvas로, 메모·이미지·차트는 DOM으로 그려서 큰 시트도 부드럽게 스크롤됩니다.

[데모](https://susia2580.github.io/xl-viewer/) · [English](README.md)

파일은 Web Worker에서 해석하며 서버로 전송되지 않습니다.

## 패키지

| 패키지            | 설명                        |
| ----------------- | --------------------------- |
| `@xl-viewer/core` | 프레임워크 무관 뷰어와 파서 |
| `@xl-viewer/vue`  | Vue 3 컴포넌트              |

## 설치

```sh
npm install @xl-viewer/core
# Vue
npm install @xl-viewer/vue
```

## 사용법

```ts
import { createViewer } from "@xl-viewer/core";
import "@xl-viewer/core/styles.css";

const viewer = createViewer(document.getElementById("sheet")!);
await viewer.open(file); // File | Blob | ArrayBuffer | Uint8Array
```

컨테이너에 높이를 지정해야 합니다. 뷰어는 컨테이너를 가득 채웁니다.

### Vue

```vue
<script setup lang="ts">
import { XlViewer } from "@xl-viewer/vue";
import "@xl-viewer/core/styles.css";
</script>

<template>
  <XlViewer :src="file" style="height: 600px" />
</template>
```

### 언어 설정

영어가 기본으로 들어 있고, 한국어는 별도 진입점에서 가져옵니다. 쓰지 않는 언어는 번들에 포함되지 않습니다.

```ts
import { ko } from "@xl-viewer/core/locales/ko";
createViewer(el, { locale: ko });
```

언어셋은 화면 문구와 지역마다 다른 기본 숫자 서식(날짜, 통화)을 정합니다. 오류·경고 메시지는 영어와 `code`로 제공하므로, 화면에 보일 문구는 `code`를 기준으로 직접 정하면 됩니다.

### Web Worker와 CSP

기본값은 `blob:` URL로 띄우는 인라인 Worker라서 번들러 설정이 필요 없습니다. CSP에서 `worker-src blob:`을 막는다면 `node_modules/@xl-viewer/core/dist/parser.worker.js`를 직접 배포하고 `workerUrl`로 지정하세요. Worker를 띄울 수 없으면 메인 스레드에서 파싱하고 `WORKER_UNAVAILABLE` 경고를 냅니다.

## 지원 범위

값과 저장된 수식 결과, 숫자 서식, 글꼴·채우기·테두리·정렬, 병합, 숨김 행·열, 텍스트 넘침, 틀 고정, 배율, 메모, 이미지, 사각형·둥근 사각형·타원·텍스트 상자, 차트(세로/가로 막대, 꺾은선, 영역, 원형, 도넛, 분산형, 콤보), 조건부 서식(색조, 데이터 막대, 아이콘, 값·텍스트·상위·평균·중복 규칙)을 표시합니다.

행·열 경계를 드래그하거나 더블클릭해 크기를 바꿀 수 있습니다(`resizable`, 보기 전용이며 파일은 바뀌지 않음). 줄바꿈 셀에 맞춰 행 높이를 키우려면 `autoFitRows`를 켭니다.

수식 계산, 편집, 선택, 복사, 검색, 수식 기반 조건부 서식, 그 밖의 도형(윤곽은 그리지 않고 글자만 표시), SmartArt, 스파크라인은 지원하지 않습니다. `.xls`, `.xlsb`, `.ods`, 암호화된 파일, Strict OOXML은 `UNSUPPORTED_FORMAT` 오류로 안내합니다.

## 지원 브라우저

Chrome, Edge, Safari, Firefox 각각 최근 2개 메이저 버전.

## 라이선스

[MIT](LICENSE)

# xl-viewer

Lightweight, read-only xlsx viewer for the browser. It draws the cell grid on a canvas and puts notes, images and charts in a DOM overlay, so large sheets scroll smoothly.

[Demo](https://susia2580.github.io/xl-viewer/) · [한국어](README.ko.md)

Files are parsed in a Web Worker and never leave the browser.

## Packages

| Package           | Description                      |
| ----------------- | -------------------------------- |
| `@xl-viewer/core` | Framework-free viewer and parser |
| `@xl-viewer/vue`  | Vue 3 component                  |

## Install

```sh
npm install @xl-viewer/core
# Vue
npm install @xl-viewer/vue
```

## Usage

```ts
import { createViewer } from "@xl-viewer/core";
import "@xl-viewer/core/styles.css";

const viewer = createViewer(document.getElementById("sheet")!, {
  onWarning: (w) => console.warn(w.code, w.message),
});
await viewer.open(file); // File | Blob | ArrayBuffer | Uint8Array

viewer.getSheetNames();
viewer.setActiveSheet(1);
viewer.on("sheetchange", (index) => {});
viewer.destroy();
```

The container needs a height; the viewer fills it.

### Vue

```vue
<script setup lang="ts">
import { XlViewer } from "@xl-viewer/vue";
import "@xl-viewer/core/styles.css";
</script>

<template>
  <XlViewer :src="file" style="height: 600px" @load="onLoad" @error="onError" />
</template>
```

Props: `src`, `showHeaders`, `showTabs`, `resizable`, `autoFitRows`, `minFontSize`, `useWorker`, `workerUrl`, `locale`, `theme`, `maxFileSize`, `maxUncompressedSize`, `maxCells`. Events: `load`, `error`, `warning`, `sheetchange`.

### Parse only

```ts
import { parseXlsx } from "@xl-viewer/core";
const model = await parseXlsx(arrayBuffer);
```

### Language

English is built in. Other languages are separate entry points, so unused ones are not bundled.

```ts
import { ko } from "@xl-viewer/core/locales/ko";
createViewer(el, { locale: ko });
```

A locale sets the on-screen messages and the built-in number formats that differ by region (dates, currency). Error and warning messages stay in English with a stable `code`.

### Web Worker and CSP

By default the parser runs in an inline worker started from a `blob:` URL, which needs no bundler setup. If your Content Security Policy blocks `worker-src blob:`, serve `node_modules/@xl-viewer/core/dist/parser.worker.js` yourself and pass its URL:

```ts
createViewer(el, { workerUrl: "/assets/parser.worker.js" });
```

If no worker can start, parsing falls back to the main thread and a `WORKER_UNAVAILABLE` warning is reported.

### Styling

Canvas colours come from the `theme` option (`gridColor`, `headerBg`, `headerColor`, `headerBorderColor`, `frozenLineColor`, `noteIndicatorColor`, `fontFallback`). Sheet tabs, note boxes and placeholders use CSS variables: `--xv-tab-bg`, `--xv-tab-color`, `--xv-tab-active-bg`, `--xv-tab-active-color`, `--xv-tab-border`, `--xv-note-bg`, `--xv-note-border`, `--xv-placeholder-bg`, `--xv-placeholder-color`.

### Limits

`maxFileSize` (default 20 MB), `maxUncompressedSize` (200 MB) and `maxCells` (5,000,000) protect against oversized or malicious files. Exceeding them rejects `open()` with `FILE_TOO_LARGE` or `PARSE_ERROR`.

## What it shows

| Feature                                                                                             | Support                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Values, cached formula results                                                                      | Yes (formulas are not calculated)     |
| Number formats, dates, colours in formats                                                           | Yes                                   |
| Fonts, fills, borders, alignment, wrap, rotation, indent                                            | Yes                                   |
| Merged cells, hidden rows/columns, row heights, column widths                                       | Yes                                   |
| Text overflow, `###` for numbers that don't fit                                                     | Yes                                   |
| Frozen panes, saved zoom                                                                            | Yes                                   |
| Notes (hover), threaded comments                                                                    | Yes                                   |
| Images (PNG, JPEG, GIF)                                                                             | Yes                                   |
| Charts: column, bar, line, area, pie, doughnut, scatter, combo                                      | Yes, via ECharts loaded on demand     |
| Conditional formatting: colour scales, data bars, icon sets, value/text/top/average/duplicate rules | Yes                                   |
| Conditional formatting with formula (`expression`) rules                                            | No                                    |
| Rectangles, rounded rectangles, ellipses and text boxes (also inside groups)                        | Yes                                   |
| Other shapes (outline not drawn, text kept), SmartArt, sparklines, pivot refresh                    | No                                    |
| Drag-resize rows and columns, double-click to fit (view only)                                       | Yes (`resizable`)                     |
| `.xls`, `.xlsb`, `.ods`, encrypted or Strict OOXML files                                            | No (reported as `UNSUPPORTED_FORMAT`) |

Editing, selection, copy and search are out of scope: this is a viewer.

## Known limitations

- Canvas text can't be selected, copied or found with the browser's find.
- Screen readers get a label for the sheet, not the cell contents.
- Missing fonts fall back to similar ones, so wrapping and overflow can differ slightly from Excel.
- Formulas saved without a cached result show as empty cells.

## Browser support

The latest two major versions of Chrome, Edge, Safari and Firefox.

## Size (gzip)

| Chunk                                        | Size    |
| -------------------------------------------- | ------- |
| Core, including the inline parser worker     | ~62 KB  |
| Charts (loaded only when a sheet has charts) | ~190 KB |
| Vue wrapper                                  | < 1 KB  |

## License

[MIT](LICENSE)

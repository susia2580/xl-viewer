<script setup lang="ts">
import type { LoadInfo, XlViewerError, XlViewerWarning, Viewer } from "@xl-viewer/core";
import { ko } from "@xl-viewer/core/locales/ko";
import { XlViewer } from "@xl-viewer/vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { FIXTURES } from "./fixtures";

const params = new URLSearchParams(location.search);
const fixture = ref(params.get("fixture") ?? FIXTURES[0]);
const src = shallowRef<ArrayBuffer | File>();
const lang = ref(params.get("lang") ?? "ko");
const headers = ref(params.get("headers") !== "0");
const fitRows = ref(params.get("fit") === "1");
const error = ref("");
const stats = ref("");
const viewerRef = ref<{ viewer: Viewer | undefined }>();
const locale = computed(() => (lang.value === "ko" ? ko : undefined));

async function loadFixture(name: string) {
  error.value = "";
  const res = await fetch(import.meta.env.BASE_URL + name);
  if (!res.ok) {
    error.value = `Fixture not found: ${name}`;
    return;
  }
  src.value = await res.arrayBuffer();
}

function onWarning(w: XlViewerWarning) {
  console.warn(`[${w.code}] ${w.message}`);
}

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = "";
  src.value = file;
}

function onLoad(info: LoadInfo) {
  const w = window as unknown as { __xlViewer?: unknown };
  w.__xlViewer = { ready: true, info, viewer: viewerRef.value?.viewer };
  const sheet = Number(params.get("sheet") ?? 0);
  if (sheet > 0) viewerRef.value?.viewer?.setActiveSheet(sheet);
}

function onError(e: XlViewerError) {
  error.value = `${e.code}: ${e.message}`;
  (window as unknown as { __xlViewer?: unknown }).__xlViewer = { ready: true, error: e.code };
}

let timer = 0;
onMounted(() => {
  loadFixture(fixture.value);
  timer = window.setInterval(() => {
    const s = viewerRef.value?.viewer?.getStats();
    if (s) stats.value = `frame ${s.frameMs.toFixed(1)} ms | measure cache ${(s.measureHitRate * 100).toFixed(0)}%`;
  }, 500);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="app">
    <div class="bar">
      <h1>xl-viewer</h1>
      <label>
        Fixture
        <select v-model="fixture" @change="loadFixture(fixture)">
          <option v-for="f in FIXTURES" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
      <label>Open file <input type="file" accept=".xlsx,.xlsm" @change="onFile" /></label>
      <label>
        Locale
        <select v-model="lang">
          <option value="ko">ko</option>
          <option value="en">en</option>
        </select>
      </label>
      <label><input v-model="headers" type="checkbox" /> Headers</label>
      <label><input v-model="fitRows" type="checkbox" /> Fit rows</label>
      <span class="stats">{{ stats }}</span>
      <span class="note">Files are processed in your browser and never uploaded.</span>
    </div>
    <p v-if="error" class="warnings">{{ error }}</p>
    <XlViewer
      ref="viewerRef"
      class="viewer"
      :src="src"
      :locale="locale"
      :show-headers="headers"
      :auto-fit-rows="fitRows"
      @load="onLoad"
      @error="onError"
      @warning="onWarning"
    />
  </div>
</template>

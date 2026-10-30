import {
  createViewer,
  type LoadInfo,
  type OpenSource,
  type XlViewerError,
  type XlViewerLocale,
  type XlViewerWarning,
  type Viewer,
  type ViewerTheme,
} from "@xl-viewer/core";
import { defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch, type PropType } from "vue";

export const XlViewer = defineComponent({
  name: "XlViewer",
  props: {
    src: { type: [Object, ArrayBuffer] as PropType<OpenSource | null | undefined>, default: undefined },
    showHeaders: { type: Boolean, default: true },
    showTabs: { type: Boolean, default: true },
    minFontSize: { type: Number, default: 12 },
    resizable: { type: Boolean, default: true },
    autoFitRows: { type: Boolean, default: false },
    useWorker: { type: Boolean, default: true },
    workerUrl: { type: [String, Object] as PropType<string | URL>, default: undefined },
    locale: { type: Object as PropType<XlViewerLocale>, default: undefined },
    theme: { type: Object as PropType<Partial<ViewerTheme>>, default: undefined },
    maxFileSize: { type: Number, default: undefined },
    maxUncompressedSize: { type: Number, default: undefined },
    maxCells: { type: Number, default: undefined },
  },
  emits: {
    load: (_info: LoadInfo) => true,
    error: (_error: XlViewerError) => true,
    warning: (_warning: XlViewerWarning) => true,
    sheetchange: (_index: number) => true,
  },
  setup(props, { emit, expose }) {
    const el = shallowRef<HTMLDivElement>();
    const viewer = shallowRef<Viewer>();

    const create = () => {
      viewer.value?.destroy();
      if (!el.value) return;
      const v = createViewer(el.value, {
        showHeaders: props.showHeaders,
        showTabs: props.showTabs,
        minFontSize: props.minFontSize,
        resizable: props.resizable,
        autoFitRows: props.autoFitRows,
        useWorker: props.useWorker,
        ...(props.workerUrl ? { workerUrl: props.workerUrl } : {}),
        ...(props.locale ? { locale: props.locale } : {}),
        ...(props.theme ? { theme: props.theme } : {}),
        ...(props.maxFileSize ? { maxFileSize: props.maxFileSize } : {}),
        ...(props.maxUncompressedSize ? { maxUncompressedSize: props.maxUncompressedSize } : {}),
        ...(props.maxCells ? { maxCells: props.maxCells } : {}),
        onWarning: (w) => emit("warning", w),
      });
      v.on("load", (info) => emit("load", info));
      v.on("error", (e) => emit("error", e));
      v.on("sheetchange", (i) => emit("sheetchange", i));
      viewer.value = v;
      if (props.src) open(props.src);
    };

    const open = (src: OpenSource) => {
      // Errors are reported through the `error` event.
      viewer.value?.open(src).catch(() => undefined);
    };

    onMounted(create);
    onBeforeUnmount(() => {
      viewer.value?.destroy();
      viewer.value = undefined;
    });
    watch(
      () => props.src,
      (src) => {
        if (src) open(src);
      },
    );
    watch(
      () => [
        props.showHeaders,
        props.showTabs,
        props.minFontSize,
        props.resizable,
        props.autoFitRows,
        props.useWorker,
        props.workerUrl,
        props.locale,
        props.maxFileSize,
        props.maxUncompressedSize,
        props.maxCells,
      ],
      create,
    );
    watch(
      () => props.theme,
      (theme) => {
        if (theme) viewer.value?.setTheme(theme);
      },
      { deep: true },
    );

    expose({ viewer });
    return () => h("div", { ref: el, class: "xl-viewer-vue" });
  },
});

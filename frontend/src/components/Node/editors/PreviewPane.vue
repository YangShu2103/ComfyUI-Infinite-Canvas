<template>
  <div
    ref="stageEl"
    class="preview-stage"
    :class="{
      'is-zoomed': isImage && zoom > 1,
      'is-pannable': isImage && zoom > 1,
      'has-strip': showStrip && isVideo,
      'is-fullscreen': fullscreen,
    }"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <CompareView
      v-if="comparing && upstream && item"
      :kind="item.kind"
      :before="upstream"
      :after="item"
      :bottom-inset="showStrip && item.kind === 'video' ? 78 : 0"
    />
    <template v-else>
      <video
        v-if="item && item.kind === 'video'"
        ref="videoEl"
        :src="item.url"
        controls
        playsinline
        preload="metadata"
      />
      <audio v-else-if="item && item.kind === 'audio'" :src="item.url" controls />
      <img
        v-else-if="item"
        :src="item.url"
        :alt="item.name"
        draggable="false"
        :style="imageStyle"
      />
      <!-- 文本类工作流：没有素材时直接大字号展示生成结果 -->
      <div v-else-if="text" class="preview-text">{{ text }}</div>
      <span v-else class="preview-empty">暂无素材</span>
    </template>

    <!-- 视频截帧 / 全屏按钮由右侧工具栏调用 -->

    <!-- 全屏预览时右上角的退出按钮（面板本身的关闭按钮被浮层盖住了） -->
    <button
      v-if="fullscreen"
      type="button"
      class="preview-exit"
      title="退出全屏 (Esc)"
      @pointerdown.stop
      @click.stop="fullscreen = false"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <div v-if="isImage && !comparing" class="preview-zoom">{{ Math.round(zoom * 100) }}%</div>

    <!-- 素材缩略条：悬浮在预览区底部 -->
    <div v-if="showStrip" class="preview-strip" @wheel.stop @pointerdown.stop>
      <button
        v-for="(thumb, i) in thumbs"
        :key="thumb.id || i"
        type="button"
        class="preview-thumb"
        :class="{ 'is-active': i === activeIndex }"
        :title="thumb.name"
        @click.stop="emit('select', i)"
      >
        <img
          v-if="thumb.kind === 'image' || thumb.kind === 'video'"
          :src="thumbSrc(thumb)"
          alt=""
          draggable="false"
          loading="lazy"
          decoding="async"
          @error="onThumbError(thumb)"
        />
        <span v-else class="thumb-kind">音频</span>
        <span v-if="thumb.kind === 'video'" class="thumb-badge">▶</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { clamp } from "../../../utils/image";
import CompareView from "./CompareView.vue";

const props = defineProps({
  item: { type: Object, default: null },
  media: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  // 对比模式：上游第一条素材 + 是否开启对比
  upstream: { type: Object, default: null },
  comparing: { type: Boolean, default: false },
  // 文本类工作流的产物：没有媒体时展示成全文
  text: { type: String, default: "" },
});

const emit = defineEmits(["select", "frame"]);

const stageEl = ref(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
let drag = null;

const isImage = computed(() => !!props.item && props.item.kind === "image");
const isVideo = computed(() => !!props.item && props.item.kind === "video");
const thumbs = computed(() => props.media || []);
const showStrip = computed(() => thumbs.value.length > 0);

// 底部素材条只加载缩略图；失败时按 id 退回原图
const thumbFails = reactive({});
function onThumbError(thumb) {
  if (thumb && thumb.id) thumbFails[thumb.id] = true;
}
function thumbSrc(thumb) {
  if (!thumb) return "";
  return (thumb.thumbUrl && !thumbFails[thumb.id]) ? thumb.thumbUrl : thumb.url;
}
const activeIndex = computed(() => props.index);

const imageStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
  cursor: zoom.value > 1 ? "grab" : "default",
}));

watch(
  () => props.item && props.item.id,
  () => {
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
  }
);

// 滚轮缩放：以指针位置为中心，仅对图像生效
function onWheel(event) {
  if (props.comparing || !isImage.value || !stageEl.value) return;
  const rect = stageEl.value.getBoundingClientRect();
  const cx = event.clientX - rect.left - rect.width / 2;
  const cy = event.clientY - rect.top - rect.height / 2;
  const factor = Math.exp(-event.deltaY / 600);
  const next = clamp(zoom.value * factor, 0.5, 8);

  const scale = next / zoom.value;
  pan.value = {
    x: cx - (cx - pan.value.x) * scale,
    y: cy - (cy - pan.value.y) * scale,
  };
  zoom.value = next;

  if (next <= 1) pan.value = { x: 0, y: 0 };
}

// 放大后按住拖动查看
function onPointerDown(event) {
  if (props.comparing || !isImage.value || zoom.value <= 1) return;
  drag = { x: event.clientX, y: event.clientY, pan: { ...pan.value } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(event) {
  if (!drag) return;
  pan.value = {
    x: drag.pan.x + (event.clientX - drag.x),
    y: drag.pan.y + (event.clientY - drag.y),
  };
}

function onPointerUp() {
  drag = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

// ------------------------------------------------------------ 全屏预览
const fullscreen = ref(false);

function toggleFullscreen() {
  fullscreen.value = !fullscreen.value;
}

function onFullscreenKey(event) {
  if (event.key === "Escape") fullscreen.value = false;
}

watch(fullscreen, (on) => {
  if (on) window.addEventListener("keydown", onFullscreenKey);
  else window.removeEventListener("keydown", onFullscreenKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onFullscreenKey);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});

// ------------------------------------------------------------ 视频截帧
const videoEl = ref(null);
const exporting = ref(false);

const FRAMES = [
  { key: "first", label: "导出首帧", tip: "截取视频第一帧，作为新节点" },
  { key: "current", label: "导出当前帧", tip: "截取播放头所在帧，作为新节点" },
  { key: "last", label: "导出尾帧", tip: "截取视频最后一帧，作为新节点" },
];

// 尾帧不能用 duration 本身：很多视频 seek 到末尾拿不到帧，留 0.05s 余量
function frameTime(kind, video) {
  const duration = Number(video.duration) || 0;
  if (kind === "first") return 0;
  if (kind === "last") return Math.max(0, duration - 0.05);
  return Math.min(video.currentTime || 0, Math.max(0, duration - 0.05));
}

function drawFrame(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty frame"))), "image/png");
  });
}

// 定位到目标时间并在 seeked 后截图；已经在目标位置时直接截，避免 seeked 不触发
function captureFrame(kind) {
  const video = videoEl.value;
  if (!video) return Promise.reject(new Error("no video"));
  if (!video.videoWidth) return Promise.reject(new Error("not ready"));

  const time = frameTime(kind, video);
  if (Math.abs((video.currentTime || 0) - time) < 0.01) return drawFrame(video);

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (handler) => (value) => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      handler(value);
    };
    const onSeeked = () => {
      drawFrame(video).then(finish(resolve), finish(reject));
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
    // 极端情况下 seeked 不来，兜底放弃，避免按钮一直处于禁用态
    setTimeout(() => finish(reject)(new Error("seek timeout")), 4000);
  });
}

async function exportFrame(kind) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const blob = await captureFrame(kind);
    const base = String(props.item?.name || "video").replace(/\.[^.]+$/, "");
    const label = FRAMES.find((frame) => frame.key === kind)?.label.replace("导出", "") || "帧";
    emit("frame", { blob, name: `${base}_${label}.png` });
  } catch {
    // 截图失败由父级统一提示
    emit("frame", { error: true });
  } finally {
    exporting.value = false;
  }
}

// 右侧工具栏（全屏 / 截帧按钮）通过 ref 调用
defineExpose({ fullscreen, exporting, toggleFullscreen, exportFrame });
</script>

<style scoped>
.preview-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--c-surface);
  user-select: none;
}

.preview-stage.is-pannable {
  cursor: grab;
}

/* 视频 + 缩略条：给底部预留缩略条高度，竖屏视频的控制条不会被挡住 */
.preview-stage.has-strip {
  box-sizing: border-box;
  padding-bottom: 78px;
}

.preview-stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
}

.preview-stage video {
  max-width: 100%;
  max-height: 100%;
}

.preview-empty {
  color: var(--c-muted);
  font-size: 13px;
}

/* 文本产物：可选中复制、可滚动的全文块 */
.preview-text {
  box-sizing: border-box;
  width: min(760px, 100%);
  max-height: 100%;
  padding: 28px 32px;
  border: 1px solid var(--c-line);
  border-radius: 14px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 14px;
  line-height: 1.9;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  user-select: text;
}

.preview-zoom {
  position: absolute;
  left: 12px;
  top: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #f4f4f8;
  font-size: 11px;
}

/* 全屏预览：铺满整个浏览器视口，盖住画布与浮层 */
.preview-stage.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2600;
  padding: 24px;
  border-radius: 0;
  background: var(--c-surface);
}

/* 全屏预览：右上角退出按钮 */
.preview-exit {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-surface) 86%, transparent);
  color: var(--c-text);
  cursor: pointer;
}

.preview-exit:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
}

/* 底部悬浮素材条 */
.preview-strip {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c-surface) 88%, transparent);
  overflow-x: auto;
}

.preview-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-surface-2);
  overflow: hidden;
  cursor: pointer;
}

.preview-thumb.is-active {
  border-color: var(--accent-yellow);
}

.preview-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.thumb-badge {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 9px;
  line-height: 1;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.thumb-kind {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--c-muted);
  font-size: 11px;
}
</style>

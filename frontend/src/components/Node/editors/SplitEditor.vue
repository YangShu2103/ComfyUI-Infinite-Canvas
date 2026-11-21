<template>
  <div class="editor">
    <!-- 参数控件挂到右侧控制列 -->
    <Teleport v-if="controlsEl" :to="controlsEl">
      <RangeSlider v-model="hLines" label="横向线" :min="0" :max="10" />
      <RangeSlider v-model="vLines" label="纵向线" :min="0" :max="10" />
      <RangeSlider v-model="lineWidth" label="分割线宽（跳过像素）" :min="0" :max="60" />
      <span class="editor-size">将输出 {{ outputCount }} 张</span>
      <span class="editor-size">滚轮放大预览，放大后可拖动画面</span>
    </Teleport>
    <!-- 应用按钮挂到右侧底部 -->
    <Teleport v-if="applyEl" :to="applyEl">
      <button type="button" class="primary-btn" :disabled="!ready || busy" @click="apply">
        {{ busy ? "处理中…" : "应用" }}
      </button>
    </Teleport>

    <div
      ref="stageEl"
      class="editor-stage"
      :class="{ 'is-zoomed': zoom > 1 }"
      @wheel.prevent="onWheel"
      @pointerdown="onStagePointerDown"
    >
      <div v-if="ready" ref="wrapEl" class="split-wrap" :style="wrapStyle">
        <img :src="src" :alt="name" draggable="false" class="split-img" />
        <!-- 线宽对应的跳过区域，让切割范围一目了然 -->
        <template v-if="lineWidth > 0">
          <span
            v-for="(cut, i) in rowCuts"
            :key="`rb${i}`"
            class="grid-band is-h"
            :style="{ top: `${cut * 100}%`, height: `${bandPx}px` }"
          />
          <span
            v-for="(cut, i) in colCuts"
            :key="`cb${i}`"
            class="grid-band is-v"
            :style="{ left: `${cut * 100}%`, width: `${bandPx}px` }"
          />
        </template>
        <!-- 分割线可以拖动，位置按图片比例保存；等高线只是初始值 -->
        <span
          v-for="(cut, i) in rowCuts"
          :key="`r${i}`"
          class="grid-line is-h"
          :class="{ 'is-active': dragState.axis === 'h' && dragState.index === i }"
          :style="{ top: `${cut * 100}%` }"
          title="拖动调整横向分割位置"
          @pointerdown.stop.prevent="startDrag('h', i, $event)"
        />
        <span
          v-for="(cut, i) in colCuts"
          :key="`c${i}`"
          class="grid-line is-v"
          :class="{ 'is-active': dragState.axis === 'v' && dragState.index === i }"
          :style="{ left: `${cut * 100}%` }"
          title="拖动调整纵向分割位置"
          @pointerdown.stop.prevent="startDrag('v', i, $event)"
        />
        <span class="grid-border" />
      </div>
      <span v-else class="editor-hint">图片加载中…</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { canvasToBlob, loadImage } from "../../../utils/image";
import RangeSlider from "./RangeSlider.vue";

const props = defineProps({
  src: { type: String, required: true },
  name: { type: String, default: "" },
  controlsEl: { type: Object, default: null },
  applyEl: { type: Object, default: null },
});

const emit = defineEmits(["apply"]);

const stageEl = ref(null);
const wrapEl = ref(null);
const sourceImage = ref(null);
const natural = reactive({ w: 0, h: 0 });
const scale = ref(1);
const hLines = ref(1);
const vLines = ref(1);
const busy = ref(false);
// 每条分割线的位置用 0–1 的比例表示，默认等分，可拖动调整
const rowCuts = ref([0.5]);
const colCuts = ref([0.5]);
// 宫格图里分隔线本身的宽度（原图像素），切割时跳过这条带
const lineWidth = ref(0);
const dragState = reactive({ axis: "", index: -1 });
let observer = null;
let dragLine = null;

const rowTotal = computed(() => hLines.value + 1);
const colTotal = computed(() => vLines.value + 1);
const outputCount = computed(() => rowTotal.value * colTotal.value);

function evenCuts(count) {
  return Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
}

watch(hLines, (count) => {
  rowCuts.value = evenCuts(count);
});
watch(vLines, (count) => {
  colCuts.value = evenCuts(count);
});

// 预览里按显示比例换算出的跳过带宽度
const bandPx = computed(() => lineWidth.value * scale.value);

// 按分割线和线宽算出每个格子的起止像素：线两侧各让出线宽的一半
function segmentsOf(cuts, total) {
  const half = lineWidth.value / 2;
  const edges = [0];
  for (const cut of cuts) {
    const pos = total * cut;
    edges.push(
      Math.max(0, Math.round(pos - half)),
      Math.min(total, Math.round(pos + half))
    );
  }
  edges.push(total);
  const spans = [];
  for (let i = 0; i < edges.length; i += 2) {
    const start = Math.max(0, Math.min(edges[i], total - 1));
    const end = Math.max(start + 1, Math.min(edges[i + 1], total));
    spans.push([start, end]);
  }
  return spans;
}

const ready = computed(() => natural.w > 0 && natural.h > 0 && scale.value > 0);

const wrapStyle = computed(() => ({
  width: `${natural.w * scale.value}px`,
  height: `${natural.h * scale.value}px`,
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));

// 预览缩放：1 表示适应窗口，最大 8 倍
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
let panDrag = null;

function onWheel(event) {
  if (!ready.value || !stageEl.value) return;
  const rect = stageEl.value.getBoundingClientRect();
  const cx = event.clientX - rect.left - rect.width / 2;
  const cy = event.clientY - rect.top - rect.height / 2;
  const factor = Math.exp(-event.deltaY / 600);
  const next = Math.min(8, Math.max(1, zoom.value * factor));
  const s = next / zoom.value;
  pan.value = {
    x: cx - (cx - pan.value.x) * s,
    y: cy - (cy - pan.value.y) * s,
  };
  zoom.value = next;
  if (next <= 1) pan.value = { x: 0, y: 0 };
}

function onStagePointerDown(event) {
  if (zoom.value <= 1 || event.button !== 0) return;
  if (event.target.closest?.(".grid-line")) return;
  panDrag = { x: event.clientX, y: event.clientY, pan: { ...pan.value } };
  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", endPan);
}

function onPanMove(event) {
  if (!panDrag) return;
  pan.value = {
    x: panDrag.pan.x + event.clientX - panDrag.x,
    y: panDrag.pan.y + event.clientY - panDrag.y,
  };
}

function endPan() {
  panDrag = null;
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", endPan);
}

function measure() {
  if (!stageEl.value || !natural.w) return;
  const rect = stageEl.value.getBoundingClientRect();
  const availableW = Math.max(160, rect.width - 36);
  const availableH = Math.max(120, rect.height - 24);
  scale.value = Math.min(availableW / natural.w, availableH / natural.h);
}

async function load() {
  natural.w = 0;
  natural.h = 0;
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
  rowCuts.value = evenCuts(hLines.value);
  colCuts.value = evenCuts(vLines.value);
  try {
    const image = await loadImage(props.src);
    sourceImage.value = image;
    natural.w = image.naturalWidth;
    natural.h = image.naturalHeight;
    measure();
  } catch (error) {
    console.warn("[Infinite-Canvas] 宫格切分素材加载失败", error);
  }
}

watch(() => props.src, load);

// 拖动分割线：限制在相邻两条线之间，至少保留 2% 的格子
function startDrag(axis, index, event) {
  dragLine = { axis, index };
  dragState.axis = axis;
  dragState.index = index;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag);
}

function onDragMove(event) {
  if (!dragLine || !wrapEl.value) return;
  const rect = wrapEl.value.getBoundingClientRect();
  const axis = dragLine.axis;
  const cuts = axis === "h" ? rowCuts.value : colCuts.value;
  const raw =
    axis === "h"
      ? (event.clientY - rect.top) / Math.max(1, rect.height)
      : (event.clientX - rect.left) / Math.max(1, rect.width);
  const gap = 0.02;
  const prev = dragLine.index === 0 ? 0 : cuts[dragLine.index - 1];
  const next = dragLine.index === cuts.length - 1 ? 1 : cuts[dragLine.index + 1];
  const value = Math.min(Math.max(raw, prev + gap), next - gap);
  const list = cuts.slice();
  list[dragLine.index] = value;
  if (axis === "h") rowCuts.value = list;
  else colCuts.value = list;
}

function endDrag() {
  dragLine = null;
  dragState.axis = "";
  dragState.index = -1;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", endDrag);
}

async function apply() {
  if (!ready.value || !sourceImage.value || busy.value) return;
  busy.value = true;
  try {
    const image = sourceImage.value;
    const rows = rowTotal.value;
    const cols = colTotal.value;
    const base = props.name ? props.name.replace(/\.\w+$/, "") : "image";
    const pieces = [];
    const rowSegs = segmentsOf(rowCuts.value, image.naturalHeight);
    const colSegs = segmentsOf(colCuts.value, image.naturalWidth);

    for (let r = 0; r < rows; r += 1) {
      const [y0, y1] = rowSegs[r];
      for (let c = 0; c < cols; c += 1) {
        const [x0, x1] = colSegs[c];
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        context.drawImage(image, x0, y0, w, h, 0, 0, w, h);
        const blob = await canvasToBlob(canvas);
        pieces.push({ blob, name: `${base}-${r + 1}-${c + 1}.png` });
      }
    }

    emit("apply", pieces);
  } catch (error) {
    console.warn("[Infinite-Canvas] 宫格切分失败", error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  load();
  if (stageEl.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(stageEl.value);
  }
});

onBeforeUnmount(() => {
  if (observer) observer.disconnect();
  endDrag();
  endPan();
});
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.editor-size {
  font-size: 12px;
  color: var(--c-muted);
}

.primary-btn {
  width: 100%;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--accent-yellow);
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.editor-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--c-surface);
}

.editor-stage.is-zoomed {
  cursor: grab;
}

.editor-stage.is-zoomed:active {
  cursor: grabbing;
}

.split-wrap {
  position: relative;
  transform-origin: center center;
  will-change: transform;
}

.split-img {
  display: block;
  width: 100%;
  height: 100%;
}

/* 分割线宽对应的跳过区域 */
.grid-band {
  position: absolute;
  z-index: 0;
  background: color-mix(in srgb, var(--c-accent) 28%, transparent);
  pointer-events: none;
}

.grid-band.is-h {
  left: 0;
  right: 0;
  transform: translateY(-50%);
}

.grid-band.is-v {
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
}

/* 分割线：中间一条细线，外加 12px 的透明拖拽热区 */
.grid-line {
  position: absolute;
  z-index: 1;
  background: transparent;
  touch-action: none;
}

.grid-line::after {
  content: "";
  position: absolute;
  background: rgba(255, 255, 255, 0.9);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.grid-line.is-h {
  left: 0;
  right: 0;
  height: 12px;
  margin-top: -6px;
  cursor: row-resize;
}

.grid-line.is-h::after {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  transform: translateY(-0.5px);
}

.grid-line.is-v {
  top: 0;
  bottom: 0;
  width: 12px;
  margin-left: -6px;
  cursor: col-resize;
}

.grid-line.is-v::after {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-0.5px);
}

/* 悬停 / 拖动：变黄加粗，明确当前在调整哪条线 */
.grid-line:hover::after,
.grid-line.is-active::after {
  background: var(--c-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c-accent) 40%, transparent);
}

.grid-line.is-h:hover::after,
.grid-line.is-h.is-active::after {
  height: 2px;
}

.grid-line.is-v:hover::after,
.grid-line.is-v.is-active::after {
  width: 2px;
}

.grid-border {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.85);
  pointer-events: none;
}

.editor-hint {
  color: var(--c-muted);
  font-size: 12px;
}
</style>

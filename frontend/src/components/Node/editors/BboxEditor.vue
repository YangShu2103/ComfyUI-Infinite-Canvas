<template>
  <div
    ref="rootEl"
    class="bbox"
    tabindex="0"
    @keydown.stop="onKeyDown"
  >
    <div class="bbox-head">
      <span class="bbox-size">{{ width }} × {{ height }}</span>
      <span class="bbox-count">{{ boxes.length }} 个框</span>
      <span class="bbox-hint">拖动创建；选中后可移动、八向缩放，Delete 删除</span>
    </div>

    <div class="bbox-body">
      <div class="bbox-main">
        <div
          ref="stageEl"
          class="bbox-stage"
          :style="{ aspectRatio: `${width} / ${height}` }"
          @pointerdown="onStagePointerDown"
        >
          <img
            v-if="backgroundUrl"
            class="bbox-bg"
            :src="backgroundUrl"
            alt=""
            draggable="false"
            @dragstart.prevent
          />
          <span class="bbox-grid" />
          <span v-if="!boxes.length && !draft" class="bbox-empty">拖动创建边界框</span>

          <div
            v-for="(box, i) in boxes"
            :key="i"
            class="bbox-item"
            :class="{ 'is-selected': i === selected }"
            :style="boxStyle(box)"
            @pointerdown.stop="startMove($event, i)"
          >
            <span class="bbox-tag">{{ String(i + 1).padStart(2, "0") }}</span>
            <span v-if="boxLabel(box)" class="bbox-label">{{ boxLabel(box) }}</span>
            <span
              v-for="handle in HANDLES"
              :key="handle"
              class="bbox-handle"
              :class="`is-${handle}`"
              @pointerdown.stop="startResize($event, i, handle)"
            />
          </div>

          <div
            v-if="draft"
            class="bbox-item is-draft"
            :style="boxStyle(draft)"
          />
        </div>
      </div>

      <div class="bbox-side">
        <button
          v-if="boxes.length"
          class="bbox-clear"
          type="button"
          @click.stop="clearAll"
        >
          清空全部
        </button>

        <template v-if="current">
          <div class="bbox-type">
            <button
              type="button"
              :class="{ 'is-active': current.metadata.type === 'obj' }"
              @click.stop="patchCurrent({ type: 'obj' })"
            >
              obj
            </button>
            <button
              type="button"
              :class="{ 'is-active': current.metadata.type === 'text' }"
              @click.stop="patchCurrent({ type: 'text' })"
            >
              text
            </button>
          </div>
          <textarea
            v-if="current.metadata.type === 'text'"
            class="panel-input bbox-textarea"
            rows="2"
            :value="current.metadata.text"
            :placeholder="'文本\n要渲染的文本（原文）'"
            spellcheck="false"
            @input="patchCurrent({ text: $event.target.value })"
            @keydown.stop
          />
          <textarea
            class="panel-input bbox-textarea"
            rows="4"
            :value="current.metadata.desc"
            :placeholder="'描述\n该区域的描述'"
            spellcheck="false"
            @input="patchCurrent({ desc: $event.target.value })"
            @keydown.stop
          />
          <button class="bbox-delete" type="button" @click.stop="removeCurrent">
            删除框
          </button>
        </template>
        <p v-else class="bbox-side-hint">选中一个框后在这里编辑</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  value: { type: Object, default: () => ({ __value__: [] }) },
  width: { type: Number, default: 1024 },
  height: { type: Number, default: 1024 },
  backgroundUrl: { type: String, default: "" },
});

const emit = defineEmits(["update"]);

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const rootEl = ref(null);
const stageEl = ref(null);
const selected = ref(-1);
const draft = ref(null);
const boxes = ref([]);
let drag = null;
let clipboard = null;

function normalize(box) {
  const meta = box && typeof box.metadata === "object" && box.metadata ? box.metadata : {};
  return {
    x: Number(box?.x) || 0,
    y: Number(box?.y) || 0,
    width: Number(box?.width) || 0,
    height: Number(box?.height) || 0,
    metadata: {
      ...meta,
      type: meta.type === "text" ? "text" : "obj",
      text: String(meta.text ?? ""),
      desc: String(meta.desc ?? ""),
      palette: Array.isArray(meta.palette) ? meta.palette.filter(Boolean).map(String) : [],
    },
  };
}

function readValue(value) {
  const list = value && Array.isArray(value.__value__) ? value.__value__ : [];
  return list
    .map(normalize)
    .filter((box) => box.width > 0 && box.height > 0);
}

boxes.value = readValue(props.value);

watch(
  () => props.value,
  (next) => {
    if (drag) return;
    const list = readValue(next);
    if (JSON.stringify(list) === JSON.stringify(boxes.value)) return;
    boxes.value = list;
    selected.value = -1;
  },
  { deep: true }
);

const current = computed(() => boxes.value[selected.value] || null);

// 分辨率变化时把已有框按比例缩放到新画布，避免跑到画布外
let lastSize = { width: props.width, height: props.height };
watch(
  () => [props.width, props.height],
  ([width, height]) => {
    const previous = lastSize;
    lastSize = { width, height };
    if (!previous.width || !previous.height || drag) return;
    if (previous.width === width && previous.height === height) return;
    if (!boxes.value.length) return;
    const sx = width / previous.width;
    const sy = height / previous.height;
    boxes.value = boxes.value.map((box) => ({
      ...box,
      x: Math.round(box.x * sx),
      y: Math.round(box.y * sy),
      width: Math.round(box.width * sx),
      height: Math.round(box.height * sy),
      metadata: { ...box.metadata, palette: [...box.metadata.palette] },
    }));
    commit();
  }
);

function boxStyle(box) {
  return {
    left: `${(box.x / props.width) * 100}%`,
    top: `${(box.y / props.height) * 100}%`,
    width: `${(box.width / props.width) * 100}%`,
    height: `${(box.height / props.height) * 100}%`,
  };
}

// 与 ComfyUI 一致：文本框显示 "文本" — 描述，普通框只显示描述
function boxLabel(box) {
  const text = String(box.metadata.text || "").trim();
  const desc = String(box.metadata.desc || "").trim();
  if (text) return desc ? `"${text}" — ${desc}` : `"${text}"`;
  return desc;
}

function commit() {
  const out = boxes.value.map((box) => ({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    metadata: {
      ...box.metadata,
      type: box.metadata.type,
      text: box.metadata.text,
      desc: box.metadata.desc,
      palette: [...box.metadata.palette],
    },
  }));
  boxes.value = out;
  emit("update", out);
}

function pointOf(event) {
  const rect = stageEl.value.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * props.width;
  const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * props.height;
  return {
    x: Math.min(Math.max(0, x), props.width),
    y: Math.min(Math.max(0, y), props.height),
  };
}

function listen() {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function unlisten() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function onStagePointerDown(event) {
  if (event.button !== 0) return;
  rootEl.value?.focus({ preventScroll: true });
  selected.value = -1;
  const point = pointOf(event);
  drag = { mode: "create", start: point };
  draft.value = { x: point.x, y: point.y, width: 0, height: 0 };
  listen();
}

function startMove(event, index) {
  if (event.button !== 0) return;
  rootEl.value?.focus({ preventScroll: true });
  selected.value = index;
  const box = boxes.value[index];
  drag = {
    mode: "move",
    index,
    start: pointOf(event),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
  listen();
}

function startResize(event, index, handle) {
  if (event.button !== 0) return;
  rootEl.value?.focus({ preventScroll: true });
  selected.value = index;
  const box = boxes.value[index];
  drag = {
    mode: "resize",
    index,
    handle,
    start: pointOf(event),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
  listen();
}

function onPointerMove(event) {
  if (!drag) return;
  const point = pointOf(event);

  if (drag.mode === "create") {
    draft.value = {
      x: Math.min(drag.start.x, point.x),
      y: Math.min(drag.start.y, point.y),
      width: Math.abs(point.x - drag.start.x),
      height: Math.abs(point.y - drag.start.y),
    };
    return;
  }

  const box = boxes.value[drag.index];
  if (!box) return;
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;

  if (drag.mode === "move") {
    box.x = Math.min(Math.max(0, drag.box.x + dx), Math.max(0, props.width - drag.box.width));
    box.y = Math.min(Math.max(0, drag.box.y + dy), Math.max(0, props.height - drag.box.height));
    return;
  }

  const handle = drag.handle;
  let left = drag.box.x;
  let top = drag.box.y;
  let right = drag.box.x + drag.box.width;
  let bottom = drag.box.y + drag.box.height;
  if (handle.includes("w")) {
    left = Math.min(Math.max(0, drag.box.x + dx), right - 4);
  }
  if (handle.includes("e")) {
    right = Math.max(Math.min(props.width, drag.box.x + drag.box.width + dx), left + 4);
  }
  if (handle.includes("n")) {
    top = Math.min(Math.max(0, drag.box.y + dy), bottom - 4);
  }
  if (handle.includes("s")) {
    bottom = Math.max(Math.min(props.height, drag.box.y + drag.box.height + dy), top + 4);
  }
  box.x = left;
  box.y = top;
  box.width = right - left;
  box.height = bottom - top;
}

function onPointerUp() {
  if (drag?.mode === "create") {
    const box = draft.value;
    if (box && box.width >= 4 && box.height >= 4) {
      boxes.value.push(normalize(box));
      selected.value = boxes.value.length - 1;
    }
  }
  draft.value = null;
  drag = null;
  unlisten();
  commit();
}

function patchCurrent(patch) {
  if (!current.value) return;
  Object.assign(current.value.metadata, patch);
  commit();
}

function removeCurrent() {
  if (selected.value < 0) return;
  boxes.value.splice(selected.value, 1);
  selected.value = -1;
  commit();
}

function clearAll() {
  if (!boxes.value.length) return;
  boxes.value = [];
  selected.value = -1;
  commit();
}

function cloneBox(box) {
  return {
    ...box,
    metadata: { ...box.metadata, palette: [...box.metadata.palette] },
  };
}

// 粘贴时向右下错开一点，连续粘贴继续错开
function pasteBox() {
  const offset = Math.max(8, Math.round(Math.min(props.width, props.height) * 0.02));
  const box = cloneBox(clipboard);
  box.x = Math.min(Math.max(0, box.x + offset), Math.max(0, props.width - box.width));
  box.y = Math.min(Math.max(0, box.y + offset), Math.max(0, props.height - box.height));
  boxes.value.push(box);
  selected.value = boxes.value.length - 1;
  clipboard = cloneBox(box);
  commit();
}

function onKeyDown(event) {
  const tag = event.target?.tagName;
  // 文本输入框里保留浏览器原生的复制粘贴
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const mod = event.metaKey || event.ctrlKey;
  if (mod && (event.key === "c" || event.key === "C")) {
    if (!current.value) return;
    event.preventDefault();
    event.stopPropagation();
    clipboard = cloneBox(current.value);
    return;
  }
  if (mod && (event.key === "v" || event.key === "V")) {
    if (!clipboard) return;
    event.preventDefault();
    event.stopPropagation();
    pasteBox();
    return;
  }

  if (!current.value) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    removeCurrent();
  } else if (event.key === "Escape") {
    selected.value = -1;
  }
}

onBeforeUnmount(() => {
  unlisten();
});
</script>

<style scoped>
.bbox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  outline: none;
}

.bbox-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--c-muted);
}

.bbox-hint {
  margin-left: auto;
  text-align: right;
}

.bbox-size {
  font-variant-numeric: tabular-nums;
  color: var(--c-text);
}

.bbox-body {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

/* 左 3/4：绘制区；右 1/4：选中框的功能区 */
.bbox-main {
  display: flex;
  flex: 3 1 0;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.bbox-side {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

/* obj / text 分段切换 */
.bbox-type {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
}

.bbox-type button {
  flex: 1 1 0;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.bbox-type button.is-active {
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-weight: 600;
}

.bbox-clear {
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 10px;
  cursor: pointer;
}

.bbox-clear:hover {
  color: var(--c-text);
  border-color: var(--c-text);
}

.bbox-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-input-bg);
  touch-action: none;
  user-select: none;
  cursor: crosshair;
}

.bbox-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.bbox-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image: linear-gradient(
      to right,
      color-mix(in srgb, var(--c-text) 18%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--c-text) 18%, transparent) 1px,
      transparent 1px
    );
  background-size: 10% 10%;
}

.bbox-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--c-muted);
  pointer-events: none;
}

.bbox-item {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--c-text) 80%, transparent);
  background: color-mix(in srgb, var(--c-text) 5%, transparent);
  cursor: move;
}

.bbox-item.is-selected {
  border-color: var(--accent-yellow);
  border-width: 2px;
  background: color-mix(in srgb, var(--accent-yellow) 20%, transparent);
  z-index: 3;
}

.bbox-item.is-draft {
  border-style: dashed;
  border-color: var(--accent-yellow);
  background: color-mix(in srgb, var(--accent-yellow) 8%, transparent);
  pointer-events: none;
}

.bbox-tag {
  position: absolute;
  top: -1px;
  left: -1px;
  padding: 0 4px;
  background: color-mix(in srgb, var(--c-text) 85%, transparent);
  color: var(--c-on-accent);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  border-radius: 0 0 4px 0;
  font-variant-numeric: tabular-nums;
}

.bbox-item.is-selected .bbox-tag {
  background: var(--accent-yellow);
}

.bbox-label {
  position: absolute;
  top: 16px;
  left: 2px;
  max-width: calc(100% - 4px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--c-text);
  pointer-events: none;
}

.bbox-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--c-bg);
  border-radius: 2px;
  background: var(--c-text);
}

.bbox-item.is-selected .bbox-handle {
  border-color: var(--c-on-accent);
  background: var(--accent-yellow);
}

.bbox-handle.is-nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}

.bbox-handle.is-n {
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}

.bbox-handle.is-ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}

.bbox-handle.is-e {
  top: 50%;
  right: -5px;
  transform: translateY(-50%);
  cursor: ew-resize;
}

.bbox-handle.is-se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}

.bbox-handle.is-s {
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}

.bbox-handle.is-sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}

.bbox-handle.is-w {
  top: 50%;
  left: -5px;
  transform: translateY(-50%);
  cursor: ew-resize;
}

/* 子组件拿不到节点面板的 scoped 样式，这里补齐输入框外观 */
.panel-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 11px;
  outline: none;
}

.panel-input:focus {
  border-color: var(--accent-yellow);
}

textarea.panel-input {
  height: auto;
  min-height: 44px;
  padding: 6px 8px;
  line-height: 1.4;
  font-family: inherit;
  resize: none;
}

.bbox-delete {
  width: 100%;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.bbox-delete:hover {
  color: #e8463a;
  border-color: #e8463a;
}

.bbox-side-hint {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 10px;
  line-height: 1.5;
  color: var(--c-muted);
  text-align: center;
}

.bbox-hint {
  font-size: 10px;
  line-height: 1.5;
}
</style>

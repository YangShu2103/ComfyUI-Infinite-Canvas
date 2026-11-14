<template>
  <div
    class="text-node"
    :class="{ 'is-connecting': connecting }"
    :style="{ width: `${nodeW}px`, height: `${nodeH}px` }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @dragover.prevent.stop="onNodeDragOver"
    @drop.prevent.stop="onNodeDrop"
  >
    <!-- 标题在输入框上方，和参考图的文本节点一致 -->
    <div class="text-head">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M3 4h10M3 8h10M3 12h6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      <span class="text-title">{{ title }}</span>
    </div>

    <div class="text-body-wrap">
      <!-- 未编辑时用普通文本块展示：可以单击拖动节点，也不会出现输入光标 -->
      <div
        v-if="!editing"
        class="text-body is-preview"
        title="双击输入内容"
        @dblclick.stop="beginEdit"
      >
        <template v-if="data.text && !textHidden">{{ data.text }}</template>
        <span v-else-if="!textHidden" class="text-placeholder">双击输入内容…</span>
      </div>
      <textarea
        v-else
        ref="bodyEl"
        class="text-body is-editing nodrag nowheel"
        :value="data.text || ''"
        placeholder="双击输入内容…"
        spellcheck="false"
        @input="onInput"
        @keydown="onBodyKeyDown"
        @blur="endEdit"
      />

      <button
        v-if="hovered || selected"
        class="node-delete"
        type="button"
        title="删除节点"
        :style="deleteStyle"
        @pointerdown.stop
        @click.stop="removeNode"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M4 7h16M9 7V5h6v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <!-- 右下角拖拽缩放：只改节点自身尺寸 -->
      <div
        v-if="hovered || selected"
        class="node-resize"
        title="拖动调整节点大小"
        @pointerdown.stop.prevent="startResize"
        @mousedown.stop
        @click.stop
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M13 3L3 13M13 8l-5 5M13 12l-1 1"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </div>

    <!-- 左侧输入端口：承接上游产物（运行生成文本时自动连线），右侧是输出端口 -->
    <Handle
      type="target"
      :position="Position.Left"
      class="node-port"
      :class="{ 'is-on': showInputPort, 'is-connected': inputConnected }"
    >
      <div class="port-hit" />
    </Handle>
    <Handle
      type="source"
      :position="Position.Right"
      class="node-port"
      :class="{ 'is-on': showOutputPort, 'is-connected': outputConnected }"
    >
      <div class="port-hit" />
    </Handle>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import { useLibrary, PROMPT_DRAG_TYPE } from "../../composables/useLibrary";

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const flow = useVueFlow("demo");
const graph = inject("canvasGraph");
const { open: openLibrary, registerTarget, unregisterTarget } = useLibrary();

const hovered = ref(false);
// 标题不带序号；老画布里存的「文本节点 N」也只显示成「文本节点」
const title = computed(() => {
  const label = props.data.label || "文本节点";
  return label.replace(/\s*\d+$/, "") || "文本节点";
});
// 双击才进入编辑：未编辑时是普通文本块，单击仍然可以拖动节点
const editing = ref(false);
const bodyEl = ref(null);

// 缩得很小或移出视口时不渲染文本内容；阈值和预处理节点保持一致（25%），
// 选中 / 编辑中始终显示，避免看不到自己在改什么
const textHidden = computed(() => {
  if (props.selected || editing.value) return false;
  if ((Number(flow.viewport.value.zoom) || 1) < 0.25) return true;
  return graph?.visibleNodeIds ? !graph.visibleNodeIds.value.has(props.id) : false;
});

async function beginEdit() {
  editing.value = true;
  await nextTick();
  bodyEl.value?.focus();
}

function endEdit() {
  editing.value = false;
}

// 从提示词面板拖进来：直接替换正文；图片等其它拖拽一律不发生
function onNodeDragOver(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes(PROMPT_DRAG_TYPE)) event.dataTransfer.dropEffect = "copy";
}

function onNodeDrop(event) {
  const raw = event.dataTransfer?.getData(PROMPT_DRAG_TYPE);
  if (!raw) return;
  let text = "";
  try {
    text = (JSON.parse(raw)?.text || "").trim();
  } catch {
    return;
  }
  if (!text) return;
  graph?.captureUndo?.(true);
  props.data.text = text;
}

function onBodyKeyDown(event) {
  // 编辑时不要触发画布快捷键（删除节点等）
  event.stopPropagation();
  if (event.key === "Escape") bodyEl.value?.blur();
}

// 提示词面板的写入目标：编辑中按光标插入，只是选中时追加到末尾
const libraryTarget = {
  isActive: () => editing.value && document.activeElement === bodyEl.value,
  insert: insertIntoText,
};

// 和普通节点一致：编辑中或选中时登记，点提示词面板的条目才能写进来
watch(
  [editing, () => props.selected],
  ([isEditing, isSelected]) => {
    if (isEditing || isSelected) registerTarget(props.id, libraryTarget);
    else unregisterTarget(props.id);
  },
  { immediate: true }
);

onBeforeUnmount(() => unregisterTarget(props.id));

function insertIntoText(text, useCaret = false) {
  const el = bodyEl.value;
  const value = props.data.text || "";
  graph?.captureUndo?.();
  if (!useCaret || !el) {
    // 没聚焦时追加到末尾；原有内容不以空白结尾就补一个空格，避免两段粘在一起
    props.data.text = value && !/\s$/.test(value) ? `${value} ${text}` : `${value}${text}`;
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  props.data.text = value.slice(0, start) + text + value.slice(end);
  nextTick(() => {
    if (!bodyEl.value) return;
    const caret = start + text.length;
    bodyEl.value.focus();
    bodyEl.value.setSelectionRange(caret, caret);
  });
}

function onInput(event) {
  graph?.captureUndo?.();
  const value = event.target.value;
  // 输入 / 或 \ 直接呼出提示词面板，触发字符本身不留在文本里
  const trigger = event.data || "";
  if (trigger === "/" || trigger === "\\") {
    const caret = event.target.selectionStart ?? value.length;
    const text = value.slice(0, caret - trigger.length) + value.slice(caret);
    props.data.text = text;
    nextTick(() => {
      const el = bodyEl.value;
      if (!el) return;
      el.value = text;
      const pos = caret - trigger.length;
      el.setSelectionRange(pos, pos);
    });
    openLibrary("prompt");
    return;
  }
  props.data.text = value;
}

// 节点尺寸：存进画布 JSON 的 data.w / data.h
const MIN_NODE_W = 260;
const MIN_NODE_H = 160;
const DEFAULT_NODE_W = 460;
const DEFAULT_NODE_H = 280;
const nodeW = computed(() => Math.max(MIN_NODE_W, Number(props.data.w) || DEFAULT_NODE_W));
const nodeH = computed(() => Math.max(MIN_NODE_H, Number(props.data.h) || DEFAULT_NODE_H));

// 删除按钮反向缩放，保持视觉大小稳定
const deleteScale = computed(() =>
  Math.min(1.4, Math.max(0.5, 1 / (flow.viewport.value.zoom || 1)))
);
const deleteStyle = computed(() => ({
  transform: `scale(${deleteScale.value})`,
  top: `${-17 * deleteScale.value}px`,
  right: `${-17 * deleteScale.value}px`,
}));

// 端口显隐与普通节点一致：拉线时只显示能落线的一侧，已连接常驻显示
const connecting = computed(() => !!flow.connectionStartHandle.value);
const connectDirection = computed(() => flow.connectionStartHandle.value?.type || null);
const isConnectStart = computed(
  () => !!connectDirection.value && flow.connectionStartHandle.value?.nodeId === props.id
);
const outputConnected = computed(() => !!graph?.connectedSources?.value?.has(props.id));
const inputConnected = computed(() => !!graph?.connectedTargets?.value?.has(props.id));
// 左侧入口不参与手动接线：只有运行产物自动连上时才露出灰色小圆点
const showInputPort = computed(() => inputConnected.value);
const showOutputPort = computed(() => {
  if (connectDirection.value) {
    return connectDirection.value === "target" || isConnectStart.value;
  }
  return props.selected || outputConnected.value;
});

function removeNode() {
  graph?.captureUndo?.(true);
  flow.removeNodes([props.id]);
}

let resizeSession = null;

function startResize(event) {
  if (event.button !== 0) return;
  graph?.captureUndo?.(true);
  resizeSession = {
    x: event.clientX,
    y: event.clientY,
    w: nodeW.value,
    h: nodeH.value,
    zoom: flow.viewport.value.zoom || 1,
  };
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("blur", stopResize);
}

function onResizeMove(event) {
  if (!resizeSession) return;
  const zoom = resizeSession.zoom || 1;
  const nextW = resizeSession.w + (event.clientX - resizeSession.x) / zoom;
  const nextH = resizeSession.h + (event.clientY - resizeSession.y) / zoom;
  props.data.w = Math.round(Math.max(MIN_NODE_W, nextW));
  props.data.h = Math.round(Math.max(MIN_NODE_H, nextH));
}

function stopResize() {
  resizeSession = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("blur", stopResize);
}
</script>

<style scoped>
/* 文本节点没有外框，视觉主体就是那个大输入框（参考图的效果） */
.text-node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  height: 100%;
}

.text-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 2px 4px;
  color: var(--c-muted);
  font-size: 11px;
  line-height: 16px;
  cursor: grab;
  user-select: none;
}

.text-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 输入框外层：删除按钮 / 缩放柄都相对它定位，和普通节点的相对位置一致 */
.text-body-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.text-body {
  width: 100%;
  height: 100%;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: 20px;
  background: var(--c-panel-2);
  box-shadow: 0 6px 18px var(--c-shadow);
  color: var(--c-text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  outline: none;
  resize: none;
}

/* 未编辑时的文本展示：单击拖动节点，双击才解锁输入 */
.text-body.is-preview {
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: grab;
  user-select: none;
}

.text-placeholder {
  color: var(--c-muted);
}

.text-body::placeholder {
  color: var(--c-muted);
}

.text-body.is-editing,
.text-body:focus {
  border-color: var(--c-accent);
}

/* 选中态和普通节点保持一致：只改变描边颜色 */
.vue-flow__node.selected .text-body {
  border-color: var(--c-accent);
}

/* 端口：与普通节点同款半圆 + 72×72 热区，只保留右侧 */
.vue-flow__handle.node-port {
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.vue-flow__handle.node-port.is-on,
.vue-flow__handle.node-port.is-connected,
.text-node:hover .vue-flow__handle.node-port {
  opacity: 1;
}

.node-port::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  border-radius: 50%;
  background: var(--c-accent);
}

.vue-flow__handle-right.node-port::before {
  clip-path: inset(0 0 0 50%);
}

.vue-flow__handle-left.node-port::before {
  clip-path: inset(0 50% 0 0);
}

.port-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  transform: translate(-50%, -50%) translateX(20px);
  pointer-events: none;
}

/* 左侧入口的热区朝左延伸 */
.vue-flow__handle-left.node-port .port-hit {
  transform: translate(-50%, -50%) translateX(-20px);
}

.vue-flow__handle.node-port.is-on .port-hit,
.vue-flow__handle.node-port.is-connected .port-hit,
.text-node:hover .vue-flow__handle.node-port .port-hit {
  pointer-events: all;
}

.text-node.is-connecting .vue-flow__handle.node-port {
  opacity: 0;
  pointer-events: none;
}

.text-node.is-connecting .vue-flow__handle.node-port.is-on {
  opacity: 1;
}

.text-node.is-connecting .vue-flow__handle.node-port .port-hit {
  pointer-events: none;
}

.text-node.is-connecting .vue-flow__handle.node-port.is-on .port-hit {
  pointer-events: all;
}

/* 左侧入口只是“运行产物来源”标记：灰点、不可交互，只在已有连线时出现 */
.vue-flow__handle-left.node-port,
.text-node:hover .vue-flow__handle-left.node-port,
.text-node.is-connecting .vue-flow__handle-left.node-port {
  opacity: 0;
}

.vue-flow__handle-left.node-port.is-connected,
.text-node:hover .vue-flow__handle-left.node-port.is-connected,
.text-node.is-connecting .vue-flow__handle-left.node-port.is-connected {
  opacity: 1;
}

/* 左侧入口：和右侧输出口同款半圆，只是用灰色表示“自动连接” */
.vue-flow__handle-left.node-port::before {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-muted);
  clip-path: inset(0 50% 0 0);
}

.vue-flow__handle-left.node-port .port-hit {
  display: none;
}

/* 删除按钮 / 缩放柄：样式与位置和普通节点保持一致 */
.node-delete {
  position: absolute;
  top: -17px;
  right: -17px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  transform-origin: top right;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: var(--c-surface-3);
  box-shadow: 0 4px 12px var(--c-shadow);
  color: var(--c-text);
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease;
}

.node-delete:hover {
  border-color: var(--c-danger);
  color: var(--c-danger);
}

.node-resize {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 21;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 8px;
  color: color-mix(in srgb, var(--c-text) 50%, transparent);
  cursor: nwse-resize;
  touch-action: none;
  transition: color 0.12s ease, background 0.12s ease;
}

.node-resize:hover {
  background: var(--c-accent-weak);
  color: var(--c-accent);
}
</style>

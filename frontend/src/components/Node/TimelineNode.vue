<template>
  <div
    class="tl-node"
    :class="{ 'is-connecting': connecting }"
    :style="{ width: `${nodeW}px`, height: `${nodeH}px` }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <NodeTitle class="tl-name" :title="data.title || '时间线'" @rename="renameNode" />

    <Handle
      type="target"
      :position="Position.Left"
      class="tl-port"
      :class="{ 'is-on': showInputPort, 'is-connected': targetConnected }"
    >
      <div class="tl-port-hit" />
    </Handle>

    <button
      v-if="hovered || selected"
      class="tl-node-delete"
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

    <!-- 顶部细条：唯一的拖动节点区域，避免和时间线内部操作抢事件 -->
    <header class="tl-head">
      <span class="tl-head-title">时间线</span>
      <span class="tl-head-count">{{ clipCount }} 个片段</span>
    </header>

    <TimelineEditor v-if="!culled" :node-id="id" :data="data" :active="selected" />
    <div v-else class="tl-culled">时间线</div>

    <div
      class="tl-resize nodrag"
      title="拖动调整节点大小"
      @pointerdown.stop.prevent="startResize"
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

    <Handle
      type="source"
      :position="Position.Right"
      class="tl-port"
      :class="{ 'is-on': showOutputPort, 'is-connected': sourceConnected }"
    >
      <div class="tl-port-hit" />
    </Handle>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import NodeTitle from "./NodeTitle.vue";
import TimelineEditor from "./editors/TimelineEditor.vue";
import { createTimeline } from "../../utils/timeline";

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const graph = inject("canvasGraph");
const flow = useVueFlow("demo");

// 旧画布里的时间线节点可能没有 timeline 字段，挂载时补一份空结构
if (!props.data.timeline) props.data.timeline = createTimeline();

const clipCount = computed(() =>
  (props.data.timeline?.tracks || []).reduce(
    (total, track) => total + (track.clips?.length || 0),
    0
  )
);

function renameNode(name) {
  graph?.renameNode?.(props.id, name);
}

// ---------------------------------------------------------------- 端口
const connecting = computed(() => !!flow.connectionStartHandle.value);
const connectDirection = computed(() => flow.connectionStartHandle.value?.type || null);
const isConnectStart = computed(
  () => !!connectDirection.value && flow.connectionStartHandle.value?.nodeId === props.id
);
const showInputPort = computed(() =>
  connectDirection.value
    ? connectDirection.value === "source" || isConnectStart.value
    : props.selected
);
const showOutputPort = computed(() =>
  connectDirection.value
    ? connectDirection.value === "target" || isConnectStart.value
    : props.selected
);
const sourceConnected = computed(() => !!graph?.connectedSources?.value?.has(props.id));
const targetConnected = computed(() => !!graph?.connectedTargets?.value?.has(props.id));

// ---------------------------------------------------------------- 悬停 / 删除
const hovered = ref(false);

const deleteScale = computed(() =>
  Math.min(1.4, Math.max(0.5, 1 / (flow.viewport.value.zoom || 1)))
);
const deleteStyle = computed(() => ({
  transform: `scale(${deleteScale.value})`,
  top: `${-17 * deleteScale.value}px`,
  right: `${-17 * deleteScale.value}px`,
}));

function removeNode() {
  graph?.captureUndo?.(true);
  flow.removeNodes([props.id]);
}

// ---------------------------------------------------------------- 尺寸
const MIN_NODE_W = 720;
const MIN_NODE_H = 380;
const DEFAULT_NODE_W = 1280;
const DEFAULT_NODE_H = 400;
const nodeW = computed(() => Math.max(MIN_NODE_W, Number(props.data.w) || DEFAULT_NODE_W));
const nodeH = computed(() => Math.max(MIN_NODE_H, Number(props.data.h) || DEFAULT_NODE_H));

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
  props.data.w = Math.round(
    Math.max(MIN_NODE_W, resizeSession.w + (event.clientX - resizeSession.x) / zoom)
  );
  props.data.h = Math.round(
    Math.max(MIN_NODE_H, resizeSession.h + (event.clientY - resizeSession.y) / zoom)
  );
}

function stopResize() {
  resizeSession = null;
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("blur", stopResize);
}

onBeforeUnmount(stopResize);

// ---------------------------------------------------------------- 裁剪
// 时间线内容很密，缩得太小就只剩外框，不参与渲染
const culled = computed(() => {
  if (props.selected) return false;
  if ((Number(graph?.viewport?.value?.zoom) || 1) < 0.3) return true;
  return graph?.visibleNodeIds ? !graph.visibleNodeIds.value.has(props.id) : false;
});
</script>

<style scoped>
.tl-node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 720px;
  height: 620px;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid var(--c-line);
  border-radius: 20px;
  background: var(--c-panel-2);
  box-shadow: 0 6px 18px var(--c-shadow);
}

.vue-flow__node.selected .tl-node {
  border-color: var(--c-accent);
}

.tl-name {
  position: absolute;
  top: -24px;
  left: 12px;
  z-index: 5;
  max-width: calc(100% - 24px);
}

.tl-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 0 0 auto;
  height: 18px;
  padding: 0 2px;
  cursor: grab;
  user-select: none;
}

.tl-head-title {
  color: var(--c-text);
  font-size: 11px;
  font-weight: 600;
}

.tl-head-count {
  color: var(--c-muted-2);
  font-size: 10px;
}

.tl-culled {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--c-muted);
  font-size: 12px;
}

.tl-node-delete {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: var(--c-surface-3);
  color: var(--c-text);
  box-shadow: 0 4px 12px var(--c-shadow);
  cursor: pointer;
  transform-origin: top right;
  transition: color 0.12s ease, border-color 0.12s ease;
}

.tl-node-delete:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.tl-resize {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--c-muted-2);
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tl-node:hover .tl-resize {
  opacity: 1;
}

/* ---------------------------------------------------------------- 端口 */
.vue-flow__handle.tl-port {
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.vue-flow__handle.tl-port.is-on,
.vue-flow__handle.tl-port.is-connected,
.tl-node:hover .vue-flow__handle.tl-port {
  opacity: 1;
}

.tl-port::before {
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

.vue-flow__handle-left.tl-port::before {
  clip-path: inset(0 50% 0 0);
}

.vue-flow__handle-right.tl-port::before {
  clip-path: inset(0 0 0 50%);
}

.tl-port-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.vue-flow__handle-left.tl-port .tl-port-hit {
  transform: translate(-50%, -50%) translateX(-20px);
}

.vue-flow__handle-right.tl-port .tl-port-hit {
  transform: translate(-50%, -50%) translateX(20px);
}

.vue-flow__handle.tl-port.is-on .tl-port-hit,
.vue-flow__handle.tl-port.is-connected .tl-port-hit,
.tl-node:hover .vue-flow__handle.tl-port .tl-port-hit {
  pointer-events: all;
}

.tl-node.is-connecting .vue-flow__handle.tl-port {
  opacity: 0;
  pointer-events: none;
}

.tl-node.is-connecting .vue-flow__handle.tl-port.is-on {
  opacity: 1;
}

.tl-node.is-connecting .vue-flow__handle.tl-port .tl-port-hit {
  pointer-events: none;
}

.tl-node.is-connecting .vue-flow__handle.tl-port.is-on .tl-port-hit {
  pointer-events: all;
}
</style>

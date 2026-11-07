<template>
  <div class="page">
    <div
      ref="wrapEl"
      class="flow-wrap"
      :class="{ 'is-drop-file': dragging }"
      @dblclick.capture="onDblClick"
      @click="rememberNode"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @contextmenu="onContextMenu"
    >
      <VueFlow
        id="demo"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-viewport="defaultViewport"
        :min-zoom="0.1"
        :max-zoom="2"
        :zoom-on-double-click="false"
        :connection-radius="70"
      >
        <Background :pattern-color="canvasGridColor" :gap="20" />
      </VueFlow>

      <!-- 划线切断连线：按住 Ctrl / Option 在空白处拖出一条红线 -->
      <svg
        v-if="cutting"
        class="cut-layer"
        :width="cutSize.w"
        :height="cutSize.h"
      >
        <path :d="cutPath" class="cut-line" />
      </svg>

      <!-- 右上角：提示词 / 资产库 面板 -->
      <LibraryDock />

      <!-- 底部居中：视图与配置快捷栏 -->
      <TabBar
        @focus="focusLastNode"
        @fit="fitCanvasView"
        @canvas="openDialog('canvas')"
        @assets="openDialog('assets')"
        @workflow="openDialog('workflow')"
      />

      <!-- 右下角：主题切换 / 退出画布 -->
      <CanvasMenu />
    </div>

    <component v-for="dialog in dialogs" :is="dialog.component" :key="dialog.key" />
  </div>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, provide, ref } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import DemoNode from "./components/Node/index.vue";
import CanvasEdge from "./components/Edge/index.vue";
import TabBar from "./components/TabBar/index.vue";
import CanvasMenu from "./components/CanvasMenu.vue";
import LibraryDock from "./components/LibraryDock.vue";
import { dialogs, openDialog, closeAllDialogs } from "./stores/dialogs.js";
import { useGraph } from "./composables/useGraph.js";
import { useCanvas } from "./composables/useCanvas.js";
import { FILE_ASSET_DRAG_TYPE } from "./composables/useLibrary.js";
import { useTheme } from "./composables/useTheme.js";

const { canvasGridColor } = useTheme();

const nodeTypes = { demo: markRaw(DemoNode) };
const edgeTypes = { canvas: markRaw(CanvasEdge) };

// 画布初始缩放：改 zoom 即可（1 = 100%）
const defaultViewport = { x: 0, y: 0, zoom: 0.7 };

const {
  nodes,
  edges,
  viewport,
  runStates,
  submitExecution,
  trackPrompt,
  abortPrompt,
  onDblClick,
  importMedia,
  appendMedia,
  appendItems,
  spawnChildNode,
  duplicateNode,
  spawnMediaNodeAt,
  spawnItemsNodeAt,
  itemsFromRefs,
  uploadAsset,
  retryUpload,
  waitForUploads,
  markUploading,
  clearUploading,
  markWaiting,
  clearWaiting,
  nodeBusy,
  replaceMediaItem,
  spawnDetachedNode,
  exportCanvas,
  loadCanvas,
  resetCanvas,
  focusNode,
  fitCanvas,
  captureUndo,
  undo,
  cutEdges,
} = useGraph();

// 最近一次点过的节点：纸飞机按钮优先聚焦它（没有点过节点就只是恢复默认视图）
const lastNodeId = ref(null);

function rememberNode(event) {
  const el = event.target instanceof Element ? event.target.closest(".vue-flow__node") : null;
  if (el && el.dataset.id) lastNodeId.value = el.dataset.id;
}

function focusLastNode() {
  closeAllDialogs();
  // 优先定位正在运行的节点（多个时取最后开始的），没有运行中的再回退到最近点过的节点
  const running = Object.keys(runStates).filter(
    (id) => runStates[id]?.status === "running" && nodes.value.some((node) => node.id === id)
  );
  focusNode(running.length ? running[running.length - 1] : lastNodeId.value);
}

function fitCanvasView() {
  closeAllDialogs();
  fitCanvas();
}

// ---------------------------------------------------------------- 划线切断连线
// 按住 Ctrl / Option 在画布空白处拖拽，红线扫过的连线直接删除。
// pointerdown 必须挂在捕获阶段，否则 Vue Flow 会先把它当成画布平移
const flow = useVueFlow("demo");
const wrapEl = ref(null);
const cutting = ref(false);
const cutPoints = ref([]);
const cutSize = ref({ w: 0, h: 0 });
let cutRect = { left: 0, top: 0 };
let cutFrame = 0;
// 两次重绘之间收到的点先攒在普通数组里，避免每个 pointermove 都触发一次渲染
let cutPending = [];
// 一次划线内只需要给所有连线采样一次（期间画布不会平移缩放）
let cutSamples = [];
let markedGroups = new Set();
const CUT_THRESHOLD = 6;

// 用二次贝塞尔把折线磨平：每段以采样点作为控制点、相邻点中点为端点，
// 拖动快了也能得到一条顺滑的曲线，而不是带棱角的折线
const cutPath = computed(() => {
  const points = cutPoints.value;
  if (points.length < 2) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q${points[i].x.toFixed(1)},${points[i].y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return d;
});

// 节点、面板、输入框上的拖拽不算划线
function isCutBlocked(target) {
  if (!(target instanceof Element)) return true;
  return !!target.closest(
    ".vue-flow__node, .vue-flow__handle, .library-dock, .canvas-tabbar, .canvas-menu, .node-panel, input, textarea, select, [contenteditable='true']"
  );
}

function onCutPointerDown(event) {
  if (event.button !== 0 || !(event.ctrlKey || event.altKey)) return;
  const wrap = wrapEl.value;
  if (!wrap || isCutBlocked(event.target)) return;

  // 拦掉画布平移，也避免选中文本
  event.preventDefault();
  event.stopPropagation();

  cutRect = wrap.getBoundingClientRect();
  cutSize.value = { w: cutRect.width, h: cutRect.height };
  cutPending = [];
  cutSamples = buildCutSamples();
  cutPoints.value = [
    { x: event.clientX - cutRect.left, y: event.clientY - cutRect.top },
  ];
  cutting.value = true;
  document.body.style.cursor = "crosshair";

  window.addEventListener("pointermove", onCutPointerMove, true);
  window.addEventListener("pointerup", onCutPointerUp, true);
  window.addEventListener("keydown", onCutKeyDown, true);
  window.addEventListener("blur", onCutCancel);
}

function onCutPointerMove(event) {
  // 合并掉一帧内的多个事件，点更密也更跟手
  const batch = event.getCoalescedEvents?.() || [];
  for (const item of batch.length ? batch : [event]) {
    const x = item.clientX - cutRect.left;
    const y = item.clientY - cutRect.top;
    const last = cutPending[cutPending.length - 1] || cutPoints.value[cutPoints.value.length - 1];
    if (!last) continue;
    if (Math.abs(x - last.x) < 1.5 && Math.abs(y - last.y) < 1.5) continue;
    cutPending.push({ x, y });
  }
  if (!cutPending.length) return;
  if (!cutFrame) cutFrame = requestAnimationFrame(flushCut);
}

// 每帧只重绘一次曲线，并只用新画出的线段做命中判定
function flushCut() {
  cutFrame = 0;
  if (!cutPending.length) return;
  const pending = cutPending;
  cutPending = [];
  let from = cutPoints.value[cutPoints.value.length - 1];
  cutPoints.value = cutPoints.value.concat(pending);
  for (const point of pending) {
    if (from) testCutSegment(from, point);
    from = point;
  }
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

// 一次划线内把每条连线的路径采样成屏幕坐标点（含包围盒，用于快速排除）
function buildCutSamples() {
  const samples = [];
  const wrap = wrapEl.value;
  if (!wrap) return samples;

  const zoom = viewport.value.zoom || 1;
  const offsetX = viewport.value.x || 0;
  const offsetY = viewport.value.y || 0;
  const step = Math.max(4 / zoom, 2);

  for (const path of wrap.querySelectorAll(".vue-flow__edge-path")) {
    const group = path.closest(".vue-flow__edge");
    const total = path.getTotalLength ? path.getTotalLength() : 0;
    if (!group || !total) continue;

    const points = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let length = 0; length <= total; length += step) {
      const point = path.getPointAtLength(length);
      const x = point.x * zoom + offsetX;
      const y = point.y * zoom + offsetY;
      points.push({ x, y });
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    samples.push({ group, points, minX, minY, maxX, maxY });
  }
  return samples;
}

// 新线段与已采样连线的最近距离：包围盒先排除，命中就高亮（只加不撤）
function testCutSegment(a, b) {
  const minX = Math.min(a.x, b.x) - CUT_THRESHOLD;
  const minY = Math.min(a.y, b.y) - CUT_THRESHOLD;
  const maxX = Math.max(a.x, b.x) + CUT_THRESHOLD;
  const maxY = Math.max(a.y, b.y) + CUT_THRESHOLD;

  for (const entry of cutSamples) {
    if (markedGroups.has(entry.group)) continue;
    if (
      entry.maxX < minX ||
      entry.minX > maxX ||
      entry.maxY < minY ||
      entry.minY > maxY
    ) continue;
    for (const point of entry.points) {
      if (distanceToSegment(point, a, b) <= CUT_THRESHOLD) {
        entry.group.classList.add("is-cutting");
        markedGroups.add(entry.group);
        break;
      }
    }
  }
}

function stopCutListeners() {
  window.removeEventListener("pointermove", onCutPointerMove, true);
  window.removeEventListener("pointerup", onCutPointerUp, true);
  window.removeEventListener("keydown", onCutKeyDown, true);
  window.removeEventListener("blur", onCutCancel);
  if (cutFrame) {
    cancelAnimationFrame(cutFrame);
    cutFrame = 0;
  }
}

function resetCut() {
  stopCutListeners();
  for (const group of markedGroups) group.classList.remove("is-cutting");
  markedGroups = new Set();
  cutSamples = [];
  cutPending = [];
  cutting.value = false;
  cutPoints.value = [];
  document.body.style.cursor = "";
}

function onCutPointerUp(event) {
  // 松手前最后一帧的点也要判定，否则末尾一段扫过的连线会漏掉
  if (cutPending.length) flushCut();
  stopCutListeners();
  if (event.button === 0) {
    const ids = [...markedGroups]
      .map((group) => group.getAttribute("data-id"))
      .filter(Boolean);
    if (ids.length) cutEdges(ids);
  }
  resetCut();
}

function onCutCancel() {
  resetCut();
}

function onCutKeyDown(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  resetCut();
}

// macOS 上 Ctrl + 左键会被当成右键，划线时要把右键菜单压掉
function onContextMenu(event) {
  if (event.ctrlKey || event.altKey) event.preventDefault();
}

// Vue Flow 的画布平移走的是 d3-zoom 的 mousedown，pointerdown 拦不住它
function onCutMouseDown(event) {
  if (event.button !== 0 || !(event.ctrlKey || event.altKey)) return;
  if (isCutBlocked(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
}

onMounted(() => {
  wrapEl.value?.addEventListener("pointerdown", onCutPointerDown, true);
  wrapEl.value?.addEventListener("mousedown", onCutMouseDown, true);
});

onBeforeUnmount(() => {
  wrapEl.value?.removeEventListener("pointerdown", onCutPointerDown, true);
  wrapEl.value?.removeEventListener("mousedown", onCutMouseDown, true);
  resetCut();
});

// 节点组件需要往画布上派生节点 / 追加素材，通过 provide 复用同一份图数据
provide("canvasGraph", {
  appendMedia,
  appendItems,
  spawnChildNode,
  duplicateNode,
  itemsFromRefs,
  uploadAsset,
  retryUpload,
  waitForUploads,
  markUploading,
  clearUploading,
  markWaiting,
  clearWaiting,
  nodeBusy,
  replaceMediaItem,
  spawnDetachedNode,
  runStates,
  submitExecution,
  trackPrompt,
  abortPrompt,
  captureUndo,
  undo,
});

// 画布管理：列表 / 切换 / 自动保存
const canvasStore = useCanvas({ nodes, edges, viewport, exportCanvas, loadCanvas, resetCanvas });
provide("canvasStore", canvasStore);
onMounted(() => canvasStore.bootstrap());

// 从系统里拖动文件进画布
const dragging = ref(false);
// 从节点媒体条里拖出来的素材用这个私有类型，避免和系统文件混淆
const ASSET_DRAG_TYPE = "application/x-infinite-canvas-asset";

function hasFiles(event) {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");
}

function hasAsset(event) {
  if (!event.dataTransfer) return false;
  const types = Array.from(event.dataTransfer.types || []);
  return types.includes(ASSET_DRAG_TYPE) || types.includes(FILE_ASSET_DRAG_TYPE);
}

function onDragOver(event) {
  if (hasAsset(event)) {
    event.dataTransfer.dropEffect = "copy";
    return;
  }
  if (!hasFiles(event)) return;
  event.dataTransfer.dropEffect = "copy";
  dragging.value = true;
}

function onDragLeave(event) {
  // 在子元素之间移动时不算离开
  if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
  dragging.value = false;
}

async function onDrop(event) {
  dragging.value = false;

  // 落在右上角面板上不算画布操作
  if (event.target instanceof Element && event.target.closest(".library-dock")) return;

  // 从节点媒体条拖出来的素材：落在画布空白处新建一个节点；
  // 落在节点/面板上不处理（面板内部那一下是排序）
  const asset = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
  if (asset) {
    if (event.target instanceof Element && event.target.closest(".vue-flow__node")) return;
    try {
      const { nodeId, index } = JSON.parse(asset);
      spawnMediaNodeAt(nodeId, index, event.clientX, event.clientY);
    } catch {
      // 数据不合法就忽略这次拖放
    }
    return;
  }

  // 从资产库拖出来的文件：拖到节点上追加素材，落在空白处新建节点
  const libraryAsset = event.dataTransfer?.getData(FILE_ASSET_DRAG_TYPE);
  if (libraryAsset) {
    let item = null;
    try {
      const ref = JSON.parse(libraryAsset);
      item = itemsFromRefs([ref])[0] || null;
    } catch {
      item = null;
    }
    if (!item) return;

    const targetEl = event.target instanceof Element ? event.target.closest(".vue-flow__node") : null;
    const targetId = targetEl?.dataset.id;
    if (targetId && appendItems(targetId, [item])) return;
    spawnItemsNodeAt([item], event.clientX, event.clientY);
    return;
  }

  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;

  // 拖到已有节点上：素材追加到该节点，不再新建
  const nodeEl = event.target instanceof Element ? event.target.closest(".vue-flow__node") : null;
  const nodeId = nodeEl?.dataset.id;
  if (nodeId && (await appendMedia(nodeId, files))) return;

  // 一次拖入的多个文件会放进同一个新节点
  await importMedia(event.clientX, event.clientY, files);
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.flow-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.flow-wrap .vue-flow {
  width: 100%;
  height: 100%;
}

/* Vue Flow 节点容器自带样式，这里只做最小覆盖 */
.flow-wrap :deep(.vue-flow__node) {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 13px;
}

.flow-wrap :deep(.vue-flow__node.selected) {
  box-shadow: none;
}

/* 拖入文件时的落点提示框 */
.flow-wrap.is-drop-file::after {
  content: "";
  position: absolute;
  inset: 10px;
  border: 2px dashed color-mix(in srgb, var(--c-text) 55%, transparent);
  border-radius: 18px;
  background: color-mix(in srgb, var(--c-text) 4%, transparent);
  pointer-events: none;
  z-index: 6;
}

/* 连线虚线 */
.flow-wrap :deep(.vue-flow__edge-path) {
  stroke: var(--c-edge);
  stroke-dasharray: 6 5;
}

/* 与选中节点相连的线：主题色实线 + 轻微光晕 */
.flow-wrap :deep(.vue-flow__edge-path.is-highlight) {
  stroke: var(--c-accent);
  stroke-width: 2.5;
  stroke-dasharray: none;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--c-accent) 45%, transparent));
}

/* 划线切断连线：覆盖层只负责绘制，不拦截任何鼠标事件 */
.cut-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
}

.cut-line {
  fill: none;
  stroke: #ff3b3b;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 5px rgba(255, 59, 59, 0.55));
}

/* 拖拽过程中高亮即将被切断的连线 */
.flow-wrap :deep(.vue-flow__edge.is-cutting .vue-flow__edge-path) {
  stroke: #ff3b3b;
  stroke-width: 3;
  stroke-dasharray: none;
}
</style>

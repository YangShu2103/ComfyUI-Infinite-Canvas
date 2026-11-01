<template>
  <div class="page">
    <div
      class="flow-wrap"
      :class="{ 'is-drop-file': dragging }"
      @dblclick.capture="onDblClick"
      @click="rememberNode"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
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
        <Background pattern-color="#2a2a33" :gap="20" />
      </VueFlow>

      <!-- 右上角：提示词 / 资产库 面板 -->
      <LibraryDock />

      <!-- 底部居中：视图与配置快捷栏 -->
      <TabBar
        @focus="focusLastNode"
        @fit="fitCanvasView"
        @canvas="openDialog('canvas')"
        @workflow="openDialog('workflow')"
      />
    </div>

    <component v-for="dialog in dialogs" :is="dialog.component" :key="dialog.key" />
  </div>
</template>

<script setup>
import { markRaw, onMounted, provide, ref } from "vue";
import { VueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import DemoNode from "./components/Node/index.vue";
import CanvasEdge from "./components/Edge/index.vue";
import TabBar from "./components/TabBar/index.vue";
import LibraryDock from "./components/LibraryDock.vue";
import { dialogs, openDialog, closeAllDialogs } from "./stores/dialogs.js";
import { useGraph } from "./composables/useGraph.js";
import { useCanvas } from "./composables/useCanvas.js";
import { FILE_ASSET_DRAG_TYPE } from "./composables/useLibrary.js";

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
  replaceMediaItem,
  spawnDetachedNode,
  exportCanvas,
  loadCanvas,
  resetCanvas,
  focusNode,
  fitCanvas,
} = useGraph();

// 最近一次点过的节点：纸飞机按钮优先聚焦它（没有点过节点就只是恢复默认视图）
const lastNodeId = ref(null);

function rememberNode(event) {
  const el = event.target instanceof Element ? event.target.closest(".vue-flow__node") : null;
  if (el && el.dataset.id) lastNodeId.value = el.dataset.id;
}

function focusLastNode() {
  closeAllDialogs();
  focusNode(lastNodeId.value);
}

function fitCanvasView() {
  closeAllDialogs();
  fitCanvas();
}

// 节点组件需要往画布上派生节点 / 追加素材，通过 provide 复用同一份图数据
provide("canvasGraph", {
  appendMedia,
  appendItems,
  spawnChildNode,
  duplicateNode,
  itemsFromRefs,
  uploadAsset,
  replaceMediaItem,
  spawnDetachedNode,
  runStates,
  submitExecution,
  trackPrompt,
  abortPrompt,
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
  border: 2px dashed rgba(230, 230, 234, 0.55);
  border-radius: 18px;
  background: rgba(230, 230, 234, 0.04);
  pointer-events: none;
  z-index: 6;
}

/* 连线虚线 */
.flow-wrap :deep(.vue-flow__edge-path) {
  stroke-dasharray: 6 5;
}

/* 与选中节点相连的线：主题色实线 + 轻微光晕 */
.flow-wrap :deep(.vue-flow__edge-path.is-highlight) {
  stroke: var(--accent-yellow);
  stroke-width: 2.5;
  stroke-dasharray: none;
  filter: drop-shadow(0 0 4px rgba(242, 255, 89, 0.45));
}
</style>

<template>
  <div
    class="demo-node"
    @mousedown="onRootMouseDown"
    @mouseenter="enterActions"
    @mouseleave="leaveActions"
  >
    <Handle
      type="target"
      :position="Position.Left"
      class="node-port"
      :class="{ 'is-on': showPort, 'is-connected': targetConnected }"
    >
      <div class="port-hit" />
    </Handle>

    <!-- 节点上方扇形操作：悬停 / 选中时出现 -->
    <NodeActions
      ref="actionsRef"
      :visible="actionsVisible"
      :node-id="id"
      :media="ownMedia"
      :input-media="inputMedia"
      :index="index"
      :label="data.label"
      @select="select"
    />
    <!-- <div class="node-head" :title="current ? current.name : data.label">
      {{ current ? current.name : data.label }}
    </div> -->

    <!-- 媒体预览：只显示本节点自己的素材；上游媒体只在面板里展示 -->
    <div v-if="ownMedia.length" class="node-media">
      <div class="media-stack">
        <div
          v-for="(item, i) in ownMedia"
          :key="item.id"
          class="media-stack-card"
          :class="{ 'is-active': i === index }"
          :style="cardStyle(i)"
          :title="item.name"
          @mousedown="onCardMouseDown($event, i)"
          @click="select(i)"
          @dblclick.stop="openPreviewPanel(i)"
        >
          <!-- 视频不拦截 mousedown，整块区域仍可拖动节点；控制条按钮单独阻止冒泡 -->
          <VideoPlayer v-if="item.kind === 'video' && i === index" :src="item.url" />
          <video
            v-else-if="item.kind === 'video'"
            :src="item.url"
            class="media-thumb"
            muted
            preload="metadata"
          />
          <audio
            v-else-if="item.kind === 'audio' && i === index"
            :src="item.url"
            class="media-audio"
            controls
          />
          <div v-else-if="item.kind === 'audio'" class="media-audio-thumb">音频</div>
          <img v-else :src="item.url" :alt="item.name" draggable="false" @dragstart.prevent />
          <!-- 每张素材右上角的删除按钮 -->
          <button
            class="card-delete"
            type="button"
            title="删除这张素材"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="removeMediaAt(i)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="ownMedia.length > 1" class="media-dots">
        <span
          v-for="(item, i) in ownMedia"
          :key="item.id"
          class="media-dot"
          :class="{ 'is-active': i === index }"
        />
      </div>
    </div>
    <div v-else-if="!showProgress" class="node-empty">支持图片 / 视频预览</div>

    <!-- 运行态：整个节点当进度条，从左向右填充，百分比居中 -->
    <div
      v-if="showProgress"
      class="node-progress"
      :class="{ 'is-queued': runState.status === 'queued' }"
    >
      <span class="node-progress-fill" :style="{ width: `${runPercent}%` }" />
      <span v-if="runState.status === 'queued'" class="node-progress-spinner" />
      <span
        v-else-if="runState.status === 'error'"
        class="node-progress-label is-error"
        :title="runState.error"
      >
        {{ runState.error }}
      </span>
      <span v-else class="node-progress-label">{{ runPercent }}%</span>
    </div>

    <button
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

    <!-- 操作面板：选中节点时出现在节点下方 20px -->
    <Transition name="panel-fade">
      <div
        v-if="selected"
        ref="panelEl"
        class="node-panel"
        @mousedown.stop
        @mouseup.stop
        @click.stop
        @dblclick.stop
        @wheel.stop
        @mouseenter="enterHover"
        @mouseleave="leaveHover"
        @focusout="onPanelFocusOut"
      >
        <!-- 悬浮工作流列表：鼠标移入面板时从面板向左弹出，移出时向右回收 -->
        <div
          v-if="workflowNames.length"
          ref="workflowListEl"
          class="panel-workflows"
          :class="{ 'is-open': panelHover }"
          @dragover.prevent
          @mouseenter="enterHover"
          @mouseleave="leaveHover"
        >
          <button
            v-for="name in workflowNames"
            :key="name"
            class="wf-pill"
            :class="{ 'is-active': data.workflow === name }"
            type="button"
            :title="name"
            @mousedown.stop
            @click.stop="pickWorkflow(name)"
          >
            {{ name }}
          </button>
        </div>
        <div v-if="stripItems.length" class="media-strip" @dragover.prevent @wheel="closePreview">
          <template v-for="entry in stripItems" :key="entry.item.id">
            <span v-if="entry.sep" class="strip-sep" />
            <div
              class="strip-item"
              :class="{
                'is-active': entry.group === 'own' && entry.i === index,
                'is-dragging': isDragging(entry),
                'is-over': isOver(entry),
              }"
              draggable="true"
              @mouseenter="openPreview($event, entry)"
              @mouseleave="closePreview"
              @dragstart="onStripDragStart($event, entry)"
              @dragover.prevent="onStripDragOver($event, entry)"
              @drop.prevent="onStripDrop($event, entry)"
              @dragend="onStripDragEnd"
              @click.stop="onStripClick(entry)"
            >
              <video
                v-if="entry.item.kind === 'video'"
                :src="entry.item.url"
                class="strip-video"
                muted
                preload="metadata"
              />
              <span v-else-if="entry.item.kind === 'audio'" class="strip-audio">音频</span>
              <img
                v-else
                :src="entry.item.url"
                :alt="entry.item.name"
                draggable="false"
                @dragstart.prevent
              />
              <span v-if="entry.item.kind === 'video'" class="strip-badge">▶</span>
              <span v-if="entry.group === 'input'" class="strip-flag" title="上游媒体" />
              <!-- 自身素材右上角删除按钮；上游素材只读，不提供删除 -->
              <button
                v-if="entry.group === 'own'"
                class="strip-delete"
                type="button"
                title="删除这张素材"
                @pointerdown.stop
                @mousedown.stop
                @click.stop="removeMediaAt(entry.i)"
              >
                <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
          </template>
        </div>
        <!-- 提示词框常驻：未选工作流时只做占位提示 -->
        <div class="panel-prompt">
          <textarea
            ref="promptEl"
            class="panel-text"
            :value="promptField ? valueOf(promptField) : promptDraft"
            :placeholder="data.workflow ? '请输入提示词内容' : '请选择左侧的工作流'"
            :readonly="!data.workflow"
            spellcheck="false"
            @input="onPromptInput"
            @focus="registerPromptTarget"
            @keydown.stop
          />
        </div>

        <!-- 其余字段：自动换行的小控件，顺序为 开关 → 下拉框 → 其他 → 随机数 -->
        <div v-if="gridFields.length" class="panel-fields">
          <div v-for="field in gridFields" :key="field.id" class="panel-field">
            <label class="panel-field-label" :title="`#${field.nodeId} ${field.key}`">
              {{ field.label }}
            </label>

            <textarea
              v-if="field.type === 'textarea'"
              class="panel-text"
              :value="valueOf(field)"
              :placeholder="field.label"
              spellcheck="false"
              @input="setValue(field, $event.target.value)"
              @keydown.stop
            />
            <input
              v-else-if="field.type === 'text'"
              class="panel-input panel-input-wide"
              type="text"
              :value="valueOf(field)"
              :placeholder="field.label"
              spellcheck="false"
              @input="setValue(field, $event.target.value)"
              @keydown.stop
            />
            <input
              v-else-if="field.type === 'number'"
              class="panel-input"
              type="number"
              :value="valueOf(field)"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              @input="setValue(field, toNumber($event.target.value))"
              @keydown.stop
            />
            <div
              v-else-if="field.type === 'slider'"
              class="panel-slider"
              :style="{ '--slider-ratio': `${ratioOf(field)}` }"
            >
              <input
                type="range"
                :value="valueOf(field)"
                :min="field.min ?? 0"
                :max="field.max ?? 100"
                :step="field.step ?? 1"
                @input="setValue(field, toNumber($event.target.value))"
              />
              <!-- 圆钮里直接显示当前数值，不再单独占一列 -->
              <span class="panel-slider-thumb">{{ valueOf(field) }}</span>
            </div>
            <select
              v-else-if="field.type === 'select'"
              class="panel-select"
              :value="valueOf(field)"
              @change="setValue(field, $event.target.value)"
              @keydown.stop
            >
              <option v-for="option in optionsOf(field)" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
            <label
              v-else-if="field.type === 'switch'"
              class="panel-switch"
              :class="{ 'is-on': !!valueOf(field) }"
            >
              <input
                type="checkbox"
                :checked="!!valueOf(field)"
                @change="setValue(field, $event.target.checked)"
                @keydown.stop
              />
              <span class="switch-track">
                <span class="switch-thumb" />
              </span>
            </label>

            <!-- 随机数：点骰子切换为每次运行刷新，输入框变只读 -->
            <div v-else-if="field.type === 'random'" class="panel-random">
              <input
                class="panel-input"
                type="number"
                :value="valueOf(field)"
                :readonly="isRandom(field)"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                @input="onRandomInput(field, $event)"
                @keydown.stop
              />
              <button
                class="panel-dice"
                :class="{ 'is-on': isRandom(field) }"
                type="button"
                :title="isRandom(field) ? '每次运行自动刷新（点击恢复固定值）' : '点击后每次运行随机刷新'"
                @click.stop="toggleRandom(field)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                  />
                  <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" />
                  <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                  <circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" />
                  <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div v-if="data.workflow && !gridFields.length" class="panel-hint">
          该工作流没有其他可调参数
        </div>

        <div class="panel-row">
          <button
            class="panel-run"
            :class="{ 'is-stop': isBusy }"
            type="button"
            :disabled="running"
            @click.stop="onRunClick"
          >
            {{ running ? "提交中…" : isBusy ? "中断" : "运行" }}
          </button>
        </div>
        <div v-if="runError" class="panel-error">{{ runError }}</div>
      </div>
    </Transition>
    <Handle
      type="source"
      :position="Position.Right"
      class="node-port"
      :class="{ 'is-on': showPort, 'is-connected': sourceConnected }"
    >
      <div class="port-hit" />
    </Handle>

    <!-- Alt/Option 拖动时跟随光标的虚拟副本，松手后才落成真实节点 -->
    <Teleport to="body">
      <div
        v-if="ghost.active"
        class="node-ghost"
        :style="{
          left: `${ghost.x}px`,
          top: `${ghost.y}px`,
          width: `${ghost.width}px`,
          height: `${ghost.height}px`,
        }"
      >
        <span class="node-ghost-label">{{ ghost.label }}</span>
      </div>
    </Teleport>

    <!-- 悬停素材条时的快速预览气泡 -->
    <Teleport to="body">
      <div
        v-if="previewCard"
        class="preview-bubble"
        :style="{
          left: `${previewCard.x}px`,
          top: `${previewCard.y}px`,
          width: previewCard.ready ? `${previewCard.width}px` : 'auto',
          height: previewCard.ready ? `${previewCard.height}px` : 'auto',
          visibility: previewCard.ready ? 'visible' : 'hidden',
        }"
      >
        <video
          v-if="previewCard.item.kind === 'video'"
          :src="previewCard.item.url"
          autoplay
          muted
          loop
          playsinline
          @loadedmetadata="fitPreview"
        />
        <img
          v-else-if="previewCard.item.kind === 'image'"
          :src="previewCard.item.url"
          @load="fitPreview"
        />
        <div v-else class="preview-bubble-audio">音频</div>
        <span class="preview-bubble-name">{{ previewCard.item.name }}</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import NodeActions from "./NodeActions.vue";
import VideoPlayer from "./VideoPlayer.vue";
import { useLibrary } from "../../composables/useLibrary.js";

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const flow = useVueFlow("demo");

// 悬停节点时显示上方扇形操作；离开后延迟收起，留出走到按钮上的时间
const actionHover = ref(false);
let actionTimer = null;
const actionsVisible = computed(() => actionHover.value || props.selected);

function enterActions() {
  clearTimeout(actionTimer);
  actionHover.value = true;
}

function leaveActions() {
  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => {
    actionHover.value = false;
  }, 260);
}

// 删除按钮反向缩放：补偿画布缩放，保持视觉大小稳定；
// 但缩放系数要夹住范围，缩得很小时不能让它相对节点膨胀成巨无霸
const deleteScale = computed(() =>
  Math.min(1.4, Math.max(0.5, 1 / (flow.viewport.value.zoom || 1)))
);
const deleteStyle = computed(() => ({
  transform: `scale(${deleteScale.value})`,
  top: `${-17 * deleteScale.value}px`,
  right: `${-17 * deleteScale.value}px`,
}));

// Alt / Option 拖动节点 = 复制：拖动期间只跟一个虚拟副本，松手才落成真实节点
const ghost = ref({ active: false, x: 0, y: 0, width: 0, height: 0, label: "" });
let ghostGrab = null;
let ghostMoved = false;

function stopGhostDrag() {
  window.removeEventListener("mousemove", onGhostMove);
  window.removeEventListener("mouseup", onGhostDrop);
  window.removeEventListener("blur", stopGhostDrag);
  ghostGrab = null;
  ghost.value.active = false;
}

function onRootMouseDown(event) {
  if (!event.altKey || event.button !== 0) return;
  // 拦掉 Vue Flow 的拖拽，原节点保持不动
  event.preventDefault();
  event.stopPropagation();

  const rect = event.currentTarget.getBoundingClientRect();
  ghostGrab = {
    dx: event.clientX - rect.left,
    dy: event.clientY - rect.top,
    x: event.clientX,
    y: event.clientY,
  };
  ghostMoved = false;
  ghost.value = {
    active: true,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    label: props.data.workflow || "复制节点",
  };
  window.addEventListener("mousemove", onGhostMove);
  window.addEventListener("mouseup", onGhostDrop);
  window.addEventListener("blur", stopGhostDrag);
}

function onGhostMove(event) {
  if (!ghostGrab) return;
  if (
    Math.abs(event.clientX - ghostGrab.x) > 3 ||
    Math.abs(event.clientY - ghostGrab.y) > 3
  ) {
    ghostMoved = true;
  }
  ghost.value.x = event.clientX - ghostGrab.dx;
  ghost.value.y = event.clientY - ghostGrab.dy;
}

function onGhostDrop() {
  const grab = ghostGrab;
  const moved = ghostMoved;
  const left = ghost.value.x;
  const top = ghost.value.y;
  stopGhostDrag();
  // Alt + 单击（没有拖动）不复制
  if (!grab || !moved) return;
  // 虚拟副本左上角换算成画布坐标，落成真实的兄弟节点
  const point = flow.screenToFlowCoordinate({ x: left, y: top });
  graph.duplicateNode(props.id, { x: point.x, y: point.y });
}

onBeforeUnmount(() => {
  stopGhostDrag();
  clearTimeout(actionTimer);
});

// 节点自身素材（节点内堆叠预览用）
const ownMedia = computed(() => props.data.media || []);
// 上游带进来的素材：只在面板里展示，不算节点自身媒体
const inputMedia = computed(() => props.data.inputMedia || []);
const index = computed(() => {
  const len = ownMedia.value.length;
  if (!len) return 0;
  return Math.min(Math.max(props.data.index || 0, 0), len - 1);
});

// 面板媒体条：上游在前、自己的在后，中间用分隔线隔开
const stripItems = computed(() => {
  const entries = inputMedia.value.map((item, i) => ({ item, group: "input", i, sep: false }));
  ownMedia.value.forEach((item, i) => {
    entries.push({ item, group: "own", i, sep: inputMedia.value.length > 0 && i === 0 });
  });
  return entries;
});

function select(i) {
  props.data.index = i;
}

// 上方操作组件实例：双击素材时借用它的预览面板
const actionsRef = ref(null);

function openPreviewPanel(i) {
  if (i !== index.value) select(i);
  actionsRef.value?.openPreviewPanel();
}

// 堆叠定位：当前卡片居中，左右相邻卡片向两侧错开并缩小
function cardStyle(i) {
  const offset = i - index.value;
  const abs = Math.abs(offset);
  return {
    transform: `translateX(calc(-50% + ${offset * 38}%)) scale(${offset === 0 ? 1 : 0.92})`,
    zIndex: String(10 - abs),
    opacity: abs === 0 ? 1 : abs <= 2 ? 0.9 : 0.5,
  };
}

// 点非当前卡片只用于切换，不触发节点拖动
function onCardMouseDown(event, i) {
  if (i !== index.value) event.stopPropagation();
}

// 面板媒体条：悬停缩略图时的快速预览气泡（Teleport 到 body，避免被节点/面板裁剪）
const previewCard = ref(null);
let previewTimer = null;

function closePreview() {
  clearTimeout(previewTimer);
  previewCard.value = null;
}

function openPreview(event, entry) {
  clearTimeout(previewTimer);
  // 拖动过程中不弹预览
  if (dragEntry.value) return;
  const rect = event.currentTarget.getBoundingClientRect();
  previewTimer = setTimeout(() => {
    previewCard.value = {
      item: entry.item,
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
      },
      x: rect.right + 12,
      y: rect.top,
      width: 0,
      height: 0,
      ready: false,
    };
    // 音频没有尺寸可测，直接给个固定小卡片
    if (entry.item.kind !== "image" && entry.item.kind !== "video") {
      placePreview(200, 88, true);
    }
  }, 260);
}

// 资源加载完成后按真实宽高比定气泡尺寸（上限 360），气泡高度自适应、由资源填满
function fitPreview(event) {
  const card = previewCard.value;
  const el = event.currentTarget;
  if (!card || !el) return;
  const width = el.naturalWidth || el.videoWidth || 0;
  const height = el.naturalHeight || el.videoHeight || 0;
  if (!width || !height) return;
  const maxWidth = 360;
  const maxHeight = Math.min(520, window.innerHeight - 80);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  placePreview(Math.round(width * scale), Math.round(height * scale), true);
}

// 根据缩略图位置摆放气泡：优先右侧，放不下翻到左侧，再夹在视口内
function placePreview(width, height, ready) {
  const card = previewCard.value;
  if (!card) return;
  const gap = 12;
  let x = card.rect.right + gap;
  if (x + width > window.innerWidth - 8) x = card.rect.left - gap - width;
  x = Math.min(Math.max(8, x), window.innerWidth - width - 8);
  let y = card.rect.top + card.rect.height / 2 - height / 2;
  y = Math.min(Math.max(8, y), window.innerHeight - height - 8);
  previewCard.value = {
    ...card,
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    ready,
  };
}

// 面板收起（节点取消选中）时把气泡一起关掉
watch(
  () => props.selected,
  (open) => {
    if (!open) closePreview();
  }
);

// 面板媒体条：拖动排序（只在同一组内排序，不会动到别的节点）
const ASSET_DRAG_TYPE = "application/x-infinite-canvas-asset";
const dragEntry = ref(null);
const overEntry = ref(null);

function isSameEntry(a, b) {
  return !!a && !!b && a.group === b.group && a.i === b.i;
}

function isDragging(entry) {
  return isSameEntry(dragEntry.value, entry);
}

function isOver(entry) {
  return !!dragEntry.value && dragEntry.value.group === entry.group && isSameEntry(overEntry.value, entry);
}

function onStripDragStart(event, entry) {
  dragEntry.value = entry;
  overEntry.value = entry;
  closePreview();
  event.dataTransfer.effectAllowed = "copyMove";
  // 部分浏览器需要写入数据才会真正开始拖拽
  event.dataTransfer.setData("text/plain", String(entry.i));
  // 自己的素材可以拖出媒体条：落在画布空白处会新建一个节点
  if (entry.group === "own") {
    event.dataTransfer.setData(
      ASSET_DRAG_TYPE,
      JSON.stringify({ nodeId: props.id, index: entry.i })
    );
  }
}

function onStripDragOver(event, entry) {
  if (!dragEntry.value || dragEntry.value.group !== entry.group) return;
  overEntry.value = entry;
}

function onStripDrop(event, entry) {
  const from = dragEntry.value;
  dragEntry.value = null;
  overEntry.value = null;
  if (!from || from.group !== entry.group || from.i === entry.i) return;

  const key = entry.group === "input" ? "inputMedia" : "media";
  const list = [...(props.data[key] || [])];
  const [moved] = list.splice(from.i, 1);
  list.splice(entry.i, 0, moved);
  props.data[key] = list;
  // 自己的素材重排后，预览跟着被拖动的那张走
  if (entry.group === "own") props.data.index = entry.i;
}

function onStripDragEnd() {
  dragEntry.value = null;
  overEntry.value = null;
}

function onStripClick(entry) {
  if (entry.group === "own") props.data.index = entry.i;
}

// 节点被删除时只释放本地预览生成的 blob URL（/view 引用不需要释放）
onBeforeUnmount(() => {
  closePreview();
  for (const item of props.data.media || []) {
    if (item.blob) URL.revokeObjectURL(item.url);
  }
});

// 正在拉线时（connectionStartHandle 非空），所有节点都显示端口
const connecting = computed(() => !!flow.connectionStartHandle.value);

// 选中节点 或 拉线中 才显示端口
const showPort = computed(() => props.selected || connecting.value);

// 已经连出 / 连入的端口常驻显示
const sourceConnected = computed(() => flow.edges.value.some((e) => e.source === props.id));
const targetConnected = computed(() => flow.edges.value.some((e) => e.target === props.id));

// 删除第 i 张自身素材；素材存在 ComfyUI input 目录时顺带删掉文件
function removeMediaAt(i) {
  const list = props.data.media || [];
  if (!list[i]) return;

  const at = index.value;
  const item = list[i];
  if (item.blob) URL.revokeObjectURL(item.url);
  if (item.ref && item.ref.type === "input" && String(item.ref.filename).startsWith("infinite_canvas_")) {
    fetch(`/infinite_canvas/api/media/${encodeURIComponent(item.ref.filename)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  const rest = list.filter((_, k) => k !== i);
  props.data.media = rest;
  // 当前预览卡跟着修正：删的是它自己就停在同一位置，删的是前面的就左移一位
  props.data.index = at > i ? at - 1 : at === i ? Math.min(i, rest.length - 1) : at;
}

// 删除节点（相连的连线会一起删掉）；素材由每张卡片/缩略图右上角的按钮单独删除
function removeNode() {
  // 运行中/排队中删除节点，同时中断任务或把它从队列里撤掉
  if (isBusy.value) graph.abortPrompt(props.id);
  flow.removeNodes([props.id]);
}

const graph = inject("canvasGraph");

// 当前节点的运行状态（由 useGraph 统一维护，不写进画布数据）
const runState = computed(() => graph?.runStates?.[props.id] || null);
const runPercent = computed(() => {
  const ratio = Number(runState.value?.progress) || 0;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
});

// 运行中或排队中：运行按钮切换成"中断"
const isBusy = computed(
  () =>
    !!runState.value &&
    (runState.value.status === "running" || runState.value.status === "queued")
);

// 排队中显示 loading；完成态留的 1 秒清理期不能盖住刚出现的产物
const showProgress = computed(() => {
  const status = runState.value?.status;
  return status === "queued" || status === "running" || status === "error";
});

function onRunClick() {
  if (isBusy.value) {
    interruptRun();
    return;
  }
  run();
}

// 中断：运行中的取消执行，排队中的从队列里删掉（后端按队列状态自动区分）
async function interruptRun() {
  runError.value = "";
  await graph.abortPrompt(props.id);
}

// 面板左侧悬浮的工作流列表（数据来自工作流配置）
const workflowNames = ref([]);
const workflowListEl = ref(null);
const panelEl = ref(null);
// 鼠标是否停在面板或列表上（留一点缓冲，便于在面板与列表之间移动）
const panelHover = ref(false);
let leaveTimer = null;
// 全局记录指针位置：面板因聚焦/重排而挪动时会误报 mouseleave，用真实坐标复核
let pointer = { x: -1, y: -1 };

function trackPointer(event) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}

function onPointerMove(event) {
  if (panelHover.value) trackPointer(event);
}

onMounted(() => window.addEventListener("mousemove", onPointerMove, { passive: true }));

// 只按指针真实位置判断：面板重排/聚焦时可能误报 mouseleave，用坐标复核后再收起
function keepPanelOpen() {
  if (pointer.x < 0) return true;
  const under = document.elementFromPoint(pointer.x, pointer.y);
  return !!under && !!under.closest(".node-panel");
}

function enterHover(event) {
  if (event) trackPointer(event);
  clearTimeout(leaveTimer);
  panelHover.value = true;
}

function leaveHover() {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    if (keepPanelOpen()) return;
    panelHover.value = false;
  }, 180);
}

// 焦点离开面板后再按指针位置判断一次，避免列表一直挂着
function onPanelFocusOut(event) {
  if (event.relatedTarget && panelEl.value?.contains(event.relatedTarget)) return;
  leaveHover();
}

// 展开时才定位到上次选中的工作流
watch(panelHover, (on) => {
  if (on) nextTick(() => revealActiveWorkflow());
});

onBeforeUnmount(() => {
  clearTimeout(leaveTimer);
  window.removeEventListener("mousemove", onPointerMove);
});

// 列表加载完把上次选中的工作流滚到可见位置
function revealActiveWorkflow() {
  const container = workflowListEl.value;
  if (!container || !props.data.workflow) return;
  const active = container.querySelector(".wf-pill.is-active");
  if (!active) return;
  container.scrollTop = Math.max(0, active.offsetTop - (container.clientHeight - active.offsetHeight) / 2);
}

async function loadWorkflowNames() {
  try {
    const response = await fetch("/infinite_canvas/api/workflows");
    const data = await response.json();
    workflowNames.value = (data.workflows || []).map((item) => item.name);
  } catch {
    workflowNames.value = [];
  }
  await nextTick();
  revealActiveWorkflow();
}

function pickWorkflow(name) {
  // 换工作流后旧参数可能对不上新字段，直接清空
  if (name !== props.data.workflow) {
    props.data.params = {};
    promptDraft.value = "";
  }
  props.data.workflow = name;
  runError.value = "";
  loadFields();
}

// 当前工作流暴露给画布的字段（定义在工作流配置里）
const fields = ref([]);

async function loadFields() {
  const name = props.data.workflow;
  if (!name) {
    fields.value = [];
    return;
  }
  try {
    const response = await fetch(
      `/infinite_canvas/api/workflows/${encodeURIComponent(name)}/fields`
    );
    const data = await response.json();
    fields.value = (data.fields || []).map((field) => ({
      ...field,
      id: `${field.nodeId}.${field.key}`,
    }));
  } catch {
    fields.value = [];
  }
}

// 参数值存在节点自己的 data.params 里，没填过就落回工作流里的默认值
function valueOf(field) {
  const value = props.data.params?.[field.nodeId]?.[field.key];
  return value === undefined ? field.default : value;
}

function setValue(field, value) {
  const params = { ...(props.data.params || {}) };
  params[field.nodeId] = { ...(params[field.nodeId] || {}), [field.key]: value };
  props.data.params = params;
}

function toNumber(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

// 滑块圆钮位置：当前值换算成 0~1
function ratioOf(field) {
  const value = Number(valueOf(field));
  const min = Number(field.min ?? 0);
  const max = Number(field.max ?? 100);
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// 下拉框没配选项时，至少把当前值显示出来，避免看起来是空的
function optionsOf(field) {
  if (field.options?.length) return field.options;
  const value = valueOf(field);
  return typeof value === "string" && value ? [value] : [];
}

// ComfyUI 的图片/音频输入用的是 "子目录/文件名" 这种相对路径
function fileNameOf(ref) {
  if (!ref?.filename) return "";
  return ref.subfolder ? `${ref.subfolder}/${ref.filename}` : ref.filename;
}

// 素材顺序：上游在前，自身在后
function mediaNames(kind) {
  return [...inputMedia.value, ...ownMedia.value]
    .filter((item) => item.kind === kind && item.ref?.filename)
    .map((item) => fileNameOf(item.ref));
}

// 素材字段的值来自节点素材，节点面板上不显示
const MEDIA_TYPES = new Set(["image", "image_list", "audio", "video"]);
const editableFields = computed(() => fields.value.filter((field) => !MEDIA_TYPES.has(field.type)));

// 提示词框常驻：取第一个文本类字段作为提示词；工作流没暴露文本字段时只作占位输入
const promptField = computed(
  () => editableFields.value.find((field) => field.type === "textarea" || field.type === "text") || null
);
const promptDraft = ref("");
const promptEl = ref(null);

// 提示词框的插入目标：输入 @ / 打开面板后，点面板条目会插到光标处
const { open: openLibrary, setPromptTarget } = useLibrary();

function promptText() {
  return promptField.value ? valueOf(promptField.value) : promptDraft.value;
}

function writePrompt(text) {
  if (promptField.value) setValue(promptField.value, text);
  else promptDraft.value = text;
}

function registerPromptTarget() {
  setPromptTarget({ nodeId: props.id, insert: insertIntoPrompt });
}

function insertIntoPrompt(text) {
  const el = promptEl.value;
  if (!el) return;
  const start = el.selectionStart ?? promptText().length;
  const end = el.selectionEnd ?? start;
  const value = promptText();
  writePrompt(value.slice(0, start) + text + value.slice(end));
  nextTick(() => {
    const caret = start + text.length;
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}

function onPromptInput(event) {
  const value = event.target.value;
  // 输入 @ / 直接打开资产库 / 提示词面板，触发字符本身留在框里的意义不大，直接去掉
  const trigger = event.data || "";
  if (trigger === "@" || trigger === "/") {
    const caret = event.target.selectionStart ?? value.length;
    const text = value.slice(0, caret - trigger.length) + value.slice(caret);
    writePrompt(text);
    nextTick(() => {
      const el = promptEl.value;
      if (!el) return;
      el.value = text;
      const pos = caret - trigger.length;
      el.setSelectionRange(pos, pos);
    });
    registerPromptTarget();
    openLibrary(trigger === "@" ? "asset" : "prompt");
    return;
  }

  writePrompt(value);
  registerPromptTarget();
}

// 其余字段：开关 → 下拉框 → 其他 → 随机数，同组内保持原有顺序
const FIELD_RANK = { switch: 0, select: 1, random: 3 };
const gridFields = computed(() =>
  editableFields.value
    .filter((field) => field.id !== promptField.value?.id)
    .sort((a, b) => (FIELD_RANK[a.type] ?? 2) - (FIELD_RANK[b.type] ?? 2))
);

// 随机数默认就是"每次运行刷新"，只有显式关掉才用固定值
function isRandom(field) {
  return props.data.randomFields?.[field.id] !== false;
}

function randomInt(field) {
  const min = Number(field.min ?? 0);
  const max = Number(field.max ?? 4294967295);
  const lo = Number.isFinite(min) ? Math.max(0, Math.ceil(min)) : 0;
  const hi = Number.isFinite(max) && max >= lo ? Math.floor(max) : 4294967295;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// 点骰子：开启时输入框只读、每次运行前重新取值；关闭后沿用当前固定值
function toggleRandom(field) {
  const flags = { ...(props.data.randomFields || {}) };
  if (isRandom(field)) {
    flags[field.id] = false;
  } else {
    delete flags[field.id];
    setValue(field, randomInt(field));
  }
  props.data.randomFields = flags;
}

function onRandomInput(field, event) {
  if (isRandom(field)) return;
  setValue(field, toNumber(event.target.value));
}

// 媒体字段没有可用素材时退回工作流里的默认值，避免给 ComfyUI 传空路径
function defaultValueOf(field) {
  return field.default === undefined || field.default === null ? "" : field.default;
}

// 实际提交给工作流的值：媒体字段从节点素材解析，随机字段按模式生成
function resolveValue(field) {
  if (field.type === "image" || field.type === "audio" || field.type === "video") {
    return mediaNames(field.type)[0] || defaultValueOf(field);
  }
  if (field.type === "image_list") {
    const names = mediaNames("image");
    if (!names.length) return defaultValueOf(field);
    // ImagePicker 这类输入是 JSON 字符串（默认值 "[]"），数组型输入才直接给数组
    return typeof field.default === "string" ? JSON.stringify(names) : names;
  }
  if (field.type === "random" && isRandom(field)) {
    const value = randomInt(field);
    setValue(field, value);
    return value;
  }
  return valueOf(field);
}

// 打开面板 / 切换工作流时，重新拉一次列表和字段（接口不可用时静默为空）
watch(
  () => [props.selected, props.data.workflow],
  ([on]) => {
    if (!on) return;
    loadWorkflowNames();
    loadFields();
  },
  { immediate: true }
);

const running = ref(false);
const runError = ref("");

// 运行：提交后立刻返回任务 id；有自身素材时马上派生下游节点承接产物，
// 等待和进度都放在下游节点上，当前节点不被阻塞
async function run() {
  if (running.value) return;
  if (!props.data.workflow) {
    runError.value = "先在左侧选择工作流";
    return;
  }

  runError.value = "";
  running.value = true;

  try {
    // 素材引用带 type/subfolder：产物在 output 目录时由后端按需接入 input 再提交
    const imageRefs = ownMedia.value
      .filter((item) => item.kind === "image" && item.ref?.filename)
      .map((item) => ({ ...item.ref }));

    // 暴露字段的值；没填过的用工作流里的默认值
    await loadFields();
    const params = {};
    for (const field of fields.value) {
      params[field.nodeId] = params[field.nodeId] || {};
      params[field.nodeId][field.key] = resolveValue(field);
    }

    // 有自身素材 → 先派生下游节点（立即出现），等待和进度都留在它身上
    const targetId = ownMedia.value.length ? graph.spawnChildNode(props.id) : props.id;

    try {
      const promptId = await graph.submitExecution({
        workflow: props.data.workflow,
        params,
        imageRefs,
      });
      graph.trackPrompt(targetId, promptId);
    } catch (error) {
      // 提交失败时清掉刚派生出的空节点
      if (targetId !== props.id) flow.removeNodes([targetId]);
      throw error;
    }
  } catch (error) {
    runError.value = error.message || "运行失败";
  } finally {
    running.value = false;
  }
}
</script>

<style scoped>
.demo-node {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 400px;
  height: 260px;
  padding: 10px;
  border: 1px solid #30303a;
  border-radius: 20px;
  background: var(--c-panel-2);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

/* 选中态由 Vue Flow 挂在外部节点容器上，作用到最后一级 .demo-node */
.vue-flow__node.selected .demo-node {
  border-color: var(--c-accent);
}

.node-head {
  flex: 0 0 auto;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--c-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 媒体预览区：堆叠卡片 */
.node-media {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.media-stack {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 14px;
}

.media-stack-card {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 84%;
  overflow: hidden;
  border: 1px solid #33333d;
  border-radius: 14px;
  background: var(--c-input-bg);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease;
  will-change: transform;
}

.media-stack-card.is-active {
  border-color: transparent;
}

.media-stack-card img,
.media-stack-card video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
}

/* 每张素材右上角的删除按钮 */
.card-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 3;
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(230, 230, 234, 0.35);
  border-radius: 50%;
  background: rgba(15, 15, 20, 0.72);
  color: var(--c-text);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.media-stack-card:hover .card-delete {
  opacity: 1;
  pointer-events: all;
}

.card-delete:hover {
  color: #ff6b6b;
  border-color: #ff6b6b;
}

/* 底部圆点指示 */
.media-dots {
  position: absolute;
  left: 50%;
  bottom: 8px;
  z-index: 12;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(12, 12, 16, 0.55);
  pointer-events: none;
}

.media-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: rgba(230, 230, 234, 0.45);
  transition: width 0.2s ease, background 0.2s ease;
}

.media-dot.is-active {
  width: 10px;
  background: var(--c-accent);
}

/* 空节点占位 */
.node-empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #33333d;
  border-radius: 14px;
  color: var(--c-muted);
  font-size: 12px;
}

/* 运行态：整个节点当进度条，绝对定位覆盖，不改变原有布局 */
.node-progress {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.node-progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  /* 主题色 --accent-yellow(#f2ff59) 的半透明渐变 */
  background: linear-gradient(
    90deg,
    rgba(242, 255, 89, 0.12),
    rgba(242, 255, 89, 0.34),
    rgba(242, 255, 89, 0.12)
  );
  background-size: 200% 100%;
  animation: node-run-shimmer 1.1s linear infinite;
  transition: width 0.35s ease;
}

/* 排队中：不显示进度，用居中转圈 + 呼吸光晕表示已入队 */
.node-progress.is-queued::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at center,
    rgba(242, 255, 89, 0.1),
    rgba(242, 255, 89, 0) 68%
  );
  animation: node-queued-pulse 1.6s ease-in-out infinite;
}

.node-progress-spinner {
  position: relative;
  z-index: 1;
  width: 26px;
  height: 26px;
  border: 2px solid rgba(242, 255, 89, 0.2);
  border-top-color: var(--accent-yellow);
  border-radius: 50%;
  animation: node-spin 0.9s linear infinite;
}

@keyframes node-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes node-queued-pulse {
  0%,
  100% {
    opacity: 0.75;
  }
  50% {
    opacity: 1;
  }
}

.node-progress-label {
  position: relative;
  z-index: 1;
  font-size: 20px;
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}

.node-progress-label.is-error {
  max-width: 90%;
  font-size: 12px;
  font-weight: 400;
  color: #ff6b6b;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes node-run-shimmer {
  from {
    background-position: 0% 0;
  }
  to {
    background-position: -200% 0;
  }
}

/* Alt/Option 拖动时的虚拟副本：跟随光标，不参与任何命中检测 */
.node-ghost {
  position: fixed;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--accent-yellow);
  border-radius: 20px;
  background: rgba(242, 255, 89, 0.08);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.node-ghost-label {
  padding: 0 10px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(242, 255, 89, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  outline: none;
}

.node-input:focus {
  border-color: var(--c-accent);
}

/* 端口几何盒：20px，位置由 Vue Flow 负责（中心压在节点边框上） */
.vue-flow__handle.node-port {
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

/* 选中 / 拉线中 / 已连接 / 鼠标悬停节点时显示 */
.vue-flow__handle.node-port.is-on,
.vue-flow__handle.node-port.is-connected,
.demo-node:hover .vue-flow__handle.node-port {
  opacity: 1;
}

/* 可见的半圆画在 ::before 上，尺寸与几何盒一致 */
.node-port::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  /* border: 2px solid var(--c-panel-2); */
  border-radius: 50%;
  background: var(--c-accent);
}

/* 只留内侧半边，直径贴在节点边框上 */
.vue-flow__handle-left.node-port::before {
  clip-path: inset(0 50% 0 0);
}

.vue-flow__handle-right.node-port::before {
  clip-path: inset(0 0 0 50%);
}

/* 拉线热区：72×72，比半圆大，隐藏态不响应 */
.port-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* 左右两侧热区整体向外偏移 20px，把遮挡节点内容的面积压到最小 */
.vue-flow__handle-left.node-port .port-hit {
  transform: translate(-50%, -50%) translateX(-20px);
}

.vue-flow__handle-right.node-port .port-hit {
  transform: translate(-50%, -50%) translateX(20px);
}

.vue-flow__handle.node-port.is-on .port-hit,
.vue-flow__handle.node-port.is-connected .port-hit,
.demo-node:hover .vue-flow__handle.node-port .port-hit {
  pointer-events: all;
}

/* 删除节点按钮：鼠标移入节点时出现在节点外围右上角，尺寸不随缩放变化 */
.node-delete {
  position: absolute;
  top: -17px;
  right: -17px;
  z-index: 20;
  width: 38px;
  height: 38px;
  padding: 0;
  transform-origin: top right;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #4a4a58;
  border-radius: 50%;
  background: #2a2a34;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  color: var(--c-text);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.demo-node:hover .node-delete {
  opacity: 1;
  pointer-events: all;
}

.node-delete:hover {
  color: #ff6b6b;
  border-color: #ff6b6b;
}

/* 节点下方的操作面板 */
.node-panel {
  position: absolute;
  left: -150px;
  top: calc(100% + 21px);
  width: 700px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid #30303a;
  border-radius: 20px;
  background: var(--c-panel-2);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  cursor: default;
  will-change: opacity, transform;
}

/* 面板出现 / 消失：自上而下淡入，向上淡出 */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 面板里的媒体条：展示该节点全部素材，可拖动排序 */
.media-strip {
  display: flex;
  gap: 6px;
  padding: 6px;
  overflow-x: auto;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-input-bg);
}

.strip-item {
  position: relative;
  flex: 0 0 auto;
  width: 60px;
  height: 60px;
  overflow: hidden;
  border: 1px solid #33333d;
  border-radius: 8px;
  cursor: grab;
  transition: border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.strip-item.is-active {
  border-color: var(--c-accent);
}

.strip-item.is-dragging {
  opacity: 0.35;
}

.strip-item.is-over {
  transform: translateY(-2px);
  border-color: var(--c-accent);
}

/* 悬停缩略图时的快速预览气泡：尺寸随资源比例，资源铺满整个框 */
.preview-bubble {
  position: fixed;
  z-index: 40;
  overflow: hidden;
  border: 1px solid #3c3c48;
  border-radius: 14px;
  background: #14141a;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.preview-bubble img,
.preview-bubble video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.preview-bubble-audio {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #b9b9c4;
  font-size: 13px;
}

.preview-bubble-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18px 10px 8px;
  overflow: hidden;
  color: #eaeaef;
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
}

.strip-item img,
.strip-item video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
}

/* 上游素材与自身素材之间的分隔线 */
.strip-sep {
  flex: 0 0 auto;
  width: 1px;
  align-self: stretch;
  margin: 2px;
  background: var(--c-line);
}

/* 上游素材标记 */
.strip-flag {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c-accent);
  opacity: 0.8;
  pointer-events: none;
}

.strip-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 0 2px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 8px;
  line-height: 12px;
  pointer-events: none;
}

/* 缩略图右上角的素材删除按钮 */
.strip-delete {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 3;
  width: 16px;
  height: 16px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 15, 20, 0.78);
  color: var(--c-text);
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.strip-item:hover .strip-delete {
  opacity: 1;
}

.strip-delete:hover {
  background: rgba(255, 107, 107, 0.85);
  color: #fff;
}

/* 面板左侧悬浮的工作流列表：位移 + 淡出；淡出比位移更快，收起时不会在面板上留下残影 */
.panel-workflows {
  position: absolute;
  top: 0;
  right: calc(100% + 10px);
  bottom: 0;
  width: 132px;
  padding: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  opacity: 0;
  transform: translateX(18px);
  pointer-events: none;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.1s ease-out;
}

.panel-workflows.is-open {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease-in;
}

.wf-pill {
  flex: 0 0 auto;
  padding: 6px 8px;
  border: 1px solid #30303a;
  border-radius: 8px;
  background: var(--c-input-bg);
  color: var(--c-muted);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.3;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}

.wf-pill:hover {
  color: var(--c-text);
  border-color: #4a4a58;
  background: rgba(38, 38, 46, 0.95);
}

.wf-pill.is-active {
  color: var(--c-text);
  border-color: var(--c-accent);
  background: rgba(230, 230, 234, 0.1);
}

.panel-error {
  font-size: 11px;
  line-height: 1.4;
  color: #ff7b7b;
  word-break: break-all;
}

/* 提示词框常驻，固定在参数区最上方 */
.panel-prompt {
  margin-bottom: 8px;
}

.panel-text {
  width: 100%;
  height: 120px;
  padding: 8px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  resize: none;
}

.panel-text:focus {
  border-color: var(--c-accent);
}

/* 其余字段：按内容最短宽度横向排列，放不下时自动换行 */
.panel-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
}

.panel-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 100%;
}

.panel-field-label {
  font-size: 11px;
  color: var(--c-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-input-wide {
  width: 180px;
}

/* 非提示词位置的文本字段只占小格 */
.panel-field .panel-text {
  width: 200px;
  height: 60px;
}

.panel-slider {
  position: relative;
  display: flex;
  align-items: center;
  width: 150px;
  height: 28px;
}

/* 原生滑块只保留交互，轨道和圆钮都用自绘的，避免各浏览器样式不一致 */
.panel-slider input[type="range"] {
  width: 100%;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

/* 轨道：已滑过的部分用主题色，分界点与自绘圆钮的中心一致 */
.panel-slider input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    rgba(242, 255, 89, 0.72) 0,
    rgba(242, 255, 89, 0.72) calc(12px + (100% - 24px) * var(--slider-ratio, 0)),
    var(--c-line) calc(12px + (100% - 24px) * var(--slider-ratio, 0)),
    var(--c-line) 100%
  );
}

.panel-slider input[type="range"]::-webkit-slider-thumb {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  cursor: grab;
}

.panel-slider input[type="range"]::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--c-line);
}

.panel-slider input[type="range"]::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: rgba(242, 255, 89, 0.72);
}

.panel-slider input[type="range"]::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  cursor: grab;
}

/* 圆钮：当前数值直接写在里面 */
.panel-slider-thumb {
  position: absolute;
  top: 50%;
  left: calc(12px + (100% - 24px) * var(--slider-ratio, 0));
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1px;
  border-radius: 50%;
  background: var(--accent-yellow);
  color: #17171a;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

/* 开关：与输入框同高的胶囊式滑块 */
.panel-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 52px;
  height: 28px;
  cursor: pointer;
}

.panel-switch input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.switch-track {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: 0 2px;
  border: 1px solid var(--c-line);
  border-radius: 999px;
  background: var(--c-input-bg);
  transition: background 0.18s ease, border-color 0.18s ease;
}

.switch-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #8b8b93;
  transition: transform 0.18s ease, background 0.18s ease;
}

.panel-switch.is-on .switch-track {
  border-color: var(--accent-yellow);
  background: var(--accent-yellow);
}

.panel-switch.is-on .switch-thumb {
  transform: translateX(24px);
  background: #1b1b1f;
}

.panel-switch input:focus-visible + .switch-track {
  border-color: var(--accent-yellow);
}

.panel-hint {
  padding: 6px 0;
  font-size: 11px;
  color: var(--c-muted);
}

/* 随机数字段的骰子按钮 */
.panel-random {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-random .panel-input {
  width: 118px;
  flex: 0 0 auto;
}

.panel-dice {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-input-bg);
  color: var(--c-muted);
}

.panel-dice:hover {
  color: var(--c-text);
  border-color: #4a4a58;
}

.panel-dice.is-on {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: rgba(242, 255, 89, 0.1);
}

.media-audio {
  width: 100%;
}

.media-audio-thumb {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 12px;
  color: var(--c-muted);
}

.strip-audio {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 10px;
  color: var(--c-muted);
  background: #222;
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-select,
.panel-input {
  height: 28px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.panel-select {
  /* 宽度跟随选项内容，不再撑满整行 */
  width: auto;
  max-width: 230px;
  flex: 0 0 auto;
  padding: 0 6px;
}

.panel-input {
  width: 62px;
  padding: 0 6px;
}

.panel-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--c-muted);
  white-space: nowrap;
  cursor: pointer;
}

.panel-check input {
  margin: 0;
}

.panel-run {
  margin-left: auto;
  height: 28px;
  padding: 0 18px;
  border: 1px solid var(--accent-yellow);
  border-radius: 999px;
  background: var(--accent-yellow);
  color: #17171a;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: box-shadow 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}

.panel-run:hover {
  box-shadow: 0 0 0 3px rgba(242, 255, 89, 0.18);
}

/* 中断态：同色系描边，红色只留给错误提示 */
.panel-run.is-stop {
  background: transparent;
  color: var(--accent-yellow);
  box-shadow: inset 0 0 0 1px var(--accent-yellow);
}

.panel-run.is-stop:hover {
  background: rgba(242, 255, 89, 0.12);
  box-shadow: inset 0 0 0 1px var(--accent-yellow);
}

.panel-run:disabled {
  opacity: 0.6;
  cursor: default;
  filter: none;
}
</style>

<template>
  <div
    class="pp-node"
    :class="{ 'is-connecting': connecting }"
    :style="{ width: `${nodeW}px`, height: `${nodeH}px` }"
    @mouseenter="hovered = true"
    @mouseleave="onLeave"
    @dragover.prevent="onNodeDragOver"
    @dragleave="onNodeDragLeave"
    @drop="onNodeDrop"
  >
    <Handle
      type="target"
      :position="Position.Left"
      class="pp-port"
      :class="{ 'is-on': showInputPort, 'is-connected': targetConnected }"
    >
      <div class="pp-port-hit" />
    </Handle>

    <!-- 悬停时右上角的删除节点按钮，和普通节点保持一致 -->
    <button
      v-if="hovered || selected"
      class="pp-node-delete"
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

    <header class="pp-head">
      <span class="pp-title">预处理</span>
      <span class="pp-count">{{ shots.length }} 个任务</span>
    </header>

    <!-- 总素材区：X 轴排列，滚轮横向滚动；上游 / 拖入的素材先落在这里 -->
    <section
      v-if="!culled"
      class="pp-pool nodrag nowheel"
      :class="{ 'is-drop': poolHot }"
      @wheel.prevent.stop="onPoolWheel"
    >
      <div ref="poolEl" class="pp-pool-scroll">
        <div
          v-for="entry in poolEntries"
          :key="`${entry.group}-${entry.index}-${entry.item.id}`"
          class="pp-card"
          :class="{
            'is-upstream': entry.group === 'input',
            'is-drop': dropKind === 'pool' && dropPoolIndex === entry.index,
          }"
          :title="entry.item.name"
          draggable="true"
          @dragstart="onPoolDragStart($event, entry)"
          @dragend="clearDragState"
          @dragover.prevent="onPoolDragOver($event, entry)"
          @drop.prevent="onPoolDrop($event, entry)"
          @mouseenter="openPreview($event, entry.item)"
          @mouseleave="closePreview"
        >
          <img
            v-if="thumbOf(entry.item)"
            :src="thumbOf(entry.item)"
            :alt="entry.item.name"
            draggable="false"
            loading="lazy"
            decoding="async"
            @dragstart.prevent
          />
          <div v-else class="pp-card-fallback">
            {{ entry.item.kind === "video" ? "▶" : entry.item.kind === "audio" ? "音频" : "素材" }}
          </div>
          <span v-if="entry.item.kind === 'video'" class="pp-play">▶</span>
          <span v-if="entry.group === 'input'" class="pp-upstream-tag">上游</span>
          <button
            v-else
            class="pp-card-del"
            type="button"
            title="从暂存池删除"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="removePoolItem(entry.index)"
          >
            ×
          </button>
        </div>
        <div v-if="!poolEntries.length" class="pp-pool-empty">
          上游素材或拖入的素材会先到这里，再手动拖进下面的任务
        </div>
      </div>
    </section>

    <!-- 任务列表 -->
    <section v-if="!culled" ref="shotsEl" class="pp-shots nowheel">
      <div
        v-for="(shot, i) in shots"
        :key="shot.id"
        class="pp-shot nodrag"
        :class="{ 'is-wait': !!shot.wait && i > 0 }"
        @dragover.prevent.stop="onShotDragOver($event, shot)"
        @drop.prevent="onShotDrop($event, shot, null)"
      >
        <div class="pp-shot-head">
          <span class="pp-shot-title">任务 {{ i + 1 }}</span>
          <div
            v-if="i > 0"
            class="pp-wait"
            :title="'继承上一个任务：等它跑完，并把它的产物作为本段输入'"
          >
            <span class="pp-wait-text">继承</span>
            <label class="pp-switch" :class="{ 'is-on': !!shot.wait }" @mousedown.stop>
              <input
                type="checkbox"
                :checked="!!shot.wait"
                @change="toggleWait(shot, $event.target.checked)"
              />
              <span class="switch-track"><span class="switch-thumb" /></span>
            </label>
          </div>
          <span
            v-if="shotStates[i]"
            class="pp-shot-state"
            :class="`is-${shotStates[i].tone}`"
          >
            {{ shotStates[i].text }}<i class="pp-dot" />
          </span>
          <button
            v-if="shotStates[i]?.tone === 'done'"
            class="pp-lock"
            :class="{ 'is-on': !!shot.locked }"
            type="button"
            :title="shot.locked ? '已锁定：下次运行跳过，点击解锁' : '点击锁定：下次运行跳过这个任务'"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="toggleShotLock(shot)"
          >
            <svg v-if="shot.locked" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M8 10.5V7a4 4 0 0 1 8 0v3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.8"
                stroke-linecap="round"
              />
              <rect
                x="4.5"
                y="10"
                width="15"
                height="11"
                rx="2.6"
                fill="currentColor"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M8 10.5V7a4 4 0 0 1 7.7-1.6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.8"
                stroke-linecap="round"
              />
              <rect
                x="4.5"
                y="10"
                width="15"
                height="11"
                rx="2.6"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            class="pp-icon"
            type="button"
            title="删除任务"
            @pointerdown.stop
            @mousedown.stop
            @click.stop="removeShot(i)"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
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

        <!-- 分镜素材：可拖动排序 / 跨分镜移动 / 删除 -->
        <div
          class="pp-shot-media"
          :class="{ 'is-drop': dropKind === 'media' && String(dropShotId).startsWith(shot.id) }"
          @dragover.prevent.stop="onMediaDragOver($event, shot)"
          @dragleave="onShotDragLeave($event, shot)"
          @drop.prevent="onShotDrop($event, shot, null)"
          @wheel.prevent.stop="onMediaWheel"
        >
          <div
            v-for="(item, m) in shot.media"
            :key="item.id"
            class="pp-card is-small"
            draggable="true"
            :title="item.name"
            @dragstart="onMediaDragStart($event, shot, m)"
            @dragend="clearDragState"
            @dragover.prevent.stop="onMediaDragOver($event, shot, m)"
            @drop.prevent="onShotDrop($event, shot, m)"
            @mouseenter="openPreview($event, item)"
            @mouseleave="closePreview"
          >
            <img
              v-if="thumbOf(item)"
              :src="thumbOf(item)"
              :alt="item.name"
              draggable="false"
              loading="lazy"
              decoding="async"
              @dragstart.prevent
            />
            <div v-else class="pp-card-fallback">
              {{ item.kind === "video" ? "▶" : item.kind === "audio" ? "音频" : "素材" }}
            </div>
            <span v-if="item.kind === 'video'" class="pp-play">▶</span>
            <button
              class="pp-card-del"
              type="button"
              title="从任务移除"
              @pointerdown.stop
              @mousedown.stop
              @click.stop="removeShotMedia(shot, m)"
            >
              ×
            </button>
          </div>
          <div v-if="!shot.media.length" class="pp-media-empty">
            把上方素材拖到这里
          </div>
        </div>

        <textarea
          class="pp-prompt nodrag nowheel"
          :value="shot.prompt"
          :placeholder="shot.workflow ? '请输入提示词内容' : '请选择工作流'"
          :readonly="!shot.workflow"
          spellcheck="false"
          @input="setShotPrompt(shot, $event.target.value)"
          @keydown.stop
        />

        <div class="pp-wf nodrag">
          <select
            class="pp-input pp-select pp-wf-select"
            :value="shot.workflow"
            @change="pickWorkflow(shot, $event.target.value)"
            @mousedown.stop
          >
            <option v-if="!shot.workflow" value="">选择工作流</option>
            <option v-for="name in workflowNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <button
            class="pp-propagate"
            type="button"
            title="紧邻的下一个任务同步使用当前工作流与参数（不含提示词）"
            :disabled="i >= shots.length - 1"
            @mousedown.stop
            @pointerdown.stop
            @click.stop="propagateShot(shot, false)"
          >
            单次传播
          </button>
          <button
            class="pp-propagate"
            type="button"
            title="所有任务同步使用当前工作流与参数（不含提示词）"
            @mousedown.stop
            @pointerdown.stop
            @click.stop="propagateShot(shot, true)"
          >
            全量传播
          </button>
        </div>

        <!-- 参数控件和普通节点的参数面板保持一致：标签在上，控件在下 -->
        <div v-if="shotFields(shot).length" class="pp-fields nodrag">
          <div v-for="field in shotFields(shot)" :key="field.id" class="pp-field">
            <span class="pp-field-label" :title="`#${field.nodeId} ${field.key}`">
              {{ field.label }}
            </span>
            <textarea
              v-if="field.type === 'textarea'"
              class="pp-text nowheel"
              :value="shotValue(shot, field)"
              spellcheck="false"
              @input="setShotValue(shot, field, $event.target.value)"
              @keydown.stop
            />
            <select
              v-else-if="field.type === 'select'"
              class="pp-input pp-select"
              :value="shotValue(shot, field)"
              @change="setShotValue(shot, field, $event.target.value)"
              @mousedown.stop
            >
              <option v-for="option in shotOptions(shot, field)" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
            <label
              v-else-if="field.type === 'switch'"
              class="pp-switch"
              :class="{ 'is-on': !!shotValue(shot, field) }"
              @mousedown.stop
            >
              <input
                type="checkbox"
                :checked="!!shotValue(shot, field)"
                @change="setShotValue(shot, field, $event.target.checked)"
              />
              <span class="switch-track"><span class="switch-thumb" /></span>
            </label>
            <div
              v-else-if="field.type === 'slider'"
              class="pp-slider"
              :style="{ '--slider-ratio': `${shotRatio(shot, field)}` }"
            >
              <input
                type="range"
                :value="shotValue(shot, field)"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                @input="setShotValue(shot, field, toNumber($event.target.value))"
              />
              <span class="pp-slider-thumb">{{ shotValue(shot, field) }}</span>
            </div>
            <div v-else-if="field.type === 'random'" class="pp-random">
              <input
                class="pp-input"
                type="number"
                :value="shotValue(shot, field)"
                :readonly="isShotRandom(shot, field)"
                @input="onShotRandomInput(shot, field, $event.target.value)"
                @keydown.stop
              />
              <button
                class="pp-dice"
                :class="{ 'is-on': isShotRandom(shot, field) }"
                type="button"
                title="点击固定 / 恢复每次运行随机"
                @click.stop="toggleShotRandom(shot, field)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <rect
                    x="4"
                    y="4"
                    width="16"
                    height="16"
                    rx="3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                  />
                  <circle cx="9" cy="9" r="1.3" fill="currentColor" />
                  <circle cx="15" cy="15" r="1.3" fill="currentColor" />
                  <circle cx="15" cy="9" r="1.3" fill="currentColor" />
                  <circle cx="9" cy="15" r="1.3" fill="currentColor" />
                </svg>
              </button>
            </div>
            <input
              v-else-if="field.type === 'number'"
              class="pp-input"
              type="number"
              :value="shotValue(shot, field)"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              @input="setShotValue(shot, field, toNumber($event.target.value))"
              @keydown.stop
            />
            <input
              v-else
              class="pp-input pp-input-wide"
              type="text"
              :value="shotValue(shot, field)"
              @input="setShotValue(shot, field, $event.target.value)"
              @keydown.stop
            />
          </div>
        </div>
      </div>
    </section>

    <footer v-if="!culled" class="pp-foot nodrag">
      <span
        class="pp-status"
        :class="{
          'is-error': runState?.status === 'error',
          'is-done': runState?.status === 'done',
        }"
        :title="runState?.message || ''"
      >
        {{ statusText }}
      </span>
      <button class="pp-add" type="button" @click="addShot">
        + 添加任务
      </button>
      <button
        class="pp-run"
        :class="{ 'is-cancel': busy }"
        type="button"
        @click="busy ? cancel() : run()"
      >
        {{ busy ? "取消运行" : "运行" }}
      </button>
    </footer>

    <!-- 右下角缩放 -->
    <div class="pp-resize nodrag" title="拖动调整节点大小" @pointerdown.stop.prevent="startResize">
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
      class="pp-port"
      :class="{ 'is-on': showOutputPort, 'is-connected': sourceConnected }"
    >
      <div class="pp-port-hit" />
    </Handle>

    <!-- 素材气泡预览：和画布上其他气泡预览一致，原图缩略、无内边距 -->
    <Teleport to="body">
      <div
        v-if="preview"
        class="pp-bubble"
        :style="{
          left: `${preview.x}px`,
          top: `${preview.y}px`,
          width: preview.ready ? `${preview.width}px` : 'auto',
          height: preview.ready ? `${preview.height}px` : 'auto',
          visibility: preview.ready ? 'visible' : 'hidden',
        }"
      >
        <img :src="preview.src" :alt="preview.name" />
        <span v-if="preview.name" class="pp-bubble-name">{{ preview.name }}</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import { FILE_ASSET_DRAG_TYPE } from "../../composables/useLibrary.js";

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

const graph = inject("canvasGraph");
const flow = useVueFlow("demo");

// ---------------------------------------------------------------- 端口
// 显隐逻辑与普通节点一致：拉线时只亮对向端口，起点自己那一侧保留
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

// ---------------------------------------------------------------- 悬停 / 删除节点
const hovered = ref(false);

function onLeave() {
  hovered.value = false;
  closePreview();
}

// 删除按钮反向缩放，画布缩小时保持点击尺寸（和普通节点一致）
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
const MIN_NODE_W = 520;
const MIN_NODE_H = 460;
const DEFAULT_NODE_W = 620;
const DEFAULT_NODE_H = 720;
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

onBeforeUnmount(() => {
  stopResize();
  clearTimeout(previewTimer);
});

// ---------------------------------------------------------------- 分镜数据
const shots = computed(() => props.data.shots || []);
const pool = computed(() => props.data.pool || []);
const upstream = computed(() => props.data.inputMedia || []);

// 总素材区：上游在前、暂存池在后
const poolEntries = computed(() => {
  const entries = upstream.value.map((item, index) => ({
    item,
    group: "input",
    index,
  }));
  pool.value.forEach((item, index) => entries.push({ item, group: "pool", index }));
  return entries;
});

const poolEl = ref(null);
const shotsEl = ref(null);

// 鼠标滚轮在总素材区上转成横向滚动
function onPoolWheel(event) {
  const el = poolEl.value;
  if (!el) return;
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  el.scrollLeft += delta;
}

// 分镜素材区本身是横向滚动的：滚轮默认会被它吃掉，这里改成滚动分镜列表；
// 按住 Shift 时才是素材区自己横向滚动
function onMediaWheel(event) {
  const list = shotsEl.value;
  if (!list) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (event.shiftKey) {
    event.currentTarget.scrollLeft += delta;
    return;
  }
  list.scrollTop += delta;
}

// 新素材追加到池尾时把横向滚动跟过去，避免"加进去了但看不到"
watch(
  () => pool.value.length,
  (next, prev) => {
    if (next <= prev) return;
    nextTick(() => {
      const el = poolEl.value;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }
);

// 所有修改都替换数组 / 对象，快照撤销才能拿到稳定的旧值
function replaceShots(list) {
  props.data.shots = list;
}

function updateShot(shotId, patch) {
  replaceShots(
    shots.value.map((shot) => {
      if (shot.id !== shotId) return shot;
      // 改了提示词 / 工作流 / 参数 / 素材后自动解锁，下次运行会重新跑这个任务
      const next = { ...shot, ...patch };
      if (!("locked" in patch) && next.locked) next.locked = false;
      return next;
    })
  );
}

// 手动开关锁：锁定的任务下次运行直接跳过，保留已有产物
function toggleShotLock(shot) {
  graph?.captureUndo?.(true);
  replaceShots(
    shots.value.map((item) => (item.id === shot.id ? { ...item, locked: !item.locked } : item))
  );
}

function addShot() {
  graph?.captureUndo?.(true);
  replaceShots([...shots.value, graph.createShot()]);
}

function removeShot(index) {
  closePreview();
  graph?.captureUndo?.(true);
  replaceShots(shots.value.filter((_, i) => i !== index));
}

function toggleWait(shot, value) {
  graph?.captureUndo?.(true);
  updateShot(shot.id, { wait: value });
}

function setShotPrompt(shot, value) {
  graph?.captureUndo?.();
  updateShot(shot.id, { prompt: value });
}

function removeShotMedia(shot, index) {
  // 素材卡片被删掉后不会触发 mouseleave，先手动收起预览气泡
  closePreview();
  graph?.captureUndo?.(true);
  updateShot(shot.id, { media: shot.media.filter((_, i) => i !== index) });
}

function removePoolItem(index) {
  closePreview();
  graph?.captureUndo?.(true);
  props.data.pool = pool.value.filter((_, i) => i !== index);
}

// ---------------------------------------------------------------- 工作流与参数
const workflowNames = ref([]);
const fieldsByWorkflow = ref({});
const fieldRequests = new Map();

async function loadWorkflowNames() {
  try {
    const response = await fetch("/infinite_canvas/api/workflows");
    const data = await response.json();
    workflowNames.value = (data.workflows || []).map((item) => item.name);
  } catch {
    workflowNames.value = [];
  }
}

async function ensureFields(name) {
  if (!name || fieldsByWorkflow.value[name] || fieldRequests.has(name)) return;
  const request = (async () => {
    try {
      const response = await fetch(
        `/infinite_canvas/api/workflows/${encodeURIComponent(name)}/fields`
      );
      const data = await response.json();
      fieldsByWorkflow.value = {
        ...fieldsByWorkflow.value,
        [name]: (data.fields || []).map((field) => ({
          ...field,
          id: `${field.nodeId}.${field.key}`,
        })),
      };
    } catch {
      fieldsByWorkflow.value = { ...fieldsByWorkflow.value, [name]: [] };
    } finally {
      fieldRequests.delete(name);
    }
  })();
  fieldRequests.set(name, request);
  return request;
}

const MEDIA_TYPES = new Set(["image", "image_list", "audio", "video"]);

function promptFieldOf(shot) {
  return (
    (fieldsByWorkflow.value[shot.workflow] || []).find(
      (field) => field.type === "textarea" || field.type === "text"
    ) || null
  );
}

// 素材字段不显示（素材来自分镜素材）；其余参数和普通节点面板一致，
// 按「开关 → 下拉 → 其他 → 随机」排序，随机的种子也可以用骰子固定
const FIELD_RANK = { switch: 0, select: 1, random: 3 };
function shotFields(shot) {
  const promptId = promptFieldOf(shot)?.id;
  return (fieldsByWorkflow.value[shot.workflow] || [])
    .filter((field) => !MEDIA_TYPES.has(field.type) && field.id !== promptId)
    .slice()
    .sort((a, b) => (FIELD_RANK[a.type] ?? 2) - (FIELD_RANK[b.type] ?? 2));
}

function shotValue(shot, field) {
  const value = shot.params?.[field.nodeId]?.[field.key];
  return value === undefined ? field.default : value;
}

function shotOptions(shot, field) {
  if (field.options?.length) return field.options;
  const value = shotValue(shot, field);
  return typeof value === "string" && value ? [value] : [];
}

function setShotValue(shot, field, value) {
  graph?.captureUndo?.();
  const params = { ...(shot.params || {}) };
  params[field.nodeId] = { ...(params[field.nodeId] || {}), [field.key]: value };
  updateShot(shot.id, { params });
}

function toNumber(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

// ---------------------------------------------------------------- 滑块 / 随机种子
function shotRatio(shot, field) {
  const value = Number(shotValue(shot, field));
  const min = Number(field.min ?? 0);
  const max = Number(field.max ?? 100);
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// 和普通节点一致：默认每次运行重新随机，点骰子固定当前值
function isShotRandom(shot, field) {
  return shot.randomFields?.[field.id] !== false;
}

function shotRandomInt(field) {
  const min = Math.ceil(Number(field.min ?? 0));
  const max = Math.floor(Number(field.max ?? Number.MAX_SAFE_INTEGER));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return Math.floor(Math.random() * 1000000000);
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toggleShotRandom(shot, field) {
  graph?.captureUndo?.(true);
  const flags = { ...(shot.randomFields || {}) };
  if (isShotRandom(shot, field)) {
    // 固定：保留当前值，以后每次都用它
    flags[field.id] = false;
    updateShot(shot.id, { randomFields: flags });
    return;
  }
  // 恢复自动：先把当前值换成一个新的随机数
  delete flags[field.id];
  const params = { ...(shot.params || {}) };
  params[field.nodeId] = { ...(params[field.nodeId] || {}), [field.key]: shotRandomInt(field) };
  updateShot(shot.id, { randomFields: flags, params });
}

function onShotRandomInput(shot, field, raw) {
  if (isShotRandom(shot, field)) return;
  setShotValue(shot, field, toNumber(raw));
}

function pickWorkflow(shot, name) {
  if (shot.workflow === name) return;
  graph?.captureUndo?.(true);
  // 换工作流后旧参数不再适用，提示词保留
  updateShot(shot.id, { workflow: name, params: {}, randomFields: {} });
  ensureFields(name);
}

// 传播工作流与参数（不含提示词）：all=true 全部分镜，否则只影响紧邻的下一个分镜
function propagateShot(shot, all) {
  const index = shots.value.findIndex((item) => item.id === shot.id);
  if (index < 0) return;
  if (!all && index >= shots.value.length - 1) return;
  if (all && shots.value.length < 2) return;
  graph?.captureUndo?.(true);
  const next = shots.value.map((entry, i) => {
    if (entry.id === shot.id) return entry;
    if (!all && i !== index + 1) return entry;
    return {
      ...entry,
      workflow: shot.workflow,
      params: { ...shot.params },
      randomFields: { ...shot.randomFields },
      // 工作流 / 参数被覆盖，已锁定的任务自动解锁
      locked: false,
    };
  });
  replaceShots(next);
  next.forEach((entry) => ensureFields(entry.workflow));
}

// 工作流列表 / 字段在打开节点时补齐；配置改动后重新拉取
watch(
  () => shots.value.map((shot) => shot.workflow).join("|"),
  () => {
    for (const shot of shots.value) ensureFields(shot.workflow);
    // 初始化时如果还没选工作流，用列表第一个兜底
    if (!workflowNames.value.length) return;
    let changed = false;
    const next = shots.value.map((shot) => {
      if (shot.workflow) return shot;
      changed = true;
      return { ...shot, workflow: workflowNames.value[0] };
    });
    if (changed) replaceShots(next);
  },
  { immediate: true }
);

watch(workflowNames, (names) => {
  if (!names.length) return;
  let changed = false;
  const next = shots.value.map((shot) => {
    if (shot.workflow) return shot;
    changed = true;
    return { ...shot, workflow: names[0] };
  });
  if (changed) replaceShots(next);
  for (const shot of shots.value) ensureFields(shot.workflow);
});

function onWorkflowsChanged() {
  fieldsByWorkflow.value = {};
  fieldRequests.clear();
  loadWorkflowNames().then(() => {
    for (const shot of shots.value) ensureFields(shot.workflow);
  });
}

loadWorkflowNames();
window.addEventListener("infinite-canvas:workflows-changed", onWorkflowsChanged);
onBeforeUnmount(() => {
  window.removeEventListener("infinite-canvas:workflows-changed", onWorkflowsChanged);
});

// ---------------------------------------------------------------- 拖拽
// 私有拖拽类型：暂存池素材 / 分镜素材
const POOL_DRAG = "application/x-ic-pool";
const MEDIA_DRAG = "application/x-ic-media";

const dropShotId = ref("");
const dropKind = ref("");
const dropPoolIndex = ref(-1);
// 暂存池高亮：拖拽进入节点时默认高亮；只有落在分镜素材区时才让位给分镜区
const poolHot = ref(false);
// 拖拽来源：同一次拖拽内用内存状态判断，比读自定义 MIME 在各浏览器都稳
const dragSource = ref(null);

function clearDragState() {
  dropShotId.value = "";
  dropKind.value = "";
  dropPoolIndex.value = -1;
  poolHot.value = false;
  dragSource.value = null;
}

// 只有从系统 / 资产库拖进来的素材才走"暂存池"落点
function acceptsDrop(event) {
  const types = dragTypes(event);
  return types.includes("Files") || types.includes(FILE_ASSET_DRAG_TYPE);
}

// 节点范围内拖拽：分镜素材区会拦截事件自己高亮，冒泡到这里的都是暂存池范围
function onNodeDragOver(event) {
  if (acceptsDrop(event)) poolHot.value = true;
  dropShotId.value = "";
  dropKind.value = "";
}

function onNodeDragLeave(event) {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget.contains(next)) return;
  clearDragState();
}

function onNodeDrop() {
  clearDragState();
}

function onShotDragLeave(event, shot) {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget.contains(next)) return;
  if (dropKind.value === "media" && String(dropShotId.value).startsWith(shot.id)) {
    dropShotId.value = "";
    dropKind.value = "";
  }
}

function onPoolDragStart(event, entry) {
  closePreview();
  clearDragState();
  dragSource.value = {
    kind: "pool",
    group: entry.group,
    index: entry.index,
    name: entry.item.name || "",
  };
  // 拖进分镜是复制，池内排序是移动，两种效果都要允许
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(
    POOL_DRAG,
    JSON.stringify({ group: entry.group, index: entry.index })
  );
  event.dataTransfer.setData("text/plain", entry.item.name || "素材");
}

function onMediaDragStart(event, shot, index) {
  closePreview();
  clearDragState();
  dragSource.value = {
    kind: "media",
    shotId: shot.id,
    index,
    name: shot.media[index]?.name || "",
  };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ shotId: shot.id, index }));
  event.dataTransfer.setData("text/plain", shot.media[index]?.name || "素材");
}

function dragTypes(event) {
  return Array.from(event.dataTransfer?.types || []);
}

function onShotDragOver(event, shot) {
  const types = dragTypes(event);
  const source = dragSource.value;
  // 系统文件 / 资产库素材只有落在分镜素材区才进分镜，其他位置高亮上方暂存池
  if (!source) {
    if (types.includes("Files") || types.includes(FILE_ASSET_DRAG_TYPE)) {
      poolHot.value = true;
      dropShotId.value = "";
      dropKind.value = "";
    }
    return;
  }
  dropKind.value = "media";
  // dropEffect 必须落在 effectAllowed 范围内，否则浏览器直接拒绝 drop
  event.dataTransfer.dropEffect = source.kind === "pool" ? "copy" : "move";
  dropShotId.value = shot.id;
}

function onMediaDragOver(event, shot, index) {
  const types = dragTypes(event);
  const source = dragSource.value;
  if (!source && !types.includes("Files") && !types.includes(FILE_ASSET_DRAG_TYPE)) return;
  // 素材区自己接收落点，别让父级再把高亮切回暂存池
  event.stopPropagation();
  poolHot.value = false;
  dropKind.value = "media";
  dropShotId.value = `${shot.id}:${index}`;
  // 分镜内排序是移动，从池 / 资产库加入是复制
  event.dataTransfer.dropEffect = source?.kind === "pool" ? "copy" : source ? "move" : "copy";
}

// ------------------------------------------------------------ 暂存池排序
function onPoolDragOver(event, entry) {
  const source = dragSource.value;
  if (!source || source.kind !== "pool" || source.group !== "pool" || entry.group !== "pool") {
    // 外部文件：不拦截，让它冒泡到节点 / 画布，落到暂存池里
    return;
  }
  event.stopPropagation();
  dropKind.value = "pool";
  dropPoolIndex.value = entry.index;
  // 池内排序是移动
  event.dataTransfer.dropEffect = "move";
}

function onPoolDrop(event, entry) {
  const source = dragSource.value;
  if (!source || source.kind !== "pool" || source.group !== "pool" || entry.group !== "pool") {
    return;
  }
  event.stopPropagation();
  const from = source.index;
  clearDragState();
  reorderPool(from, entry.index);
}

function reorderPool(from, to) {
  if (from === to) return;
  const list = [...pool.value];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  graph?.captureUndo?.(true);
  props.data.pool = list;
}

// 拖到分镜上：分镜素材排序，或从暂存池 / 资产库加入素材
function onShotDrop(event, shot, insertIndex) {
  const data = event.dataTransfer;
  if (!data) return;
  const source = dragSource.value;

  // 从系统拖进来的文件：只有落在分镜素材区才加到该分镜，其余位置交给画布进暂存池
  const files = Array.from(data.files || []);
  if (files.length) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".pp-shot-media")) return;
    event.stopPropagation();
    clearDragState();
    graph?.appendFilesToShot?.(props.id, shot.id, files);
    return;
  }

  const types = dragTypes(event);
  const fromAsset = types.includes(FILE_ASSET_DRAG_TYPE);
  // 资产库素材同理：只有落在分镜素材区才进分镜，否则继续冒泡给画布进暂存池
  if (fromAsset) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".pp-shot-media")) return;
  } else if (!source) {
    return;
  }
  event.stopPropagation();
  clearDragState();

  // 分镜内 / 跨分镜移动素材
  if (source?.kind === "media") {
    const from = shots.value.find((item) => item.id === source.shotId);
    const item = from?.media?.[source.index];
    if (!from || !item) return;
    if (from.id === shot.id) {
      reorderMedia(shot, source.index, insertIndex);
      return;
    }
    // 跨分镜移动时同样不允许同名重复
    if (shot.media.some((entry) => entry.name === item.name)) return;
    graph?.captureUndo?.(true);
    const next = shots.value.map((entry) => {
      if (entry.id === from.id) {
        return {
          ...entry,
          media: entry.media.filter((_, i) => i !== source.index),
          locked: false,
        };
      }
      if (entry.id === shot.id) {
        const list = [...entry.media];
        list.splice(insertIndex ?? list.length, 0, item);
        return { ...entry, media: list, locked: false };
      }
      return entry;
    });
    replaceShots(next);
    return;
  }

  // 暂存池 -> 分镜
  if (source?.kind === "pool") {
    const list = source.group === "input" ? upstream.value : pool.value;
    const item = list[source.index];
    if (!item) return;
    // 同名文件不重复添加
    if (shot.media.some((entry) => entry.name === item.name)) return;
    graph?.captureUndo?.(true);
    const media = [...shot.media];
    media.splice(insertIndex ?? media.length, 0, { ...item });
    updateShot(shot.id, { media });
    return;
  }

  addAssetToShot(data, shot, insertIndex);
}

// 从资产库拖进分镜：同名不进分镜；暂存池里没有的话也补一份
function addAssetToShot(data, shot, insertIndex) {
  const assetRaw = data.getData(FILE_ASSET_DRAG_TYPE);
  if (!assetRaw) return;
  let ref = null;
  try {
    ref = JSON.parse(assetRaw);
  } catch {
    ref = null;
  }
  if (!ref) return;
  const item = graph?.itemsFromRefs?.([ref])?.[0];
  if (!item) return;
  graph?.captureUndo?.(true);
  if (!shot.media.some((entry) => entry.name === item.name)) {
    const media = [...shot.media];
    media.splice(insertIndex ?? media.length, 0, item);
    updateShot(shot.id, { media });
  }
  addPoolCopy(item);
}

// 往暂存池补一份（同名已存在则跳过）
function addPoolCopy(item) {
  if (!item || pool.value.some((entry) => entry.name === item.name)) return;
  props.data.pool = [...pool.value, { ...item }];
}

function reorderMedia(shot, from, to) {
  const list = [...shot.media];
  // 拖到素材区空白处：直接排到最后
  if (to === null || to === undefined) {
    if (from === list.length - 1) return;
    const [item] = list.splice(from, 1);
    list.push(item);
    graph?.captureUndo?.(true);
    updateShot(shot.id, { media: list });
    return;
  }
  if (from === to) return;
  // 拖到某张卡片上：按拖拽方向落位（向右拖放到目标后面、向左拖放到目标前面）
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  graph?.captureUndo?.(true);
  updateShot(shot.id, { media: list });
}

// ---------------------------------------------------------------- 预览气泡
const preview = ref(null);
let previewTimer = 0;

function thumbOf(item) {
  if (item?.thumbUrl) return item.thumbUrl;
  if (item?.kind === "image") return item.url;
  return "";
}

// 预览尺寸和画布上其他气泡一致：最长边不超过 360，高度不超过 520
const PREVIEW_MAX_W = 360;
const PREVIEW_MAX_H = 520;

function openPreview(event, item) {
  clearTimeout(previewTimer);
  const src = thumbOf(item);
  if (!src) return;
  const rect = event.currentTarget.getBoundingClientRect();
  previewTimer = setTimeout(() => {
    preview.value = {
      src,
      name: item.name || "",
      x: 0,
      y: 0,
      width: PREVIEW_MAX_W,
      height: PREVIEW_MAX_W,
      ready: false,
      anchor: { right: rect.right, left: rect.left, top: rect.top, height: rect.height },
    };
    const img = new Image();
    img.onload = () => {
      if (!preview.value || preview.value.src !== src) return;
      const naturalW = img.naturalWidth || PREVIEW_MAX_W;
      const naturalH = img.naturalHeight || PREVIEW_MAX_W;
      const scale = Math.min(1, PREVIEW_MAX_W / naturalW, PREVIEW_MAX_H / naturalH);
      placePreview(Math.round(naturalW * scale), Math.round(naturalH * scale));
    };
    img.onerror = () => {
      if (preview.value && preview.value.src === src) preview.value = null;
    };
    img.src = src;
  }, 220);
}

function placePreview(width, height) {
  const anchor = preview.value?.anchor;
  if (!anchor) return;
  const gap = 12;
  const maxTop = window.innerHeight - height - 8;
  let x = anchor.right + gap;
  if (x + width > window.innerWidth - 8) x = anchor.left - width - gap;
  x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const y = Math.max(8, Math.min(anchor.top + anchor.height / 2 - height / 2, maxTop));
  preview.value = { ...preview.value, x, y, width, height, ready: true };
}

function closePreview() {
  clearTimeout(previewTimer);
  preview.value = null;
}

// ---------------------------------------------------------------- 运行
const runState = computed(() => graph?.preprocessStates?.[props.id]);
const busy = computed(() => runState.value?.status === "running");

const statusText = computed(() => {
  const state = runState.value;
  if (!state) return "按任务派发下游节点";
  if (state.status === "error") return state.message || "运行失败";
  if (state.status === "done") return state.message || "已派发全部下游节点";
  return `已派发 ${state.sent || 0} / ${state.total || 0}`;
});

// 每个任务对应下游节点的运行态：标题后面显示状态和色点
const SHOT_STATES = {
  uploading: { text: "生成中", tone: "run" },
  running: { text: "生成中", tone: "run" },
  queued: { text: "排队中", tone: "queue" },
  waiting: { text: "等待中", tone: "wait" },
  done: { text: "已完成", tone: "done" },
  error: { text: "失败", tone: "error" },
};

const shotStates = computed(() =>
  shots.value.map((shot) => {
    const id = shot.nodeId;
    if (!id) return null;
    const state = graph?.runStates?.[id];
    if (state) return SHOT_STATES[state.status] || null;
    // 运行态只保留一秒，之后按节点是否已有产物判定为已完成
    const node = (graph?.nodes?.value || []).find((item) => item.id === id);
    return node && (node.data?.media || []).length ? SHOT_STATES.done : null;
  })
);

// 任务从运行中变成已完成时自动上锁；此前就已完成的旧任务不上锁，避免误跳过
let prevShotTones = [];
watch(shotStates, (list) => {
  let changed = false;
  const next = shots.value.map((shot, i) => {
    const wasActive = ["run", "queue", "wait"].includes(prevShotTones[i]);
    if (wasActive && list[i]?.tone === "done" && !shot.locked) {
      changed = true;
      return { ...shot, locked: true };
    }
    return shot;
  });
  if (changed) replaceShots(next);
  prevShotTones = list.map((state) => state?.tone || "");
});

// 缩放 / 视口裁剪：缩得很小或移出视口时只保留外框，避免大量缩略图和输入框参与渲染
const culled = computed(() => {
  if (props.selected) return false;
  const status = runState.value?.status;
  if (status && status !== "idle") return false;
  if ((Number(graph?.viewport?.value?.zoom) || 1) < 0.25) return true;
  return graph?.visibleNodeIds ? !graph.visibleNodeIds.value.has(props.id) : false;
});

function run() {
  graph?.runPreprocess?.(props.id);
}

// 取消派发：停止所有子节点里运行中 / 排队中 / 等待中的任务，产物节点保留
function cancel() {
  graph?.cancelPreprocess?.(props.id);
}
</script>

<style scoped>
.pp-node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 620px;
  height: 720px;
  padding: 10px;
  border: 1px solid var(--c-line);
  border-radius: 20px;
  background: var(--c-panel-2);
  box-shadow: 0 6px 18px var(--c-shadow);
  /* 任务状态色：完成 / 排队 / 等待，画面里没有对应的全局令牌 */
  --pp-ok: #4ade80;
  --pp-queue: #fb923c;
  --pp-wait: #60a5fa;
}

html[data-theme="light"] .pp-node {
  --pp-ok: #16a34a;
  --pp-queue: #ea580c;
  --pp-wait: #2563eb;
}

.vue-flow__node.selected .pp-node {
  border-color: var(--c-accent);
}

.pp-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 0 0 auto;
  padding: 0 2px;
  cursor: grab;
}

.pp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.pp-count {
  font-size: 11px;
  color: var(--c-muted);
}

/* 总素材区：横向滚动，隐藏滚动条 */
.pp-pool {
  flex: 0 0 auto;
  height: 92px;
  padding: 6px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-surface-2);
  overflow: hidden;
  transition: border-color 0.12s ease, background 0.12s ease;
}

/* 拖拽进入节点时高亮：素材会落到这里 */
.pp-pool.is-drop {
  border-color: var(--c-accent);
  background: var(--c-accent-weak);
}

.pp-pool-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior: contain;
}

.pp-pool-scroll::-webkit-scrollbar {
  display: none;
}

.pp-pool-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--c-muted-2);
  font-size: 11px;
  text-align: center;
  line-height: 1.6;
}

.pp-card {
  position: relative;
  flex: 0 0 auto;
  width: 108px;
  height: 72px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-surface-3);
  overflow: hidden;
  cursor: grab;
}

.pp-card.is-small {
  width: 60px;
  height: 60px;
}

/* 拖拽排序时，落点卡片给一圈强调框 */
.pp-card.is-drop {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-weak);
}

.pp-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.pp-card-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--c-muted);
  font-size: 11px;
}

.pp-play {
  position: absolute;
  right: 4px;
  bottom: 2px;
  color: #fff;
  font-size: 10px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.pp-upstream-tag {
  position: absolute;
  left: 3px;
  top: 3px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  pointer-events: none;
}

.pp-card-del {
  position: absolute;
  right: 2px;
  top: 2px;
  display: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}

.pp-card:hover .pp-card-del {
  display: block;
}

/* 分镜列表：不显示滚动条，高度随内容自然排布 */
.pp-shots {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.pp-shots::-webkit-scrollbar {
  display: none;
}

.pp-shot {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-surface-3);
}

/* 继承：和上一个任务共用一个外框。
   只改边框颜色 / 圆角，不动 margin，勾选时不会产生位移跳动 */
.pp-shot.is-wait {
  border-color: var(--c-accent);
  border-top-color: transparent;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.pp-shot:has(+ .pp-shot.is-wait) {
  border-color: var(--c-accent);
  border-bottom-color: transparent;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

/* 用两条高亮竖边跨过两张卡之间的间距，让外框连成一条；中间不填充颜色 */
.pp-shot:has(+ .pp-shot.is-wait)::after {
  content: "";
  position: absolute;
  left: -1px;
  right: -1px;
  bottom: -9px;
  z-index: 1;
  height: 9px;
  border-left: 1px solid var(--c-accent);
  border-right: 1px solid var(--c-accent);
  pointer-events: none;
}

/* 一组里的中间任务：上下边框都交给相邻任务封口 */
.pp-shot.is-wait:has(+ .pp-shot.is-wait) {
  border-bottom-color: transparent;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

/* 悬停时右上角的删除节点按钮，尺寸 / 配色与普通节点完全一致 */
.pp-node-delete {
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

.pp-node-delete:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.pp-shot-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pp-shot-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
  user-select: none;
}

/* 任务状态：文字 + 色点 */
.pp-shot-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--c-muted);
  font-size: 10px;
  white-space: nowrap;
}

.pp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-muted);
}

.pp-shot-state.is-done .pp-dot {
  background: var(--pp-ok);
}

.pp-shot-state.is-run .pp-dot {
  background: var(--c-accent);
  animation: pp-pulse 1.2s ease-in-out infinite;
}

.pp-shot-state.is-queue .pp-dot {
  background: var(--pp-queue);
}

.pp-shot-state.is-wait .pp-dot {
  background: var(--pp-wait);
}

.pp-shot-state.is-error .pp-dot {
  background: var(--c-danger);
}

/* 已完成任务的锁：实心图标，上锁时用主题高亮色 */
.pp-lock {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  cursor: pointer;
}

.pp-lock:hover {
  background: var(--c-input-bg);
  color: var(--c-text);
}

.pp-lock.is-on {
  color: var(--c-accent);
}

.pp-lock.is-on:hover {
  color: var(--c-accent);
}

@keyframes pp-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pp-shot-state.is-run .pp-dot {
    animation: none;
  }
}

.pp-shot-head .pp-icon {
  margin-left: auto;
}

/* 等待开关：文案 + 与参数面板一致的胶囊开关 */
.pp-wait {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--c-muted);
  font-size: 10px;
  cursor: pointer;
  user-select: none;
}

.pp-wait.is-on,
.pp-wait:has(.pp-switch.is-on) {
  color: var(--c-text);
}

.pp-wait-text {
  white-space: nowrap;
}

/* 通用开关：等待开关和 switch 参数共用，尺寸比参数面板更紧凑 */
.pp-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 21px;
  cursor: pointer;
}

.pp-switch input {
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
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--c-muted-2);
  transition: transform 0.18s ease, background 0.18s ease;
}

.pp-switch.is-on .switch-track {
  border-color: var(--accent-yellow);
  background: var(--accent-yellow);
}

.pp-switch.is-on .switch-thumb {
  transform: translateX(17px);
  background: var(--c-on-accent);
}

.pp-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  cursor: pointer;
}

.pp-icon:hover {
  border-color: var(--c-line);
  color: var(--c-danger);
}

.pp-shot-media {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 68px;
  padding: 4px;
  border: 1px dashed var(--c-line);
  border-radius: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior: contain;
}

.pp-shot-media::-webkit-scrollbar {
  display: none;
}

.pp-shot-media.is-drop {
  border-color: var(--c-accent);
}

.pp-media-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 60px;
  color: var(--c-muted-2);
  font-size: 11px;
}

.pp-prompt {
  width: 100%;
  min-height: 90px;
  max-height: 160px;
  padding: 6px 8px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.pp-prompt:focus {
  border-color: var(--c-accent);
}

/* 参数控件：比普通节点的参数面板更紧凑 */
.pp-input {
  width: 54px;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 10px;
  outline: none;
}

.pp-input:focus {
  border-color: var(--c-accent);
}

.pp-input-wide {
  width: 160px;
}

/* 下拉框宽度跟随内容 */
.pp-select {
  width: auto;
  max-width: 200px;
  padding: 0 4px;
}

/* 工作流选择 + 传播按钮 */
.pp-wf {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pp-wf-select {
  width: 170px;
  max-width: 170px;
  height: 24px;
}

.pp-propagate {
  flex: 0 0 auto;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}

.pp-propagate:hover {
  border-color: var(--c-accent);
  color: var(--c-accent-ink);
}

.pp-propagate:disabled {
  opacity: 0.45;
  cursor: default;
}

.pp-text {
  width: 190px;
  height: 52px;
  padding: 6px 7px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 10px;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.pp-text:focus {
  border-color: var(--c-accent);
}

/* 滑块：数值直接写在圆钮里 */
.pp-slider {
  position: relative;
  display: flex;
  align-items: center;
  width: 130px;
  height: 22px;
}

.pp-slider input[type="range"] {
  width: 100%;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  cursor: pointer;
}

.pp-slider input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-yellow) 72%, transparent) 0,
    color-mix(in srgb, var(--accent-yellow) 72%, transparent)
      calc(9px + (100% - 18px) * var(--slider-ratio, 0)),
    var(--c-line) calc(9px + (100% - 18px) * var(--slider-ratio, 0)),
    var(--c-line) 100%
  );
}

.pp-slider input[type="range"]::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  cursor: grab;
}

.pp-slider input[type="range"]::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--c-line);
}

.pp-slider input[type="range"]::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent-yellow) 72%, transparent);
}

.pp-slider input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: 0;
  background: transparent;
  cursor: grab;
}

.pp-slider-thumb {
  position: absolute;
  top: 50%;
  left: calc(9px + (100% - 18px) * var(--slider-ratio, 0));
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0 1px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 8px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px var(--c-shadow);
}

/* 随机种子：骰子按钮切换"每次运行随机 / 固定" */
.pp-random {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pp-random .pp-input {
  width: 102px;
}

.pp-dice {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-muted);
  cursor: pointer;
}

.pp-dice:hover {
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.pp-dice.is-on {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-weak);
}

/* 参数区：标签在上、控件在下，和参数面板一致 */
.pp-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
}

.pp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 100%;
}

.pp-field-label {
  color: var(--c-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-add {
  justify-self: center;
  height: 24px;
  padding: 0 14px;
  border: 1px dashed var(--c-line);
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 10px;
  cursor: pointer;
}

.pp-add:hover {
  border-color: var(--c-accent);
  color: var(--c-text);
}

/* 底部：状态在左、添加分镜居中、运行按钮在右 */
.pp-foot {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding-top: 2px;
}

.pp-run {
  justify-self: end;
}

.pp-status {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--c-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-status.is-error {
  color: var(--c-danger);
}

.pp-status.is-done {
  color: var(--c-accent-ink);
}

.pp-run {
  flex: 0 0 auto;
  height: 24px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: var(--c-accent);
  color: var(--c-on-accent);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.pp-run:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 派发中：运行按钮变成取消 */
.pp-run.is-cancel {
  background: var(--c-danger);
  color: #fff;
}

/* 端口：几何盒 / 半圆 / 热区都对齐普通节点，交互逻辑也一致 */
.vue-flow__handle.pp-port {
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

/* 选中 / 拉线中 / 已连接 / 鼠标悬停节点时显示 */
.vue-flow__handle.pp-port.is-on,
.vue-flow__handle.pp-port.is-connected,
.pp-node:hover .vue-flow__handle.pp-port {
  opacity: 1;
}

.pp-port::before {
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

/* 只留内侧半边，直径贴在节点边框上 */
.vue-flow__handle-left.pp-port::before {
  clip-path: inset(0 50% 0 0);
}

.vue-flow__handle-right.pp-port::before {
  clip-path: inset(0 0 0 50%);
}

/* 拉线热区：72×72，隐藏态不响应 */
.pp-port-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.vue-flow__handle-left.pp-port .pp-port-hit {
  transform: translate(-50%, -50%) translateX(-20px);
}

.vue-flow__handle-right.pp-port .pp-port-hit {
  transform: translate(-50%, -50%) translateX(20px);
}

.vue-flow__handle.pp-port.is-on .pp-port-hit,
.vue-flow__handle.pp-port.is-connected .pp-port-hit,
.pp-node:hover .vue-flow__handle.pp-port .pp-port-hit {
  pointer-events: all;
}

/* 拉线时只显示能落线的一侧，另一侧等于不存在 */
.pp-node.is-connecting .vue-flow__handle.pp-port {
  opacity: 0;
  pointer-events: none;
}

.pp-node.is-connecting .vue-flow__handle.pp-port.is-on {
  opacity: 1;
}

.pp-node.is-connecting .vue-flow__handle.pp-port .pp-port-hit {
  pointer-events: none;
}

.pp-node.is-connecting .vue-flow__handle.pp-port.is-on .pp-port-hit {
  pointer-events: all;
}

/* 右下角缩放 */
.pp-resize {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: var(--c-muted);
  cursor: nwse-resize;
}

.pp-resize:hover {
  color: var(--c-text);
  background: var(--c-hover);
}

/* 气泡预览：和画布上其他气泡预览一致，图片本身不带内边距 */
.pp-bubble {
  position: fixed;
  z-index: 3500;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-panel);
  box-shadow: 0 18px 40px var(--c-shadow);
  pointer-events: none;
  overflow: hidden;
}

.pp-bubble img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pp-bubble-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  color: #fff;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

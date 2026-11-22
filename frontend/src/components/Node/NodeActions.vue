<template>
  <!-- 节点上方扇形操作：两边小、中间大 -->
  <div v-if="fanMounted || panelOpen" class="node-actions" :class="{ 'is-open': fanOpen }">
    <button
      v-for="(action, i) in actions"
      :key="action.key"
      class="fan-btn"
      :class="{ 'is-enabled': !isDisabled(action) }"
      :style="fanStyle(i)"
      type="button"
      :title="action.label"
      :disabled="isDisabled(action)"
      @pointerdown.stop
      @mousedown.stop
      @click.stop="trigger(action)"
    >
      <svg
        viewBox="0 0 24 24"
        :width="Math.round(fanSizes[i] * 0.48)"
        :height="Math.round(fanSizes[i] * 0.48)"
        aria-hidden="true"
      >
        <path
          v-for="(d, k) in action.paths"
          :key="k"
          :d="d"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>

  <!-- 操作面板：预览 / 裁切 / 扩图 / 宫格编辑 -->
  <Teleport to="body">
    <div v-if="panelOpen" class="asset-mask" @mousedown.self="closePanel">
      <div class="asset-panel" @mousedown.stop @click.stop @wheel.stop>
        <!-- 关闭按钮放在弹层外框右上角 -->
        <button class="asset-close" type="button" title="关闭" @click="closePanel">
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

        <div class="asset-body">
          <aside class="asset-side">
            <div class="side-tools">
              <button
                v-for="action in actions"
                :key="action.key"
                class="tool-btn"
                :class="{ 'is-active': mode === modeOf(action) }"
                type="button"
                :title="action.label"
                :disabled="isDisabled(action)"
                @click="trigger(action)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    v-for="(d, k) in action.paths"
                    :key="k"
                    :d="d"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ action.label }}</span>
              </button>
            </div>

            <!-- 参数控件由当前编辑器 Teleport 进来 -->
            <div ref="controlsEl" class="side-controls">
              <!-- 宫格：分割 / 拼接 -->
              <div v-if="mode === 'grid'" class="side-switch">
                <button
                  type="button"
                  :class="{ 'is-active': gridMode === 'split' }"
                  @click="setGridMode('split')"
                >
                  分割
                </button>
                <button
                  type="button"
                  :class="{ 'is-active': gridMode === 'merge' }"
                  @click="setGridMode('merge')"
                >
                  拼接
                </button>
              </div>

              <!-- 编辑：在预览图上直接涂抹 -->
              <button
                v-if="mode === 'preview' && isImage"
                class="side-compare side-edit"
                :class="{ 'is-active': editing }"
                type="button"
                @click="toggleEdit"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ editing ? "退出编辑" : "编辑" }}</span>
              </button>

              <!-- 蒙板操作：进入蒙板模式后在右侧提供显示/隐藏与反相 -->
              <template v-if="mode === 'preview' && editing && maskMode">
                <button
                  class="side-compare"
                  :class="{ 'is-active': previewMaskVisible }"
                  type="button"
                  @click="previewRef?.toggleMaskVisibility()"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path
                      v-if="!previewMaskVisible"
                      d="M4 4l16 16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                  </svg>
                  <span>{{ previewMaskVisible ? "隐藏蒙板" : "显示蒙板" }}</span>
                </button>
                <button
                  class="side-compare"
                  :class="{ 'is-active': previewMaskInverted }"
                  type="button"
                  @click="previewRef?.invertMask()"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M12 3a9 9 0 010 18z" fill="currentColor" opacity="0.55" />
                  </svg>
                  <span>{{ previewMaskInverted ? "取消反相" : "反相" }}</span>
                </button>
              </template>

              <!-- 对比：自身与上游第一条素材类型一致时显示 -->
              <button
                v-if="mode === 'preview' && canCompare && !editing"
                class="side-compare"
                :class="{ 'is-active': comparing }"
                type="button"
                @click="toggleCompare"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ comparing ? "退出对比" : "对比" }}</span>
              </button>

              <!-- 预览工具：全屏 + 视频截帧，固定在工具栏底部 -->
              <div v-if="mode === 'preview'" class="side-extra">
                <button class="side-action" type="button" @click="previewRef?.toggleFullscreen()">
                  <svg v-if="previewFullscreen" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span>{{ previewFullscreen ? "退出全屏" : "全屏预览" }}</span>
                </button>

                <template v-if="previewIsVideo">
                  <button
                    v-for="frame in FRAME_ACTIONS"
                    :key="frame.key"
                    class="side-action"
                    type="button"
                    :disabled="previewBusy"
                    @click="previewRef?.exportFrame(frame.key)"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <rect
                        x="3"
                        y="6"
                        width="18"
                        height="12"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                      />
                      <path
                        d="M3 10h18M10 6v12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                      />
                    </svg>
                    <span>{{ frame.label }}</span>
                  </button>
                </template>
              </div>
            </div>

            <!-- 应用按钮同样由编辑器 Teleport 进来，沉底 -->
            <div
              ref="applyEl"
              class="side-apply"
              :class="{ 'is-hidden': mode === 'preview' && !editing }"
            >
              <button
                v-if="mode === 'preview' && editing"
                class="apply-btn"
                type="button"
                :disabled="!previewEdit.hasStrokes && !previewEdit.hasMask"
                @click="applyEdit"
              >
                应用
              </button>
            </div>
          </aside>

          <div class="asset-main">
            <template v-if="showContent">
              <div v-if="mode === 'preview'" class="preview-shell">
                <!-- 编辑状态：工具栏直接摆在预览图上方 -->
                <div v-if="editing" class="edit-top">
                  <div class="edit-row">
                    <div class="edit-tools">
                      <button
                        type="button"
                        class="edit-tool"
                        :class="{ 'is-active': editTool === 'hand' }"
                        title="抓手（H，按住空格临时切换）"
                        @click="toggleHandTool"
                      >
                        抓手
                      </button>
                      <button
                        type="button"
                        class="edit-tool"
                        :class="{ 'is-active': editTool === 'brush' }"
                        title="画笔（B）"
                        @click="editTool = 'brush'"
                      >
                        画笔
                      </button>
                      <button
                        type="button"
                        class="edit-tool"
                        :class="{ 'is-active': editTool === 'eraser' }"
                        title="橡皮（E）"
                        @click="editTool = 'eraser'"
                      >
                        橡皮
                      </button>
                      <button
                        type="button"
                        class="edit-tool"
                        :class="{ 'is-active': maskMode }"
                        title="蒙板（Q）"
                        @click="maskMode = !maskMode"
                      >
                        蒙板
                      </button>
                    </div>

                    <div v-if="editTool === 'brush' && !maskMode" class="edit-colors">
                      <button
                        v-for="color in EDIT_COLORS"
                        :key="color"
                        type="button"
                        class="edit-swatch"
                        :class="{ 'is-active': editColor === color }"
                        :style="{ background: color }"
                        :title="color"
                        @click="editColor = color"
                      />
                    </div>

                    <label v-if="editTool !== 'hand'" class="edit-size">
                      <span>大小</span>
                      <input
                        v-model.number="editSize"
                        type="range"
                        min="2"
                        max="160"
                        step="1"
                        @pointerup="$event.target.blur()"
                      />
                      <span class="edit-size-value">{{ editSize }}px</span>
                    </label>

                    <div class="edit-history">
                      <button
                        type="button"
                        class="edit-mini"
                        :disabled="!previewEdit.canUndo"
                        @click="previewRef?.undoEdit()"
                      >
                        撤销
                      </button>
                      <button
                        type="button"
                        class="edit-mini"
                        :disabled="!previewEdit.canRedo"
                        @click="previewRef?.redoEdit()"
                      >
                        重做
                      </button>
                      <button
                        type="button"
                        class="edit-mini"
                        :disabled="maskMode ? !previewEdit.hasMask : !previewEdit.hasStrokes"
                        @click="previewRef?.clearEdit()"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                </div>

                <PreviewPane
                  ref="previewRef"
                  :item="current"
                  :media="media"
                  :index="index"
                  :upstream="upstreamFirst"
                  :comparing="comparing"
                  :text="resultText"
                  :editing="editing"
                  :tool="editTool"
                  :color="editColor"
                  :size="editSize"
                  :pan-mode="handMode"
                  :mask-mode="maskMode"
                  @select="emit('select', $event)"
                  @frame="onExportFrame"
                  @edit-state="onEditState"
                />
              </div>

              <CropEditor
                v-else-if="mode === 'crop' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onReplace"
              />
              <ExpandEditor
                v-else-if="mode === 'expand' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onReplace"
              />
              <SplitEditor
                v-else-if="mode === 'grid' && gridMode === 'split' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onSplit"
              />
              <MergeEditor
                v-else-if="mode === 'grid' && gridMode === 'merge'"
                :media="media"
                :name="label"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onMerge"
              />

              <span v-else class="asset-empty">该素材不支持此操作</span>
            </template>
          </div>
        </div>
      </div>
    </div>
    <!-- 截帧导出结果提示：全屏预览时也要盖在上面 -->
    <div v-if="notice" class="asset-notice">{{ notice }}</div>
  </Teleport>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { baseName } from "../../utils/image";
import PreviewPane from "./editors/PreviewPane.vue";
import CropEditor from "./editors/CropEditor.vue";
import ExpandEditor from "./editors/ExpandEditor.vue";
import SplitEditor from "./editors/SplitEditor.vue";
import MergeEditor from "./editors/MergeEditor.vue";
import { saveBlob } from "../../utils/download";

const props = defineProps({
  visible: { type: Boolean, default: false },
  nodeId: { type: String, default: "" },
  media: { type: Array, default: () => [] },
  // 上游节点传入该节点的素材（用于对比）
  inputMedia: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  label: { type: String, default: "" },
});

const emit = defineEmits(["select"]);

const graph = inject("canvasGraph");

// 预览工具栏：全屏与截帧按钮放在右侧工具栏，实际动作交给 PreviewPane
const previewRef = ref(null);
const previewFullscreen = computed(() => !!previewRef.value?.fullscreen);
const previewBusy = computed(() => !!previewRef.value?.exporting);
const previewIsVideo = computed(() => current.value?.kind === "video");
// 蒙板状态由 PreviewPane 持有，右侧按钮通过 ref 读取/操作
const previewMaskVisible = computed(() => previewRef.value?.maskVisible !== false);
const previewMaskInverted = computed(() => !!previewRef.value?.maskInverted);
const FRAME_ACTIONS = [
  { key: "first", label: "导出首帧" },
  { key: "current", label: "导出当前帧" },
  { key: "last", label: "导出尾帧" },
];

// ------------------------------------------------------------ 视频截帧导出
// 截出来的帧先上传成素材，再在源节点旁边建一个不连线的新节点，并给一条提示
const notice = ref("");
let noticeTimer = 0;

function showNotice(text) {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 2600);
}

async function onExportFrame(payload) {
  if (!payload || payload.error || !payload.blob) {
    showNotice("截帧失败，请重试");
    return;
  }
  try {
    const item = await graph?.uploadAsset?.(payload.blob, payload.name);
    if (!item) throw new Error("upload failed");
    graph?.spawnDetachedNode?.(props.nodeId, [item]);
    showNotice(`已导出为节点：${payload.name}`);
  } catch {
    showNotice("截帧失败，请重试");
  }
}

const panelOpen = ref(false);

// 扇形按钮只在悬停/选中时挂载：节点一多就常驻几百个按钮 DOM，没必要。
// 先挂载、下一帧再加 is-open，保住展开动画；收起动画结束后再卸载
const fanMounted = ref(false);
const fanOpen = ref(false);
let fanTimer = 0;
watch(
  () => props.visible,
  (on) => {
    clearTimeout(fanTimer);
    if (on) {
      fanMounted.value = true;
      nextTick(() => {
        fanOpen.value = true;
      });
    } else {
      fanOpen.value = false;
      fanTimer = setTimeout(() => {
        fanMounted.value = false;
      }, 220);
    }
  },
  { immediate: true }
);
// 面板两阶段渲染：先挂右列（Teleport 目标），下一帧再挂编辑器
const showContent = ref(false);
const controlsEl = ref(null);
const applyEl = ref(null);
const mode = ref("preview");
// 宫格图标下再分「分割 / 拼接」两个子模式
const gridMode = ref("split");
const current = computed(() => props.media[props.index] || null);
const isImage = computed(() => !!current.value && current.value.kind === "image");
// 文本类工作流的产物：没有素材时预览面板展示全文
const resultText = computed(() => {
  const node = (graph?.nodes?.value || []).find((item) => item.id === props.nodeId);
  return String(node?.data?.textResult || "");
});

// 对比：自身与上游都有素材，第一条类型一致（只支持图片/视频），
// 且当前预览的必须是第一个素材
const comparing = ref(false);
const upstreamFirst = computed(() => props.inputMedia[0] || null);
const canCompare = computed(() => {
  const own = props.media[0];
  const up = upstreamFirst.value;
  if (!own || !up) return false;
  if (own.kind !== up.kind) return false;
  if (own.kind !== "image" && own.kind !== "video") return false;
  return props.index === 0;
});

watch(
  () => [canCompare.value, props.index, props.media.length, props.inputMedia.length],
  () => {
    if (!canCompare.value) comparing.value = false;
  }
);

function toggleCompare() {
  if (!canCompare.value) return;
  comparing.value = !comparing.value;
}

// ------------------------------------------------------------ 预览图上直接编辑
const editing = ref(false);
const editTool = ref("brush");
const editColor = ref("#000000");
const editSize = ref(24);
// 蒙板模式：落笔写入红色蒙板层
const maskMode = ref(false);
const EDIT_COLORS = ["#000000", "#ffffff", "#ff3b30", "#ffcc00", "#34c759", "#0a84ff"];
const previewEdit = reactive({ canUndo: false, canRedo: false, hasStrokes: false, hasMask: false });
// 按住空格临时进入抓手
const spaceHand = ref(false);
const handMode = computed(
  () => editing.value && (editTool.value === "hand" || spaceHand.value)
);
// 再按一次 H 回到之前的画笔工具
const lastDrawTool = ref("brush");
watch(editTool, (tool) => {
  if (tool !== "hand") lastDrawTool.value = tool;
});

function toggleHandTool() {
  editTool.value = editTool.value === "hand" ? lastDrawTool.value : "hand";
}

function onEditState(state) {
  Object.assign(previewEdit, state);
}

function toggleEdit() {
  if (!isImage.value) return;
  if (!editing.value) comparing.value = false;
  editing.value = !editing.value;
}

async function applyEdit() {
  const result = await previewRef.value?.exportEdit();
  if (!result) return;
  const old = current.value;
  if (!old) return;
  const base = baseName(old.name || "image");
  // 之前的原图（没有 alpha 的底图），用于再次编辑与取消蒙板
  const oldOriginal = old.original || {
    url: old.url,
    ref: old.ref,
    name: old.name,
    thumbUrl: old.thumbUrl,
  };
  let item = old;
  try {
    let painted = null;
    if (result.blob) painted = await graph.uploadAsset(result.blob, `${base}-edit.png`);

    if (result.maskBlob && result.maskedBlob) {
      const maskItem = await graph.uploadAsset(result.maskBlob, `${base}-mask.png`);
      const maskedItem = await graph.uploadAsset(result.maskedBlob, `${base}-masked.png`);
      if (maskedItem) {
        // 和 ComfyUI 一样，应用后节点直接载入带蒙板的合成图；原图留作再次编辑
        item = {
          ...maskedItem,
          original: painted
            ? { url: painted.url, ref: painted.ref, name: painted.name, thumbUrl: painted.thumbUrl }
            : oldOriginal,
          mask: maskItem ? { url: maskItem.url, ref: maskItem.ref, name: maskItem.name } : null,
          maskInverted: !!result.maskInverted,
        };
      }
    } else if (result.maskTouched) {
      // 蒙板被清空：图像恢复成不带 alpha 的原图
      const restored = painted || oldOriginal;
      item = {
        ...old,
        url: restored.url,
        ref: restored.ref,
        name: restored.name,
        thumbUrl: restored.thumbUrl,
        original: null,
        mask: null,
        maskInverted: false,
      };
    } else if (painted) {
      item = { ...painted, original: null, mask: null, maskInverted: false };
    }
    if (item !== old) graph.replaceMediaItem(props.nodeId, props.index, { ...item, id: old.id });
  } catch (error) {
    console.warn("[Infinite-Canvas] 保存编辑失败", error);
  }
  editing.value = false;
  maskMode.value = false;
}

// 编辑时拦截 Ctrl/⌘+Z，别让画布的撤销快捷键吃掉
function shieldKey(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // 滑块、复选、单选、按钮不输入文字，快捷键照常生效
  const type = String(target.type || "text").toLowerCase();
  return !["range", "checkbox", "radio", "button", "color", "file"].includes(type);
}

function onEditKeyDown(event) {
  if (!editing.value) return;
  const key = String(event.key || "").toLowerCase();

  if (event.ctrlKey || event.metaKey) {
    if (key === "z") {
      shieldKey(event);
      if (event.shiftKey) previewRef.value?.redoEdit();
      else previewRef.value?.undoEdit();
    } else if (key === "y") {
      shieldKey(event);
      previewRef.value?.redoEdit();
    } else if (key === "0") {
      // Ctrl/⌘+0：回到适应窗口
      shieldKey(event);
      previewRef.value?.resetView();
    }
    return;
  }

  // 输入框里不抢普通字母
  if (isTypingTarget(event.target)) return;

  // 滑块上按快捷键时顺手移除焦点，避免看起来像被选中
  if (event.target instanceof HTMLInputElement && event.target.type === "range") {
    event.target.blur();
  }

  if (key === "h") {
    shieldKey(event);
    toggleHandTool();
  } else if (key === "b") {
    shieldKey(event);
    editTool.value = "brush";
  } else if (key === "e") {
    shieldKey(event);
    editTool.value = "eraser";
  } else if (key === "q") {
    shieldKey(event);
    maskMode.value = !maskMode.value;
  } else if (key === "[" || key === "]") {
    shieldKey(event);
    const next = editSize.value + (key === "]" ? 2 : -2);
    editSize.value = Math.min(160, Math.max(2, next));
  } else if (key === " " || key === "spacebar") {
    // 按住空格临时抓手
    shieldKey(event);
    spaceHand.value = true;
  }
}

function onEditKeyUp(event) {
  if (event.key === " " || event.key === "Spacebar") spaceHand.value = false;
}

function onWindowBlur() {
  spaceHand.value = false;
}

watch(editing, (on) => {
  if (on) {
    window.addEventListener("keydown", onEditKeyDown, true);
    window.addEventListener("keyup", onEditKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
  } else {
    window.removeEventListener("keydown", onEditKeyDown, true);
    window.removeEventListener("keyup", onEditKeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
    spaceHand.value = false;
    maskMode.value = false;
  }
});

watch(
  () => props.index,
  () => {
    editing.value = false;
  }
);

// 切到裁切/扩图等模式时退出编辑，避免快捷键还挂在预览上
watch(mode, () => {
  editing.value = false;
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onEditKeyDown, true);
  window.removeEventListener("keyup", onEditKeyUp, true);
  window.removeEventListener("blur", onWindowBlur);
});

const zipRefs = computed(() =>
  props.media
    .filter((item) => item.ref && item.ref.filename)
    .map((item) => ({
      filename: item.ref.filename,
      subfolder: item.ref.subfolder || "",
      type: item.ref.type || "output",
    }))
);

// 扇形位置：x 为相对节点中心，top 为圆心距节点上沿的高度；中间两个最大
const fanSizes = [30, 34, 38, 38, 34, 30];
const FAN = [
  { x: -120, y: 28 },
  { x: -78, y: 40 },
  { x: -30, y: 48 },
  { x: 30, y: 48 },
  { x: 78, y: 40 },
  { x: 120, y: 28 },
];

function fanStyle(i) {
  const size = fanSizes[i];
  return {
    left: `${FAN[i].x}px`,
    top: `${-FAN[i].y}px`,
    width: `${size}px`,
    height: `${size}px`,
    transform: "translate(-50%, -50%)",
  };
}

const actions = [
  {
    key: "crop",
    label: "裁切",
    mode: "crop",
    imageOnly: true,
    paths: ["M8 4v12h12", "M4 8h12v12"],
  },
  {
    key: "expand",
    label: "扩图",
    mode: "expand",
    imageOnly: true,
    paths: ["M4 9V4h5", "M20 15v5h-5", "M15 4h5v5", "M9 20H4v-5"],
  },
  {
    key: "preview",
    label: "预览",
    mode: "preview",
    paths: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  },
  {
    key: "grid",
    label: "宫格",
    mode: "grid",
    imageOnly: true,
    paths: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  },
  {
    key: "download",
    label: "下载",
    paths: ["M12 3v12", "M7 11l5 5 5-5", "M4 20h16"],
  },
  {
    key: "downloadAll",
    label: "全部下载",
    paths: ["M12 2v9", "M8.5 8.5 12 12l3.5-3.5", "M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"],
  },
];

function modeOf(action) {
  return action.mode || "";
}

// 按钮可用规则：
// - 批量下载：节点自身至少两个文件才可用
// - 裁切 / 扩图 / 宫格：只对图片可用（音频、视频禁用）
// - 下载：当前有素材即可用
function isDisabled(action) {
  if (action.key === "downloadAll") return props.media.length < 2;
  if (action.key === "download") return !current.value;
  return !!action.imageOnly && !isImage.value;
}

function trigger(action) {
  if (isDisabled(action)) return;
  if (action.key === "download") {
    downloadCurrent();
    return;
  }
  if (action.key === "downloadAll") {
    downloadAll();
    return;
  }
  panelOpen.value = true;
  showContent.value = false;
  mode.value = action.mode || "preview";
  // 每次从图标进入宫格都先落在「分割」
  if (action.key === "grid") gridMode.value = "split";
  nextTick(() => {
    showContent.value = true;
  });
}

// 宫格分割 / 拼接切换后重新挂起编辑器
function setGridMode(next) {
  if (gridMode.value === next) return;
  showContent.value = false;
  gridMode.value = next;
  nextTick(() => {
    showContent.value = true;
  });
}

function closePanel() {
  panelOpen.value = false;
  showContent.value = false;
  comparing.value = false;
  editing.value = false;
  mode.value = "preview";
}

// 双击节点素材时由父组件调用：直接打开预览面板
function openPreviewPanel() {
  panelOpen.value = true;
  showContent.value = false;
  comparing.value = false;
  editing.value = false;
  mode.value = "preview";
  nextTick(() => {
    showContent.value = true;
  });
}

defineExpose({ openPreviewPanel });

// 下载文件名以节点名称为准，扩展名沿用素材原名
function downloadName(item) {
  const raw = item?.name || item?.ref?.filename || "";
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot) : "";
  // 节点名可能本身就是文件名（带后缀），先去掉媒体后缀再拼，避免出现 xxx.png.png
  const base = String(props.label || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|mkv|mp3|wav|flac|ogg|m4a)$/i, "");
  return `${base || raw.slice(0, dot > 0 ? dot : undefined) || "asset"}${ext}`;
}

// 下载当前显示的资产（走 /view 拉二进制，确保文件名可控）
async function downloadCurrent() {
  const item = current.value;
  if (!item) return;
  const filename = downloadName(item);
  try {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error("下载失败");
    saveBlob(await response.blob(), filename);
  } catch (error) {
    console.warn("[Infinite-Canvas] 下载失败", error);
  }
}

// 全部下载：由后端把节点自身素材打包成 zip
async function downloadAll() {
  if (!zipRefs.value.length) return;
  try {
    const response = await fetch("/infinite_canvas/api/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: zipRefs.value, name: props.label || "assets" }),
    });
    if (!response.ok) throw new Error("打包失败");
    saveBlob(await response.blob(), `${props.label || "assets"}.zip`);
  } catch (error) {
    console.warn("[Infinite-Canvas] 打包失败", error);
  }
}

// 裁切 / 扩图：新图直接覆盖当前素材
async function onReplace(blob, filename) {
  try {
    const item = await graph.uploadAsset(blob, filename);
    if (item) graph.replaceMediaItem(props.nodeId, props.index, item);
    mode.value = "preview";
  } catch (error) {
    console.warn("[Infinite-Canvas] 覆盖素材失败", error);
  }
}

// 宫格分割：所有切片放进旁边新建的节点
async function onSplit(pieces) {
  const items = [];
  for (const piece of pieces) {
    const item = await graph.uploadAsset(piece.blob, piece.name);
    if (item) items.push(item);
  }
  if (items.length) graph.spawnDetachedNode(props.nodeId, items);
  closePanel();
}

// 宫格拼接：合成图放进旁边新建的节点
async function onMerge(blob, filename) {
  try {
    const item = await graph.uploadAsset(blob, filename);
    if (item) graph.spawnDetachedNode(props.nodeId, [item]);
    closePanel();
  } catch (error) {
    console.warn("[Infinite-Canvas] 拼接结果保存失败", error);
  }
}
</script>

<style scoped>
/* 扇形操作层：锚在节点上沿中心，隐藏时不占交互 */
.node-actions {
  position: absolute;
  left: 50%;
  /* 再往上让出节点名称那一行，底边与名字之间留约 5px */
  bottom: calc(100% + 18px);
  z-index: 25;
  width: 0;
  height: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.node-actions.is-open {
  opacity: 1;
  transform: none;
}

.node-actions.is-open .fan-btn {
  pointer-events: auto;
}

.fan-btn {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: var(--c-surface-3);
  box-shadow: 0 6px 16px var(--c-shadow);
  color: var(--c-text);
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.fan-btn:hover {
  border-color: var(--c-accent);
  background: var(--c-hover);
  color: var(--c-accent);
}

/* 可用按钮高亮：黄色描边 + 淡黄底；不可用按钮降透明度并禁用指针 */
.fan-btn.is-enabled {
  border-color: color-mix(in srgb, var(--c-accent) 75%, transparent);
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 10%, transparent);
}

.fan-btn.is-enabled:hover {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 20%, transparent);
}

.fan-btn:disabled {
  opacity: 0.32;
  cursor: not-allowed;
  box-shadow: none;
}

.fan-btn:disabled:hover {
  border-color: var(--c-border-strong);
  background: var(--c-surface-3);
  color: var(--c-text);
}

/* 弹层 */
.asset-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-backdrop);
}

/* 截帧结果提示：固定底部居中，层级高于全屏预览 */
.asset-notice {
  position: fixed;
  left: 50%;
  bottom: 40px;
  z-index: 2700;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c-text) 88%, transparent);
  color: var(--c-surface);
  font-size: 12px;
  pointer-events: none;
}

.asset-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1120px, 93vw);
  height: min(720px, 90vh);
  padding: 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: 18px;
  background: var(--c-surface);
  box-shadow: 0 24px 60px var(--c-shadow);
}

.asset-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-surface) 86%, transparent);
  color: var(--c-text);
  cursor: pointer;
}

.asset-close:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
}

.asset-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.asset-main {
  position: relative;
  order: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: var(--c-surface-2);
}

/* 预览 + 顶部编辑工具栏（工具栏浮在预览上方，不占布局高度） */
.preview-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.edit-top {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  z-index: 4;
  padding: 8px 10px;
  border: 1px solid var(--c-border-strong);
  border-radius: 12px;
  background: color-mix(in srgb, var(--c-surface-3) 90%, transparent);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.edit-tools,
.edit-history {
  display: flex;
  gap: 6px;
}

.edit-tool {
  width: 60px;
  height: 28px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.edit-tool.is-active {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 16%, transparent);
  color: var(--c-accent);
}

.edit-colors {
  display: flex;
  gap: 8px;
}

.edit-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--c-border-strong);
  cursor: pointer;
}

.edit-swatch.is-active {
  border-color: var(--c-accent);
}

.edit-size {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 180px;
  min-width: 150px;
  color: var(--c-muted);
  font-size: 12px;
}

.edit-size input[type="range"] {
  flex: 1;
  min-width: 0;
}

.edit-size-value {
  width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.edit-mini {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface);
  color: var(--c-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.edit-mini:hover:not(:disabled) {
  color: var(--c-text);
  border-color: var(--c-accent);
}

.edit-mini:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.apply-btn {
  width: 100%;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--accent-yellow);
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.apply-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.asset-empty {
  margin: auto;
  color: var(--c-muted);
  font-size: 13px;
}

/* 右侧控制列：图标 → 参数 → 应用（沉底） */
.asset-side {
  order: 2;
  flex: 0 0 128px;
  min-height: 0;
  /* 顶部留出关闭按钮的位置 */
  padding-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.side-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 4px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 10px;
  line-height: 1.2;
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.tool-btn:hover:not(:disabled) {
  border-color: var(--c-accent);
  background: var(--c-hover);
  color: var(--c-accent);
}

.tool-btn.is-active {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 宫格子模式切换 */
.side-switch {
  flex: 0 0 auto;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: var(--c-surface-3);
}

.side-switch button {
  flex: 1;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.side-switch button.is-active {
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-weight: 600;
}

/* 参数控件容器：编辑器 Teleport 进来 */
.side-controls {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 100%;
  margin-top: 6px;
  padding: 10px;
  border-radius: 10px;
  background: var(--c-surface-3);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.side-controls:empty {
  display: none;
}

.side-hint {
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.7;
}

/* 对比开关：放在预览工具列里 */
.side-compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  margin-top: 0;
  border: 1px solid color-mix(in srgb, var(--c-accent) 60%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c-accent) 8%, transparent);
  color: var(--c-accent);
  font-size: 12px;
  cursor: pointer;
}

.side-compare:hover,
.side-compare.is-active {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 20%, transparent);
}

/* 应用按钮容器：编辑器 Teleport 进来，沉底 */
.side-apply {
  flex: 0 0 auto;
  margin-top: auto;
}

.side-apply.is-hidden {
  display: none;
}

/* 预览工具：全屏 + 截帧按钮，沉到工具栏底部 */
.side-extra {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
}

.side-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface-2);
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
}

.side-action:hover:not(:disabled) {
  color: var(--c-accent);
  border-color: var(--c-accent);
}

.side-action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>

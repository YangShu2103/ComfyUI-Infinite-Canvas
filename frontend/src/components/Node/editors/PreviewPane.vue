<template>
  <div
    ref="stageEl"
    class="preview-stage"
    :class="{
      'is-zoomed': isImage && zoom > 1,
      'is-pannable': isImage && zoom > 1 && !editing,
      'is-editing': editing,
      'has-strip': showStrip && isVideo,
      'is-fullscreen': fullscreen,
    }"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @contextmenu.prevent
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
        ref="imgEl"
        :src="imageSrc"
        :alt="item.name"
        draggable="false"
        :style="imageStyle"
        @load="onImageLoad"
      />
      <!-- 文本类工作流：没有素材时直接大字号展示生成结果 -->
      <div v-else-if="text" class="preview-text">{{ text }}</div>
      <span v-else class="preview-empty">暂无素材</span>
    </template>

    <!-- 编辑状态：直接盖在预览图上的笔迹层 -->
    <canvas
      v-if="editing && isImage && item && !comparing"
      ref="paintEl"
      class="paint-layer"
      :class="{ 'is-hand': panMode, 'is-mask': maskMode }"
      @pointerdown.stop="onPaintPointerDown"
      @contextmenu.prevent
    />
    <!-- 蒙板层：半透明红色显示，画在笔迹层之上 -->
    <canvas
      v-if="editing && isImage && item && !comparing"
      ref="maskEl"
      class="paint-layer mask-layer"
      :class="{ 'is-active': maskMode, 'is-invisible': !maskVisible }"
      @pointerdown.stop="onPaintPointerDown"
      @contextmenu.prevent
    />

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

    <!-- 素材缩略条：编辑时隐藏，避免误切素材 -->
    <div v-if="showStrip && !editing" class="preview-strip" @wheel.stop @pointerdown.stop>
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { canvasToBlob, clamp, loadImage } from "../../../utils/image";
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
  // 编辑状态：直接在预览图上涂抹
  editing: { type: Boolean, default: false },
  tool: { type: String, default: "brush" },
  color: { type: String, default: "#000000" },
  size: { type: Number, default: 24 },
  // 抓手模式：左键拖动查看，不落笔
  panMode: { type: Boolean, default: false },
  // 蒙板模式：落笔写入蒙板层而不是普通笔迹
  maskMode: { type: Boolean, default: false },
});

const emit = defineEmits(["select", "frame", "edit-state"]);

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

// 带蒙板的素材显示的是合成图；编辑时改用不带 alpha 的原图作底，方便反复修改
const imageSrc = computed(() => {
  const item = props.item;
  if (!item) return "";
  if (props.editing && item.original?.url) return item.original.url;
  return item.url;
});

watch(
  () => props.item && props.item.id,
  () => {
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
    resetEditState();
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
function beginPan(event) {
  drag = { x: event.clientX, y: event.clientY, pan: { ...pan.value } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerDown(event) {
  if (props.comparing || !isImage.value) return;
  if (props.editing) {
    // 编辑时左键留给画笔，右键/中键才平移
    if ((event.button === 1 || event.button === 2) && zoom.value > 1) beginPan(event);
    return;
  }
  if (zoom.value <= 1) return;
  beginPan(event);
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

// ------------------------------------------------------------ 在预览图上直接编辑
const imgEl = ref(null);
const paintEl = ref(null);
const maskEl = ref(null);
const strokes = ref([]);
const redoStack = ref([]);
let activeStroke = null;
let paintSyncRaf = 0;
let stageObserver = null;

// 蒙板：白色笔迹存在 maskWhite 离屏画布里，显示层 tint 成半透明红
const maskStrokes = ref([]);
const maskRedo = ref([]);
const maskVisible = ref(true);
const maskInverted = ref(false);
const maskBase = ref(null); // 已保存的蒙板位图（白色笔迹）
let maskWhite = null;
let maskDirty = false;

const hasStrokes = computed(() => strokes.value.length > 0);
const hasMask = computed(() => maskStrokes.value.length > 0 || !!maskBase.value);

function emitEditState() {
  const inMask = props.maskMode;
  emit("edit-state", {
    canUndo: inMask ? maskStrokes.value.length > 0 : strokes.value.length > 0,
    canRedo: inMask ? maskRedo.value.length > 0 : redoStack.value.length > 0,
    hasStrokes: hasStrokes.value,
    hasMask: hasMask.value,
  });
}

watch(
  () => [
    props.maskMode,
    strokes.value.length,
    redoStack.value.length,
    maskStrokes.value.length,
    maskRedo.value.length,
  ],
  emitEditState
);

function resetEditState() {
  strokes.value = [];
  redoStack.value = [];
  maskStrokes.value = [];
  maskRedo.value = [];
  maskVisible.value = true;
  maskInverted.value = false;
  maskBase.value = null;
  maskWhite = null;
  maskDirty = false;
  emit("edit-state", { canUndo: false, canRedo: false, hasStrokes: false, hasMask: false });
}

// 笔迹层始终贴合当前预览图的位置和大小（缩放、平移、全屏都会变）
function syncPaintRect() {
  const stage = stageEl.value;
  const img = imgEl.value;
  if (!stage || !img) return;
  const s = stage.getBoundingClientRect();
  const r = img.getBoundingClientRect();
  for (const canvas of [paintEl.value, maskEl.value]) {
    if (!canvas) continue;
    canvas.style.left = `${r.left - s.left}px`;
    canvas.style.top = `${r.top - s.top}px`;
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
  }
}

function schedulePaintSync() {
  if (!props.editing || paintSyncRaf) return;
  paintSyncRaf = requestAnimationFrame(() => {
    paintSyncRaf = 0;
    syncPaintRect();
  });
}

function initPaint() {
  const img = imgEl.value;
  const canvas = paintEl.value;
  if (!img || !canvas || !img.naturalWidth) return;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

  if (maskEl.value) {
    maskEl.value.width = canvas.width;
    maskEl.value.height = canvas.height;
  }
  maskWhite = document.createElement("canvas");
  maskWhite.width = canvas.width;
  maskWhite.height = canvas.height;
  maskInverted.value = !!props.item?.maskInverted;
  maskDirty = false;
  loadMaskBase();
  syncPaintRect();
}

// 已保存的蒙板作为底图载入；没有蒙板时尝试从图片 alpha 里识别（ComfyUI 蒙板编辑器画的）
async function loadMaskBase() {
  maskBase.value = null;
  maskStrokes.value = [];
  maskRedo.value = [];
  const src = props.item?.mask?.url;
  if (src) {
    try {
      maskBase.value = await loadImage(src);
    } catch {
      maskBase.value = null;
    }
  } else {
    importAlphaMask();
  }
  repaintMask();
  emitEditState();
}

// 外部画的蒙板存在 alpha 里（透明处 = 蒙板），转成白色蒙板层
function importAlphaMask() {
  const img = imgEl.value;
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const mask = document.createElement("canvas");
    mask.width = canvas.width;
    mask.height = canvas.height;
    const mctx = mask.getContext("2d");
    const out = mctx.createImageData(mask.width, mask.height);
    let found = false;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha >= 250) continue;
      found = true;
      out.data[i] = 255;
      out.data[i + 1] = 255;
      out.data[i + 2] = 255;
      out.data[i + 3] = 255 - alpha;
    }
    if (!found) return;
    mctx.putImageData(out, 0, 0);
    maskBase.value = mask;
  } catch {
    // 读不到像素（画布被污染等）就当作没有蒙板
  }
}

function onImageLoad() {
  if (props.editing) nextTick(initPaint);
}

watch(
  () => props.editing,
  (on) => {
    if (!on) {
      resetEditState();
      return;
    }
    nextTick(() => {
      if (imgEl.value?.complete) initPaint();
    });
  }
);

watch([zoom, () => pan.value.x, () => pan.value.y, fullscreen], schedulePaintSync);

function paintPoint(event) {
  const canvas = paintEl.value;
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

// 笔刷大小按屏幕像素算，缩放后观感一致
function brushSizeNatural() {
  const canvas = paintEl.value;
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / Math.max(1, rect.width);
  return Math.max(1, props.size * scale);
}

function strokeCtx(stroke) {
  const canvas = stroke.mask ? maskEl.value : paintEl.value;
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  ctx.save();
  if (stroke.mask) {
    // 蒙板层始终用半透明红显示；反相时红底挖空，画笔变成“擦除红色”
    const erasing = stroke.tool === "eraser";
    ctx.globalCompositeOperation =
      erasing !== maskInverted.value ? "destination-out" : "source-over";
    ctx.strokeStyle = "#ff3b30";
    ctx.fillStyle = "#ff3b30";
  } else {
    ctx.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

function drawDot(stroke, point) {
  const ctx = strokeCtx(stroke);
  if (!ctx) return;
  ctx.beginPath();
  ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSegment(stroke, from, to) {
  const ctx = strokeCtx(stroke);
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function onPaintPointerDown(event) {
  // 抓手模式：左键也用来平移
  if (props.panMode) {
    event.preventDefault();
    beginPan(event);
    return;
  }
  if (event.button === 1 || event.button === 2) {
    if (zoom.value > 1) {
      event.preventDefault();
      beginPan(event);
    }
    return;
  }
  if (event.button !== 0) return;
  if (props.maskMode ? !maskEl.value : !paintEl.value) return;
  event.preventDefault();
  activeStroke = {
    mask: props.maskMode,
    tool: props.tool,
    color: props.maskMode ? "#ffffff" : props.color,
    size: brushSizeNatural(),
    points: [paintPoint(event)],
  };
  drawDot(activeStroke, activeStroke.points[0]);
  window.addEventListener("pointermove", onPaintMove);
  window.addEventListener("pointerup", onPaintUp);
}

function onPaintMove(event) {
  if (!activeStroke) return;
  const point = paintPoint(event);
  const last = activeStroke.points[activeStroke.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
  drawSegment(activeStroke, last, point);
  activeStroke.points.push(point);
}

function onPaintUp() {
  if (activeStroke) {
    if (activeStroke.mask) {
      maskStrokes.value = [...maskStrokes.value, activeStroke];
      maskRedo.value = [];
      maskDirty = true;
      repaintMask();
    } else {
      strokes.value = [...strokes.value, activeStroke];
      redoStack.value = [];
    }
    activeStroke = null;
  }
  window.removeEventListener("pointermove", onPaintMove);
  window.removeEventListener("pointerup", onPaintUp);
}

function repaintEdits() {
  const canvas = paintEl.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes.value) {
    if (stroke.points.length === 1) {
      drawDot(stroke, stroke.points[0]);
      continue;
    }
    for (let i = 1; i < stroke.points.length; i += 1) {
      drawSegment(stroke, stroke.points[i - 1], stroke.points[i]);
    }
  }
}

// ------------------------------------------------------------ 蒙板图层
function paintMaskShape(ctx, stroke) {
  ctx.beginPath();
  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  ctx.stroke();
}

// 重建白色蒙板位图 + 红色显示层
function repaintMask() {
  const display = maskEl.value;
  if (!display || !maskWhite) return;
  const wctx = maskWhite.getContext("2d");
  wctx.clearRect(0, 0, maskWhite.width, maskWhite.height);
  if (maskBase.value) {
    wctx.drawImage(maskBase.value, 0, 0, maskWhite.width, maskWhite.height);
  }
  for (const stroke of maskStrokes.value) {
    wctx.save();
    wctx.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    wctx.strokeStyle = "#ffffff";
    wctx.fillStyle = "#ffffff";
    wctx.lineWidth = stroke.size;
    wctx.lineCap = "round";
    wctx.lineJoin = "round";
    paintMaskShape(wctx, stroke);
    wctx.restore();
  }

  const ctx = display.getContext("2d");
  ctx.clearRect(0, 0, display.width, display.height);
  ctx.globalCompositeOperation = "source-over";
  if (maskInverted.value) {
    // 反相：整块铺红，再用蒙板挖空
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(0, 0, display.width, display.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(maskWhite, 0, 0);
  } else {
    ctx.drawImage(maskWhite, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(0, 0, display.width, display.height);
  }
  ctx.globalCompositeOperation = "source-over";
}

function undoEdit() {
  if (props.maskMode) {
    if (!maskStrokes.value.length) return;
    const last = maskStrokes.value[maskStrokes.value.length - 1];
    maskStrokes.value = maskStrokes.value.slice(0, -1);
    maskRedo.value = [...maskRedo.value, last];
    maskDirty = true;
    repaintMask();
    return;
  }
  if (!strokes.value.length) return;
  const last = strokes.value[strokes.value.length - 1];
  strokes.value = strokes.value.slice(0, -1);
  redoStack.value = [...redoStack.value, last];
  repaintEdits();
}

function redoEdit() {
  if (props.maskMode) {
    if (!maskRedo.value.length) return;
    const stroke = maskRedo.value[maskRedo.value.length - 1];
    maskRedo.value = maskRedo.value.slice(0, -1);
    maskStrokes.value = [...maskStrokes.value, stroke];
    maskDirty = true;
    repaintMask();
    return;
  }
  if (!redoStack.value.length) return;
  const stroke = redoStack.value[redoStack.value.length - 1];
  redoStack.value = redoStack.value.slice(0, -1);
  strokes.value = [...strokes.value, stroke];
  repaintEdits();
}

function clearEdit() {
  if (props.maskMode) {
    if (!hasMask.value) return;
    maskStrokes.value = [];
    maskRedo.value = [];
    maskBase.value = null;
    maskInverted.value = false;
    maskDirty = true;
    repaintMask();
    emitEditState();
    return;
  }
  if (!strokes.value.length) return;
  strokes.value = [];
  redoStack.value = [];
  repaintEdits();
}

function toggleMaskVisibility() {
  maskVisible.value = !maskVisible.value;
}

function invertMask() {
  if (!hasMask.value) return;
  maskInverted.value = !maskInverted.value;
  maskDirty = true;
  repaintMask();
  emitEditState();
}

// 保存：原图 + 笔迹合成 PNG
async function exportEdit() {
  const img = imgEl.value;
  const canvas = paintEl.value;
  if (!img || !canvas || !img.naturalWidth) return null;
  const output = document.createElement("canvas");
  output.width = img.naturalWidth;
  output.height = img.naturalHeight;
  const ctx = output.getContext("2d");
  ctx.drawImage(img, 0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0, output.width, output.height);

  const painted = hasStrokes.value ? await canvasToBlob(output) : null;
  if (!hasMask.value) {
    return { blob: painted, maskTouched: maskDirty, maskBlob: null, maskedBlob: null, maskInverted: false };
  }

  // 蒙板 PNG（白色，不反相）：用于下次继续编辑
  const maskBlob = await canvasToBlob(maskWhite);

  // alpha = 1 - 蒙板；反相后 alpha = 蒙板
  const alpha = document.createElement("canvas");
  alpha.width = maskWhite.width;
  alpha.height = maskWhite.height;
  const actx = alpha.getContext("2d");
  if (maskInverted.value) {
    actx.drawImage(maskWhite, 0, 0);
  } else {
    actx.fillStyle = "#ffffff";
    actx.fillRect(0, 0, alpha.width, alpha.height);
    actx.globalCompositeOperation = "destination-out";
    actx.drawImage(maskWhite, 0, 0);
  }

  const masked = document.createElement("canvas");
  masked.width = output.width;
  masked.height = output.height;
  const mctx = masked.getContext("2d");
  mctx.drawImage(output, 0, 0);
  mctx.globalCompositeOperation = "destination-in";
  mctx.drawImage(alpha, 0, 0);

  return {
    blob: painted,
    maskTouched: maskDirty,
    maskBlob,
    maskedBlob: await canvasToBlob(masked),
    maskInverted: maskInverted.value,
  };
}

onMounted(() => {
  if (stageEl.value) {
    stageObserver = new ResizeObserver(() => schedulePaintSync());
    stageObserver.observe(stageEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onFullscreenKey);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointermove", onPaintMove);
  window.removeEventListener("pointerup", onPaintUp);
  if (paintSyncRaf) cancelAnimationFrame(paintSyncRaf);
  if (stageObserver) stageObserver.disconnect();
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
// 回到适应窗口的 100%
function resetView() {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

defineExpose({
  fullscreen,
  exporting,
  toggleFullscreen,
  exportFrame,
  undoEdit,
  redoEdit,
  clearEdit,
  exportEdit,
  resetView,
  maskVisible,
  maskInverted,
  hasMask,
  toggleMaskVisibility,
  invertMask,
});
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

/* 编辑笔迹层：位置和大小由 JS 同步到图片的显示区域 */
.paint-layer {
  position: absolute;
  z-index: 2;
  cursor: crosshair;
  touch-action: none;
}

.paint-layer.is-hand {
  cursor: grab;
}

/* 蒙板层压在最上面：只有蒙板模式才接收指针事件 */
.mask-layer {
  z-index: 3;
  opacity: 0.45;
  pointer-events: none;
}

.mask-layer.is-active {
  pointer-events: auto;
}

.mask-layer.is-invisible {
  opacity: 0;
}

.paint-layer.is-mask {
  pointer-events: none;
}

.paint-layer.is-hand:active {
  cursor: grabbing;
}

.preview-stage > img {
  background-color: var(--c-surface);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.12) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.12) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.12) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.12) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
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

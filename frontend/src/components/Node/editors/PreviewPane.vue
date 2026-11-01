<template>
  <div
    ref="stageEl"
    class="preview-stage"
    :class="{ 'is-zoomed': isImage && zoom > 1, 'is-pannable': isImage && zoom > 1 }"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <video
      v-if="item && item.kind === 'video'"
      :src="item.url"
      controls
      playsinline
      preload="metadata"
    />
    <audio v-else-if="item && item.kind === 'audio'" :src="item.url" controls />
    <img
      v-else-if="item"
      :src="item.url"
      :alt="item.name"
      draggable="false"
      :style="imageStyle"
    />
    <span v-else class="preview-empty">暂无素材</span>

    <div v-if="isImage" class="preview-zoom">{{ Math.round(zoom * 100) }}%</div>

    <!-- 素材缩略条：悬浮在预览区底部 -->
    <div v-if="thumbs.length" class="preview-strip" @wheel.stop @pointerdown.stop>
      <button
        v-for="(thumb, i) in thumbs"
        :key="thumb.id || i"
        type="button"
        class="preview-thumb"
        :class="{ 'is-active': i === activeIndex }"
        :title="thumb.name"
        @click.stop="emit('select', i)"
      >
        <img v-if="thumb.kind === 'image'" :src="thumb.url" alt="" draggable="false" />
        <span v-else class="thumb-kind">{{ thumb.kind === "video" ? "视频" : "音频" }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { clamp } from "../../../utils/image";

const props = defineProps({
  item: { type: Object, default: null },
  media: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
});

const emit = defineEmits(["select"]);

const stageEl = ref(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
let drag = null;

const isImage = computed(() => !!props.item && props.item.kind === "image");
const thumbs = computed(() => props.media || []);
const activeIndex = computed(() => props.index);

const imageStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
  cursor: zoom.value > 1 ? "grab" : "default",
}));

watch(
  () => props.item && props.item.id,
  () => {
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
  }
);

// 滚轮缩放：以指针位置为中心，仅对图像生效
function onWheel(event) {
  if (!isImage.value || !stageEl.value) return;
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
function onPointerDown(event) {
  if (!isImage.value || zoom.value <= 1) return;
  drag = { x: event.clientX, y: event.clientY, pan: { ...pan.value } };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
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
  background: #14141a;
  user-select: none;
}

.preview-stage.is-pannable {
  cursor: grab;
}

.preview-stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
}

.preview-stage video {
  max-width: 100%;
  max-height: 100%;
}

.preview-empty {
  color: var(--c-muted);
  font-size: 13px;
}

.preview-zoom {
  position: absolute;
  left: 12px;
  top: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--c-muted);
  font-size: 11px;
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
  background: rgba(14, 14, 19, 0.78);
  overflow-x: auto;
}

.preview-thumb {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid #33333d;
  border-radius: 8px;
  background: #1a1a21;
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

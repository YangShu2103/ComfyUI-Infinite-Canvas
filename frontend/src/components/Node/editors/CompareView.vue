<template>
  <div v-if="kind === 'image'" ref="stageEl" class="cmp-image" @pointerdown="startDrag">
    <div class="cmp-layer">
      <img :src="before.url" :alt="before.name" draggable="false" />
    </div>
    <div class="cmp-layer" :style="{ clipPath: `inset(0 0 0 ${pos}%)` }">
      <img :src="after.url" :alt="after.name" draggable="false" />
    </div>
    <span class="cmp-tag is-left">上游</span>
    <span class="cmp-tag is-right">当前</span>
    <div class="cmp-line" :style="{ left: `${pos}%` }">
      <span class="cmp-handle">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path
            d="M10 7l-5 5 5 5M14 7l5 5-5 5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </div>
  </div>

  <div v-else class="cmp-video">
    <div class="cmp-side">
      <video
        ref="videoA"
        :src="before.url"
        muted
        playsinline
        preload="metadata"
        @timeupdate="onTimeA"
        @play="playing = true"
        @pause="playing = false"
        @ended="onEnded"
      />
      <span class="cmp-tag is-left">上游</span>
    </div>

    <div class="cmp-mid">
      <button class="cmp-play" type="button" :title="playing ? '同步暂停' : '同步播放'" @click="toggle">
        <svg v-if="!playing" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M7 4.5v15M17 4.5v15"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <span class="cmp-time">{{ formatTime(current) }} / {{ formatTime(duration) }}</span>
    </div>

    <div class="cmp-side">
      <video
        ref="videoB"
        :src="after.url"
        playsinline
        preload="metadata"
        @ended="onEnded"
      />
      <span class="cmp-tag is-right">当前</span>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from "vue";

const props = defineProps({
  kind: { type: String, default: "image" },
  before: { type: Object, required: true },
  after: { type: Object, required: true },
});

// ---------------- 图片：左右滑动对比 ----------------
const stageEl = ref(null);
const pos = ref(50);
let dragging = false;

function startDrag(event) {
  if (props.kind !== "image" || !stageEl.value) return;
  dragging = true;
  updatePos(event);
  window.addEventListener("pointermove", updatePos);
  window.addEventListener("pointerup", endDrag);
}

function updatePos(event) {
  if (!dragging || !stageEl.value) return;
  const rect = stageEl.value.getBoundingClientRect();
  if (!rect.width) return;
  const next = ((event.clientX - rect.left) / rect.width) * 100;
  pos.value = Math.min(100, Math.max(0, next));
}

function endDrag() {
  dragging = false;
  window.removeEventListener("pointermove", updatePos);
  window.removeEventListener("pointerup", endDrag);
}

onBeforeUnmount(() => {
  endDrag();
  pauseAll();
});

// ---------------- 视频：左右同步播放 ----------------
const videoA = ref(null);
const videoB = ref(null);
const playing = ref(false);
const current = ref(0);
const duration = ref(0);

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function onTimeA() {
  const a = videoA.value;
  const b = videoB.value;
  if (!a) return;
  current.value = a.currentTime;
  if (Number.isFinite(a.duration)) duration.value = Math.max(duration.value, a.duration);
  // 播放中修正两路视频的进度漂移
  if (playing.value && b && Math.abs(b.currentTime - a.currentTime) > 0.3) {
    b.currentTime = a.currentTime;
  }
}

async function toggle() {
  const a = videoA.value;
  const b = videoB.value;
  if (!a || !b) return;
  if (playing.value) {
    pauseAll();
    return;
  }
  if (a.currentTime >= (a.duration || 0)) a.currentTime = 0;
  b.currentTime = a.currentTime;
  a.muted = true;
  b.muted = false;
  try {
    await Promise.all([a.play(), b.play()]);
    playing.value = true;
  } catch {
    playing.value = false;
  }
}

function pauseAll() {
  playing.value = false;
  if (videoA.value) videoA.value.pause();
  if (videoB.value) videoB.value.pause();
}

function onEnded() {
  pauseAll();
  if (Number.isFinite(videoA.value?.duration)) duration.value = videoA.value.duration;
}
</script>

<style scoped>
.cmp-image {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0c0c10;
  cursor: ew-resize;
  touch-action: none;
}

.cmp-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cmp-layer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.cmp-tag {
  position: absolute;
  top: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #e6e6e6;
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
}

.cmp-tag.is-left {
  left: 10px;
}

.cmp-tag.is-right {
  right: 10px;
}

.cmp-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-yellow);
  transform: translateX(-1px);
  pointer-events: none;
}

.cmp-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--accent-yellow);
  border-radius: 50%;
  background: rgba(14, 14, 19, 0.82);
  color: var(--accent-yellow);
  transform: translate(-50%, -50%);
}

/* ---------------- 视频对比 ---------------- */
.cmp-video {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  background: #0c0c10;
}

.cmp-side {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.cmp-side video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.cmp-mid {
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #14141a;
}

.cmp-play {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(242, 255, 89, 0.75);
  border-radius: 50%;
  background: rgba(242, 255, 89, 0.1);
  color: var(--accent-yellow);
  cursor: pointer;
}

.cmp-play:hover {
  background: rgba(242, 255, 89, 0.22);
}

.cmp-time {
  font-size: 10px;
  color: var(--c-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>

<template>
  <div
    ref="editorEl"
    class="tl-editor nowheel"
    tabindex="0"
    @keydown="onKeyDown"
  >
    <!-- 预览：浮在节点上方，尺寸按项目比例受节点宽度 / 最大高度约束；未选中节点时隐藏 -->
    <div
      v-if="active"
      class="tl-preview-float nodrag"
      :style="previewStyle"
      title="点击播放 / 暂停"
      @click="togglePlay"
    >
      <canvas ref="previewEl" class="tl-preview" />
      <span v-if="!totalDuration" class="tl-stage-hint">把素材拖到下方轨道开始编辑</span>
      <button
        v-if="totalDuration"
        class="tl-preview-fs"
        type="button"
        title="全屏预览（F）"
        @click.stop="enterFullscreen"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 9V5h4M20 15v4h-4M20 9V5h-4M4 15v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- 传输条 -->
    <div class="tl-transport">
      <button
        class="tl-icon nodrag"
        type="button"
        title="在播放头处分割（S）"
        :disabled="!canSplit"
        @click="splitAtPlayhead"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="6" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
          <circle cx="6" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M8 7.5L20 19M8 16.5L20 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
      </button>
      <button
        class="tl-icon nodrag"
        type="button"
        title="删除选中片段（Delete）"
        :disabled="!selectedClipId"
        @click="removeSelected"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="tl-icon is-play nodrag"
        type="button"
        :title="playing ? '暂停（空格）' : '播放（空格）'"
        :disabled="!totalDuration"
        @click="togglePlay"
      >
        <svg v-if="!playing" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M8 5l11 7-11 7V5Z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
        </svg>
      </button>
      <span class="tl-time">
        <b>{{ formatTimecode(playhead, fps) }}</b>
        <span class="tl-time-sep">/</span>
        {{ formatTimecode(totalDuration, fps) }}
      </span>
      <span class="tl-spacer" />
      <span class="tl-size">{{ tl.width }} × {{ tl.height }} · {{ fps }}fps</span>
    </div>

    <!-- 素材暂存池 -->
    <div class="tl-bin nodrag">
      <div class="tl-bin-scroll">
        <div
          v-for="item in binItems"
          :key="item.id"
          class="tl-bin-item"
          :title="`${item.name}（拖到轨道，或双击加到播放头）`"
          @pointerdown="startBinDrag(item, $event)"
          @dblclick="addAtPlayhead(item)"
          @mouseenter="openBinPreview($event, item)"
          @mouseleave="closeBinPreview"
        >
          <img
            v-if="binImage(item)"
            :src="binImage(item)"
            alt=""
            draggable="false"
            loading="lazy"
            decoding="async"
            @error="onThumbError(item)"
          />
          <!-- 上传中 / 音频等还没有可用封面时给文字占位，避免 <img> 闪出裂图图标 -->
          <span v-else class="tl-bin-audio">
            {{ item.pending ? "上传中" : item.kind === "video" ? "视频" : item.kind === "audio" ? "音频" : "素材" }}
          </span>
          <span class="tl-bin-kind">{{ kindLabel(item.kind) }}</span>
          <span v-if="item.pending" class="tl-bin-dur">上传中…</span>
          <span v-else-if="metaOf(item)?.duration" class="tl-bin-dur">
            {{ formatTimecode(metaOf(item).duration, fps) }}
          </span>
        </div>
        <button class="tl-bin-add" type="button" title="上传图片 / 视频 / 音频" @click="pickFiles">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
        <span v-if="!binItems.length" class="tl-bin-empty">上游素材会自动出现在这里，也可以直接拖文件进来</span>
      </div>
      <input ref="fileEl" type="file" accept="image/*,video/*,audio/*" multiple hidden @change="onFilesPicked" />
    </div>

    <!-- 时间线 -->
    <div class="tl-timeline nodrag">
      <div class="tl-labels">
        <div class="tl-label-spacer" />
        <div v-for="track in tl.tracks" :key="track.id" class="tl-label" :class="`is-${track.kind}`">
          {{ track.id.toUpperCase() }}
        </div>
      </div>
      <div ref="scrollEl" class="tl-scroll" @wheel.prevent="onWheel">
        <div class="tl-content" :style="{ width: `${contentWidth}px` }">
          <div class="tl-ruler" @pointerdown.prevent="startScrub">
            <span
              v-for="tick in ticks"
              :key="tick.s"
              class="tl-tick"
              :style="{ left: `${tick.x}px` }"
            >
              <span class="tl-tick-label">{{ tick.label }}</span>
            </span>
            <span class="tl-head-cap" :style="{ left: `${playhead * pps}px` }" />
          </div>
          <div class="tl-tracks">
            <div
              v-for="track in tl.tracks"
              :key="track.id"
              class="tl-track"
              :class="`is-${track.kind}`"
              :data-track-id="track.id"
              @pointerdown.self="onTrackBlankDown(track, $event)"
            >
              <!-- 拖拽时的落点预览：告诉用户会放在哪条轨道、占多长 -->
              <div
                v-for="hint in dropHints.filter((entry) => entry.trackId === track.id)"
                :key="`hint-${hint.trackId}`"
                class="tl-drop"
                :style="{ left: `${hint.start * pps}px`, width: `${Math.max(8, hint.length * pps)}px` }"
              >
                <span v-if="hint.length * pps > 46" class="tl-drop-label">
                  {{ formatTimecode(hint.length, fps) }}
                </span>
              </div>
              <div
                v-for="clip in track.clips"
                :key="clip.id"
                class="tl-clip"
                :class="{
                  'is-selected': clip.id === selectedClipId,
                  'is-audio': track.kind === 'audio',
                }"
                :style="clipStyle(clip)"
                @pointerdown.stop="startClipDrag(clip, track, 'move', $event)"
              >
                <img
                  v-if="track.kind === 'video'"
                  class="tl-clip-thumb"
                  :src="clipThumb(clip)"
                  alt=""
                  draggable="false"
                  @error="onThumbError(clipItem(clip))"
                />
                <span class="tl-clip-name">{{ clipName(clip) }}</span>
                <button
                  v-if="clip.linkId"
                  class="tl-clip-link"
                  type="button"
                  title="取消链接：视频与音频分开移动"
                  @pointerdown.stop
                  @click.stop="unlink(clip)"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                    <path d="M9 15l6-6M8 7l1.5-1.5a4 4 0 0 1 5.7 5.7L14 12.5M10 11.5L8.5 13a4 4 0 0 0 5.7 5.7L16 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  </svg>
                </button>
                <span class="tl-trim is-left" @pointerdown.stop="startClipDrag(clip, track, 'trim-l', $event)" />
                <span class="tl-trim is-right" @pointerdown.stop="startClipDrag(clip, track, 'trim-r', $event)" />
              </div>
            </div>
            <span class="tl-playhead" :style="{ left: `${playhead * pps}px` }" />
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作条：导出按钮在右下角，样式与普通节点的「运行」一致 -->
    <div class="tl-footer">
      <div v-if="exportState.status === 'running'" class="tl-progress">
        <span class="tl-progress-track">
          <span
            class="tl-progress-fill"
            :style="{ width: `${Math.round(exportState.progress * 100)}%` }"
          />
        </span>
        <span class="tl-progress-text">
          {{ Math.round(exportState.progress * 100) }}%
          <template v-if="exportState.stage"> · {{ exportState.stage }}</template>
        </span>
      </div>
      <span v-else-if="exportState.status === 'done'" class="tl-footer-note">
        已生成下游节点
      </span>
      <span
        v-else-if="exportState.status === 'error'"
        class="tl-footer-note is-error"
        :title="exportState.message"
      >
        导出失败：{{ exportState.message }}
      </span>
      <span class="tl-spacer" />
      <button
        class="tl-run nodrag"
        :class="{ 'is-stop': exportState.status === 'running' }"
        type="button"
        :title="exportTitle"
        :disabled="!totalDuration && exportState.status !== 'running'"
        @click="toggleExport"
      >
        {{ exportState.status === "running" ? "取消" : "导出" }}
      </button>
    </div>

    <!-- 拖拽影子 -->
    <Teleport to="body">
      <div
        v-if="ghost"
        class="tl-ghost"
        :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }"
      >
        <img v-if="binImage(ghost.item)" :src="binImage(ghost.item)" alt="" />
        <span v-else>{{ ghost.item.kind === "audio" ? "音频" : ghost.item.kind === "video" ? "视频" : "素材" }}</span>
      </div>
    </Teleport>

    <!-- 素材气泡预览：和节点上的素材气泡一致，悬停素材池时出现在旁边 -->
    <Teleport to="body">
      <div
        v-if="binPreview"
        class="tl-bubble"
        :style="{
          left: `${binPreview.x}px`,
          top: `${binPreview.y}px`,
          width: binPreview.ready ? `${binPreview.width}px` : 'auto',
          height: binPreview.ready ? `${binPreview.height}px` : 'auto',
          visibility: binPreview.ready ? 'visible' : 'hidden',
        }"
      >
        <video
          v-if="binPreview.kind === 'video'"
          :src="binPreview.src"
          :poster="binPreview.poster"
          autoplay
          muted
          loop
          playsinline
          @loadedmetadata="fitBinPreview"
        />
        <img
          v-else
          :src="binPreview.src"
          alt=""
          @load="fitBinPreview"
          @error="closeBinPreview"
        />
        <span v-if="binPreview.name" class="tl-bubble-name">{{ binPreview.name }}</span>
      </div>
    </Teleport>

    <!-- 全屏预览：挂到 body，避免被画布缩放裁切；原生全屏不可用时退化成铺满窗口的浮层 -->
    <Teleport to="body">
      <div
        v-if="fullscreen"
        ref="fsEl"
        class="tl-fs"
        @click.self="exitFullscreen"
      >
        <canvas
          ref="fsCanvasEl"
          class="tl-fs-canvas"
          title="点击播放 / 暂停"
          @click="togglePlay"
        />
        <div class="tl-fs-bar" @click.stop>
          <button class="tl-fs-btn" type="button" :title="playing ? '暂停（空格）' : '播放（空格）'" @click="togglePlay">
            <svg v-if="!playing" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M8 5l11 7-11 7V5Z" fill="currentColor" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
            </svg>
          </button>
          <span class="tl-fs-time">
            <b>{{ formatTimecode(playhead, fps) }}</b>
            <span class="tl-time-sep">/</span>
            {{ formatTimecode(totalDuration, fps) }}
          </span>
          <span class="tl-fs-spacer" />
          <span class="tl-fs-size">{{ tl.width }} × {{ tl.height }} · {{ fps }}fps</span>
          <button class="tl-fs-btn is-text" type="button" @click="exitFullscreen">退出全屏（Esc）</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  IMAGE_CLIP_LENGTH,
  IMAGE_MAX_LENGTH,
  clipLength,
  formatTimecode,
  newClipId,
  roundToFrame,
} from "../../../utils/timeline";

const props = defineProps({
  nodeId: { type: String, required: true },
  data: { type: Object, required: true },
  // 只有选中的节点才显示浮动预览
  active: { type: Boolean, default: false },
});

const graph = inject("canvasGraph");

const editorEl = ref(null);
const scrollEl = ref(null);
const previewEl = ref(null);
const fileEl = ref(null);
const fsEl = ref(null);
const fsCanvasEl = ref(null);

// 导出任务按节点 id 记住：节点被画布裁掉（缩小 / 移出视野）再回来时继续轮询，
// 不会因为组件卸载而丢掉正在跑的任务
const exportSessions = new Map();

const tl = computed(() => props.data.timeline);

// 项目帧率：拖入第一个视频时自动探测，所有时间都对齐到这个帧率上
const fps = computed(() => Math.max(1, Math.round(Number(tl.value.fps) || 30)));

// 画布缩放系数：节点内部的像素要换算成屏幕像素，否则拖动和点击会按比例偏移
const viewScale = computed(() => Number(graph?.viewport?.value?.zoom) || 1);

// 浮动预览的尺寸：宽度跟随节点，但有上限；高度也有上限，竖屏素材不会糊满整屏
const MAX_PREVIEW_WIDTH = 1080;
const MAX_PREVIEW_HEIGHT = 720;

const previewStyle = computed(() => {
  const width = Math.max(1, Number(tl.value.width) || 1280);
  const height = Math.max(1, Number(tl.value.height) || 720);
  const nodeWidth = Math.max(240, Number(props.data.w) || 720);
  const maxWidth = Math.min(MAX_PREVIEW_WIDTH, Math.max(200, nodeWidth - 20));
  const scale = Math.min(maxWidth / width, MAX_PREVIEW_HEIGHT / height);
  return {
    width: `${Math.round(width * scale)}px`,
    height: `${Math.round(height * scale)}px`,
  };
});

// ---------------------------------------------------------------- 时间线视图
const zoom = ref(1);
// 基准像素/秒：默认 720 宽的节点正好放下 20 秒
const PPS_BASE = 32;
const pps = computed(() => PPS_BASE * zoom.value);
const playhead = ref(0);
const selectedClipId = ref("");
const playing = ref(false);
const ghost = ref(null);
const dropHints = ref([]);

const binItems = computed(() => {
  const seen = new Set();
  const list = [];
  for (const item of [...(props.data.inputMedia || []), ...(props.data.media || [])]) {
    if (!item || !item.id || seen.has(item.id)) continue;
    if (!item.url && !item.thumbUrl && !item.ref?.filename) continue;
    seen.add(item.id);
    list.push(item);
  }
  return list;
});

const allClips = computed(() =>
  tl.value.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })))
);

const totalDuration = computed(() => {
  let end = 0;
  for (const { clip } of allClips.value) {
    end = Math.max(end, Number(clip.start) + clipLength(clip));
  }
  return end;
});

const availableWidth = ref(0);

// 时间轴始终铺满可视宽度：内容宽度直接等于可视宽度，不会在右侧留出空白断口；
// 素材更长时按实际时长延长，出现横向滚动
const contentSeconds = computed(() => {
  const minSeconds = 20;
  const fitSeconds = availableWidth.value ? availableWidth.value / pps.value : 0;
  return Math.max(minSeconds, fitSeconds, Math.ceil(totalDuration.value + 3));
});
const contentWidth = computed(() => contentSeconds.value * pps.value);

const selectedClip = computed(
  () => allClips.value.find((entry) => entry.clip.id === selectedClipId.value)?.clip || null
);

const canSplit = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return false;
  const gap = 0.5 / fps.value;
  return playhead.value > clip.start + gap && playhead.value < clip.start + clipLength(clip) - gap;
});

const tickStep = computed(() => (pps.value >= 70 ? 1 : pps.value >= 26 ? 2 : 5));
const ticks = computed(() => {
  const step = tickStep.value;
  const list = [];
  for (let second = 0; second <= contentSeconds.value + 1e-6; second += step) {
    list.push({ s: second, x: second * pps.value, label: formatTimecode(second) });
  }
  // 末尾补一个无标签刻度，保证刻度尺一直画到最右边，不会留出断口
  const last = list[list.length - 1];
  if (!last || last.s < contentSeconds.value - 1e-6) {
    list.push({ s: contentSeconds.value, x: contentSeconds.value * pps.value, label: "" });
  }
  return list;
});

watch(totalDuration, (value) => {
  if (playhead.value > value) playhead.value = value;
});

function setZoom(value) {
  const next = Math.min(6, Math.max(0.5, value));
  if (next === zoom.value || !scrollEl.value) {
    zoom.value = next;
    return;
  }
  const anchor = playhead.value * pps.value - scrollEl.value.scrollLeft;
  zoom.value = next;
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollLeft = Math.max(0, playhead.value * pps.value - anchor);
  });
}

function onWheel(event) {
  if (event.ctrlKey || event.altKey) {
    const rect = scrollEl.value.getBoundingClientRect();
    const offset = (event.clientX - rect.left) / viewScale.value;
    const time = (scrollEl.value.scrollLeft + offset) / pps.value;
    const next = Math.min(6, Math.max(0.5, zoom.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    zoom.value = next;
    nextTick(() => {
      scrollEl.value.scrollLeft = Math.max(0, time * pps.value - offset);
    });
    return;
  }
  scrollEl.value.scrollLeft += event.deltaY || event.deltaX;
}

// ---------------------------------------------------------------- 素材元数据
const mediaMeta = computed(() => tl.value.mediaMeta || {});
const probing = new Map();

function metaOf(item) {
  return item ? mediaMeta.value[item.id] : null;
}

function finiteDuration(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds < 86400 ? seconds : 0;
}

function detectAudio(el) {
  if (typeof el.mozHasAudio === "boolean") return el.mozHasAudio;
  if (el.audioTracks && typeof el.audioTracks.length === "number") return el.audioTracks.length > 0;
  if (typeof el.webkitAudioDecodedByteCount === "number" && el.webkitAudioDecodedByteCount > 0) return true;
  // Chrome 在元数据阶段读不到音轨信息（解码前字节数为 0），先按有声音处理，
  // 保证带音轨的视频拖上时间线时一定自动分出音频轨；导出阶段再由后端精确探测
  return true;
}

// 帧率没法从元数据里直接读：播放几帧，用相邻帧 mediaTime 的差值估帧率，
// 23.976 / 29.97 / 59.94 会取整成 24 / 30 / 60；估不出来返回 0（回退 30）
function detectFps(el) {
  return new Promise((resolve) => {
    if (typeof el.requestVideoFrameCallback !== "function") {
      resolve(0);
      return;
    }
    const times = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.pause?.();
      const deltas = [];
      for (let i = 1; i < times.length; i += 1) {
        const delta = times[i] - times[i - 1];
        if (delta > 0.001 && delta < 1) deltas.push(delta);
      }
      if (deltas.length < 2) {
        resolve(0);
        return;
      }
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      const raw = 1 / median;
      resolve(raw >= 5 && raw <= 120 ? Math.round(raw) : 0);
    };
    const onFrame = (now, meta) => {
      times.push(meta.mediaTime);
      if (times.length < 5) el.requestVideoFrameCallback(onFrame);
      else finish();
    };
    el.muted = true;
    const started = el.play();
    if (started?.then) started.then(() => el.requestVideoFrameCallback(onFrame)).catch(finish);
    else finish();
    // 网络慢 / 播放被拦截：最多等 1.5 秒，估不出来就用默认 30
    setTimeout(finish, 1500);
  });
}

function ensureMeta(item) {
  const cached = mediaMeta.value[item.id];
  if (cached) return Promise.resolve(cached);
  if (probing.has(item.id)) return probing.get(item.id);

  const task = new Promise((resolve) => {
    if (item.kind === "image") {
      const image = new Image();
      image.onload = () =>
        resolve({ duration: 0, width: image.naturalWidth, height: image.naturalHeight, hasAudio: false });
      image.onerror = () => resolve({ duration: 0, width: 0, height: 0, hasAudio: false });
      image.src = item.url || item.thumbUrl;
      return;
    }
    if (item.kind === "video") {
      // 只有时间线里还没有视频时才需要探测帧率，后续素材直接复用项目帧率
      const wantFps = !tl.value.tracks.some((track) =>
        track.clips.some((clip) => clipItem(clip)?.kind === "video")
      );
      const el = document.createElement("video");
      el.preload = "metadata";
      el.muted = true;
      el.playsInline = true;
      // 帧率探测要靠 requestVideoFrameCallback 拿到“已上屏”的帧，
      // 元素必须挂在 DOM 上，所以放一个 2px、透明的探针在视口外
      el.style.cssText =
        "position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0.01;pointer-events:none";
      if (wantFps) document.body.appendChild(el);
      let settled = false;
      const finish = (probedFps = 0) => {
        if (settled) return;
        settled = true;
        const meta = {
          duration: finiteDuration(el.duration),
          width: el.videoWidth,
          height: el.videoHeight,
          hasAudio: detectAudio(el),
          fps: probedFps,
        };
        el.pause?.();
        el.remove();
        resolve(meta);
      };
      el.addEventListener(
        "loadedmetadata",
        () => {
          if (!wantFps) {
            finish(0);
            return;
          }
          detectFps(el).then(finish, () => finish(0));
        },
        { once: true }
      );
      el.addEventListener("error", () => finish(0), { once: true });
      setTimeout(() => finish(0), 8000);
      el.src = item.url;
      return;
    }
    const el = document.createElement("audio");
    el.preload = "metadata";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ duration: finiteDuration(el.duration), width: 0, height: 0, hasAudio: true });
    };
    el.addEventListener("loadedmetadata", done, { once: true });
    el.addEventListener("error", done, { once: true });
    setTimeout(done, 8000);
    el.src = item.url;
  }).then((meta) => {
    mediaMeta.value[item.id] = meta;
    probing.delete(item.id);
    return meta;
  });

  probing.set(item.id, task);
  return task;
}

// ---------------------------------------------------------------- 片段数据
function itemById(mediaId) {
  return binItems.value.find((item) => item.id === mediaId) || null;
}

function clipItem(clip) {
  return itemById(clip.mediaId);
}

// 素材从上游连进来时不会经过拖拽落点，这里补上帧率探测：
// 时间线里还没有视频片段时，项目帧率跟着第一个视频素材走
watch(
  binItems,
  (items) => {
    const hasVideoClip = () =>
      tl.value.tracks.some((track) =>
        track.clips.some((clip) => clipItem(clip)?.kind === "video")
      );
    if (hasVideoClip()) return;
    const video = items.find((item) => item.kind === "video");
    if (!video) return;
    ensureMeta(video)
      .then((meta) => {
        if (meta?.fps && !hasVideoClip()) tl.value.fps = meta.fps;
      })
      .catch(() => {});
  },
  { immediate: true }
);

function clipName(clip) {
  return clipItem(clip)?.name || "片段";
}

function binThumb(item) {
  if (!item) return "";
  return item.thumbUrl || item.url || "";
}

// 能安全塞进 <img> 的封面：音频没有可渲染的缩略图，上传中的视频只有 blob 地址，
// 直接塞进 <img> 都会闪出裂图图标，这些情况走文字占位
function binImage(item) {
  if (!item || item.kind === "audio") return "";
  if (item.thumbUrl) return item.thumbUrl;
  if (item.pending) return item.kind === "image" ? item.url || "" : "";
  return item.url || "";
}

// ---------------------------------------------------------------- 素材预览气泡
const PREVIEW_MAX_W = 360;
const PREVIEW_MAX_H = 520;
const binPreview = ref(null);
let binPreviewTimer = 0;

function openBinPreview(event, item) {
  clearTimeout(binPreviewTimer);
  if (!item || item.kind === "audio") return;
  // 视频直接用原片地址，气泡里静音自动播放；图片用缩略图
  const src = item.kind === "video" ? item.url || "" : binImage(item);
  if (!src) return;
  const rect = event.currentTarget.getBoundingClientRect();
  binPreviewTimer = setTimeout(() => {
    binPreview.value = {
      kind: item.kind,
      src,
      poster: item.thumbUrl || "",
      name: item.name || "",
      x: 0,
      y: 0,
      width: PREVIEW_MAX_W,
      height: PREVIEW_MAX_W,
      ready: false,
      anchor: { left: rect.left, right: rect.right, top: rect.top, height: rect.height },
    };
  }, 220);
}

// 媒体就绪后按真实宽高比定气泡尺寸：最长边 360、最高 520
function fitBinPreview(event) {
  const card = binPreview.value;
  const el = event.currentTarget;
  if (!card || !el) return;
  const width = el.videoWidth || el.naturalWidth || 0;
  const height = el.videoHeight || el.naturalHeight || 0;
  if (!width || !height) return;
  const scale = Math.min(1, PREVIEW_MAX_W / width, PREVIEW_MAX_H / height);
  placeBinPreview(Math.round(width * scale), Math.round(height * scale));
}

// 优先放右侧，放不下翻到左侧，再夹在视口内；高度按素材比例，上限 520
function placeBinPreview(width, height) {
  const anchor = binPreview.value?.anchor;
  if (!anchor) return;
  const gap = 12;
  const maxTop = window.innerHeight - height - 8;
  let x = anchor.right + gap;
  if (x + width > window.innerWidth - 8) x = anchor.left - width - gap;
  x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const y = Math.max(8, Math.min(anchor.top + anchor.height / 2 - height / 2, maxTop));
  binPreview.value = { ...binPreview.value, x, y, width, height, ready: true };
}

function closeBinPreview() {
  clearTimeout(binPreviewTimer);
  binPreview.value = null;
}

function clipThumb(clip) {
  return binThumb(clipItem(clip));
}

function kindLabel(kind) {
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  return "图片";
}

function onThumbError() {
  // 缩略图失败时保留底色，不影响拖拽
}

function trackOf(clip) {
  return tl.value.tracks.find((track) => track.clips.some((item) => item.id === clip.id)) || null;
}

function linkedGroup(clip) {
  if (!clip?.linkId) return [clip];
  const group = [];
  for (const track of tl.value.tracks) {
    for (const item of track.clips) {
      if (item.linkId === clip.linkId) group.push(item);
    }
  }
  return group.length ? group : [clip];
}

function trackAccepts(track, kind) {
  if (track.kind === "audio") return kind === "audio" || kind === "video";
  return kind === "image" || kind === "video";
}

// 所有时间一律对齐整帧：拖拽、裁剪、吸附、分割之后都不会出现半帧
function roundTime(value) {
  return roundToFrame(value, fps.value);
}

function snapTime(value, ignoreIds) {
  const threshold = 7 / pps.value;
  let best = value;
  let bestGap = threshold;
  const candidates = [0, playhead.value];
  for (const { clip } of allClips.value) {
    if (ignoreIds?.has(clip.id)) continue;
    candidates.push(clip.start, clip.start + clipLength(clip));
  }
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return roundTime(best);
}

// 播放头吸附：拖动时贴近片段首尾和 0 秒，方便精确对齐剪辑点
function snapPlayhead(value) {
  const threshold = 7 / pps.value;
  let best = value;
  let bestGap = threshold;
  const candidates = [0];
  for (const { clip } of allClips.value) {
    candidates.push(clip.start, clip.start + clipLength(clip));
  }
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return roundTime(best);
}

// 视频轨不允许重叠：依次与已占用区间比较，被挡住就顺延到它后面
function settleOverlap(track, clip) {
  if (track.kind !== "video") return;
  for (let guard = 0; guard < 200; guard += 1) {
    const hit = track.clips.find(
      (other) =>
        other.id !== clip.id &&
        clip.start < other.start + clipLength(other) &&
        clip.start + clipLength(clip) > other.start
    );
    if (!hit) return;
    clip.start = roundTime(hit.start + clipLength(hit));
  }
}

function clipStyle(clip) {
  return {
    left: `${clip.start * pps.value}px`,
    width: `${Math.max(8, clipLength(clip) * pps.value)}px`,
  };
}

// 覆盖式落点：把被 [start, end) 压住的片段裁成应有的样子（完全盖住就删除，
// 压住一头就裁掉那一头，压在中间就裂成两段）。链接组（视频 + 自动分出的音频）
// 整体处理，所以裁完之后仍然音画对齐。
function overwriteRange(trackIds, start, end, keepIds) {
  const eps = 1e-4;
  const minLen = 0.5 / fps.value;
  const groups = [];
  const seen = new Set();

  for (const trackId of trackIds) {
    const track = tl.value.tracks.find((entry) => entry.id === trackId);
    if (!track) continue;
    for (const clip of track.clips) {
      if (keepIds?.has(clip.id)) continue;
      const clipEnd = clip.start + clipLength(clip);
      if (clipEnd <= start + eps || clip.start >= end - eps) continue;
      const key = clip.linkId || `solo:${clip.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push(linkedGroup(clip));
    }
  }

  for (const group of groups) {
    const head = group[0];
    const s = head.start;
    const e = head.start + clipLength(head);
    // 不足一帧的残段直接丢掉，避免留下点不到的碎片
    const keepLeft = s < start - eps && start - s >= minLen;
    const keepRight = e > end + eps && e - end >= minLen;

    if (!keepLeft && !keepRight) {
      const ids = new Set(group.map((clip) => clip.id));
      for (const track of tl.value.tracks) {
        track.clips = track.clips.filter((clip) => !ids.has(clip.id));
      }
      continue;
    }

    if (keepLeft && !keepRight) {
      for (const clip of group) clip.out = roundTime(clip.in + (start - s));
      continue;
    }

    if (!keepLeft && keepRight) {
      for (const clip of group) {
        clip.start = roundTime(end);
        clip.in = roundTime(clip.in + (end - s));
      }
      continue;
    }

    // 中间被压住：左半保留，右半复制成新片段并共用新的 linkId
    const newLink = head.linkId ? `l${Math.random().toString(36).slice(2, 8)}` : null;
    const rights = [];
    for (const clip of group) {
      const track = trackOf(clip);
      rights.push({
        track,
        clip: {
          id: newClipId(),
          mediaId: clip.mediaId,
          start: roundTime(end),
          in: roundTime(clip.in + (end - s)),
          out: clip.out,
          linkId: newLink,
        },
      });
      clip.out = roundTime(clip.in + (start - s));
    }
    for (const { track, clip } of rights) {
      if (track) track.clips.push(clip);
    }
  }
}

// ---------------------------------------------------------------- 添加片段
async function dropItem(item, trackId, time) {
  const track = tl.value.tracks.find((entry) => entry.id === trackId);
  if (!track || !trackAccepts(track, item.kind)) return;
  const meta = await ensureMeta(item);
  if (!meta) return;

  graph?.captureUndo?.(true);

  // 项目尺寸跟随第一个素材
  if (!allClips.value.length && meta.width && meta.height) {
    tl.value.width = meta.width;
    tl.value.height = meta.height;
  }

  // 项目帧率跟随第一个视频；后面的素材按时间重采样，不再改项目帧率
  if (meta.fps) tl.value.fps = meta.fps;

  const length =
    item.kind === "image" ? IMAGE_CLIP_LENGTH : Math.max(0.2, meta.duration || IMAGE_CLIP_LENGTH);
  const start = snapTime(roundTime(time ?? playhead.value), null);
  const end = roundTime(start + length);

  const makeClip = (linkId) => ({
    id: newClipId(),
    mediaId: item.id,
    start,
    in: 0,
    out: roundTime(length),
    linkId,
  });

  // 视频落到音频轨：只取它的声音
  if (track.kind === "audio") {
    const clip = makeClip(null);
    track.clips.push(clip);
    selectedClipId.value = clip.id;
    // 覆盖落点：同一条轨道上被压住的部分裁掉，不再往后顺延
    overwriteRange([track.id], start, end, new Set([clip.id]));
    focusEditor();
    syncAll(playhead.value);
    scheduleDraw();
    return;
  }

  const videoClip = makeClip(null);
  track.clips.push(videoClip);
  const keepIds = new Set([videoClip.id]);
  const coverTracks = [track.id];

  // 带音轨的视频自动在配对的音频轨生成片段：V2 → A2，V1 → A1
  if (item.kind === "video" && meta.hasAudio) {
    const audioId = track.id === "v2" ? "a2" : "a1";
    const audioTrack =
      tl.value.tracks.find((entry) => entry.id === audioId) ||
      tl.value.tracks.find((entry) => entry.kind === "audio");
    if (audioTrack) {
      const linkId = `l${Math.random().toString(36).slice(2, 8)}`;
      const audioClip = {
        id: newClipId(),
        mediaId: item.id,
        start,
        in: 0,
        out: roundTime(length),
        linkId,
      };
      videoClip.linkId = linkId;
      audioTrack.clips.push(audioClip);
      keepIds.add(audioClip.id);
      coverTracks.push(audioTrack.id);
    }
  }

  // 新片段停在落点，把目标轨 / 配对音频轨上被覆盖的旧内容裁掉
  overwriteRange(coverTracks, start, end, keepIds);

  selectedClipId.value = videoClip.id;
  focusEditor();
  syncAll(playhead.value);
  scheduleDraw();
}

function addAtPlayhead(item) {
  const meta = mediaOfKind(item);
  const track = meta || tl.value.tracks.find((entry) => entry.kind === "video");
  if (track) dropItem(item, track.id, playhead.value);
}

function mediaOfKind(item) {
  if (item.kind === "audio") return tl.value.tracks.find((entry) => entry.kind === "audio");
  return tl.value.tracks.find((entry) => entry.kind === "video");
}

// 从外部拖入 / 点加号上传，走节点已有的上传队列，素材会进入 data.media
function pickFiles() {
  fileEl.value?.click();
}

function onFilesPicked(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (files.length) graph?.appendMedia?.(props.nodeId, files);
}

// ---------------------------------------------------------------- 素材池拖拽
function startBinDrag(item, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  suppressCanvasClick();
  closeBinPreview();
  // 先把元数据探出来，拖拽时的落点预览才能显示真实时长
  ensureMeta(item).catch(() => {});
  ghost.value = { item, x: event.clientX, y: event.clientY };
  const move = (moveEvent) => {
    ghost.value = { item, x: moveEvent.clientX, y: moveEvent.clientY };
    updateDropHints(item, moveEvent);
  };
  const up = (upEvent) => {
    window.removeEventListener("pointermove", move);
    ghost.value = null;
    dropHints.value = [];
    const point = dropPointAt(upEvent.clientX, upEvent.clientY);
    if (!point) return;
    dropItem(item, point.track.id, point.time);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

// 指针落点：优先命中轨道行；拖到轨道左侧（标签区 / 轨道起点之前的留白）时，
// 按纵向位置找到对应轨道，并把时间归到 0，避免想放在开头却丢失落点
function dropPointAt(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const hit = element instanceof Element ? element.closest("[data-track-id]") : null;
  let row = hit;
  let rect = row ? row.getBoundingClientRect() : null;
  if (!row && editorEl.value) {
    for (const candidate of editorEl.value.querySelectorAll("[data-track-id]")) {
      const box = candidate.getBoundingClientRect();
      if (clientY >= box.top && clientY <= box.bottom) {
        row = candidate;
        rect = box;
        break;
      }
    }
  }
  if (!row || !rect) return null;
  const track = tl.value.tracks.find((entry) => entry.id === row.dataset.trackId);
  if (!track) return null;
  const time =
    clientX <= rect.left ? 0 : (clientX - rect.left) / (pps.value * viewScale.value);
  return { track, rect, time };
}

function hintLength(item) {
  if (item.kind === "image") return IMAGE_CLIP_LENGTH;
  const meta = mediaMeta.value[item.id];
  return meta?.duration || IMAGE_CLIP_LENGTH;
}

// 拖拽时的落点预览：目标轨道显示将要放置的区间，视频还会在配对音频轨显示
function updateDropHints(item, event) {
  const point = dropPointAt(event.clientX, event.clientY);
  if (!point || !trackAccepts(point.track, item.kind)) {
    dropHints.value = [];
    return;
  }
  const track = point.track;
  const trackId = track.id;
  const start = snapTime(Math.max(0, point.time), null);
  const length = hintLength(item);
  const hints = [{ trackId, start, length }];
  if (item.kind === "video" && track.kind === "video") {
    const audioId = track.id === "v2" ? "a2" : "a1";
    if (tl.value.tracks.some((entry) => entry.id === audioId)) {
      hints.push({ trackId: audioId, start, length });
    }
  }
  dropHints.value = hints;
}

// ---------------------------------------------------------------- 片段拖动 / 裁剪
let drag = null;

function selectClip(clip) {
  selectedClipId.value = clip.id;
  editorEl.value?.focus?.({ preventScroll: true });
}

function startClipDrag(clip, track, mode, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  suppressCanvasClick();
  selectClip(clip);
  graph?.captureUndo?.(true);
  const group = linkedGroup(clip);
  const trackMap = new Map();
  for (const member of group) trackMap.set(member.id, trackOf(member));
  const origin = new Map();
  for (const member of group) {
    origin.set(member.id, { start: member.start, in: member.in, out: member.out });
  }
  drag = {
    mode,
    clip,
    track,
    startX: event.clientX,
    startY: event.clientY,
    origin,
    group,
    trackMap,
    ids: new Set(group.map((member) => member.id)),
    length: clipLength(clip),
    // 移动模式下先只记录目标位置、显示落点预览，松手才真正落位并覆盖
    moved: false,
    plan: null,
    targetStart: null,
  };
  window.addEventListener("pointermove", onClipMove);
  window.addEventListener("pointerup", endClipDrag);
}

function onClipMove(event) {
  if (!drag) return;
  const dx = (event.clientX - drag.startX) / (pps.value * viewScale.value);

  if (drag.mode === "move") {
    // 没真正移动就当成单击：松手时把播放头放到片段开头
    if (!drag.moved) {
      const far =
        Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;
      if (!far) return;
      drag.moved = true;
    }
    const origin = drag.origin.get(drag.clip.id);
    const minStart = Math.min(
      ...drag.group.map((member) => drag.origin.get(member.id).start)
    );
    const delta = Math.max(dx, -minStart);
    const desired = roundTime(origin.start + delta);
    const point = dropPointAt(event.clientX, event.clientY);
    // 拖到轨道起点左侧（标签区 / 轨道前留白）时按 0 秒落位
    const atStart = !!point && event.clientX <= point.rect.left;
    const start = atStart ? 0 : Math.max(0, snapTime(desired, drag.ids));
    drag.targetStart = start;
    drag.plan = point ? moveTrackPlan(point.track) : null;
    // 落点预览沿用拖拽素材时的样式：目标轨（视频还会带上配对音频轨）
    dropHints.value = drag.plan
      ? [...new Set(drag.plan.values())].map((trackId) => ({
          trackId,
          start,
          length: drag.length,
        }))
      : [];
    return;
  }

  const origin = drag.origin.get(drag.clip.id);
  const minimum = 0.1;

  if (drag.mode === "trim-l") {
    let delta = Math.max(dx, -origin.in, -origin.start);
    delta = Math.min(delta, drag.length - minimum);
    const snapped = snapTime(origin.start + delta, drag.ids);
    delta = Math.min(Math.max(snapped - origin.start, -origin.in, -origin.start), drag.length - minimum);
    // 视频轨不能盖住左边的片段
    const videoTrack = drag.trackMap.get(drag.clip.id);
    if (videoTrack?.kind === "video") {
      const previousEnd = previousClipEnd(videoTrack, drag.ids, origin.start);
      if (origin.start + delta < previousEnd) delta = previousEnd - origin.start;
    }
    for (const member of drag.group) {
      const base = drag.origin.get(member.id);
      member.start = roundTime(base.start + delta);
      member.in = roundTime(base.in + delta);
    }
    return;
  }

  // trim-r：限制在源素材时长与轨道右侧相邻片段之间
  let delta = Math.max(dx, minimum - drag.length);
  const sourceLimit = clipSourceLimit(drag.clip);
  if (sourceLimit) delta = Math.min(delta, sourceLimit - origin.out);

  const snappedEnd = snapTime(origin.start + origin.out + delta, drag.ids);
  delta = snappedEnd - (origin.start + origin.out);
  if (sourceLimit) delta = Math.min(delta, sourceLimit - origin.out);

  for (const member of drag.group) {
    const base = drag.origin.get(member.id);
    member.out = roundTime(base.out + delta);
  }

  // 结束后再按各轨道右侧邻居收一次，避免拖出重叠
  for (const member of drag.group) {
    const track = drag.trackMap.get(member.id);
    if (!track || track.kind !== "video") continue;
    const nextStart = nextClipStart(track, drag.ids, member.start);
    if (nextStart < Infinity && member.start + clipLength(member) > nextStart) {
      member.out = roundTime(member.in + Math.max(minimum, nextStart - member.start));
    }
  }
}

// 源素材最长能拉到多少（秒）；图片给一个上限，避免无限拉长
function clipSourceLimit(clip) {
  const item = clipItem(clip);
  if (!item) return 0;
  if (item.kind === "image") return IMAGE_MAX_LENGTH;
  const meta = mediaMeta.value[item.id];
  return meta?.duration || 0;
}

function nextClipStart(track, ignoreIds, afterStart) {
  let next = Infinity;
  for (const other of track.clips) {
    if (ignoreIds?.has(other.id)) continue;
    if (other.start >= afterStart - 0.001) next = Math.min(next, other.start);
  }
  return next;
}

function previousClipEnd(track, ignoreIds, beforeStart) {
  let end = 0;
  for (const other of track.clips) {
    if (ignoreIds?.has(other.id)) continue;
    const otherEnd = other.start + clipLength(other);
    if (otherEnd <= beforeStart + 0.001) end = Math.max(end, otherEnd);
  }
  return end;
}

// 移动片段的目标轨道：视频组里视频进目标视频轨，链接的音频跟到配对音频轨；
// 从音频轨拖起时反过来，视频跟着到配对视频轨。拖到不兼容的轨道上视为无效
function moveTrackPlan(targetTrack) {
  if (!targetTrack) return null;
  const grabbed = drag.trackMap.get(drag.clip.id);
  if (!grabbed) return null;
  const plan = new Map();
  if (grabbed.kind === "audio") {
    if (targetTrack.kind !== "audio") return null;
    const pairedVideo = trackById(targetTrack.id === "a2" ? "v2" : "v1");
    for (const member of drag.group) {
      const memberTrack = drag.trackMap.get(member.id);
      if (!memberTrack) return null;
      if (memberTrack.kind === "audio") plan.set(member.id, targetTrack.id);
      else {
        if (!pairedVideo) return null;
        plan.set(member.id, pairedVideo.id);
      }
    }
    return plan;
  }
  if (targetTrack.kind !== "video") return null;
  const pairedAudio = trackById(targetTrack.id === "v2" ? "a2" : "a1");
  for (const member of drag.group) {
    const memberTrack = drag.trackMap.get(member.id);
    if (!memberTrack) return null;
    if (memberTrack.kind === "audio") {
      if (!pairedAudio) return null;
      plan.set(member.id, pairedAudio.id);
    } else {
      plan.set(member.id, targetTrack.id);
    }
  }
  return plan;
}

function trackById(id) {
  return tl.value.tracks.find((entry) => entry.id === id) || null;
}

// 松手后真正落位：整组移动到目标轨道 / 目标时间，再把压住的旧片段裁掉（向前向后都覆盖）
function applyClipMove(state) {
  const base = state.origin.get(state.clip.id).start;
  const delta = state.targetStart - base;
  for (const member of state.group) {
    const from = state.trackMap.get(member.id);
    const to = trackById(state.plan.get(member.id));
    const origin = state.origin.get(member.id);
    if (!from || !to || !origin) continue;
    member.start = roundTime(origin.start + delta);
    if (from.id !== to.id) {
      from.clips = from.clips.filter((clip) => clip.id !== member.id);
      to.clips.push(member);
    }
  }
  const end = roundTime(state.targetStart + state.length);
  const keepIds = new Set(state.group.map((member) => member.id));
  overwriteRange([...new Set(state.plan.values())], state.targetStart, end, keepIds);
}

// 单击片段：播放头到片段开头；400ms 内在同一片段上再点一次：到片段末尾
let lastClick = { clipId: "", time: 0 };

function endClipDrag() {
  const state = drag;
  drag = null;
  window.removeEventListener("pointermove", onClipMove);
  window.removeEventListener("pointerup", endClipDrag);
  if (state?.mode === "move") {
    if (state.moved && state.plan) applyClipMove(state);
    else if (!state.moved) {
      const now = performance.now();
      const again = lastClick.clipId === state.clip.id && now - lastClick.time < 400;
      lastClick = { clipId: state.clip.id, time: again ? 0 : now };
      setPlayheadTime(state.clip.start + (again ? state.length : 0));
    }
  }
  dropHints.value = [];
  syncAll(playhead.value);
  scheduleDraw();
}

// ---------------------------------------------------------------- 删除 / 分割 / 解锁
function removeSelected() {
  const clip = selectedClip.value;
  if (!clip) return;
  graph?.captureUndo?.(true);
  const ids = new Set(linkedGroup(clip).map((member) => member.id));
  for (const track of tl.value.tracks) {
    track.clips = track.clips.filter((member) => !ids.has(member.id));
  }
  selectedClipId.value = "";
  syncAll(playhead.value);
  scheduleDraw();
}

function splitAtPlayhead() {
  const clip = selectedClip.value;
  if (!clip) return;
  const time = playhead.value;
  const offset = time - clip.start;
  const minLen = 1 / fps.value;
  if (offset < minLen - 1e-6 || clipLength(clip) - offset < minLen - 1e-6) return;

  graph?.captureUndo?.(true);
  const group = linkedGroup(clip);
  const newLinkId = group.length > 1 ? `l${Math.random().toString(36).slice(2, 8)}` : null;
  for (const member of group) {
    const track = trackOf(member);
    if (!track) continue;
    const right = {
      id: newClipId(),
      mediaId: member.mediaId,
      start: roundTime(time),
      in: roundTime(member.in + offset),
      out: member.out,
      linkId: newLinkId,
    };
    member.out = roundTime(member.in + offset);
    track.clips.push(right);
    settleOverlap(track, right);
  }
  syncAll(playhead.value);
  scheduleDraw();
}

function unlink(clip) {
  const group = linkedGroup(clip);
  if (group.length < 2) return;
  graph?.captureUndo?.(true);
  for (const member of group) member.linkId = null;
}

// ---------------------------------------------------------------- 播放头
function timeFromClientX(element, clientX) {
  return (clientX - element.getBoundingClientRect().left) / (pps.value * viewScale.value);
}

function setPlayheadTime(time) {
  const clamped = Math.min(contentSeconds.value, Math.max(0, time));
  playhead.value = roundTime(clamped);
}

function focusEditor() {
  editorEl.value?.focus?.({ preventScroll: true });
}

// 时间线内部拖动（播放头 / 片段 / 素材）松手落在画布上时，浏览器会把 click 派给
// Vue Flow 的空白处，节点被取消选中、浮动预览跟着消失。这里拦掉紧随其后的一次 click
function suppressCanvasClick() {
  const stop = (event) => {
    window.removeEventListener("click", stop, true);
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", stop, true);
  window.addEventListener(
    "pointerup",
    (upEvent) => {
      // 松手还在节点里就是普通点击，撤销拦截
      if (editorEl.value?.contains(upEvent.target)) {
        window.removeEventListener("click", stop, true);
        return;
      }
      setTimeout(() => window.removeEventListener("click", stop, true), 0);
    },
    { once: true, capture: true }
  );
}

function startScrub(event) {
  focusEditor();
  suppressCanvasClick();
  const rail = event.currentTarget;
  const move = (moveEvent) =>
    setPlayheadTime(snapPlayhead(timeFromClientX(rail, moveEvent.clientX)));
  setPlayheadTime(snapPlayhead(timeFromClientX(rail, event.clientX)));
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), {
    once: true,
  });
}

function onTrackBlankDown(track, event) {
  if (event.target !== event.currentTarget) return;
  focusEditor();
  selectedClipId.value = "";
  setPlayheadTime(snapPlayhead(timeFromClientX(event.currentTarget, event.clientX)));
}

// ---------------------------------------------------------------- 预览
const videoEls = new Map();
const imageEls = new Map();
let drawRaf = 0;
let widthObserver = null;

function topVideoClipAt(time) {
  for (const track of tl.value.tracks) {
    if (track.kind !== "video") continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clipLength(clip)) return clip;
    }
  }
  return null;
}

function imageFor(item) {
  let image = imageEls.get(item.id);
  if (!image) {
    image = new Image();
    image.onload = scheduleDraw;
    image.src = item.url || item.thumbUrl;
    imageEls.set(item.id, image);
  }
  return image;
}

function videoFor(item) {
  let el = videoEls.get(item.id);
  if (!el) {
    el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    el.src = item.url;
    el.addEventListener("seeked", scheduleDraw);
    el.addEventListener("loadeddata", scheduleDraw);
    videoEls.set(item.id, el);
  }
  return el;
}

function drawContain(ctx, source, width, height, cw, ch) {
  if (!width || !height) return;
  const scale = Math.min(cw / width, ch / height);
  const w = width * scale;
  const h = height * scale;
  ctx.drawImage(source, (cw - w) / 2, (ch - h) / 2, w, h);
}

// 同一个时间点可以画到节点上方的小预览，也可以画到全屏浮层的大预览
function drawInto(canvas, time) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const clip = topVideoClipAt(time);
  const item = clip ? clipItem(clip) : null;
  let source = null;
  let sourceW = 0;
  let sourceH = 0;

  if (item?.kind === "video") {
    const el = videoFor(item);
    // seek 过程中 readyState 会掉回 1、画面还不可用：这时先保留上一帧，
    // 等 seeked 再重画。否则快速换帧 / 拖播放头时画布会闪一下黑
    if (el.seeking || el.readyState < 2 || !el.videoWidth) return;
    source = el;
    sourceW = el.videoWidth;
    sourceH = el.videoHeight;
  } else if (item) {
    const image = imageFor(item);
    if (!image.complete || !image.naturalWidth) return;
    source = image;
    sourceW = image.naturalWidth;
    sourceH = image.naturalHeight;
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (source) drawContain(ctx, source, sourceW, sourceH, canvas.width, canvas.height);
}

function draw(time) {
  drawInto(previewEl.value, time);
  if (fullscreen.value) drawInto(fsCanvasEl.value, time);
}

function scheduleDraw() {
  if (drawRaf) return;
  drawRaf = requestAnimationFrame(() => {
    drawRaf = 0;
    draw(playhead.value);
  });
}

// ---------------------------------------------------------------- 媒体同步
// 播放时以 performance.now 为主时钟，媒体元素只做小幅速率纠偏（视频静音、音频保持音调），
// 漂移超过阈值才 seek，避免频繁跳帧和咔哒声
const AUDIO_LEAD = 0.12;
// 音频元素按片段缓存：同一素材在时间线上出现多次时，各段独立走时间
const audioEls = new Map();

function seekTo(el, time) {
  try {
    el.currentTime = Math.max(0, time);
  } catch {
    // 元数据还没就绪，下一帧再试
  }
}

// drift = 实际位置 − 目标位置：超前就放慢，落后就加快
function correctRate(el, drift) {
  if (Math.abs(drift) < 0.04) {
    if (el.playbackRate !== 1) el.playbackRate = 1;
    return;
  }
  const rate = Math.min(1.08, Math.max(0.92, 1 - drift * 0.4));
  if (Math.abs(el.playbackRate - rate) > 0.005) el.playbackRate = rate;
}

// 视频：只同步当前时间点附近的素材，避免所有素材同时解码
function syncVideo(time) {
  const active = new Map();
  for (const track of tl.value.tracks) {
    if (track.kind !== "video") continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clipLength(clip)) {
        active.set(clip.mediaId, clip);
      }
    }
  }
  for (const [id, el] of videoEls) {
    const clip = active.get(id);
    if (!clip) {
      if (!el.paused) el.pause();
      continue;
    }
    const target = clip.in + (time - clip.start);
    if (!playing.value) {
      el.playbackRate = 1;
      if (Math.abs(el.currentTime - target) > 0.02) seekTo(el, target);
      if (!el.paused) el.pause();
      continue;
    }
    if (el.readyState < 2) continue;
    const drift = el.currentTime - target;
    if (Math.abs(drift) > 0.3) {
      seekTo(el, target);
      el.playbackRate = 1;
    } else {
      correctRate(el, drift);
    }
    if (el.paused) el.play?.().catch(() => {});
  }
}

function audioEntryFor(clip) {
  const item = clipItem(clip);
  if (!item || !item.url) return null;
  let entry = audioEls.get(clip.id);
  if (entry && entry.mediaId === clip.mediaId) return entry;
  if (entry) {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load?.();
  }
  const el = document.createElement("audio");
  el.preload = "auto";
  el.src = item.url;
  entry = { el, mediaId: clip.mediaId };
  audioEls.set(clip.id, entry);
  return entry;
}

// 音频：音频轨上的片段（独立音频文件或视频拆出来的声音）按时间点对位播放
function syncAudio(time) {
  const live = new Set();
  const existing = new Set();
  for (const track of tl.value.tracks) {
    if (track.kind !== "audio") continue;
    for (const clip of track.clips) {
      existing.add(clip.id);
      const end = clip.start + clipLength(clip);
      // 起播前留一点提前量，先把位置摆好，到点直接出声
      if (time < clip.start - AUDIO_LEAD || time >= end) continue;
      const entry = audioEntryFor(clip);
      if (!entry) continue;
      const { el } = entry;

      if (time < clip.start) {
        if (playing.value && el.readyState >= 2) {
          live.add(clip.id);
          if (el.paused && Math.abs(el.currentTime - clip.in) > 0.02) seekTo(el, clip.in);
        }
        continue;
      }

      live.add(clip.id);
      const target = Math.max(0, clip.in + (time - clip.start));
      if (!playing.value) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.02) seekTo(el, target);
        continue;
      }
      if (el.readyState < 2) continue;
      const drift = el.currentTime - target;
      if (Math.abs(drift) > 0.25) {
        seekTo(el, target);
        el.playbackRate = 1;
      } else {
        correctRate(el, drift);
      }
      if (el.paused) el.play().catch(() => {});
    }
  }
  // 离开区间的音频一律静音，避免换段后旧声音还在响；片段被删掉的就回收掉
  for (const [id, entry] of audioEls) {
    if (!existing.has(id)) {
      entry.el.pause();
      entry.el.removeAttribute("src");
      audioEls.delete(id);
      continue;
    }
    if (!live.has(id) && !entry.el.paused) entry.el.pause();
  }
}

function syncAll(time) {
  syncVideo(time);
  syncAudio(time);
}

watch(
  playhead,
  (time) => {
    if (!playing.value) {
      syncAll(time);
      scheduleDraw();
    }
  },
  { flush: "post" }
);

watch(() => [tl.value.width, tl.value.height], sizeCanvas);

function sizeCanvas() {
  const canvas = previewEl.value;
  if (!canvas) return;
  canvas.width = Math.max(2, Number(tl.value.width) || 1280);
  canvas.height = Math.max(2, Number(tl.value.height) || 720);
  sizeFsCanvas();
  scheduleDraw();
}

// 全屏画布按项目分辨率做后备缓冲，显示尺寸由 CSS 约束（保持比例、不超出屏幕）
function sizeFsCanvas() {
  const canvas = fsCanvasEl.value;
  if (!canvas) return;
  canvas.width = Math.max(2, Number(tl.value.width) || 1280);
  canvas.height = Math.max(2, Number(tl.value.height) || 720);
  scheduleDraw();
}

onMounted(() => {
  sizeCanvas();
  syncAll(playhead.value);
  document.addEventListener("visibilitychange", onVisibilityChange);
  // 之前有没跑完的导出：接着轮询
  const session = exportSessions.get(props.nodeId);
  if (session?.jobId && session.state?.status === "running") {
    exportJobId = session.jobId;
    exportState.value = { ...session.state };
    pollExport();
  }
  if (scrollEl.value) {
    availableWidth.value = scrollEl.value.clientWidth;
    widthObserver = new ResizeObserver(() => {
      if (scrollEl.value) availableWidth.value = scrollEl.value.clientWidth;
    });
    widthObserver.observe(scrollEl.value);
  }
});

// 标签页切到后台时 rAF 会被暂停，但音频还在播；直接停下，回来不会音画错位
function onVisibilityChange() {
  if (document.hidden && playing.value) stopPlayback();
}

// 取消选中节点时收起预览，同时停止播放，避免看不见画面还在跑
watch(
  () => props.active,
  (value) => {
    if (!value) {
      if (fullscreen.value) exitFullscreen();
      if (playing.value) stopPlayback();
      return;
    }
    nextTick(() => {
      sizeCanvas();
      syncAll(playhead.value);
    });
  }
);

// ---------------------------------------------------------------- 播放
let rafId = 0;
let baseTime = 0;
let basePlayhead = 0;

function togglePlay() {
  if (playing.value) stopPlayback();
  else startPlayback();
}

function startPlayback() {
  if (totalDuration.value <= 0) return;
  if (playhead.value >= totalDuration.value - 0.05) playhead.value = 0;
  playing.value = true;
  basePlayhead = playhead.value;
  baseTime = performance.now();
  // 在用户手势的调用栈里先把音频拉起来，避免自动播放策略拦掉后面的 play()
  syncAll(playhead.value);
  scheduleDraw();
  const tick = () => {
    if (!playing.value) return;
    playhead.value = basePlayhead + (performance.now() - baseTime) / 1000;
    if (playhead.value >= totalDuration.value) {
      playhead.value = totalDuration.value;
      stopPlayback();
      return;
    }
    syncAll(playhead.value);
    scheduleDraw();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  playing.value = false;
  cancelAnimationFrame(rafId);
  for (const el of videoEls.values()) el.pause?.();
  for (const entry of audioEls.values()) entry.el.pause();
  syncAll(playhead.value);
  scheduleDraw();
}

// ---------------------------------------------------------------- 全屏预览
const fullscreen = ref(false);
// 是否真的进了浏览器原生全屏：iframe 未开 allowfullscreen 时会失败，退化为铺满窗口的浮层
let nativeFs = false;

async function enterFullscreen() {
  if (fullscreen.value) return;
  fullscreen.value = true;
  await nextTick();
  sizeFsCanvas();
  scheduleDraw();
  window.addEventListener("keydown", onFullscreenKey, true);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  const el = fsEl.value;
  if (el?.requestFullscreen) {
    try {
      await el.requestFullscreen();
      nativeFs = true;
    } catch {
      nativeFs = false;
    }
  }
}

function exitFullscreen() {
  if (!fullscreen.value) return;
  fullscreen.value = false;
  nativeFs = false;
  window.removeEventListener("keydown", onFullscreenKey, true);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  focusEditor();
}

// 用户用浏览器自身的 Esc 退出原生全屏时，浮层也一起关掉
function onFullscreenChange() {
  if (!document.fullscreenElement && nativeFs) {
    nativeFs = false;
    fullscreen.value = false;
    window.removeEventListener("keydown", onFullscreenKey, true);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    focusEditor();
  }
}

// 全屏浮层挂在 body 上，编辑器自身的按键收不到，单独监听
function onFullscreenKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    exitFullscreen();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    togglePlay();
  }
}

// ---------------------------------------------------------------- 导出
// 后端合成 MP4（2 视频轨 + 2 音频轨），这里负责提交任务、轮询进度，
// 完成后把产物作为媒体派生一个下游节点
const exportState = ref({ status: "idle", progress: 0, stage: "", message: "" });
let exportJobId = "";
let exportTimer = 0;

const exportTitle = computed(() => {
  const state = exportState.value;
  if (state.status === "running") {
    return `${state.stage || "导出中"} ${Math.round(state.progress * 100)}% · 点击取消`;
  }
  if (state.status === "error") return state.message || "导出失败";
  if (state.status === "done") return "已导出并生成下游节点";
  return "导出 MP4";
});

function buildExportPayload() {
  const tracks = [];
  let missing = "";
  for (const track of tl.value.tracks) {
    const clips = [];
    for (const clip of track.clips) {
      const item = clipItem(clip);
      if (!item) continue;
      if (!item.ref?.filename) {
        missing = missing || clipName(clip);
        continue;
      }
      clips.push({
        id: clip.id,
        kind: item.kind,
        name: item.name,
        start: clip.start,
        in: clip.in,
        out: clip.out,
        ref: {
          filename: item.ref.filename,
          subfolder: item.ref.subfolder || "",
          type: item.ref.type || "input",
        },
      });
    }
    tracks.push({ kind: track.kind, clips });
  }
  return {
    payload: {
      width: Number(tl.value.width) || 1280,
      height: Number(tl.value.height) || 720,
      fps: Number(tl.value.fps) || 30,
      tracks,
    },
    missing,
  };
}

function stopExportPoll() {
  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = 0;
}

function toggleExport() {
  if (exportState.value.status === "running") cancelExport();
  else startExport();
}

async function startExport() {
  if (exportState.value.status === "running" || !totalDuration.value) return;
  const { payload, missing } = buildExportPayload();
  if (missing) {
    exportState.value = {
      status: "error",
      progress: 0,
      stage: "",
      message: `素材还没上传完成：${missing}`,
    };
    return;
  }
  if (!payload.tracks.some((track) => track.clips.length)) {
    exportState.value = { status: "error", progress: 0, stage: "", message: "时间线是空的" };
    return;
  }

  exportState.value = { status: "running", progress: 0, stage: "提交中", message: "" };
  try {
    const response = await fetch("/infinite_canvas/api/timeline/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.jobId) throw new Error(data?.error || "导出任务创建失败");
    exportJobId = data.jobId;
    pollExport();
  } catch (error) {
    exportState.value = {
      status: "error",
      progress: 0,
      stage: "",
      message: error?.message || "导出任务创建失败",
    };
  }
}

function pollExport() {
  stopExportPoll();
  exportTimer = setTimeout(async () => {
    if (!exportJobId) return;
    const jobId = exportJobId;
    try {
      const response = await fetch(`/infinite_canvas/api/timeline/export/${jobId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "获取导出进度失败");

      if (data.status === "running") {
        exportState.value = {
          status: "running",
          progress: Number(data.progress) || 0,
          stage: data.stage || "导出中",
          message: "",
        };
        pollExport();
        return;
      }
      exportJobId = "";
      if (data.status === "done") {
        finishExport(data.result);
        return;
      }
      if (data.status === "cancelled") {
        exportState.value = { status: "idle", progress: 0, stage: "", message: "" };
        return;
      }
      exportState.value = {
        status: "error",
        progress: 0,
        stage: "",
        message: data.error || "导出失败",
      };
    } catch (error) {
      stopExportPoll();
      exportState.value = {
        status: "error",
        progress: 0,
        stage: "",
        message: error?.message || "获取导出进度失败",
      };
    }
  }, 400);
}

async function cancelExport() {
  stopExportPoll();
  const jobId = exportJobId;
  exportJobId = "";
  exportState.value = { status: "idle", progress: 0, stage: "", message: "" };
  if (!jobId) return;
  try {
    await fetch(`/infinite_canvas/api/timeline/export/${jobId}/cancel`, { method: "POST" });
  } catch {
    // 取消失败也不影响前端状态，任务最多在后台跑完
  }
}

// 导出完成：把 MP4 作为产物派生一个下游节点（时间线的素材池不往下传）
function finishExport(result) {
  if (!result?.filename) {
    exportState.value = {
      status: "error",
      progress: 0,
      stage: "",
      message: "导出结果缺少文件名",
    };
    return;
  }
  const items =
    graph?.itemsFromRefs?.([
      {
        filename: result.filename,
        subfolder: result.subfolder || "",
        type: result.type || "output",
        name: result.name || result.filename,
        kind: "video",
      },
    ]) || [];
  graph?.captureUndo?.(true);
  graph?.spawnChildNode?.(props.nodeId, items, { inherit: false });
  exportState.value = { status: "done", progress: 1, stage: "完成", message: "" };
  window.setTimeout(() => {
    if (exportState.value.status === "done") {
      exportState.value = { status: "idle", progress: 0, stage: "", message: "" };
    }
  }, 3000);
}

// 记录每个节点的导出状态，供组件重新挂载后接着轮询
watch(
  exportState,
  (state) => {
    exportSessions.set(props.nodeId, { jobId: exportJobId, state: { ...state } });
  },
  { deep: true }
);

// ---------------------------------------------------------------- 键盘
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function onKeyDown(event) {
  if (isTypingTarget(event.target)) return;
  const key = event.key;
  if (key === "Delete" || key === "Backspace") {
    if (!selectedClip.value) return;
    event.preventDefault();
    event.stopPropagation();
    removeSelected();
    return;
  }
  if (key === " ") {
    event.preventDefault();
    event.stopPropagation();
    togglePlay();
    return;
  }
  if (key === "s" || key === "S") {
    event.preventDefault();
    event.stopPropagation();
    splitAtPlayhead();
    return;
  }
  if (key === "f" || key === "F") {
    event.preventDefault();
    event.stopPropagation();
    if (fullscreen.value) exitFullscreen();
    else enterFullscreen();
    return;
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 1 : 1 / fps.value;
    setPlayheadTime(playhead.value + (key === "ArrowLeft" ? -step : step));
    return;
  }
  if (key === "Escape") {
    selectedClipId.value = "";
  }
}

// 拖入新素材（外部文件 / 资产库）时，节点自己的媒体变化，素材池要跟着刷新
watch(
  () => (props.data.media || []).length + (props.data.inputMedia || []).length,
  () => nextTick(scheduleDraw)
);

onBeforeUnmount(() => {
  if (widthObserver) widthObserver.disconnect();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  closeBinPreview();
  stopExportPoll();
  exitFullscreen();
  stopPlayback();
  endClipDrag();
  cancelAnimationFrame(drawRaf);
  for (const el of videoEls.values()) {
    el.pause?.();
    el.removeAttribute("src");
  }
  videoEls.clear();
  for (const entry of audioEls.values()) {
    entry.el.pause();
    entry.el.removeAttribute("src");
  }
  audioEls.clear();
});
</script>

<style scoped>
.tl-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  outline: none;
}

/* ---------------------------------------------------------------- 预览 */
/* 预览脱离节点主体，浮在节点上方：宽度不超过节点，高度也有上限
   （竖屏素材不会把整块面板撑得很高） */
.tl-preview-float {
  position: absolute;
  left: 50%;
  /* 节点内容顶部 = padding 10 + 标题条 18，再往上留 8 的缝 */
  bottom: calc(100% + 36px);
  transform: translateX(-50%);
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #000;
  box-shadow: 0 10px 28px var(--c-shadow);
  overflow: hidden;
  cursor: pointer;
}

.tl-preview {
  display: block;
  width: 100%;
  height: 100%;
}

.tl-stage-hint {
  position: absolute;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  pointer-events: none;
}

/* 预览右上角的全屏按钮：悬停才出现，不干扰画面 */
.tl-preview-fs {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}

.tl-preview-float:hover .tl-preview-fs {
  opacity: 1;
}

.tl-preview-fs:hover {
  background: rgba(0, 0, 0, 0.8);
}

/* ---------------------------------------------------------------- 传输条 */
.tl-transport {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 28px;
  padding: 0 2px;
  color: var(--c-muted);
}

.tl-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text);
  cursor: pointer;
}

.tl-icon:hover:not(:disabled) {
  background: var(--c-hover);
}

.tl-icon:disabled {
  opacity: 0.35;
  cursor: default;
}

.tl-icon.is-play {
  width: 30px;
  color: var(--c-text);
}

.tl-time {
  flex: 0 0 auto;
  margin-left: 2px;
  font-size: 11px;
  color: var(--c-muted);
  font-variant-numeric: tabular-nums;
}

.tl-time b {
  color: var(--c-text);
  font-weight: 600;
}

.tl-time-sep {
  margin: 0 3px;
}

.tl-spacer {
  flex: 1;
}

.tl-size {
  font-size: 10px;
  color: var(--c-muted-2);
  font-variant-numeric: tabular-nums;
}

/* 底部操作条：进度在左，导出按钮在右下角（与普通节点的「运行」同款） */
.tl-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  height: 28px;
  padding: 0 2px;
}

.tl-run {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 18px;
  border: 1px solid var(--accent-yellow);
  border-radius: 999px;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: box-shadow 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}

.tl-run:hover:not(:disabled) {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-accent) 18%, transparent);
}

.tl-run:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 导出中：按钮变成「取消」，切危险色，和「运行 / 中断」的区分方式一致 */
.tl-run.is-stop {
  border-color: var(--c-danger);
  background: transparent;
  color: var(--c-danger);
}

.tl-run.is-stop:hover {
  background: var(--c-danger-soft);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-danger) 20%, transparent);
}

.tl-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
  margin-left: 2px;
}

.tl-progress-track {
  position: relative;
  flex: 0 0 120px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-line);
  overflow: hidden;
}

.tl-progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: var(--accent-yellow);
  transition: width 0.2s linear;
}

.tl-progress-text {
  font-size: 10px;
  color: var(--c-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tl-footer-note {
  font-size: 10px;
  color: var(--c-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-footer-note.is-error {
  color: var(--c-danger);
}

/* ---------------------------------------------------------------- 素材池 */
.tl-bin {
  flex: 0 0 auto;
  height: 62px;
  padding: 4px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface-2);
  overflow: hidden;
}

.tl-bin-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior: contain;
}

.tl-bin-scroll::-webkit-scrollbar {
  display: none;
}

.tl-bin-item {
  position: relative;
  flex: 0 0 auto;
  width: 84px;
  height: 52px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: var(--c-surface-3);
  overflow: hidden;
  cursor: grab;
}

.tl-bin-item:active {
  cursor: grabbing;
}

.tl-bin-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.tl-bin-audio {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--c-muted);
  font-size: 10px;
  pointer-events: none;
}

.tl-bin-kind {
  position: absolute;
  left: 3px;
  top: 3px;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9px;
  line-height: 13px;
  pointer-events: none;
}

.tl-bin-dur {
  position: absolute;
  right: 3px;
  bottom: 2px;
  color: #fff;
  font-size: 9px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.tl-bin-add {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 36px;
  height: 52px;
  border: 1px dashed var(--c-line);
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  cursor: pointer;
}

.tl-bin-add:hover {
  color: var(--c-text);
  border-color: var(--c-muted);
}

.tl-bin-empty {
  color: var(--c-muted-2);
  font-size: 10px;
  white-space: nowrap;
  padding-left: 4px;
}

/* ---------------------------------------------------------------- 时间线 */
.tl-timeline {
  position: relative;
  display: flex;
  /* 底部多了导出条：时间线吸收剩余高度，节点默认高度下不会挤出去 */
  flex: 1 1 206px;
  min-height: 0;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface-2);
  overflow: hidden;
}

.tl-labels {
  flex: 0 0 34px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--c-line);
  background: var(--c-surface-2);
}

.tl-label-spacer {
  height: 22px;
  border-bottom: 1px solid var(--c-line);
}

.tl-label {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  border-bottom: 1px solid var(--c-line);
  color: var(--c-muted);
  font-size: 9px;
  letter-spacing: 0.04em;
}

.tl-label.is-audio {
  color: var(--c-muted-2);
}

.tl-scroll {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.tl-content {
  position: relative;
}

.tl-ruler {
  position: relative;
  height: 22px;
  border-bottom: 1px solid var(--c-line);
  cursor: ew-resize;
}

.tl-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--c-line);
}

.tl-tick-label {
  position: absolute;
  left: 3px;
  top: 3px;
  color: var(--c-muted-2);
  font-size: 9px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tl-head-cap {
  position: absolute;
  top: 0;
  width: 9px;
  height: 9px;
  margin-left: -4px;
  border-radius: 2px 2px 4px 4px;
  background: var(--accent-yellow);
  pointer-events: none;
}

.tl-tracks {
  position: relative;
}

.tl-track {
  position: relative;
  height: 46px;
  border-bottom: 1px solid var(--c-line);
  background: color-mix(in srgb, var(--c-text) 3%, transparent);
}

.tl-track.is-audio {
  background: color-mix(in srgb, var(--c-text) 1.5%, transparent);
}

.tl-clip {
  position: absolute;
  top: 4px;
  bottom: 4px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-surface-3);
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.tl-clip.is-audio {
  background: color-mix(in srgb, var(--c-accent) 18%, var(--c-surface-3));
}

.tl-clip.is-selected {
  border-color: var(--accent-yellow);
  box-shadow: 0 0 0 1px var(--accent-yellow);
  z-index: 3;
}

/* 拖拽落点预览 */
.tl-drop {
  position: absolute;
  top: 4px;
  bottom: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--accent-yellow);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-yellow) 18%, transparent);
  pointer-events: none;
  /* 高于片段：拖动已有片段时，落点预览要能盖在目标区间的旧片段上 */
  z-index: 4;
}

.tl-drop-label {
  color: var(--accent-yellow);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tl-clip-thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
  pointer-events: none;
}

.tl-clip-name {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 3px;
  color: #fff;
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}

.tl-clip-link {
  position: absolute;
  /* 让开右侧 7px 的裁剪把手，避免挡住拖拽裁剪 */
  right: 12px;
  top: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  cursor: pointer;
}

.tl-clip-link:hover {
  background: rgba(0, 0, 0, 0.75);
}

.tl-trim {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
}

.tl-trim.is-left {
  left: 0;
}

.tl-trim.is-right {
  right: 0;
}

.tl-clip:hover .tl-trim {
  background: color-mix(in srgb, var(--accent-yellow) 45%, transparent);
}

.tl-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  margin-left: -0.5px;
  background: var(--accent-yellow);
  pointer-events: none;
  z-index: 4;
}

/* ---------------------------------------------------------------- 拖拽影子 */
.tl-ghost {
  position: fixed;
  z-index: 4000;
  width: 84px;
  height: 52px;
  margin-left: -42px;
  margin-top: -26px;
  border-radius: 7px;
  border: 1px solid var(--accent-yellow);
  background: var(--c-surface-3);
  overflow: hidden;
  pointer-events: none;
  box-shadow: 0 6px 18px var(--c-shadow);
}

.tl-ghost img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tl-ghost span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--c-text);
  font-size: 10px;
}

/* 素材气泡预览：与节点上的素材气泡同款 */
.tl-bubble {
  position: fixed;
  z-index: 3500;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-panel);
  box-shadow: 0 18px 40px var(--c-shadow);
  pointer-events: none;
  overflow: hidden;
}

.tl-bubble img,
.tl-bubble video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.tl-bubble-name {
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

/* ---------------------------------------------------------------- 全屏预览 */
.tl-fs {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.tl-fs-canvas {
  display: block;
  max-width: 100vw;
  max-height: calc(100vh - 64px);
  width: auto;
  height: auto;
  cursor: pointer;
}

.tl-fs-bar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 330px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(20, 20, 26, 0.82);
  backdrop-filter: blur(8px);
  color: #e6e6ea;
  font-size: 12px;
}

.tl-fs-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tl-fs-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.tl-fs-btn.is-text {
  color: #cfcfd6;
}

.tl-fs-time {
  color: #9c9caa;
  font-variant-numeric: tabular-nums;
}

.tl-fs-time b {
  color: #fff;
  font-weight: 600;
}

.tl-fs-spacer {
  flex: 1;
}

.tl-fs-size {
  color: #6f6f7c;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
</style>

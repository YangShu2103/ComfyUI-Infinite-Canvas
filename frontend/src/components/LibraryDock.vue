<template>
  <div class="library-dock">
    <!-- 右上角两个圆角 tab -->
    <div class="library-tabs">
      <button
        class="lib-tab"
        :class="{ 'is-active': panel === 'prompt' }"
        type="button"
        @click="toggle('prompt')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        提示词
      </button>
      <button
        class="lib-tab"
        :class="{ 'is-active': panel === 'asset' }"
        type="button"
        @click="toggle('asset')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path d="M4.5 18l5-5 4 4 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        </svg>
        资产库
      </button>
    </div>

    <!-- 右侧滑出面板 -->
    <Transition name="dock">
      <section v-if="panel" class="library-panel" @wheel.stop @mousedown.stop>
        <!-- 提示词 -->
        <template v-if="panel === 'prompt'">
          <header class="lib-head">
            <span class="lib-title">提示词</span>
            <span class="lib-count">{{ prompts.length }} 条</span>
          </header>

          <div class="lib-add">
            <textarea
              v-model="draft"
              class="lib-add-input"
              rows="2"
              placeholder="输入要收藏的提示词…"
              spellcheck="false"
              @keydown.enter.prevent="addPrompt"
            />
            <button
              class="lib-add-btn"
              type="button"
              :disabled="!draft.trim() || saving"
              @click="addPrompt"
            >
              {{ saving ? "保存中" : "收藏" }}
            </button>
          </div>

          <div class="lib-list">
            <article
              v-for="item in prompts"
              :key="item.id"
              class="prompt-item"
              @click="insertPrompt(item.text)"
            >
              <p class="prompt-text">{{ item.text }}</p>
              <button class="item-del" type="button" title="删除" @click.stop="removePrompt(item)">
                ×
              </button>
            </article>
            <p v-if="!prompts.length" class="lib-empty">还没有收藏的提示词</p>
          </div>

          <footer class="lib-foot">
            {{ promptTarget ? "点击条目插入到当前提示词框" : "先点到节点的提示词框，再点条目插入" }}
          </footer>
        </template>

        <!-- 资产库 -->
        <template v-else>
          <header class="lib-head">
            <span class="lib-title">资产库</span>
            <span class="lib-count" v-if="total">{{ assets.length }} / {{ total }}</span>
            <div class="lib-switch">
              <button
                type="button"
                :class="{ 'is-active': kind === 'input' }"
                @click="setKind('input')"
              >
                input
              </button>
              <button
                type="button"
                :class="{ 'is-active': kind === 'output' }"
                @click="setKind('output')"
              >
                output
              </button>
            </div>
          </header>

          <div class="lib-cats">
            <button
              v-for="cat in CATEGORIES"
              :key="cat.value"
              type="button"
              class="lib-cat"
              :class="{ 'is-active': category === cat.value }"
              @click="setCategory(cat.value)"
            >
              {{ cat.label }}
            </button>
          </div>

          <div
            ref="gridEl"
            class="asset-grid"
            @scroll="onGridScroll"
            @wheel="closePreview"
          >
            <div
              v-for="file in assets"
              :key="assetKey(file)"
              class="asset-cell"
              draggable="true"
              :title="file.filename"
              @dragstart="onAssetDragStart($event, file)"
              @mouseenter="openPreview($event, file)"
              @mouseleave="closePreview"
            >
              <!-- 视频也用后端抽帧的缩略图，不再只显示扩展名 -->
              <img
                v-if="showThumb(file)"
                :src="thumbUrl(file)"
                loading="lazy"
                decoding="async"
                alt=""
                @error="markThumbFailed(file)"
              />
              <span v-else class="asset-ext">{{ extOf(file.filename) }}</span>
              <span v-if="file.category === 'video'" class="asset-badge">▶</span>
              <span v-else-if="file.category === 'audio'" class="asset-badge is-audio">♪</span>
              <span class="asset-name">{{ file.filename }}</span>
            </div>
            <p v-if="loadingMore" class="lib-more">加载中…</p>
            <p v-else-if="assets.length && !hasMore" class="lib-more">
              已加载全部 {{ total }} 个
            </p>
            <p v-if="!assets.length" class="lib-empty">
              {{ loading ? "加载中…" : "这个目录里还没有素材" }}
            </p>
          </div>

          <footer class="lib-foot">拖到画布空白处新建节点，拖到节点上添加素材</footer>

          <!-- 悬停素材时的快速预览气泡 -->
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
                v-if="previewCard.file.category === 'video'"
                :src="assetUrl(previewCard.file)"
                autoplay
                muted
                loop
                playsinline
                @loadedmetadata="fitPreview"
              />
              <img
                v-else-if="previewCard.file.category === 'photo'"
                :src="thumbUrl(previewCard.file, 640)"
                @load="fitPreview"
              />
              <div v-else class="preview-bubble-audio">音频</div>
              <span class="preview-bubble-name">{{ previewCard.file.filename }}</span>
            </div>
          </Teleport>
        </template>
      </section>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { FILE_ASSET_DRAG_TYPE, useLibrary } from "../composables/useLibrary.js";

const { panel, promptTarget, toggle, insertPrompt } = useLibrary();

const prompts = ref([]);
const draft = ref("");
const saving = ref(false);

const kind = ref("input");
// 二级分类：全部 / 图片 / 音频 / 视频
const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "photo", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];
const category = ref("all");
// 资产库一次只拉一页，滚动到底再拉下一页；缩略图由后端按需生成
const PAGE_LIMIT = 60;
const assets = ref([]);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const exhausted = ref(false);
const gridEl = ref(null);
const hasMore = computed(() => !exhausted.value && assets.value.length < total.value);

watch(panel, (value) => {
  if (value === "prompt") loadPrompts();
  if (value === "asset") loadAssets();
  else closePreview();
});

watch(kind, () => {
  if (panel.value === "asset") loadAssets();
});

watch(category, () => {
  if (panel.value === "asset") loadAssets();
});

async function loadPrompts() {
  try {
    const response = await fetch("/infinite_canvas/api/library/prompts");
    const data = await response.json();
    prompts.value = data.prompts || [];
  } catch {
    prompts.value = [];
  }
}

async function addPrompt() {
  const text = draft.value.trim();
  if (!text || saving.value) return;
  saving.value = true;
  try {
    const response = await fetch("/infinite_canvas/api/library/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (data.prompts) prompts.value = data.prompts;
    draft.value = "";
  } catch {
    // 接口不可用时保留输入内容，等下次重试
  } finally {
    saving.value = false;
  }
}

async function removePrompt(item) {
  try {
    const response = await fetch(
      `/infinite_canvas/api/library/prompts/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (data.prompts) prompts.value = data.prompts;
  } catch {
    // 删除失败就保持原样
  }
}

function fetchAssets(offset, assetKind, assetCategory) {
  const params = new URLSearchParams({
    type: assetKind,
    category: assetCategory,
    offset: String(offset),
    limit: String(PAGE_LIMIT),
  });
  return fetch(`/infinite_canvas/api/library/assets?${params.toString()}`).then(
    (response) => response.json()
  );
}

async function loadAssets() {
  loading.value = true;
  const currentKind = kind.value;
  const currentCategory = category.value;
  try {
    const data = await fetchAssets(0, currentKind, currentCategory);
    // 期间切了 input/output 或分类，这一页结果作废
    if (kind.value !== currentKind || category.value !== currentCategory) return;
    assets.value = data.files || [];
    total.value = Number(data.total) || assets.value.length;
    exhausted.value = false;
  } catch {
    assets.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
    nextTick(() => {
      if (gridEl.value) gridEl.value.scrollTop = 0;
    });
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  const currentKind = kind.value;
  const currentCategory = category.value;
  try {
    const data = await fetchAssets(assets.value.length, currentKind, currentCategory);
    if (kind.value !== currentKind || category.value !== currentCategory) return;
    const next = data.files || [];
    // 服务端按修改时间排序，期间有新文件会让偏移量错位，按 key 去重
    const seen = new Set(assets.value.map(assetKey));
    for (const file of next) {
      const key = assetKey(file);
      if (!seen.has(key)) {
        seen.add(key);
        assets.value.push(file);
      }
    }
    total.value = Number(data.total) || total.value;
    if (!next.length) exhausted.value = true;
  } catch {
    // 拉取失败就停在当前这一页，下次滚动再试
  } finally {
    loadingMore.value = false;
  }
}

function onGridScroll(event) {
  const el = event.currentTarget;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore();
}

function setKind(next) {
  if (kind.value === next) return;
  kind.value = next;
}

function setCategory(next) {
  if (category.value === next) return;
  category.value = next;
}

function assetKey(file) {
  return `${file.type}/${file.subfolder}/${file.filename}`;
}

// 图片和视频都有缩略图（视频是后端抽帧的封面），音频只有图标
function canThumb(file) {
  return file.category === "photo" || file.category === "video";
}

// 缩略图生成失败（比如服务器没装 PyAV/OpenCV 抽不了视频帧）时退回扩展名占位
const thumbFailed = ref({});

function showThumb(file) {
  return canThumb(file) && !thumbFailed.value[assetKey(file)];
}

function markThumbFailed(file) {
  thumbFailed.value = { ...thumbFailed.value, [assetKey(file)]: true };
}

// 缩略图只用于网格展示；v= 用源文件的 mtime，源图更新后能拿到新缩略图
// size 是后端缩略图最长边档位：网格 320，悬停气泡放大展示用 640
function thumbUrl(file, size = 320) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || kind.value,
    size: String(size),
    v: String(file.updated || 0),
  });
  return `/infinite_canvas/api/library/thumb?${params.toString()}`;
}

// 原图地址：拖到画布、预览视频时用
function assetUrl(file) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || kind.value,
  });
  return `/view?${params.toString()}`;
}

function extOf(name) {
  return (name.split(".").pop() || "?").toUpperCase().slice(0, 4);
}

function onAssetDragStart(event, file) {
  closePreview();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", file.filename);
  event.dataTransfer.setData(
    FILE_ASSET_DRAG_TYPE,
    JSON.stringify({ filename: file.filename, subfolder: file.subfolder || "", type: file.type })
  );
}

// 悬停素材时的快速预览气泡：和节点媒体条一样的气泡（Teleport 到 body，避免被面板裁剪）
const previewCard = ref(null);
let previewTimer = null;

function closePreview() {
  clearTimeout(previewTimer);
  previewCard.value = null;
}

function openPreview(event, file) {
  clearTimeout(previewTimer);
  const rect = event.currentTarget.getBoundingClientRect();
  previewTimer = setTimeout(() => {
    previewCard.value = {
      file,
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
    if (file.category !== "photo" && file.category !== "video") {
      placePreview(200, 88, true);
    }
  }, 220);
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
</script>

<style scoped>
.library-dock {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.library-tabs {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}

.lib-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--c-line-strong);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.lib-tab:hover {
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.lib-tab.is-active {
  border-color: var(--c-accent);
  background: var(--c-accent-weak);
  color: var(--c-accent-ink);
}

.library-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: min(340px, 34vw);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--c-line-strong);
  border-radius: 14px;
  background: var(--c-surface);
  box-shadow: 0 20px 48px var(--c-shadow);
  pointer-events: auto;
}

.dock-enter-from,
.dock-leave-to {
  opacity: 0;
  transform: translateX(28px);
}

.dock-enter-active,
.dock-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 8px;
  flex: 0 0 auto;
}

.lib-title {
  color: var(--c-text);
  font-size: 13px;
  font-weight: 600;
}

.lib-count {
  color: var(--c-muted);
  font-size: 11px;
}

.lib-switch {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding: 2px;
  border-radius: 8px;
  background: var(--c-surface-3);
}

.lib-switch button {
  height: 22px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.lib-switch button.is-active {
  background: var(--c-surface);
  color: var(--c-text);
}

.lib-cats {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
  flex: 0 0 auto;
}

.lib-cat {
  height: 24px;
  padding: 0 12px;
  border: 1px solid var(--c-line);
  border-radius: 999px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.lib-cat:hover {
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.lib-cat.is-active {
  border-color: color-mix(in srgb, var(--c-accent) 60%, transparent);
  background: var(--c-accent-weak);
  color: var(--c-accent-ink);
}

.lib-add {
  display: flex;
  gap: 8px;
  padding: 0 12px 10px;
  flex: 0 0 auto;
}

.lib-add-input {
  flex: 1 1 auto;
  min-height: 52px;
  max-height: 96px;
  padding: 8px;
  border: 1px solid var(--c-line-strong);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.lib-add-input:focus {
  border-color: var(--c-accent);
}

.lib-add-btn {
  flex: 0 0 auto;
  align-self: flex-end;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--accent-yellow);
  border-radius: 7px;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.lib-add-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.lib-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-item {
  position: relative;
  padding: 9px 28px 9px 10px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.prompt-item:hover {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
  background: var(--c-surface-3);
}

.prompt-text {
  margin: 0;
  display: -webkit-box;
  overflow: hidden;
  color: var(--c-text);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.item-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--c-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.item-del:hover {
  background: color-mix(in srgb, var(--c-text) 8%, transparent);
  color: var(--c-danger);
}

.asset-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start;
  gap: 8px;
}

.asset-cell {
  position: relative;
  /* 用 padding-top 撑正方形：grid 自动行高不认 aspect-ratio，行会被压矮导致方块互相压盖 */
  padding-top: 100%;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: 9px;
  background: var(--c-surface-2);
  cursor: grab;
}

.asset-cell:hover {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
}

.asset-cell img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.asset-ext {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--c-muted);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.asset-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 5px 4px;
  overflow: hidden;
  color: #f4f4f8;
  font-size: 10px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
}

/* 视频/音频角标：视频有缩略图，再叠一个播放符号 */
.asset-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #f4f4f8;
  font-size: 9px;
  line-height: 1;
}

.asset-badge.is-audio {
  color: var(--accent-yellow, #f2ff59);
}

.lib-empty {
  grid-column: 1 / -1;
  margin: 18px 0;
  color: var(--c-muted-2);
  font-size: 12px;
  text-align: center;
}

.lib-more {
  grid-column: 1 / -1;
  margin: 4px 0 8px;
  color: var(--c-muted-2);
  font-size: 11px;
  text-align: center;
}

.lib-foot {
  flex: 0 0 auto;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--c-line);
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.4;
}

/* 悬停预览气泡（Teleport 到 body） */
.preview-bubble {
  position: fixed;
  z-index: 40;
  overflow: hidden;
  border: 1px solid var(--c-line-strong);
  border-radius: 14px;
  background: var(--c-surface);
  box-shadow: 0 18px 44px var(--c-shadow);
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
  color: var(--c-muted);
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
</style>

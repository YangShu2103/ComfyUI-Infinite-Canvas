<template>
  <FloatingWindow v-if="visible" :title="title" width="92vw" height="86vh" @close="close">
    <div class="am">
      <!-- 顶部：input / output 切换 + 刷新 / 搜索 / 批量管理 -->
      <header class="am-bar">
        <div class="am-tabs">
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
        <span class="am-total">{{ assets.length }} / {{ total }} 个素材</span>

        <div class="am-actions">
          <button
            v-if="batch"
            class="am-btn"
            type="button"
            :disabled="!loadedKeys.length"
            @click="selectAll"
          >
            全选
          </button>
          <button
            v-if="batch"
            class="am-btn is-danger"
            type="button"
            :disabled="!selected.size"
            @click="removeSelected"
          >
            删除{{ selected.size ? `（${selected.size}）` : "" }}
          </button>
          <button
            v-if="batch"
            class="am-btn"
            type="button"
            :disabled="!selected.size"
            @click="downloadSelected"
          >
            下载{{ selected.size ? `（${selected.size}）` : "" }}
          </button>
          <input
            v-model="query"
            class="am-search"
            type="search"
            placeholder="搜索素材名称"
            spellcheck="false"
            @input="onSearchInput"
          />
          <button class="am-btn" type="button" title="刷新列表" @click="reload">
            刷新
          </button>
          <button
            class="am-btn"
            type="button"
            :class="{ 'is-active': batch }"
            @click="toggleBatch"
          >
            {{ batch ? "退出管理" : "批量管理" }}
          </button>
        </div>
      </header>

      <div class="am-body">
        <!-- 左侧：文件类型 + 数量（可收起） -->
        <aside class="am-side" :class="{ 'is-collapsed': !sideOpen }">
          <button
            class="am-side-toggle"
            type="button"
            :title="sideOpen ? '收起分类' : '展开分类'"
            @click="sideOpen = !sideOpen"
          >
            {{ sideOpen ? "‹" : "›" }}
          </button>
          <div v-if="sideOpen" class="am-side-inner">
            <span class="am-side-title">文件类型</span>
            <button
              v-for="cat in CATEGORIES"
              :key="cat.value"
              class="am-cat"
              type="button"
              :class="{ 'is-active': category === cat.value }"
              @click="setCategory(cat.value)"
            >
              <span>{{ cat.label }}</span>
              <span class="am-cat-count">{{ counts[cat.value] ?? 0 }}</span>
            </button>
            <p class="am-side-tip">
              {{ kind }} 目录里的素材，点分类筛选，双击素材下载
            </p>
          </div>
        </aside>

        <!-- 中间：文件视图 -->
        <section ref="gridEl" class="am-grid" @scroll="onGridScroll">
          <div
            v-for="file in assets"
            :key="assetKey(file)"
            class="am-cell"
            :class="{
              'is-active': activeKey === assetKey(file),
              'is-selected': selected.has(assetKey(file)),
            }"
            :title="file.filename"
            @click="selectFile(file)"
            @dblclick="downloadOne(file)"
          >
            <img
              v-if="showThumb(file)"
              :src="thumbUrl(file)"
              alt=""
              loading="lazy"
              decoding="async"
              @error="markThumbFailed(file)"
            />
            <span v-else class="am-ext">{{ extOf(file.filename) }}</span>
            <span v-if="file.category === 'video'" class="am-badge">▶</span>
            <span v-else-if="file.category === 'audio'" class="am-badge is-audio">♪</span>
            <span class="am-name">{{ file.filename }}</span>
            <label v-if="batch" class="am-check" @click.stop>
              <input
                type="checkbox"
                :checked="selected.has(assetKey(file))"
                @change="toggleSelect(file)"
              />
            </label>
          </div>

          <p v-if="loading" class="am-hint">加载中…</p>
          <p v-else-if="loadingMore" class="am-hint">加载中…</p>
          <p v-else-if="!assets.length" class="am-hint">
            {{ query ? "没有匹配的素材" : "这个目录里还没有素材" }}
          </p>
          <p v-else-if="!hasMore" class="am-hint">已加载全部 {{ total }} 个</p>
        </section>

        <!-- 右侧：上预览，下工作流 JSON -->
        <aside class="am-right">
          <section class="am-preview">
            <header class="am-preview-head">
              <span class="am-preview-title" :title="activeFile?.filename">
                {{ activeFile ? activeFile.filename : "文件预览" }}
              </span>
              <div v-if="activeFile" class="am-preview-tools">
                <button type="button" title="下载" @click="downloadOne(activeFile)">下载</button>
                <button
                  class="is-danger"
                  type="button"
                  title="删除"
                  @click="removeFiles([activeFile])"
                >
                  删除
                </button>
              </div>
            </header>

            <div class="am-preview-body">
              <template v-if="activeFile">
                <video
                  v-if="activeFile.category === 'video'"
                  :src="assetUrl(activeFile)"
                  controls
                  playsinline
                />
                <audio
                  v-else-if="activeFile.category === 'audio'"
                  :src="assetUrl(activeFile)"
                  controls
                />
                <img v-else :src="assetUrl(activeFile)" :alt="activeFile.filename" />
              </template>
              <p v-else class="am-hint">点击中间素材查看预览</p>
            </div>

            <footer v-if="activeFile" class="am-preview-meta">
              {{ activeFile.subfolder || "根目录" }} · {{ kind }} ·
              {{ formatSize(activeFile.size) }} ·
              {{ formatTime(activeFile.updated) }}
            </footer>
          </section>

          <section class="am-json">
            <header class="am-json-head">
              <span>工作流 JSON</span>
              <button v-if="workflowJson" type="button" @click="copyJson">复制</button>
            </header>
            <pre v-if="workflowJson" class="am-json-body">{{ workflowJson }}</pre>
            <p v-else class="am-hint">
              {{ metaLoading ? "读取中…" : activeFile ? "这个文件没有内嵌工作流" : "先选择一个素材" }}
            </p>
          </section>
        </aside>
      </div>

      <p v-if="message" class="am-msg">{{ message }}</p>
    </div>
  </FloatingWindow>
</template>

<script>
export const meta = { key: "assets", title: "资产管理", order: 2 };
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import FloatingWindow from "../FloatingWindow/index.vue";
import { closeDialog, isDialogOpen } from "../../stores/dialogs.js";

const key = "assets";
const title = "资产管理";
const visible = computed(() => isDialogOpen(key));

const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "photo", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

const kind = ref("input");
const category = ref("all");
const query = ref("");
const sideOpen = ref(true);
const batch = ref(false);

const PAGE_LIMIT = 60;
const assets = ref([]);
const total = ref(0);
const counts = ref({});
const loading = ref(false);
const loadingMore = ref(false);
const exhausted = ref(false);
const gridEl = ref(null);
const hasMore = computed(() => !exhausted.value && assets.value.length < total.value);

const activeFile = ref(null);
const activeKey = computed(() => (activeFile.value ? assetKey(activeFile.value) : ""));
const metaData = ref(null);
const metaLoading = ref(false);
const workflowJson = computed(() => {
  const data = metaData.value?.workflow || metaData.value?.prompt;
  return data ? JSON.stringify(data, null, 2) : "";
});

// 选中集合用 Set，改动后整体替换才能触发响应式更新
const selected = ref(new Set());
const loadedKeys = computed(() => assets.value.map(assetKey));

const message = ref("");
let messageTimer = 0;
let searchTimer = 0;

function toast(text) {
  message.value = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (message.value = ""), 2600);
}

watch(
  visible,
  (on) => {
    if (on) {
      kind.value = "input";
      category.value = "all";
      query.value = "";
      batch.value = false;
      selected.value = new Set();
      activeFile.value = null;
      metaData.value = null;
      reload();
    }
  },
  { immediate: true }
);

watch([kind, category], () => {
  if (visible.value) reload();
});

async function fetchAssets(offset, q = query.value) {
  const params = new URLSearchParams({
    type: kind.value,
    category: category.value,
    offset: String(offset),
    limit: String(PAGE_LIMIT),
  });
  if (q) params.set("q", q);
  const response = await fetch(`/infinite_canvas/api/library/assets?${params.toString()}`);
  return response.json();
}

async function reload() {
  await Promise.all([loadFirstPage(), loadCounts()]);
}

async function loadFirstPage() {
  loading.value = true;
  const snapshot = `${kind.value}/${category.value}/${query.value}`;
  try {
    const data = await fetchAssets(0, query.value);
    // 期间切了目录/分类/搜索词，这一页结果作废
    if (snapshot !== `${kind.value}/${category.value}/${query.value}`) return;
    assets.value = data.files || [];
    total.value = Number(data.total) || assets.value.length;
    exhausted.value = false;
    if (activeFile.value && !assets.value.some((f) => assetKey(f) === activeKey.value)) {
      activeFile.value = null;
      metaData.value = null;
    }
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

// 左侧分类计数：每类只取一条，用 total 当数量
async function loadCounts() {
  const q = query.value;
  const snapshotKind = kind.value;
  const results = await Promise.all(
    CATEGORIES.map(async (cat) => {
      const params = new URLSearchParams({
        type: snapshotKind,
        category: cat.value,
        offset: "0",
        limit: "1",
      });
      if (q) params.set("q", q);
      try {
        const response = await fetch(`/infinite_canvas/api/library/assets?${params.toString()}`);
        const data = await response.json();
        return [cat.value, Number(data.total) || 0];
      } catch {
        return [cat.value, 0];
      }
    })
  );
  if (snapshotKind === kind.value) counts.value = Object.fromEntries(results);
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  const snapshot = `${kind.value}/${category.value}/${query.value}`;
  try {
    const data = await fetchAssets(assets.value.length, query.value);
    if (snapshot !== `${kind.value}/${category.value}/${query.value}`) return;
    const seen = new Set(loadedKeys.value);
    for (const file of data.files || []) {
      const fileKey = assetKey(file);
      if (!seen.has(fileKey)) {
        seen.add(fileKey);
        assets.value.push(file);
      }
    }
    total.value = Number(data.total) || total.value;
    if (!(data.files || []).length) exhausted.value = true;
  } catch {
    // 失败就停在当前页，下次滚动再试
  } finally {
    loadingMore.value = false;
  }
}

function onGridScroll(event) {
  const el = event.currentTarget;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) loadMore();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (visible.value) reload();
  }, 350);
}

function setKind(next) {
  if (kind.value === next) return;
  kind.value = next;
  category.value = "all";
  activeFile.value = null;
  metaData.value = null;
  selected.value = new Set();
}

function setCategory(next) {
  if (category.value === next) return;
  category.value = next;
  selected.value = new Set();
}

function toggleBatch() {
  batch.value = !batch.value;
  if (!batch.value) selected.value = new Set();
}

function selectAll() {
  selected.value = new Set(loadedKeys.value);
}

function toggleSelect(file) {
  const next = new Set(selected.value);
  const fileKey = assetKey(file);
  if (next.has(fileKey)) next.delete(fileKey);
  else next.add(fileKey);
  selected.value = next;
}

function refsOf(files) {
  return files.map((file) => ({
    type: file.type || kind.value,
    subfolder: file.subfolder || "",
    filename: file.filename,
  }));
}

async function removeFiles(files) {
  if (!files.length) return;
  const names = files.length > 1 ? `${files.length} 个素材` : files[0].filename;
  if (!window.confirm(`确定删除 ${names}？删除后无法恢复。`)) return;
  try {
    const response = await fetch("/infinite_canvas/api/library/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: refsOf(files) }),
    });
    const data = await response.json();
    toast(`已删除 ${Number(data.removed) || 0} 个素材`);
    const removedKeys = new Set(files.map(assetKey));
    if (activeFile.value && removedKeys.has(assetKey(activeFile.value))) {
      activeFile.value = null;
      metaData.value = null;
    }
    selected.value = new Set();
    await reload();
  } catch {
    toast("删除失败，请重试");
  }
}

function removeSelected() {
  const files = assets.value.filter((file) => selected.value.has(assetKey(file)));
  removeFiles(files);
}

async function downloadFiles(files) {
  if (!files.length) return;
  if (files.length === 1) {
    downloadOne(files[0]);
    return;
  }
  try {
    const response = await fetch("/infinite_canvas/api/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: refsOf(files), name: `${kind.value}-assets` }),
    });
    if (!response.ok) {
      toast("打包失败");
      return;
    }
    const blob = await response.blob();
    triggerDownload(blob, `${kind.value}-assets.zip`);
  } catch {
    toast("打包失败，请重试");
  }
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 交给浏览器下载后再释放
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadOne(file) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || kind.value,
  });
  const anchor = document.createElement("a");
  anchor.href = `/view?${params.toString()}`;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function downloadSelected() {
  downloadFiles(assets.value.filter((file) => selected.value.has(assetKey(file))));
}

async function selectFile(file) {
  activeFile.value = file;
  metaData.value = null;
  metaLoading.value = true;
  const params = new URLSearchParams({
    type: file.type || kind.value,
    subfolder: file.subfolder || "",
    filename: file.filename,
  });
  try {
    const response = await fetch(`/infinite_canvas/api/library/meta?${params.toString()}`);
    const data = await response.json();
    // 响应回来时可能已经点了别的素材
    if (activeFile.value && assetKey(activeFile.value) === assetKey(file)) {
      metaData.value = data && !data.error ? data : null;
    }
  } catch {
    if (activeFile.value && assetKey(activeFile.value) === assetKey(file)) metaData.value = null;
  } finally {
    metaLoading.value = false;
  }
}

async function copyJson() {
  if (!workflowJson.value) return;
  try {
    await navigator.clipboard.writeText(workflowJson.value);
    toast("工作流 JSON 已复制");
  } catch {
    toast("复制失败");
  }
}

function close() {
  closeDialog(key);
}

function assetKey(file) {
  return `${file.type}/${file.subfolder}/${file.filename}`;
}

function canThumb(file) {
  return file.category === "photo" || file.category === "video";
}

const thumbFailed = ref({});

function showThumb(file) {
  return canThumb(file) && !thumbFailed.value[assetKey(file)];
}

function markThumbFailed(file) {
  thumbFailed.value = { ...thumbFailed.value, [assetKey(file)]: true };
}

// 网格用 320 档位缩略图，源文件更新后靠 v=mtime 拿到新图
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

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

onBeforeUnmount(() => {
  clearTimeout(messageTimer);
  clearTimeout(searchTimer);
});
</script>

<style scoped>
.am {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.am-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--c-line);
}

.am-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: var(--c-input-bg);
}

.am-tabs button {
  padding: 5px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  font-size: 12px;
  cursor: pointer;
}

.am-tabs button.is-active {
  background: color-mix(in srgb, var(--c-accent) 16%, transparent);
  color: var(--c-accent);
}

.am-total {
  color: var(--c-muted);
  font-size: 12px;
}

.am-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.am-btn {
  padding: 5px 10px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
}

.am-btn:hover:not(:disabled) {
  border-color: #44444f;
}

.am-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.am-btn.is-active {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
  color: var(--c-accent);
}

.am-btn.is-danger {
  border-color: #5a3038;
  color: #ff8f8f;
}

.am-search {
  width: 180px;
  padding: 5px 10px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 12px;
  outline: none;
}

.am-search:focus {
  border-color: #4a4a58;
}

.am-body {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}

/* 左侧分类 */
.am-side {
  position: relative;
  flex: 0 0 auto;
  width: 190px;
  padding: 12px 10px 12px 12px;
  border-right: 1px solid var(--c-line);
  transition: width 0.15s;
}

.am-side.is-collapsed {
  width: 30px;
  padding: 12px 0;
}

.am-side-toggle {
  position: absolute;
  top: 10px;
  right: 6px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--c-muted);
  cursor: pointer;
}

.am-side.is-collapsed .am-side-toggle {
  position: static;
  margin: 0 auto;
}

.am-side-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.am-side-title {
  margin-bottom: 6px;
  padding-right: 20px;
  color: var(--c-muted);
  font-size: 12px;
}

.am-cat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
}

.am-cat:hover {
  border-color: var(--c-line);
}

.am-cat.is-active {
  border-color: color-mix(in srgb, var(--c-accent) 40%, transparent);
  color: var(--c-accent);
}

.am-cat-count {
  color: var(--c-muted);
  font-size: 11px;
}

.am-cat.is-active .am-cat-count {
  color: var(--c-accent);
}

.am-side-tip {
  margin: 10px 2px 0;
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.6;
}

/* 中间网格 */
.am-grid {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  align-content: start;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
}

.am-cell {
  position: relative;
  padding-top: 100%;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: #141418;
  cursor: pointer;
}

.am-cell.is-active {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c-accent) 40%, transparent);
}

.am-cell.is-selected {
  border-color: #6fa8ff;
  box-shadow: 0 0 0 1px rgba(111, 168, 255, 0.4);
}

.am-cell > img,
.am-cell > .am-ext {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.am-cell > img {
  object-fit: cover;
}

.am-ext {
  display: grid;
  place-items: center;
  color: var(--c-muted);
  font-size: 12px;
  letter-spacing: 0.06em;
}

.am-badge {
  position: absolute;
  right: 6px;
  top: 5px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

.am-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 7px 5px;
  overflow: hidden;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  color: #ededf2;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.am-check {
  position: absolute;
  left: 6px;
  top: 6px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(16, 16, 20, 0.75);
}

.am-check input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--c-accent);
}

/* 右侧：预览 + 工作流 JSON */
.am-right {
  flex: 0 0 auto;
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--c-line);
}

.am-preview {
  flex: 1 1 58%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 12px;
}

.am-preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
}

.am-preview-title {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--c-text);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.am-preview-tools {
  display: flex;
  gap: 6px;
}

.am-preview-tools button {
  padding: 3px 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 11px;
  cursor: pointer;
}

.am-preview-tools button.is-danger {
  border-color: #5a3038;
  color: #ff8f8f;
}

.am-preview-body {
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
  background: #101013;
}

.am-preview-body img,
.am-preview-body video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.am-preview-body audio {
  width: 100%;
}

.am-preview-meta {
  padding-top: 8px;
  overflow: hidden;
  color: var(--c-muted);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.am-json {
  flex: 1 1 42%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--c-line);
}

.am-json-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  color: var(--c-muted);
  font-size: 12px;
}

.am-json-head button {
  padding: 3px 8px;
  border: 1px solid var(--c-line);
  border-radius: 6px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-size: 11px;
  cursor: pointer;
}

.am-json-body {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 10px;
  background: #101013;
  color: #b8d8ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.am-hint {
  grid-column: 1 / -1;
  margin: 8px 0;
  color: var(--c-muted);
  font-size: 12px;
  text-align: center;
}

/* 右侧空态时别被网格的 grid-column 规则影响 */
.am-preview-body .am-hint,
.am-json .am-hint {
  grid-column: auto;
}

.am-msg {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 7px 14px;
  border: 1px solid var(--c-line);
  border-radius: 9px;
  background: rgba(24, 24, 30, 0.95);
  color: var(--c-text);
  font-size: 12px;
}
</style>

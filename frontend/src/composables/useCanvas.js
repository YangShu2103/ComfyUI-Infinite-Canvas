import { nextTick, ref, watch } from "vue";

const API = "/infinite_canvas/api/canvases";
const LAST_KEY = "infinite-canvas:last";
const AUTOSAVE_DELAY = 800;

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && data.error) || `请求失败（${response.status}）`);
  }
  return data;
}

function readLast() {
  try {
    return localStorage.getItem(LAST_KEY) || "";
  } catch {
    return "";
  }
}

function rememberLast(id) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function useCanvas({ nodes, edges, viewport, exportCanvas, loadCanvas, resetCanvas }) {
  const list = ref([]);
  const currentId = ref("");
  const currentName = ref("");
  const saving = ref(false);
  const dirty = ref(false);
  const message = ref("");
  const ready = ref(false);

  // 加载画布时整体替换 nodes/edges，不能让自动保存把这一轮当成用户编辑
  let applying = false;
  let saveTimer = null;

  async function refresh() {
    const data = await request(API);
    list.value = data.canvases || [];
    return list.value;
  }

  async function applyCanvas(canvas) {
    applying = true;
    loadCanvas(canvas);
    currentId.value = canvas.id;
    currentName.value = canvas.name || "";
    rememberLast(canvas.id);
    dirty.value = false;
    message.value = "";
    // 等 watch 冲刷完再解除保护（loadCanvas 的赋值是同步的，watch 是微任务）
    await nextTick();
    applying = false;
  }

  async function create(name) {
    const fallback = `画布 ${list.value.length + 1}`;
    const canvas = await request(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || fallback }),
    });
    applying = true;
    resetCanvas();
    currentId.value = canvas.id;
    currentName.value = canvas.name || fallback;
    rememberLast(canvas.id);
    dirty.value = false;
    await refresh();
    await nextTick();
    applying = false;
    return canvas;
  }

  async function open(id) {
    if (!id) return null;
    const canvas = await request(`${API}/${encodeURIComponent(id)}`);
    await applyCanvas(canvas);
    return canvas;
  }

  async function rename(id, name) {
    const next = (name || "").trim();
    if (!id || !next) return null;
    const saved = await request(`${API}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas: { name: next } }),
    });
    if (id === currentId.value) currentName.value = saved.name || next;
    await refresh();
    return saved;
  }

  async function saveNow() {
    if (!currentId.value) return;
    clearTimeout(saveTimer);
    saving.value = true;
    try {
      const canvas = exportCanvas();
      await request(`${API}/${encodeURIComponent(currentId.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas }),
      });
      dirty.value = false;
      message.value = "";
    } catch (error) {
      message.value = error.message || "保存失败";
    } finally {
      saving.value = false;
    }
  }

  function scheduleSave() {
    if (applying || !currentId.value) return;
    dirty.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_DELAY);
  }

  async function remove(ids) {
    const targets = (ids || []).filter(Boolean);
    if (!targets.length) return [];
    const data = await request(`${API}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets }),
    });
    const removed = data.removed || [];
    if (removed.includes(currentId.value)) {
      applying = true;
      resetCanvas();
      currentId.value = "";
      currentName.value = "";
      rememberLast("");
      dirty.value = false;
      await nextTick();
      applying = false;
    }
    await refresh();
    return removed;
  }

  // 打开页面时恢复上次编辑的画布；一个都没有就新建一张
  async function bootstrap() {
    try {
      await refresh();
      const last = readLast();
      if (last && list.value.some((item) => item.id === last)) {
        await open(last);
      } else if (list.value.length) {
        await open(list.value[0].id);
      } else {
        await create("画布 1");
      }
    } catch (error) {
      message.value = error.message || "画布加载失败";
    } finally {
      ready.value = true;
    }
  }

  watch([nodes, edges, viewport], scheduleSave, { deep: true });

  return {
    list,
    currentId,
    currentName,
    saving,
    dirty,
    message,
    ready,
    refresh,
    create,
    open,
    rename,
    remove,
    saveNow,
    bootstrap,
  };
}

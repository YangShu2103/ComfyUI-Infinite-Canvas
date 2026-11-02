import { nextTick, onScopeDispose, reactive, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";

const NODE_WIDTH = 400;
const NODE_HEIGHT = 260;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.7 };

// ComfyUI 的 /view 地址：素材存在 input 目录，产物存在 output 目录，前端只存引用
function mediaUrl(ref) {
  const params = new URLSearchParams({
    filename: ref.filename || "",
    subfolder: ref.subfolder || "",
    type: ref.type || "input",
  });
  return `/view?${params.toString()}`;
}

function guessKind(filename) {
  if (/\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(filename || "")) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(filename || "")) return "video";
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(filename || "")) return "audio";
  return "image";
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ------------------------------------------------------------ 完成通知
// 任务跑完时：页面在后台就闪标题，同时播放两声提示音（WebAudio 合成，不依赖音频文件）
// 本页面通常被嵌在 ComfyUI 的 iframe 里，标题要改父页面的，标签栏才会跟着闪
function hostDocument() {
  try {
    return window.top.document;
  } catch {
    return document;
  }
}
const hostDoc = hostDocument();
let baseTitle = hostDoc.title || "Infinite Canvas";
let titleTimer = 0;
let audioCtx = null;

function audioContext() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function unlockAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

function playDoneSound() {
  const ctx = audioContext();
  if (!ctx) return;
  const play = () => {
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.18 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.32);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
  else play();
}

function stopTitleFlash() {
  if (!titleTimer) return;
  clearInterval(titleTimer);
  titleTimer = 0;
  hostDoc.title = baseTitle;
}

// 只在标签页不可见时闪（用户正看着画布就不打扰）
function flashTitle() {
  if (!hostDoc.hidden) return;
  clearInterval(titleTimer);
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    hostDoc.title = on ? "● 完成" : baseTitle;
  }, 900);
}

function notifyDone() {
  playDoneSound();
  flashTitle();
}

// 第一次交互时解锁音频，避免完成提示音被浏览器自动播放策略拦截
window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
hostDoc.addEventListener("visibilitychange", () => {
  if (!hostDoc.hidden) stopTitleFlash();
});

// 工作流列表顺序由「工作流配置」维护，新节点默认用列表里的第一个
let workflowNames = [];
let workflowsLoaded = false;

async function loadWorkflowNames(force = false) {
  if (workflowsLoaded && !force) return workflowNames;
  try {
    const response = await fetch("/infinite_canvas/api/workflows");
    const data = await response.json();
    workflowNames = (data.workflows || []).map((item) => item.name);
  } catch {
    workflowNames = [];
  }
  workflowsLoaded = true;
  return workflowNames;
}

function defaultWorkflow() {
  return workflowNames[0] || "";
}

// 配置页调整顺序后，下一次建节点直接用新顺序
if (typeof window !== "undefined") {
  window.addEventListener("infinite-canvas:workflows-changed", () => {
    loadWorkflowNames(true);
  });
}
loadWorkflowNames();

// 序列化时去掉运行时字段（url 由 ref 推导，blob 是上传前的临时数据）
function stripMediaItem(item) {
  const { url, blob, ...rest } = item;
  return rest;
}

// 反序列化时根据 ref 还原 /view 地址（JSON 里只存引用，不存完整 URL）
function hydrateMediaItem(item) {
  if (!item) return item;
  if (!item.ref || !item.ref.filename) return item;
  return { ...item, url: mediaUrl(item.ref) };
}

export function useGraph() {
  const flow = useVueFlow("demo");

  const nodes = ref([]);
  const edges = ref([]);
  // 画布的平移/缩放，与节点坐标一起保存，刷新后回到上次看到的位置
  const viewport = ref({ ...DEFAULT_VIEWPORT });

  let nodeSeq = 0;
  let edgeSeq = 0;
  let connectStart = null;
  // 加载画布时整体替换 nodes/edges，需要让同步/回收的监听跳过这一轮
  let loading = false;
  // Vue Flow 允许落在端口附近就吸附连接，此时 mouseup 的 target 可能是画布，
  // 用 connect 事件先行标记，避免把有效连接误判成"在空白处松手"
  let justConnected = false;

  function baseData(label) {
    return {
      label,
      // 没指定工作流的新节点默认用列表第一条
      workflow: defaultWorkflow(),
      // 工作流暴露字段的值：{ 节点id: { 输入名: 值 } }
      params: {},
      // 哪些随机数字段处于"每次运行刷新"模式：{ 字段id: true }
      randomFields: {},
      inputMedia: [],
    };
  }

  function addNode(position) {
    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(position.x - NODE_WIDTH / 2),
          y: Math.round(position.y - 36),
        },
        data: baseData(`${nodeSeq}`),
      },
    ];
    return id;
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取素材失败"));
      reader.readAsDataURL(file);
    });
  }

  // 单个文件 -> 媒体项：先上传到 ComfyUI input 目录，再拿 /view 引用
  async function uploadFile(file, kind) {
    const name = file.name || (kind === "video" ? "视频" : "图片");
    try {
      const dataUrl = await readDataUrl(file);
      const response = await fetch("/infinite_canvas/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: dataUrl }),
      });
      const ref = await response.json().catch(() => null);
      if (!response.ok || !ref || !ref.filename) throw new Error();
      return {
        id: newId(),
        name,
        kind,
        ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "input" },
        url: mediaUrl(ref),
      };
    } catch {
      // 接口不可用时退回本地预览（刷新后失效，但界面仍可用）
      return { id: newId(), name, kind, url: URL.createObjectURL(file), blob: file };
    }
  }

  // 文件 -> 节点内媒体项（会逐个上传）
  async function toMediaItems(files) {
    const media = [];
    for (const file of files) {
      let kind = "";
      if (file.type.startsWith("image/")) kind = "image";
      else if (file.type.startsWith("video/")) kind = "video";
      else if (file.type.startsWith("audio/")) kind = "audio";
      if (!kind) continue;
      const item = await uploadFile(file, kind);
      if (item) media.push(item);
    }
    return media;
  }

  // 执行结果（后端返回的 /view 引用）-> 媒体项，不需要再下载
  function itemsFromRefs(refs) {
    return (refs || [])
      .filter((ref) => ref && ref.filename)
      .map((ref) => ({
        id: newId(),
        name: ref.name || ref.filename,
        kind: ref.kind || guessKind(ref.filename),
        ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" },
        url: mediaUrl(ref),
      }));
  }

  // 一次拖入的多个文件放进同一个节点，节点内用堆叠卡片切换
  async function addMediaNode(position, files) {
    const media = await toMediaItems(files);
    if (!media.length) return null;

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(position.x - NODE_WIDTH / 2),
          y: Math.round(position.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          media,
          index: 0,
        },
      },
    ];
    return id;
  }

  // 往已有节点上继续追加素材
  async function appendMedia(nodeId, files) {
    const items = await toMediaItems(files);
    if (!items.length) return false;

    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    const media = node.data.media || [];
    node.data.media = [...media, ...items];
    if (!media.length) node.data.index = 0;
    return true;
  }

  // 直接把已构造好的媒体项追加到节点（执行产物走这里，不再经过上传）
  function appendItems(nodeId, items) {
    if (!items || !items.length) return false;

    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    const media = node.data.media || [];
    node.data.media = [...media, ...items];
    if (!media.length) node.data.index = 0;
    return true;
  }

  // 以当前节点为输入，在它右侧派生一个下游节点：自动连线 + 继承自身媒体
  // items 为新节点自身的首批素材（运行产物）
  function spawnChildNode(sourceId, items = []) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    // 继承的素材在创建时就带上，避免新建后再改 data 被 v-model 同步覆盖
    const inherited = (source.data.media || []).map((item) => ({ ...item, sourceId }));
    // 同一个节点多次运行时，依次向下排开，避免新节点叠在一起
    const childCount = edges.value.filter((edge) => edge.source === sourceId).length;

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(source.position.x + NODE_WIDTH + 80),
          y: Math.round(source.position.y + childCount * (NODE_HEIGHT + 40)),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          // 生成参数沿用上游节点
          params: JSON.parse(JSON.stringify(source.data.params || {})),
          randomFields: JSON.parse(JSON.stringify(source.data.randomFields || {})),
          workflow: source.data.workflow || defaultWorkflow(),
          media: items,
          index: 0,
          inputMedia: inherited,
        },
      },
    ];

    addEdge(sourceId, null, id, null);
    return id;
  }

  // 从屏幕坐标拖入文件：转画布坐标后建节点
  async function importMedia(clientX, clientY, files) {
    return addMediaNode(
      flow.screenToFlowCoordinate({ x: clientX, y: clientY }),
      files
    );
  }

  function addEdge(source, sourceHandle, target, targetHandle) {
    edgeSeq += 1;
    edges.value = [
      ...edges.value,
      {
        id: `e${edgeSeq}`,
        type: "canvas",
        source,
        sourceHandle: sourceHandle || null,
        target,
        targetHandle: targetHandle || null,
      },
    ];
  }

  // 节点输出给下游时只带自身媒体（不含它自己的上游输入）
  function inheritMedia(sourceId, targetId) {
    const source = nodes.value.find((item) => item.id === sourceId);
    const target = nodes.value.find((item) => item.id === targetId);
    if (!source || !target) return;

    const own = source.data.media || [];
    if (!own.length) return;

    const existing = target.data.inputMedia || [];
    const seen = new Set(existing.map((item) => item.id));
    const added = [];
    for (const item of own) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      // sourceId 用于断开连线时精确回收
      added.push({ ...item, sourceId });
    }
    if (!added.length) return;

    target.data.inputMedia = [...existing, ...added];
  }

  // 断开连线后，把这条上游贡献的媒体从下游移除
  function dropInputMedia(targetId, sourceId) {
    if (edges.value.some((edge) => edge.target === targetId && edge.source === sourceId)) {
      return;
    }
    const node = nodes.value.find((item) => item.id === targetId);
    if (!node) return;

    const list = node.data.inputMedia || [];
    const kept = list.filter((item) => item.sourceId !== sourceId);
    if (kept.length !== list.length) node.data.inputMedia = kept;
  }

  // 监听连线被删除（手动删除校验，节点删除也会触发）
  watch(
    edges,
    (next, prev) => {
      if (loading) return;
      for (const edge of prev || []) {
        if (!next.some((item) => item.id === edge.id)) {
          dropInputMedia(edge.target, edge.source);
        }
      }
    },
    { deep: true }
  );

  // 上游自身媒体被重排/删除/追加后，同步给所有直接下游
  function syncDownstream(sourceId) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return;

    const own = (source.data.media || []).map((item) => ({ ...item, sourceId }));
    const targets = new Set(
      edges.value.filter((edge) => edge.source === sourceId).map((edge) => edge.target)
    );

    for (const targetId of targets) {
      const target = nodes.value.find((item) => item.id === targetId);
      if (!target) continue;

      // 用最新自身媒体替换该来源原来占的那一段，其他来源的位置保持不变
      const kept = [];
      let at = -1;
      for (const item of target.data.inputMedia || []) {
        if (item.sourceId === sourceId) {
          if (at === -1) at = kept.length;
          continue;
        }
        kept.push(item);
      }
      if (at === -1) at = kept.length;

      target.data.inputMedia = [...kept.slice(0, at), ...own, ...kept.slice(at)];
    }
  }

  // 自身媒体的 id 序列快照：序列一变就说明被重排/删除/追加，通知下游
  const mediaKeys = new Map();
  // 每个节点自身素材对应的 input 文件名，节点被删除时用来回收文件
  const nodeOwnFiles = new Map();

  function ownInputFiles(node) {
    const names = [];
    for (const item of node.data.media || []) {
      const ref = item && item.ref;
      if (!ref || ref.type !== "input") continue;
      const filename = String(ref.filename || "");
      if (filename.startsWith("infinite_canvas_")) names.push(filename);
    }
    return names;
  }

  // 只删仍无人引用的文件：其他节点的 media / inputMedia 里还有同一个引用就保留
  function releaseInputFiles(filenames) {
    const used = new Set();
    for (const node of nodes.value) {
      for (const item of [...(node.data.media || []), ...(node.data.inputMedia || [])]) {
        if (item && item.ref && item.ref.filename) used.add(item.ref.filename);
      }
    }
    for (const filename of filenames) {
      if (used.has(filename)) continue;
      fetch(`/infinite_canvas/api/media/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }

  function snapshotMediaKeys() {
    mediaKeys.clear();
    nodeOwnFiles.clear();
    for (const node of nodes.value) {
      mediaKeys.set(node.id, (node.data.media || []).map((item) => item.id).join(","));
      nodeOwnFiles.set(node.id, ownInputFiles(node));
    }
  }

  watch(
    nodes,
    () => {
      if (loading) return;
      const alive = new Set();
      for (const node of nodes.value) {
        alive.add(node.id);
        const key = (node.data.media || []).map((item) => item.id).join(",");
        const prev = mediaKeys.get(node.id);
        mediaKeys.set(node.id, key);
        nodeOwnFiles.set(node.id, ownInputFiles(node));
        if (prev !== undefined && prev !== key) syncDownstream(node.id);
      }

      // 节点被删掉后清掉快照，并回收它自己的 input 文件
      let removedFiles = null;
      for (const id of [...nodeOwnFiles.keys()]) {
        if (alive.has(id)) continue;
        const files = nodeOwnFiles.get(id) || [];
        nodeOwnFiles.delete(id);
        if (files.length) removedFiles = (removedFiles || []).concat(files);
      }
      for (const id of [...mediaKeys.keys()]) {
        if (!alive.has(id)) mediaKeys.delete(id);
      }

      // 等这一轮下游同步（断线回收 inputMedia）跑完，再确认文件是否真的没人引用
      if (removedFiles) setTimeout(() => releaseInputFiles(removedFiles), 0);
    },
    { deep: true }
  );

  // ------------------------------------------------------------ 画布存取

  function exportCanvas() {
    return {
      nodes: nodes.value.map((node) => ({
        id: node.id,
        type: node.type || "demo",
        position: { x: node.position.x, y: node.position.y },
        data: {
          ...node.data,
          media: (node.data.media || []).map(stripMediaItem),
          inputMedia: (node.data.inputMedia || []).map(stripMediaItem),
        },
      })),
      edges: edges.value.map((edge) => ({
        id: edge.id,
        type: edge.type || "canvas",
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      })),
      seq: { node: nodeSeq, edge: edgeSeq },
      viewport: {
        x: Math.round(viewport.value.x),
        y: Math.round(viewport.value.y),
        zoom: viewport.value.zoom,
      },
    };
  }

  function loadCanvas(canvas) {
    loading = true;
    const loadedNodes = (canvas.nodes || []).map((node) => {
      const data = node.data || {};
      return {
        id: String(node.id),
        type: node.type || "demo",
        position: {
          x: Math.round(node.position?.x || 0),
          y: Math.round(node.position?.y || 0),
        },
        data: {
          ...baseData(data.label || node.id),
          ...data,
          media: (data.media || []).map(hydrateMediaItem),
          inputMedia: (data.inputMedia || []).map(hydrateMediaItem),
        },
      };
    });
    const loadedEdges = (canvas.edges || []).map((edge) => ({
      id: edge.id,
      type: edge.type || "canvas",
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
    }));

    nodes.value = loadedNodes;
    edges.value = loadedEdges;

    // 序号从文件里恢复，避免新节点 id 和已有节点冲突
    nodeSeq = Number(canvas.seq?.node) || 0;
    edgeSeq = Number(canvas.seq?.edge) || 0;
    for (const node of loadedNodes) nodeSeq = Math.max(nodeSeq, Number(node.id) || 0);
    for (const edge of loadedEdges) {
      edgeSeq = Math.max(edgeSeq, Number(String(edge.id).replace(/^e/, "")) || 0);
    }

    snapshotMediaKeys();

    // 恢复上次的平移/缩放（旧画布没有 viewport 字段时回到默认视图）
    const saved = canvas.viewport || {};
    const zoom = Number(saved.zoom);
    const next = {
      x: Number(saved.x) || 0,
      y: Number(saved.y) || 0,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_VIEWPORT.zoom,
    };
    viewport.value = next;
    nextTick(() => {
      flow.setViewport(next);
      loading = false;
    });
  }

  function resetCanvas() {
    loading = true;
    nodes.value = [];
    edges.value = [];
    nodeSeq = 0;
    edgeSeq = 0;
    snapshotMediaKeys();
    viewport.value = { ...DEFAULT_VIEWPORT };
    nextTick(() => {
      flow.setViewport(DEFAULT_VIEWPORT);
      loading = false;
    });
  }

  // ------------------------------------------------------------ 视图操作
  // 纸飞机按钮：恢复默认缩放，并把指定节点（没传就取当前选中的）居中
  function focusNode(nodeId) {
    const zoom = DEFAULT_VIEWPORT.zoom;
    let id = nodeId;
    if (!id) {
      const picked = flow.getSelectedNodes && flow.getSelectedNodes();
      id = picked && picked.length ? picked[0].id : null;
    }
    const node = id && flow.findNode ? flow.findNode(id) : null;
    if (!node) {
      flow.setViewport({ ...DEFAULT_VIEWPORT });
      return;
    }

    const pos = node.computedPosition || node.position || { x: 0, y: 0 };
    const size = node.dimensions || { width: 0, height: 0 };
    // 视口容器尺寸：Vue Flow 这里可能给的是 ref，也可能直接是 DOM 元素
    const raw = flow.viewportRef;
    const el = raw && raw.value !== undefined ? raw.value : raw;
    const width = (el && el.clientWidth) || window.innerWidth;
    const height = (el && el.clientHeight) || window.innerHeight;
    flow.setViewport({
      x: Math.round(width / 2 - (pos.x + size.width / 2) * zoom),
      y: Math.round(height / 2 - (pos.y + size.height / 2) * zoom),
      zoom,
    });
  }

  // 全览：把包含所有节点的区域缩放到视口里
  function fitCanvas() {
    flow.fitView({ padding: 0.18, includeHiddenNodes: false });
  }

  function onDblClick(event) {
    // 双击节点时不要新建
    if (event.target.closest(".vue-flow__node")) return;
    addNode(flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }));
  }

  function onConnect(connection) {
    justConnected = true;
    addEdge(
      connection.source,
      connection.sourceHandle,
      connection.target,
      connection.targetHandle
    );
    // 把上游媒体带进下游节点
    inheritMedia(connection.source, connection.target);
  }

  function onConnectStart(payload) {
    connectStart = payload
      ? {
          nodeId: payload.nodeId,
          handleId: payload.handleId,
          handleType: payload.handleType,
        }
      : null;
  }

  function onConnectEnd(event) {
    const start = connectStart;
    connectStart = null;

    if (justConnected) {
      justConnected = false;
      return;
    }

    if (!start || !event || !(event.target instanceof Element)) return;
    // 落在端口上说明是有效连接，交给 onConnect 处理
    if (event.target.closest(".vue-flow__handle")) return;

    const id = addNode(
      flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    );

    // 手动拉线新建的下游节点沿用上游选择的工作流和已填参数
    const upstream = nodes.value.find((item) => item.id === start.nodeId);
    const created = nodes.value.find((item) => item.id === id);
    if (created && upstream?.data.workflow) {
      created.data.workflow = upstream.data.workflow;
      created.data.params = JSON.parse(JSON.stringify(upstream.data.params || {}));
      created.data.randomFields = JSON.parse(
        JSON.stringify(upstream.data.randomFields || {})
      );
    }

    if (start.handleType === "source") {
      addEdge(start.nodeId, start.handleId, id, null);
      inheritMedia(start.nodeId, id);
    } else {
      addEdge(id, null, start.nodeId, start.handleId);
      inheritMedia(id, start.nodeId);
    }
  }

  const offConnect = flow.onConnect(onConnect);
  const offConnectStart = flow.onConnectStart(onConnectStart);
  const offConnectEnd = flow.onConnectEnd(onConnectEnd);

  // ------------------------------------------------------------ 节点复制
  // 按住 Alt / Option 拖动节点时会拖出一个虚拟副本，松手处才落成真实的兄弟节点，
  // 原节点不动；工作流、参数（提示词除外）、上游连线和素材一起复制

  const fieldCache = new Map();

  function workflowFields(name) {
    if (!name) return Promise.resolve([]);
    if (fieldCache.has(name)) return Promise.resolve(fieldCache.get(name));
    return fetch(`/infinite_canvas/api/workflows/${encodeURIComponent(name)}/fields`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const fields = Array.isArray(data?.fields) ? data.fields : [];
        fieldCache.set(name, fields);
        return fields;
      })
      .catch(() => {
        fieldCache.set(name, []);
        return [];
      });
  }

  // 节点上的提示词 = 第一个文本类字段，复制时把它清掉（回落到字段默认值）
  async function clearPrompt(nodeId, workflow) {
    const fields = await workflowFields(workflow);
    const prompt = fields.find(
      (field) => field.type === "textarea" || field.type === "text"
    );
    if (!prompt) return;
    const node = nodes.value.find((item) => item.id === nodeId);
    const holder = node?.data?.params?.[prompt.nodeId];
    if (!holder || !(prompt.key in holder)) return;
    const next = { ...holder };
    delete next[prompt.key];
    node.data.params = { ...node.data.params, [prompt.nodeId]: next };
  }

  function duplicateNode(sourceId, position) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        data: {
          ...baseData(`${nodeSeq}`),
          workflow: source.data.workflow || defaultWorkflow(),
          params: JSON.parse(JSON.stringify(source.data.params || {})),
          randomFields: JSON.parse(JSON.stringify(source.data.randomFields || {})),
          // 素材沿用引用，但 id 要重新生成，避免和原节点在同一目标节点上被去重
          media: (source.data.media || []).map((item) => ({ ...item, id: newId() })),
          index: 0,
          inputMedia: (source.data.inputMedia || []).map((item) => ({
            ...item,
            id: newId(),
          })),
        },
      },
    ];

    // 上游连线一起复制，副本的运行条件和原节点一致
    for (const edge of edges.value.filter((item) => item.target === sourceId)) {
      addEdge(edge.source, edge.sourceHandle, id, edge.targetHandle);
    }

    clearPrompt(id, source.data.workflow);
    return id;
  }

  // 拖动结束后把坐标写回节点数据：Vue Flow 只在内部状态里更新位置，
  // 不写回来导出的画布就还是创建时的坐标
  const offNodeDragStop = flow.onNodeDragStop((payload) => {
    const dragged = payload?.nodes?.length
      ? payload.nodes
      : payload?.node
        ? [payload.node]
        : [];
    for (const item of dragged) {
      const target = nodes.value.find((node) => node.id === item.id);
      if (target && item.position) {
        target.position = { x: item.position.x, y: item.position.y };
      }
    }
  });

  // 平移/缩放变化同步到本地，自动保存一并写入
  watch(
    () => flow.viewport.value,
    (value) => {
      if (loading || !value) return;
      viewport.value = { x: value.x, y: value.y, zoom: value.zoom };
    },
    { deep: true }
  );

  // ------------------------------------------------------------ 异步执行
  // /prompt 只返回 prompt_id，进度通过 ComfyUI 的 /ws 推送；
  // 另外定时查结果接口兜底，避免 WebSocket 断线时任务一直停在"运行中"
  const runStates = reactive({});
  const promptNodes = new Map();
  // 节点 -> 当前任务，中断时按节点找到要取消的 prompt
  const nodePrompts = new Map();
  const settledPrompts = new Set();
  const pollers = new Map();
  let socket = null;

  function executionClientId() {
    const KEY = "infinite_canvas_client_id";
    let value = localStorage.getItem(KEY);
    if (!value) {
      value = `ic_${newId()}`;
      localStorage.setItem(KEY, value);
    }
    return value;
  }

  // 和提交任务时用的是同一个 clientId，否则 ComfyUI 不会把进度推过来
  const clientId = executionClientId();

  function ensureSocket() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(
      `${scheme}://${location.host}/ws?clientId=${encodeURIComponent(clientId)}`
    );
    socket.onmessage = onSocketMessage;
    socket.onclose = () => {
      socket = null;
    };
    socket.onerror = () => {
      // 连不上 /ws 时任务仍靠轮询跟进，这里只提示方便排查（如开发服务器没代理 /ws）
      console.warn("[Infinite-Canvas] WebSocket 连接失败，进度改为轮询更新");
      socket = null;
    };
  }

  // 进度百分比来自采样步数，加载模型/解码阶段没有事件，容易长时间停在 0%，
  // 因此界面上不做进度估算，只显示状态 + 计时（见 Node/index.vue）
  function onSocketMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const data = message?.data || {};
    // 老版本 ComfyUI 的 progress 消息不带 prompt_id：只有一个任务在跑时直接归属它
    const promptId = data.prompt_id || (promptNodes.size === 1 ? promptNodes.keys().next().value : "");
    if (!promptId) return;

    const nodeId = promptNodes.get(promptId);
    const state = nodeId ? runStates[nodeId] : null;
    if (!state) return;

    if (message.type === "execution_start") {
      state.status = "running";
    } else if (message.type === "progress" || message.type === "progress_state") {
      // 只用来确认任务确实在跑；不换算成百分比（阶段划分不可靠）
      state.status = "running";
    } else if (message.type === "execution_success") {
      checkPrompt(nodeId, promptId);
    } else if (message.type === "execution_interrupted") {
      failPrompt(nodeId, promptId, "任务已中断");
    } else if (message.type === "execution_error") {
      failPrompt(nodeId, promptId, data.exception_message || "执行失败");
    }
  }

  async function submitExecution(payload) {
    const response = await fetch("/infinite_canvas/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, clientId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error((data && data.error) || `运行失败（${response.status}）`);
    }
    if (!data || !data.prompt_id) throw new Error("ComfyUI 未返回任务 id");
    return data.prompt_id;
  }

  function stopPolling(promptId) {
    const timer = pollers.get(promptId);
    if (timer) clearInterval(timer);
    pollers.delete(promptId);
  }

  function failPrompt(nodeId, promptId, message) {
    if (settledPrompts.has(promptId)) return;
    settledPrompts.add(promptId);
    stopPolling(promptId);
    promptNodes.delete(promptId);
    nodePrompts.delete(nodeId);
    const state = runStates[nodeId];
    if (state) {
      state.status = "error";
      state.error = message || "运行失败";
    }
    setTimeout(() => {
      if (runStates[nodeId]?.status === "error") delete runStates[nodeId];
    }, 4000);
  }

  function finishPrompt(nodeId, promptId, images) {
    if (settledPrompts.has(promptId)) return;
    settledPrompts.add(promptId);
    stopPolling(promptId);
    promptNodes.delete(promptId);
    nodePrompts.delete(nodeId);

    const state = runStates[nodeId];
    const items = itemsFromRefs(images);
    if (items.length) {
      appendItems(nodeId, items);
      if (state) state.status = "done";
      notifyDone();
    } else if (state) {
      state.status = "error";
      state.error = "工作流没有返回素材";
    }
    setTimeout(() => {
      if (runStates[nodeId]?.status !== "error") delete runStates[nodeId];
    }, 1000);
  }

  async function checkPrompt(nodeId, promptId) {
    if (settledPrompts.has(promptId) || !promptNodes.has(promptId)) return;
    let data = null;
    try {
      const response = await fetch(`/infinite_canvas/api/prompts/${encodeURIComponent(promptId)}`);
      data = await response.json().catch(() => null);
    } catch {
      return;
    }
    if (!data) return;
    if (data.status === "error") {
      failPrompt(nodeId, promptId, data.error);
      return;
    }
    if (data.status !== "done") {
      // 排队中还是执行中由 ComfyUI 队列给出，没开始前不显示假进度
      const state = runStates[nodeId];
      if (state) {
        state.status = data.status === "queued" ? "queued" : "running";
        state.position = Number(data.position) || 0;
      }
      return;
    }
    finishPrompt(nodeId, promptId, data.images || []);
  }

  // 提交成功后先按"排队中"接管，第一次查询会立刻纠正成运行中
  function trackPrompt(nodeId, promptId) {
    promptNodes.set(promptId, nodeId);
    nodePrompts.set(nodeId, promptId);
    runStates[nodeId] = {
      status: "queued",
      error: "",
      position: 0,
      promptId,
      // 从提交开始计时（排队时间也算），界面显示已等/已用时长
      startedAt: Date.now(),
    };
    ensureSocket();

    const started = Date.now();
    const timer = setInterval(() => {
      // 超过 30 分钟视为异常，避免无限挂起
      if (Date.now() - started > 30 * 60 * 1000) {
        failPrompt(nodeId, promptId, "等待超时，任务可能仍在执行");
        return;
      }
      checkPrompt(nodeId, promptId);
    }, 2500);
    pollers.set(promptId, timer);

    setTimeout(() => checkPrompt(nodeId, promptId), 800);
  }

  // 先清本地状态（同步执行，删除节点时可以立即生效），返回要取消的任务 id
  function clearRunState(nodeId) {
    const state = runStates[nodeId];
    const promptId = state?.promptId || nodePrompts.get(nodeId) || "";
    if (promptId) {
      settledPrompts.add(promptId);
      stopPolling(promptId);
      promptNodes.delete(promptId);
    }
    nodePrompts.delete(nodeId);
    delete runStates[nodeId];
    return promptId;
  }

  // 运行中的任务中断执行，排队中的任务移出队列
  async function abortPrompt(nodeId) {
    const promptId = clearRunState(nodeId);
    if (!promptId) return "";
    try {
      const response = await fetch("/infinite_canvas/api/queue/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      });
      const data = await response.json().catch(() => null);
      return (data && data.action) || "";
    } catch {
      return "";
    }
  }

  onScopeDispose(() => {
    offConnect();
    offConnectStart();
    offConnectEnd();
    offNodeDragStop();
    for (const timer of pollers.values()) clearInterval(timer);
    pollers.clear();
    if (socket) socket.close();
  });

  // 编辑产物（裁切 / 扩图 / 宫格）先上传成 input 素材，再作为节点内容
  async function uploadAsset(blob, name) {
    const filename = name || "edit.png";
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    return uploadFile(file, guessKind(filename));
  }

  // 编辑结果覆盖节点里的某张素材：保留原 id，堆叠位置不变
  function replaceMediaItem(nodeId, i, item) {
    const node = nodes.value.find((entry) => entry.id === nodeId);
    if (!node) return false;
    const list = node.data.media || [];
    if (!list[i]) return false;
    node.data.media = list.map((old, k) => (k === i ? { ...item, id: old.id } : old));
    return true;
  }

  // 在源节点旁边建一个不连线的新节点（宫格切分 / 拼接的产物）
  function spawnDetachedNode(sourceId, items = []) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    const x = Math.round(source.position.x + NODE_WIDTH + 80);
    let y = Math.round(source.position.y);
    // 与已有节点重叠时继续向下排开
    while (
      nodes.value.some(
        (node) => Math.abs(node.position.x - x) < 40 && Math.abs(node.position.y - y) < NODE_HEIGHT
      )
    ) {
      y += NODE_HEIGHT + 40;
    }

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: { x, y },
        data: { ...baseData(`${nodeSeq}`), media: items, index: 0 },
      },
    ];
    return id;
  }

  // 把节点里的一张素材拖到画布空白处：用这张素材新建一个不连线的节点
  function spawnMediaNodeAt(sourceId, i, clientX, clientY) {
    const source = nodes.value.find((item) => item.id === sourceId);
    const item = source?.data?.media?.[i];
    if (!source || !item) return null;

    const point = flow.screenToFlowCoordinate({ x: clientX, y: clientY });
    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(point.x - NODE_WIDTH / 2),
          y: Math.round(point.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          workflow: source.data.workflow || defaultWorkflow(),
          // 素材是复制出来的，id 重新生成，避免和源节点在同一上游上被去重
          media: [{ ...item, id: newId() }],
          index: 0,
        },
      },
    ];
    return id;
  }

  // 从资产库拖进画布：在落点新建一个只带这批素材的节点
  function spawnItemsNodeAt(items, clientX, clientY) {
    if (!items || !items.length) return null;

    const point = flow.screenToFlowCoordinate({ x: clientX, y: clientY });
    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(point.x - NODE_WIDTH / 2),
          y: Math.round(point.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          media: items,
          index: 0,
        },
      },
    ];
    return id;
  }

  return {
    nodes,
    edges,
    viewport,
    runStates,
    submitExecution,
    trackPrompt,
    abortPrompt,
    onDblClick,
    importMedia,
    appendMedia,
    appendItems,
    spawnChildNode,
    duplicateNode,
    spawnMediaNodeAt,
    spawnItemsNodeAt,
    itemsFromRefs,
    uploadAsset,
    replaceMediaItem,
    spawnDetachedNode,
    exportCanvas,
    loadCanvas,
    resetCanvas,
    focusNode,
    fitCanvas,
  };
}

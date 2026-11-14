import { ref } from "vue";

// 右上角「提示词 / 资产库 / 日志」面板与节点提示词框之间共享的状态
// 模块级单例：App 挂面板，Node 只需要登记自己能接收提示词
const panel = ref(null); // "prompt" | "asset" | "log" | null
// 面板打开（选中）的节点各自的写入通道：nodeId -> { insert(text, useCaret), isActive() }
const targets = new Map();
// 最近一次聚焦过的写入目标：面板里的点击会让输入框失焦，
// 这里在 mousedown 时先记下来，双击插入时仍能按原光标位置写入
let lastActiveId = null;
// 给面板底部提示用：当前有多少个节点可以接收提示词
const targetCount = ref(0);
// 拖放替换通道：nodeId -> (text) => void。和插入通道分开登记，
// 因为插入通道会"一次写给所有可接收节点"，替换只针对落点那一个
const replaceTargets = new Map();

// 从资产库拖进画布时用的私有类型，避免和系统文件、节点素材混淆
export const FILE_ASSET_DRAG_TYPE = "application/x-infinite-canvas-file-asset";
// 从提示词面板拖到画布/节点上时用这个类型，载荷是 { id, name, text, type }
export const PROMPT_DRAG_TYPE = "application/x-infinite-canvas-prompt";

// 被嵌在 ComfyUI 的 iframe 里时，异步剪贴板 API 可能因权限或焦点被拒，
// 退回 execCommand + 临时 textarea（点击条目本身是用户手势，仍然有效）
function legacyCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

export function useLibrary() {
  function open(name) {
    panel.value = name;
  }

  function close() {
    panel.value = null;
  }

  function toggle(name) {
    panel.value = panel.value === name ? null : name;
  }

  // 节点面板展开时登记，收起/卸载时注销
  function registerTarget(nodeId, target) {
    targets.set(nodeId, target);
    targetCount.value = targets.size;
  }

  function unregisterTarget(nodeId) {
    if (lastActiveId === nodeId) lastActiveId = null;
    if (!targets.delete(nodeId)) return;
    targetCount.value = targets.size;
  }

  // 在会抢走焦点的操作（面板里 mousedown）之前调用，记住当前聚焦的输入框
  function captureActive() {
    const entry = [...targets.entries()].find(([, target]) => target.isActive?.());
    if (entry) lastActiveId = entry[0];
  }

  // 拖放替换：节点挂载时登记自己"把提示词整体写进去"的能力，
  // 字段怎么找、没有字段时落到草稿，都由节点自己决定
  function registerReplace(nodeId, fn) {
    replaceTargets.set(nodeId, fn);
  }

  function unregisterReplace(nodeId) {
    replaceTargets.delete(nodeId);
  }

  function replacePromptText(nodeId, text) {
    const fn = replaceTargets.get(nodeId);
    if (!fn) return false;
    fn(text);
    return true;
  }

  // 点条目：有聚焦的提示词框就按光标插入（全选时即整体替换），
  // 否则写回最近聚焦过的节点；一个都没选中时复制到剪贴板
  async function insertPrompt(text) {
    if (!text) return "";
    if (!targets.size) {
      return (await copyText(text)) ? "copied" : "failed";
    }
    const active = [...targets.entries()].find(([, target]) => target.isActive?.());
    if (active) {
      active[1].insert(text, true);
    } else {
      const remembered = lastActiveId ? targets.get(lastActiveId) : null;
      if (remembered) remembered.insert(text, true);
      else targets.forEach((target) => target.insert(text, false));
    }
    // 面板保持打开，方便连续插入
    return "inserted";
  }

  return {
    panel,
    targetCount,
    open,
    close,
    toggle,
    registerTarget,
    unregisterTarget,
    captureActive,
    insertPrompt,
    registerReplace,
    unregisterReplace,
    replacePromptText,
  };
}

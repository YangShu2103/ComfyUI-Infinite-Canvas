import { ref } from "vue";

// 右上角「提示词 / 资产库」面板与节点提示词框之间共享的状态
// 模块级单例：App 挂面板，Node 只需要登记插入目标
const panel = ref(null); // "prompt" | "asset" | null
const promptTarget = ref(null); // { nodeId, insert(text) }

// 从资产库拖进画布时用的私有类型，避免和系统文件、节点素材混淆
export const FILE_ASSET_DRAG_TYPE = "application/x-infinite-canvas-file-asset";

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

  function setPromptTarget(target) {
    promptTarget.value = target;
  }

  // 点条目时插入到最近编辑的提示词框；没有目标时保持面板打开并返回 false
  function insertPrompt(text) {
    const target = promptTarget.value;
    if (!target || !text) return false;
    target.insert(text);
    panel.value = null;
    return true;
  }

  return { panel, promptTarget, open, close, toggle, setPromptTarget, insertPrompt };
}

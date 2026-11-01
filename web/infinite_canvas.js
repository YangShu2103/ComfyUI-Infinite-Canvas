import { app } from "/scripts/app.js";

const BTN_ID = "infinite-canvas-topbar-btn";
const MODAL_ID = "infinite-canvas-modal";
const STYLE_ID = "infinite-canvas-style";
const LOG = "[Infinite-Canvas]";
const READY_FLAG = "__INFINITE_CANVAS_READY__";

const LABEL = "Infinite-Canvas";
const ANCHOR_LABELS = ["管理扩展功能", "Manage extensions", "Manage Extensions"];

// 换掉锚点按钮的图标内容（沿用原生 svg 元素，只替换内部 path，保证尺寸/颜色一致）
const ICON_PATHS = `
  <rect x="3" y="3" width="18" height="18" rx="2" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></rect>
  <path d="M3 9h18" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"></path>
  <path d="M9 21V9" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"></path>`;

// 弹窗页面地址：Vue 构建产物，由后端静态路由托管
const PAGE_CANDIDATES = ["/infinite_canvas/app/index.html"];

let resolvedPageUrl = null;
let buttonEl = null;
let injecting = false;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
/* 克隆出来的按钮：只补一条防穿透，其余样式全部来自原生节点 */
#${BTN_ID} { position: relative; z-index: 1; pointer-events: auto; }

/* 没有「管理扩展功能」（未装 ComfyUI-Manager）时自己长出来的入口 */
#${BTN_ID}.ic-fallback {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin: 4px;
  padding: 0 10px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  background: var(--comfy-menu-bg, #202020);
  color: var(--input-text, #e0e0e0);
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
}
#${BTN_ID}.ic-fallback:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
/* 连顶部菜单容器都拿不到时，退化成右上角悬浮按钮，保证入口一定可见 */
#${BTN_ID}.ic-float {
  position: fixed;
  top: 10px;
  right: 10px;
  margin: 0;
  z-index: 20000;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}

#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.6);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
#${MODAL_ID}.ic-open { display: flex; }
#${MODAL_ID} .ic-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--comfy-menu-bg, #202020);
}
#${MODAL_ID} .ic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #333);
  color: var(--input-text, #e0e0e0);
  font-size: 14px;
  font-weight: 600;
}
#${MODAL_ID} .ic-close {
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
#${MODAL_ID} .ic-close:hover { background: rgba(255,255,255,.1); }
#${MODAL_ID} .ic-frame {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  background: #181818;
}
`;
  document.head.appendChild(style);
}

// ---- 弹窗 ----

function openModal() {
  const overlay = document.getElementById(MODAL_ID) || buildModal();
  overlay.classList.add("ic-open");
  const frame = overlay.querySelector(".ic-frame");
  resolvePageUrl().then((url) => {
    // 带时间戳，避免缓存，方便改完 index.html 立即看到效果
    frame.src = `${url}?t=${Date.now()}`;
  });
}

function closeModal() {
  const overlay = document.getElementById(MODAL_ID);
  if (!overlay) return;
  overlay.classList.remove("ic-open");
  const frame = overlay.querySelector(".ic-frame");
  if (frame) frame.src = "about:blank";
}

function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.innerHTML = `
<div class="ic-panel">
  <div class="ic-header">
    <span>Infinite-Canvas</span>
    <button class="ic-close" type="button" title="关闭">&times;</button>
  </div>
  <iframe class="ic-frame" title="Infinite-Canvas" src="about:blank"></iframe>
</div>`;

  overlay.querySelector(".ic-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  return overlay;
}

async function resolvePageUrl() {
  if (resolvedPageUrl) return resolvedPageUrl;
  for (const url of PAGE_CANDIDATES) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        resolvedPageUrl = url;
        return url;
      }
    } catch (err) {
      // 尝试下一个候选地址
    }
  }
  resolvedPageUrl = PAGE_CANDIDATES[0];
  return resolvedPageUrl;
}

// ---- 顶部栏按钮（克隆原生节点实现） ----

function normalizeText(value) {
  return (value || "").replace(/\s+/g, "");
}

function findAnchorButton() {
  const nodes = document.querySelectorAll(
    'button, a, [role="button"], [role="menuitem"], [role="tab"]'
  );
  const labels = ANCHOR_LABELS.map(normalizeText);

  const candidates = [];
  for (const el of nodes) {
    if (el === buttonEl || el.querySelector(`#${BTN_ID}`)) continue;
    candidates.push({
      el,
      texts: [
        el.textContent,
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
      ].map(normalizeText),
    });
  }

  for (const label of labels) {
    for (const c of candidates) {
      if (c.texts.some((t) => t === label)) return c.el;
    }
  }
  for (const label of labels) {
    for (const c of candidates) {
      if (c.texts.some((t) => t && t.includes(label))) return c.el;
    }
  }
  return null;
}

// 祖先链（跨越 shadow root 边界）
function ancestorChain(el) {
  const chain = [];
  let cur = el;
  while (cur) {
    chain.push(cur);
    cur = cur.parentElement || cur.getRootNode?.()?.host || null;
  }
  return chain;
}

function commonAncestor(a, b) {
  const setB = new Set(ancestorChain(b));
  for (const node of ancestorChain(a)) {
    if (setB.has(node)) return node;
  }
  return null;
}

// 从 el 往上找，返回「其父节点正好是 ancestor」的那一层
function climbToChildOf(el, ancestor) {
  let cur = el;
  while (cur) {
    if (cur.parentElement === ancestor) return cur;
    if (cur.parentElement) {
      cur = cur.parentElement;
      continue;
    }
    const host = cur.getRootNode?.()?.host;
    if (host === ancestor) return cur;
    cur = host || null;
  }
  return null;
}

// 找到承载文案的节点：它要么是叶子，要么除 svg 外没有别的子元素
function findLabelNode(root, labels) {
  const norm = new Set(labels.map(normalizeText));
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const otherChildren = [...el.children].filter(
      (c) => c.tagName.toLowerCase() !== "svg"
    );
    if (otherChildren.length) continue;
    if (norm.has(normalizeText(el.textContent))) return el;
  }
  return null;
}

// 只替换文本节点，保留同级的 svg 图标
function replaceLabelText(el, text) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue)) {
      node.nodeValue = text;
      return true;
    }
  }
  return false;
}

// 复制锚点按钮的外观：优先整块克隆它所在的卡片（含外层壳），退化则只克隆按钮
function buildClone(anchor) {
  const menuEl = app.menu?.element;
  const common = menuEl ? commonAncestor(anchor, menuEl) : null;
  const card = common ? climbToChildOf(anchor, common) : null;

  if (card && card !== anchor) {
    const clone = card.cloneNode(true);
    const buttons = clone.querySelectorAll("button");
    // 克隆内容必须真的带上了文案，且卡片里只有一个按钮才可用
    if (findLabelNode(clone, ANCHOR_LABELS) && buttons.length <= 1) {
      return { node: clone, ref: card };
    }
  }
  return { node: anchor.cloneNode(true), ref: anchor };
}

function injectButton({ anchorOnly = false, forceFloat = false } = {}) {
  if (buttonEl?.isConnected) return true;
  if (injecting) return false;
  injecting = true;

  try {
    const anchor = findAnchorButton();
    if (anchor) {
      const { node, ref } = buildClone(anchor);
      if (!ref?.parentElement) return false;

      node.id = BTN_ID;
      node.removeAttribute?.("disabled");

      const labelNode = findLabelNode(node, ANCHOR_LABELS);
      if (labelNode) replaceLabelText(labelNode, LABEL);
      else console.warn(LOG, "未找到文案节点，按钮文字可能仍是原样");

      // 换图标：仅在原生 svg 使用 24x24 viewBox 时替换内部 path
      const svg = node.querySelector("svg");
      if (svg && svg.getAttribute("viewBox") === "0 0 24 24") {
        svg.innerHTML = ICON_PATHS;
      }

      node.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      });

      ref.parentElement.insertBefore(node, ref);
      buttonEl = node;

      // 兜底：清掉可能存在的重复实例
      document.querySelectorAll(`[id="${BTN_ID}"]`).forEach((n) => {
        if (n !== node) n.remove();
      });

      console.log(LOG, "按钮已注入（克隆自「管理扩展功能」）", node);
      return true;
    }

    // 没有 Manager 提供的锚点：先等一会儿让顶部菜单渲染出来，再自己造一个入口
    if (anchorOnly) return false;
    return injectFallbackButton(forceFloat);
  } catch (err) {
    console.error(LOG, "注入入口失败", err);
    return false;
  } finally {
    injecting = false;
  }
}

// 顶部菜单容器：优先用 app.menu.element，再退到旧版 .comfy-menu
function findMenuHost() {
  const candidates = [
    app.menu?.element,
    document.querySelector(".comfy-menu"),
  ];
  for (const el of candidates) {
    if (!el) continue;
    const rect = el.getBoundingClientRect?.();
    // 只有放在屏幕上真的看得见才往里塞，否则会造出一个隐形按钮
    if (rect && rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

function injectFallbackButton(forceFloat = false) {
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.className = "ic-fallback";
  btn.title = LABEL;
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${ICON_PATHS}</svg><span>${LABEL}</span>`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openModal();
  });

  const host = forceFloat ? null : findMenuHost();
  if (host) {
    host.insertBefore(btn, host.firstChild);
    console.log(LOG, "未找到「管理扩展功能」，已在顶部菜单注入独立入口");
  } else {
    btn.classList.add("ic-float");
    document.body.appendChild(btn);
    console.log(LOG, "未找到「管理扩展功能」与菜单容器，已在右上角注入悬浮入口");
  }

  buttonEl = btn;
  // 兜底：清掉可能存在的重复实例
  document.querySelectorAll(`[id="${BTN_ID}"]`).forEach((n) => {
    if (n !== btn) n.remove();
  });
  return true;
}

function startInjection() {
  let tries = 0;
  const attempt = () => {
    // 前 1.5 秒只找 Manager 的锚点，给顶部菜单一点渲染时间；
    // 之后开始自造入口，20 次（10 秒）仍拿不到菜单容器就用右上角悬浮按钮，
    // 保证没装 ComfyUI-Manager 的环境也能打开画布
    const ok = injectButton({ anchorOnly: tries < 3, forceFloat: tries >= 20 });
    if (ok) return;
    tries += 1;
    if (tries < 120) {
      setTimeout(attempt, 500);
      return;
    }
    console.warn(LOG, "入口注入失败：页面里既没有「管理扩展功能」也没有可用的菜单容器");
  };
  attempt();

  // 低频看门狗：按钮被前端重渲染彻底移除时才补回。
  // 周期远大于 detach/attach 的窗口，不会像 MutationObserver 那样误判重建。
  setInterval(() => {
    if (buttonEl?.isConnected) return;
    console.warn(LOG, "按钮不在页面中，重新注入");
    injectButton();
  }, 5000);
}

function onKeyDown(e) {
  if (e.key === "Escape") closeModal();
}

app.registerExtension({
  name: "ComfyUI.InfiniteCanvas",

  setup() {
    // 防止该模块被前端加载两次时注入出两个按钮
    if (window[READY_FLAG]) {
      console.log(LOG, "已初始化，跳过重复注入");
      return;
    }
    window[READY_FLAG] = true;

    injectStyles();
    startInjection();
    document.addEventListener("keydown", onKeyDown);
    console.log(LOG, "扩展已启动");
  },
});

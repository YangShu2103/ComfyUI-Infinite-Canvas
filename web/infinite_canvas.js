import { app } from "/scripts/app.js";

const BTN_ID = "infinite-canvas-fab";
const MODAL_ID = "infinite-canvas-modal";
const STYLE_ID = "infinite-canvas-style";
const LOG = "[Infinite-Canvas]";
const READY_FLAG = "__INFINITE_CANVAS_READY__";

const LABEL = "Infinite-Canvas";
// 入口位置记忆（拖拽后可移动）
const POS_KEY = "infinite-canvas-fab-pos";
const POS_API = "/infinite_canvas/api/fab-position";
const BTN_SIZE = 44;
const EDGE_GAP = 6;

// 入口图标：四宫格画布
const ICON_PATHS = `
  <rect x="3" y="3" width="18" height="18" rx="4" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></rect>
  <path d="M12 3v18M3 12h18" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"></path>`;

// 弹窗页面地址：Vue 构建产物，由后端静态路由托管
const PAGE_CANDIDATES = ["/infinite_canvas/app/index.html"];

let resolvedPageUrl = null;
let buttonEl = null;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
/* 右侧悬浮入口：圆形按钮，可拖拽到任意位置 */
#${BTN_ID} {
  position: fixed;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${BTN_SIZE}px;
  height: ${BTN_SIZE}px;
  padding: 0;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.14));
  border-radius: 50%;
  background: var(--comfy-menu-bg, #202020);
  color: var(--input-text, #d8d8dc);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease,
    box-shadow 0.16s ease;
}
#${BTN_ID}:hover {
  transform: translateY(-1px) scale(1.06);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.55);
}
/* 拖拽中：跟随指针移动，不保留悬停放大 */
#${BTN_ID}.ic-dragging {
  cursor: grabbing;
  transform: none;
  transition: none;
}
#${BTN_ID}:active { transform: scale(0.97); }
#${BTN_ID} svg { pointer-events: none; }

#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
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
#${MODAL_ID} .ic-frame {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
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

// 画布内的右下角菜单点「退出画布」时通知这里关闭弹窗
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== "infinite-canvas:close") return;
  closeModal();
});

function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.innerHTML = `
<div class="ic-panel">
  <iframe class="ic-frame" title="Infinite-Canvas" src="about:blank"></iframe>
</div>`;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("ic-open")) closeModal();
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

// ---- 悬浮入口 ----

// 默认贴在页面右侧、约 58% 高度，避开顶栏与右下角缩放控件
function defaultPosition() {
  return {
    left: window.innerWidth - BTN_SIZE - 18,
    top: Math.round(window.innerHeight * 0.58),
  };
}

// 位置限制在可视区域内，窗口缩小后也不会跑到屏幕外
function clampPosition(pos) {
  const maxLeft = Math.max(EDGE_GAP, window.innerWidth - BTN_SIZE - EDGE_GAP);
  const maxTop = Math.max(EDGE_GAP, window.innerHeight - BTN_SIZE - EDGE_GAP);
  return {
    left: Math.min(Math.max(pos.left, EDGE_GAP), maxLeft),
    top: Math.min(Math.max(pos.top, EDGE_GAP), maxTop),
  };
}

// 按比例存位置（fx/fy 是按钮左上角占视口的比例），换屏幕尺寸也能落在相近位置
function positionToFraction(pos) {
  return {
    fx: window.innerWidth ? pos.left / window.innerWidth : 0,
    fy: window.innerHeight ? pos.top / window.innerHeight : 0,
    ts: Date.now(),
  };
}

function fractionToPosition(data) {
  return clampPosition({
    left: data.fx * window.innerWidth,
    top: data.fy * window.innerHeight,
  });
}

function readLocalPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (!saved) return null;
    if (Number.isFinite(saved.fx) && Number.isFinite(saved.fy)) return saved;
    // 兼容旧版本存的像素位置
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      return positionToFraction(saved);
    }
  } catch {
    // 位置数据损坏就当作没有存过
  }
  return null;
}

function writeLocalPosition(data) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(data));
  } catch {
    // 浏览器禁用存储时忽略，后端仍会记住位置
  }
}

function applyPosition(pos) {
  if (!buttonEl) return null;
  const next = clampPosition(pos);
  buttonEl.style.left = `${next.left}px`;
  buttonEl.style.top = `${next.top}px`;
  return next;
}

function currentPosition() {
  return {
    left: parseFloat(buttonEl?.style.left) || 0,
    top: parseFloat(buttonEl?.style.top) || 0,
  };
}

// 拖拽结束：本地立即记住，同时写回后端，换浏览器/设备也能恢复
function savePosition(pos) {
  const data = positionToFraction(pos);
  writeLocalPosition(data);
  fetch(POS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}

// 打开页面时恢复上次位置：本地优先，再用后端较新的记录覆盖
async function restorePosition() {
  const local = readLocalPosition();
  applyPosition(local ? fractionToPosition(local) : defaultPosition());

  try {
    const res = await fetch(POS_API, { cache: "no-store" });
    if (!res.ok) return;
    const remote = (await res.json())?.fab_position;
    if (!remote || !Number.isFinite(remote.fx) || !Number.isFinite(remote.fy)) return;
    // 后端记录比本地新（比如换了设备拖过位置）才覆盖
    if (local && (remote.ts || 0) <= (local.ts || 0)) return;
    const data = { fx: remote.fx, fy: remote.fy, ts: remote.ts || 0 };
    writeLocalPosition(data);
    applyPosition(fractionToPosition(data));
  } catch {
    // 后端不可用时只用本地位置
  }
}

function bindDrag(btn) {
  let drag = null;
  let dragged = false;
  let lastPos = null;

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    drag = { pointerId: e.pointerId, startX: rect.left, startY: rect.top, x: e.clientX, y: e.clientY };
    dragged = false;
    lastPos = { left: rect.left, top: rect.top };
    btn.setPointerCapture(e.pointerId);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    // 小于 4px 的抖动算点击，不算拖拽
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    if (!dragged) {
      dragged = true;
      btn.classList.add("ic-dragging");
    }
    lastPos = applyPosition({ left: drag.startX + dx, top: drag.startY + dy }) || lastPos;
  });

  const finish = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    btn.releasePointerCapture?.(e.pointerId);
    btn.classList.remove("ic-dragging");
    // 拖过位置就记住，没拖动就是一次普通点击
    if (dragged) savePosition(lastPos || currentPosition());
    else openModal();
  };
  btn.addEventListener("pointerup", finish);
  btn.addEventListener("pointercancel", finish);

  // 键盘操作：聚焦后回车/空格也能打开
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal();
    }
  });
}

function mountButton() {
  if (buttonEl?.isConnected) return true;

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.title = `${LABEL}（可拖动）`;
  btn.setAttribute("aria-label", LABEL);
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICON_PATHS}</svg>`;

  document.body.appendChild(btn);
  buttonEl = btn;
  applyPosition(defaultPosition());
  restorePosition();
  bindDrag(btn);

  // 兜底：清掉可能存在的重复实例
  document.querySelectorAll(`[id="${BTN_ID}"]`).forEach((n) => {
    if (n !== btn) n.remove();
  });

  console.log(LOG, "悬浮入口已挂载");
  return true;
}

function onKeyDown(e) {
  if (e.key === "Escape") closeModal();
}

app.registerExtension({
  name: "ComfyUI.InfiniteCanvas",

  setup() {
    // 防止该模块被前端加载两次时注入两个入口
    if (window[READY_FLAG]) {
      console.log(LOG, "已初始化，跳过重复注入");
      return;
    }
    window[READY_FLAG] = true;

    injectStyles();
    mountButton();
    document.addEventListener("keydown", onKeyDown);

    // 窗口尺寸变化后把按钮拉回可视范围内（保留用户保存的位置，仅本次夹紧）
    window.addEventListener("resize", () => {
      if (buttonEl?.isConnected) applyPosition(currentPosition());
    });

    // 低频看门狗：前端重渲染把按钮移除时才补回
    setInterval(() => {
      if (!buttonEl?.isConnected) mountButton();
    }, 5000);

    console.log(LOG, "扩展已启动");
  },
});

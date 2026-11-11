<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="ctx-mask"
      @pointerdown.self="close"
      @contextmenu.prevent="close"
      @wheel.passive="close"
    >
      <div
        class="ctx-menu"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @pointerdown.stop
        @contextmenu.prevent
        @mousedown.stop
      >
        <button class="ctx-item" type="button" disabled>
          <span>提示词节点</span>
          <span class="ctx-tag">开发中</span>
        </button>
        <button class="ctx-item" type="button" @click="pick('preprocess')">
          <span>预处理节点</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, watch } from "vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
});
const emit = defineEmits(["pick", "close"]);

function close() {
  emit("close");
}

function pick(key) {
  emit("pick", key);
  emit("close");
}

function onKeyDown(event) {
  if (event.key === "Escape") close();
}

// 打开时监听 Esc，关闭就摘掉，避免常驻键盘监听
watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeyDown, true);
    else window.removeEventListener("keydown", onKeyDown, true);
  }
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown, true));
</script>

<style scoped>
/* 透明的全屏遮罩：点到菜单外面任意位置就关掉 */
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.ctx-menu {
  position: fixed;
  min-width: 168px;
  padding: 6px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-panel);
  box-shadow: 0 10px 30px var(--c-shadow);
  backdrop-filter: blur(10px);
}

.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--c-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.ctx-item:not(:disabled):hover {
  background: var(--c-hover);
}

.ctx-item:disabled {
  color: var(--c-muted);
  cursor: default;
}

.ctx-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--c-panel-2);
  color: var(--c-muted);
  font-size: 10px;
  line-height: 16px;
}
</style>

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
        <div v-if="header" class="ctx-head" :title="header">{{ header }}</div>
        <button
          v-for="item in items"
          :key="item.key"
          class="ctx-item"
          :class="{ 'is-danger': item.danger }"
          type="button"
          :disabled="item.disabled"
          @click="pick(item.key)"
        >
          <svg v-if="item.icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              v-for="(d, k) in item.icon"
              :key="k"
              :d="d"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ item.label }}</span>
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
  items: { type: Array, default: () => [] },
  // 菜单顶部的语境标识：空白处是「新建节点」，节点上是节点名称
  header: { type: String, default: "" },
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

.ctx-head {
  padding: 4px 10px 7px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--c-line);
  color: var(--c-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
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

.ctx-item svg {
  flex: 0 0 auto;
  opacity: 0.7;
}

.ctx-item.is-danger {
  color: var(--c-danger);
}

.ctx-item.is-danger svg {
  opacity: 0.9;
}

.ctx-item:not(:disabled):hover {
  background: var(--c-hover);
}

.ctx-item:disabled {
  color: var(--c-muted);
  cursor: default;
}
</style>

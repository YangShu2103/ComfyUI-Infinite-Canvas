<template>
  <div
    class="preview-node"
    :class="{ 'is-configurable': data.exposed > 0 }"
    :style="{ '--n-hue': data.hue }"
  >
    <Handle type="target" :position="Position.Left" class="preview-handle" />
    <div class="preview-title">
      {{ data.title }}<span class="preview-id">#{{ id }}</span>
    </div>
    <div class="preview-type">
      {{ data.classType }}
      <span v-if="data.exposed" class="preview-count">{{ data.exposed }} 已用</span>
    </div>
    <Handle type="source" :position="Position.Right" class="preview-handle" />
  </div>
</template>

<script setup>
import { Handle, Position } from "@vue-flow/core";

defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});
</script>

<style scoped>
.preview-node {
  width: 168px;
  padding: 6px 9px;
  border: 1px solid hsl(var(--n-hue) 42% 55% / 0.5);
  border-radius: 8px;
  background: hsl(var(--n-hue) 32% 15%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.preview-node:hover {
  border-color: hsl(var(--n-hue) 55% 70%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.preview-node.is-configurable {
  border-color: rgba(242, 255, 89, 0.55);
}

.preview-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #e6e6ea;
  white-space: nowrap;
  overflow: hidden;
}

.preview-title > span {
  flex: 0 0 auto;
}

.preview-id {
  font-weight: 400;
  font-size: 10px;
  color: hsl(var(--n-hue) 55% 72%);
}

.preview-type {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 10px;
  color: #9a9aa8;
  white-space: nowrap;
  overflow: hidden;
}

.preview-count {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--accent-yellow);
}

.preview-handle {
  width: 6px;
  height: 6px;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: hsl(var(--n-hue) 45% 60% / 0.7);
}
</style>

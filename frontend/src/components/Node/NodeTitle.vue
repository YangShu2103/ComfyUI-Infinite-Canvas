<script setup>
import { nextTick, ref } from "vue";

// 节点左上角的名称：单击进入改名，回车 / 失焦保存，Esc 取消。
// badge 是给「任务 N」这类角标留的位置，名称排在角标后面
const props = defineProps({
  title: { type: String, default: "" },
  badge: { type: String, default: "" },
});
const emit = defineEmits(["rename"]);

const editing = ref(false);
const draft = ref("");
const inputEl = ref(null);

function start() {
  draft.value = props.title;
  editing.value = true;
  nextTick(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
  });
}

function commit() {
  if (!editing.value) return;
  editing.value = false;
  const value = draft.value.trim();
  if (value && value !== props.title) emit("rename", value);
}

function cancel() {
  editing.value = false;
}

defineExpose({ start });
</script>

<template>
  <div class="node-title" @mousedown.stop @click.stop @dblclick.stop>
    <span v-if="badge" class="node-title-badge">{{ badge }}</span>
    <input
      v-if="editing"
      ref="inputEl"
      v-model="draft"
      class="node-title-input"
      spellcheck="false"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    />
    <span v-else class="node-title-text" :title="title" @click="start">{{ title }}</span>
  </div>
</template>

<style scoped>
.node-title {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  /* 固定行高：切换成输入框时不改变节点布局 */
  height: 16px;
  color: var(--c-muted);
  font-size: 11px;
  line-height: 16px;
  user-select: none;
  cursor: text;
}

.node-title-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--c-accent-weak);
  color: var(--c-accent-ink);
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
}

.node-title-text {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-title-text:hover {
  color: var(--c-text);
}

.node-title-input {
  width: 150px;
  max-width: 100%;
  height: 16px;
  box-sizing: border-box;
  padding: 0 4px;
  border: 1px solid var(--c-accent);
  border-radius: 4px;
  background: var(--c-input-bg);
  color: var(--c-text);
  font-family: inherit;
  font-size: 11px;
  line-height: 14px;
  outline: none;
}
</style>

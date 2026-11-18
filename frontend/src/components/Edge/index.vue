<template>
  <BaseEdge
    :path="path"
    :marker-end="markerEnd"
    class="canvas-edge"
    :class="{ 'is-highlight': linkedToSelected, 'is-running': linkedToRunning }"
  />

  <!-- 高亮 / 运行中的连线：渐变按半个连线长度平铺并循环平移，
       一圈正好推进一个周期，循环处严丝合缝，不会出现空档 -->
  <template v-if="(linkedToSelected || linkedToRunning) && flowOn">
    <defs>
      <linearGradient
        :id="gradId"
        gradientUnits="userSpaceOnUse"
        :x1="sourceX"
        :y1="sourceY"
        :x2="gradX2"
        :y2="gradY2"
        spreadMethod="repeat"
      >
        <stop class="flow-edge-stop" offset="0" />
        <stop class="flow-peak-stop" offset="0.5" />
        <stop class="flow-edge-stop" offset="1" />
        <animateTransform
          attributeName="gradientTransform"
          type="translate"
          :values="`0 0;${dx / 2} ${dy / 2}`"
          :dur="linkedToRunning && !linkedToSelected ? '1.15s' : '1.6s'"
          repeatCount="indefinite"
        />
      </linearGradient>
    </defs>
    <path :d="path" :stroke="`url(#${gradId})`" class="edge-flow" fill="none" />
  </template>

  <!-- 透明加宽路径：只负责 hover 命中 -->
  <path
    :d="path"
    class="edge-hit"
    fill="none"
    stroke="transparent"
    stroke-width="24"
    @mouseenter="show"
    @mouseleave="hide"
  />

  <EdgeLabelRenderer>
    <div
      class="edge-tool"
      :style="{ transform: `translate(${labelX}px, ${labelY}px) scale(${invZoom})` }"
    >
      <button
        class="edge-delete"
        :class="{ 'is-on': hovered }"
        type="button"
        title="删除连线"
        @mouseenter="show"
        @mouseleave="hide"
        @click.stop="removeEdges([id])"
      >
        <svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from "@vue-flow/core";

// 多根节点组件无法继承属性：Vue Flow 会给 Edge 传一堆扩展属性，
// 不关掉的话每次重渲染都会打印一条警告（1000+ 连线时警告本身就很耗时）
defineOptions({ inheritAttrs: false });

const graph = inject("canvasGraph");

const props = defineProps({
  id: { type: String, required: true },
  // 端点节点 id：用于判断是否与选中节点相连
  source: { type: String, required: true },
  target: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  markerEnd: { type: String, default: "" },
});

const flow = useVueFlow("demo");

const hovered = ref(false);

const bezier = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })
);
const path = computed(() => bezier.value[0]);
const labelX = computed(() => bezier.value[1]);
const labelY = computed(() => bezier.value[2]);
// 删除按钮反向缩放，保证任何缩放下屏幕尺寸恒定
const invZoom = computed(() => 1 / (flow.viewport.value.zoom || 1));

// 选中的节点作为起点或终点时，这条线高亮（上游、下游都算）
const linkedToSelected = computed(() =>
  flow.getSelectedNodes.value.some(
    (node) => node.id === props.source || node.id === props.target
  )
);

// 端点节点正在运行（含排队）时，这条线也走流光，不用选中节点
const runningIds = computed(() => {
  const states = graph?.runStates;
  if (!states) return new Set();
  return new Set(
    Object.keys(states).filter((id) => {
      const status = states[id]?.status;
      return status === "running" || status === "queued";
    })
  );
});
const linkedToRunning = computed(
  () => runningIds.value.has(props.source) || runningIds.value.has(props.target)
);

// 流光开关（右下角菜单里切换，存在浏览器本地）
const flowOn = computed(() => graph?.edgeFlow?.value !== false);

// 渐变推进向量：沿 source→target 方向平移，光带才会顺着连线走
const dx = computed(() => props.targetX - props.sourceX);
const dy = computed(() => props.targetY - props.sourceY);
// 渐变周期取连线长度的一半（两个光带），平移一个周期即无缝循环
const gradX2 = computed(() => props.sourceX + dx.value / 2);
const gradY2 = computed(() => props.sourceY + dy.value / 2);
// 每条线一个独立渐变，避免互相抢同一个 id
const gradId = computed(() => `edge-flow-${String(props.id).replace(/[^\w-]/g, "_")}`);

// 路径和按钮之间留一点缓冲，避免鼠标移过去时闪一下
let hideTimer = null;
function show() {
  clearTimeout(hideTimer);
  hovered.value = true;
}
function hide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hovered.value = false;
  }, 120);
}

function removeEdges(ids) {
  graph?.captureUndo?.(true);
  flow.removeEdges(ids);
}
</script>

<style scoped>
.edge-hit {
  pointer-events: stroke;
  cursor: pointer;
}

.canvas-edge {
  stroke: var(--c-edge);
}

/* 运行中的连线：实线主题色，和选中高亮区分开（光带更快） */
.canvas-edge.is-running {
  stroke: var(--c-accent);
  stroke-width: 2.5;
}

/* 流光层：整条线填一层会平移的渐变，亮带连续扫过（不是一段段虚线） */
.edge-flow {
  stroke-width: 2.8;
  pointer-events: none;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c-accent) 70%, transparent));
}

/* 渐变两端透明、中间最亮，平移时就像一束光顺着线走 */
.flow-edge-stop {
  stop-color: var(--c-accent);
  stop-opacity: 0;
}

.flow-peak-stop {
  stop-color: color-mix(in srgb, var(--c-accent) 40%, #fff);
  stop-opacity: 1;
}

/* 锚点落在连线中点，本身不占位 */
.edge-tool {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.edge-delete {
  position: absolute;
  left: 0;
  top: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: var(--c-surface-3);
  color: var(--c-text);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.edge-delete.is-on {
  opacity: 1;
  pointer-events: all;
}

.edge-delete:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}
</style>

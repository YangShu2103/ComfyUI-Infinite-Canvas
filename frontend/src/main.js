import { createApp } from "vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "./styles/base.css";
import App from "./App.vue";
import { useTheme } from "./composables/useTheme.js";

// 挂载前先应用主题，避免刷新时闪一下默认暗色
useTheme();

createApp(App).mount("#app");

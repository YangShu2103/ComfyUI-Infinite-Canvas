import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 本地开发时接口转发到正在运行的 ComfyUI（可用 COMFYUI_URL 覆盖）
const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";

const proxy = {
  "/infinite_canvas/api": {
    target: COMFYUI_URL,
    changeOrigin: true,
  },
  // 画布素材/产物走 ComfyUI 的 /view（input、output 目录）
  "/view": {
    target: COMFYUI_URL,
    changeOrigin: true,
  },
  // ComfyUI 的进度推送走 /ws，开发服务器必须把 WebSocket 升级一起转发
  "/ws": {
    target: COMFYUI_URL,
    changeOrigin: true,
    ws: true,
  },
};

// ComfyUI 通过 /infinite_canvas/app/ 托管构建产物，base 必须和它一致
export default defineConfig({
  plugins: [vue()],
  base: "/infinite_canvas/app/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 产物体积小、同源加载，不需要拆包
    assetsInlineLimit: 4096,
  },
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    proxy,
  },
});

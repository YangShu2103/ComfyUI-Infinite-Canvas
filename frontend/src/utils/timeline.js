// 时间线节点的公共数据结构与纯函数：节点创建、片段长度、时间码都走这里，
// 避免创建逻辑和编辑器各写一份默认值

export const TIMELINE_TRACKS = [
  { id: "v2", kind: "video" },
  { id: "v1", kind: "video" },
  { id: "a1", kind: "audio" },
  { id: "a2", kind: "audio" },
];

export function createTimeline() {
  return {
    version: 1,
    fps: 30,
    width: 1280,
    height: 720,
    // 素材时长 / 尺寸等元数据，首次拖上轨道时探测并缓存
    mediaMeta: {},
    tracks: TIMELINE_TRACKS.map((track) => ({ ...track, clips: [] })),
  };
}

export function newClipId() {
  return `c${Math.random().toString(36).slice(2, 10)}`;
}

export function clipLength(clip) {
  const length = Number(clip?.out) - Number(clip?.in);
  return Number.isFinite(length) && length > 0 ? length : 0.1;
}

// 00:05 / 01:20，超过一小时才补小时位；传了 fps 就显示到帧：00:05.12
export function formatTimecode(seconds, fps = 0) {
  const total = Math.max(0, Number(seconds) || 0);
  const rate = Math.round(Number(fps) || 0);
  const pad = (value, size = 2) => String(value).padStart(size, "0");

  if (rate > 0) {
    const totalFrames = Math.round(total * rate);
    const whole = Math.floor(totalFrames / rate);
    const frames = totalFrames % rate;
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    // 帧号位数跟着帧率走：24/30/60 两位，120 三位
    const ff = pad(frames, rate >= 100 ? 3 : 2);
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}.${ff}` : `${pad(m)}:${pad(s)}.${ff}`;
  }

  const whole = Math.floor(total);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 把时间对齐到整帧：拖拽、裁剪、播放头都走它，片段边界永远是整数帧
export function roundToFrame(seconds, fps) {
  const value = Math.max(0, Number(seconds) || 0);
  const rate = Number(fps) || 0;
  if (!rate) return Math.round(value * 100) / 100;
  return Math.round(value * rate) / rate;
}

// 图片没有固有长度，默认占用 3 秒；上限给 60 秒，避免误拖出超长片段
export const IMAGE_CLIP_LENGTH = 3;
export const IMAGE_MAX_LENGTH = 60;

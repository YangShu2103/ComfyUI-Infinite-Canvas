// 与 ComfyUI ResolutionSelector 保持同一套计算：
// 比例 + 百万像素 + 对齐倍数 → 输出宽高
export const BBOX_ASPECT_RATIOS = {
  "1:1 (Square)": [1, 1],
  "2:3 (Portrait Photo)": [2, 3],
  "3:2 (Photo)": [3, 2],
  "3:4 (Portrait Standard)": [3, 4],
  "4:3 (Standard)": [4, 3],
  "9:16 (Portrait Widescreen)": [9, 16],
  "16:9 (Widescreen)": [16, 9],
  "21:9 (Ultrawide)": [21, 9],
};

// Python 的 round 是银行家舍入，这里保持一致，避免宽高差一个倍数
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function resolutionSize(aspectRatio, megapixels, multiple) {
  const pair = BBOX_ASPECT_RATIOS[String(aspectRatio || "")];
  const mp = Number(megapixels);
  const mult = Math.floor(Number(multiple));
  if (!pair || !Number.isFinite(mp) || mp <= 0 || !Number.isFinite(mult) || mult <= 0) {
    return null;
  }
  const total = mp * 1024 * 1024;
  const scale = Math.sqrt(total / (pair[0] * pair[1]));
  return {
    width: roundHalfEven((pair[0] * scale) / mult) * mult,
    height: roundHalfEven((pair[1] * scale) / mult) * mult,
  };
}

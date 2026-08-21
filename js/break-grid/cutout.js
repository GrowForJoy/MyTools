// ---------- 通用工具 ----------
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

export function imageToCanvas(img, maxDim = 1024) {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) { w = img.width; h = img.height; }
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas;
}

/** 复制画布 */
export function copyCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([
    p,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(msg)), ms); }),
  ]).finally(() => clearTimeout(t));
}

// ---------- AI 抠图 ----------
let _imglyOKIdx = -1; 
const _modCache = {}; 

const IMGLY_SOURCES = [
  {
    name: "esm.sh@1.5.8",
    lib: "https://esm.sh/@imgly/background-removal@1.5.8",
    cfg: {}, // 全部使用库默认
  },
  {
    name: "jsdelivr@1.4.5（国内主用）",
    lib: "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/index.mjs",
    cfg: {
      publicPath: "https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.4.5/dist/",
      model: "isnet_quint8", // 量化小模型，约 40MB
      proxyToWorker: false, // 主线程运行，避免跨域 worker 加载问题
    },
  },
  {
    name: "unpkg@1.4.5（国内备用）",
    lib: "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/index.mjs",
    cfg: {
      publicPath: "https://unpkg.com/@imgly/background-removal-data@1.4.5/dist/",
      model: "isnet_quint8",
      proxyToWorker: false,
    },
  },
];

async function getImglyLib(url) {
  if (_modCache[url]) return _modCache[url];
  const mod = await import(/* @vite-ignore */ url);
  _modCache[url] = mod;
  return mod;
}

async function aiRemoveBackground(dataURL, onProgress) {
  const work = (async () => {
    // 优先用已验证可用的源；否则依次尝试各线路
    const order = _imglyOKIdx >= 0 ? [_imglyOKIdx] : IMGLY_SOURCES.map((_, i) => i);
    let lastErr;
    for (const i of order) {
      const src = IMGLY_SOURCES[i];
      try {
        const mod = await getImglyLib(src.lib);
        const removeBackground =
          mod.removeBackground || (mod.default && mod.default.removeBackground) || mod.default;
        if (typeof removeBackground !== "function") throw new Error("抠图库加载异常");

        const blob = await removeBackground(dataURL, {
          output: { format: "image/png", quality: 0.9, type: "foreground" },
          progress: (key, current, total) => {
            if (total) onProgress?.(current / total, key);
          },
          ...src.cfg,
        });
        _imglyOKIdx = i; // 记下可用源，下次直连
        const url = URL.createObjectURL(blob);
        try {
          const img = await loadImage(url);
          return imageToCanvas(img, 1024); // 限边 1024，便于后续编辑
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        console.warn(`[cutout] 抠图源 ${src.name} 失败：`, e);
        lastErr = e;
      }
    }
    throw lastErr || new Error("AI 抠图失败");
  })();
  return withTimeout(work, 180000, "AI 抠图超时，改用边缘抠图");
}

// ---------- 边缘抠图----------
export function floodFillCutout(srcCanvas, tolerance = 34) {
  const { width, height } = srcCanvas;
  const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const n = width * height;
  const visited = new Uint8Array(n);

  // 颜色平方容差（RGB 三通道和）
  const tol2 = tolerance * tolerance * 3;

  // 索引队列 + 头指针，保证 O(n)
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  // 从四边种子开始泛洪；以「当前像素」颜色作为比较基准，可顺延渐变背景
  const seed = (x, y) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }

  const tryPush = (nIdx, refI) => {
    if (visited[nIdx]) return;
    const ni = nIdx * 4;
    const dr = data[ni] - data[refI];
    const dg = data[ni + 1] - data[refI + 1];
    const db = data[ni + 2] - data[refI + 2];
    if (dr * dr + dg * dg + db * db <= tol2) {
      visited[nIdx] = 1;
      queue[tail++] = nIdx;
    }
  };

  while (head < tail) {
    const idx = queue[head++];
    const i = idx * 4;
    data[i + 3] = 0; // 擦除 alpha
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) tryPush(idx - 1, i);
    if (x < width - 1) tryPush(idx + 1, i);
    if (y > 0) tryPush(idx - width, i);
    if (y < height - 1) tryPush(idx + width, i);
  }

  ctx.putImageData(imgData, 0, 0);
  featherEdges(srcCanvas);
  return srcCanvas;
}

/** 简易边缘羽化：让被擦除像素的边缘更柔和 */
function featherEdges(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const s = src.data, o = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (s[i + 3] > 0) {
        let t = 0;
        if (x === 0 || s[i - 4 + 3] === 0) t++;
        if (x === width - 1 || s[i + 4 + 3] === 0) t++;
        if (y === 0 || s[i - width * 4 + 3] === 0) t++;
        if (y === height - 1 || s[i + width * 4 + 3] === 0) t++;
        o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2];
        o[i + 3] = t ? Math.max(0, s[i + 3] - t * 60) : s[i + 3];
      } else {
        o[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

// ---------- 统一入口 ----------
/**
 * 自动抠图：优先 AI（ISNet），失败回退边缘抠图。
 * @param {string} dataURL 主角图片 dataURL
 * @param {object} opts { useAi, onStatus, onProgress }
 * @returns {Promise<{canvas, method}>}
 */
export async function autoCutout(dataURL, opts = {}) {
  const { useAi = true, onStatus, onProgress } = opts;
  const img = await loadImage(dataURL);
  const base = imageToCanvas(img, 1024);

  if (useAi) {
    try {
      onStatus?.("正在加载 AI 抠图模型（首次需联网下载，约 10MB 起）…");
      const cut = await aiRemoveBackground(dataURL, (p, file) => {
        if (typeof p === "number") onProgress?.(p, file);
      });
      return { canvas: cut, method: "ai" };
    } catch (e) {
      console.warn("[cutout] AI 失败，回退边缘抠图：", e);
      onStatus?.("AI 模型不可用，改用边缘抠图…");
    }
  }

  // 边缘抠图兜底
  const work = copyCanvas(base);
  floodFillCutout(work, 34);
  return { canvas: work, method: "flood" };
}

export const __test = { floodFillCutout, imageToCanvas };

// app.js —— 冲出九宫格主逻辑
// 流程：上传(2~9张) → 选主角 → 抠图生成 → 编辑(拖拽/缩放/擦除) → 下载

import { autoCutout, copyCanvas } from "./cutout.js";

const $ = (id) => document.getElementById(id);

// ---------- 状态 ----------
const state = {
  images: [],          // {id, dataURL, el: HTMLImageElement, name}
  mainIndex: -1,        // 主角在 images 中的下标
  // 抠图结果
  cutoutCanvas: null,  // 原始抠图画布（AI/边缘结果）
  cutoutOriginal: null,// 抠图副本（用于「恢复」）
  cutoutNat: { w: 0, h: 0 },
  method: null,
  // 编辑变换（dx/dy 以输出画布坐标为准，scale 无量纲）
  edit: { scale: 2, dx: 0, dy: 0 },
  brush: { on: false, size: 28 },
  crop: { on: false }, // 矩形裁剪模式
  undoStack: [],
  // 设置
  gap: 6,
  gapColor: "#ffffff",
  outputSize: 1080,
  topPad: 0, // 顶部留白（输出坐标系像素）：九宫格整体下移，主角可上冲至此区域
  align: "bc", // 九宫格在画布内的位置：t/c/b(上中下) + l/c/r(左中右)，默认 bc=下中
  tryAi: true,
};

const MAX_IMAGES = 9;
const MIN_IMAGES = 2;

// ---------- DOM 引用 ----------
const els = {
  grid: $("uploadGrid"),
  fileInput: $("fileInput"),
  counter: $("counter"),
  generateBtn: $("generateBtn"),
  settingsToggle: $("settingsToggle"),
  settings: $("settings"),
  clearBtn: $("clearBtn"),
  gapRange: $("gapRange"), gapOut: $("gapOut"),
  topPadRange: $("topPadRange"), topPadOut: $("topPadOut"),
  anchorGrid: $("anchorGrid"),
  gapColor: $("gapColor"),
  outputSize: $("outputSize"),
  tryAi: $("tryAi"),
  editorCard: $("editorCard"),
  methodBadge: $("methodBadge"),
  preview: $("preview"),
  gridLayer: $("gridLayer"),
  cutoutLayer: $("cutoutLayer"),
  scaleRange: $("scaleRange"), scaleOut: $("scaleOut"),
  resetPosBtn: $("resetPosBtn"),
  brushToggle: $("brushToggle"),
  brushSizeWrap: $("brushSizeWrap"),
  brushSize: $("brushSize"), brushSizeOut: $("brushSizeOut"),
  cropToggle: $("cropToggle"), cropBox: $("cropBox"),
  undoBtn: $("undoBtn"),
  restoreBtn: $("restoreBtn"),
  backBtn: $("backBtn"),
  downloadBtn: $("downloadBtn"),
  overlay: $("overlay"),
  overlayText: $("overlayText"),
  progressFill: $("progressFill"),
  toast: $("toast"),
};

// ---------- 工具函数 ----------
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("读取文件失败"));
    fr.readAsDataURL(file);
  });
}

function makeImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataURL;
  });
}

let toastTimer = null;
function toast(msg, ms = 2400) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

function showOverlay(text = "正在处理…") {
  els.overlayText.textContent = text;
  els.progressFill.style.width = "0%";
  els.overlay.hidden = false;
}
function hideOverlay() { els.overlay.hidden = true; }
function setOverlayText(t) { els.overlayText.textContent = t; }
function setOverlayProgress(p) {
  if (typeof p === "number" && p >= 0) {
    els.progressFill.style.width = `${Math.min(100, Math.max(0, p * 100)).toFixed(1)}%`;
  }
}

// 把抠图库回传的英文文件名（如 isnet_quint8.onnx、ort-wasm.jsep.wasm）翻译成中文提示
function progressLabel(key) {
  const k = String(key || "").toLowerCase();
  if (!k) return "";
  if (/onnx|isnet|rmbg|model/.test(k)) return "正在下载抠图模型";
  if (/wasm|ort|jsep/.test(k)) return "正在加载推理引擎";
  return "正在准备资源";
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- 上传网格渲染 ----------
function renderUploadGrid() {
  els.counter.textContent = `${state.images.length} / ${MAX_IMAGES}`;
  els.generateBtn.disabled = !(state.images.length >= MIN_IMAGES && state.mainIndex >= 0);

  const items = [];
  state.images.forEach((it, i) => {
    const isMain = i === state.mainIndex;
    items.push(`
      <div class="slot filled ${isMain ? "slot--main" : ""}" data-index="${i}" draggable="true" title="点击设为主角，拖拽调整顺序">
        <img src="${it.dataURL}" alt="${it.name || ""}" />
        ${isMain ? "" : `<span class="slot__index">${i + 1}</span>`}
        <button class="slot__rm" data-rm="${i}" title="移除" type="button">×</button>
      </div>`);
  });
  if (state.images.length < MAX_IMAGES) {
    items.push(`<button class="slot add" data-add type="button" title="添加图片">+</button>`);
  }
  els.grid.innerHTML = items.join("");
}

// ---------- 上传交互 ----------
async function addFiles(files) {
  const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
  if (!list.length) return;
  const room = MAX_IMAGES - state.images.length;
  if (room <= 0) { toast("最多 9 张图片"); return; }
  const slice = list.slice(0, room);
  for (const f of slice) {
    try {
      const dataURL = await readFileAsDataURL(f);
      const el = await makeImage(dataURL);
      const item = { id: crypto.randomUUID(), dataURL, el, name: f.name };
      state.images.push(item);
      if (state.mainIndex < 0) state.mainIndex = state.images.length - 1; // 自动设首张为主角
    } catch (e) { console.error(e); toast(`「${f.name}」添加失败`); }
  }
  renderUploadGrid();
}

function handleSlotClick(e) {
  const rm = e.target.closest("[data-rm]");
  if (rm) {
    e.stopPropagation();
    const idx = Number(rm.dataset.rm);
    removeImage(idx);
    return;
  }
  const add = e.target.closest("[data-add]");
  if (add) { els.fileInput.click(); return; }
  const slot = e.target.closest("[data-index]");
  if (slot) {
    state.mainIndex = Number(slot.dataset.index);
    renderUploadGrid();
    if (!els.editorCard.hidden) toast("主角已更换，点击「生成效果图」重新抠图");
  }
}

function removeImage(idx) {
  state.images.splice(idx, 1);
  if (state.mainIndex >= state.images.length) state.mainIndex = state.images.length - 1;
  else if (idx < state.mainIndex) state.mainIndex -= 1;
  renderUploadGrid();
}

// 拖拽排序（在网格内交换）
let dragFrom = -1;
function bindDragReorder() {
  els.grid.addEventListener("dragstart", (e) => {
    const slot = e.target.closest("[data-index]");
    if (!slot) return;
    dragFrom = Number(slot.dataset.index);
    e.dataTransfer.effectAllowed = "move";
  });
  els.grid.addEventListener("dragover", (e) => {
    const slot = e.target.closest("[data-index]");
    if (!slot) return;
    e.preventDefault();
    els.grid.querySelectorAll(".slot").forEach((s) => s.classList.remove("dragover"));
    slot.classList.add("dragover");
  });
  els.grid.addEventListener("dragleave", () => {
    els.grid.querySelectorAll(".slot").forEach((s) => s.classList.remove("dragover"));
  });
  els.grid.addEventListener("drop", (e) => {
    e.preventDefault();
    const slot = e.target.closest("[data-index]");
    if (!slot || dragFrom < 0) return;
    const to = Number(slot.dataset.index);
    if (to !== dragFrom) {
      const arr = state.images;
      const moved = arr.splice(dragFrom, 1)[0];
      arr.splice(to, 0, moved);
      // 同步主角下标
      if (state.mainIndex === dragFrom) state.mainIndex = to;
      else if (dragFrom < state.mainIndex && to >= state.mainIndex) state.mainIndex -= 1;
      else if (dragFrom > state.mainIndex && to <= state.mainIndex) state.mainIndex += 1;
      renderUploadGrid();
    }
    dragFrom = -1;
  });
}

// 文件拖入整个网格上传
function bindFileDrop() {
  els.grid.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  els.grid.addEventListener("drop", (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }
  });
}

// ---------- 设置面板 ----------
function bindSettings() {
  els.settingsToggle.addEventListener("click", () => {
    const open = els.settings.hasAttribute("hidden");
    els.settings.hidden = !open;
    els.settingsToggle.setAttribute("aria-expanded", String(open));
  });
  els.gapRange.addEventListener("input", () => {
    state.gap = Number(els.gapRange.value);
    els.gapOut.textContent = state.gap;
    layout();
  });
  els.topPadRange.addEventListener("input", () => {
    state.topPad = Number(els.topPadRange.value);
    els.topPadOut.textContent = state.topPad;
    layout();
  });
  els.anchorGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-align]");
    if (!btn) return;
    state.align = btn.dataset.align;
    els.anchorGrid.querySelectorAll("button").forEach(b =>
      b.classList.toggle("is-active", b === btn));
    layout();
  });
  els.gapColor.addEventListener("input", () => {
    state.gapColor = els.gapColor.value;
    renderPreviewGrid();
    layout();
  });
  els.outputSize.addEventListener("change", () => {
    state.outputSize = Number(els.outputSize.value);
    layout();
  });
  els.tryAi.addEventListener("change", () => { state.tryAi = els.tryAi.checked; });
  els.clearBtn.addEventListener("click", () => {
    if (!state.images.length) return;
    if (!confirm("确认清空所有图片？")) return;
    state.images = [];
    state.mainIndex = -1;
    hideEditor();
    renderUploadGrid();
  });
}

// ---------- 生成 ----------
async function generate() {
  if (state.images.length < MIN_IMAGES) { toast("至少上传 2 张图片"); return; }
  if (state.mainIndex < 0) { toast("请选择主角"); return; }

  showOverlay("正在准备…");
  try {
    const main = state.images[state.mainIndex];
    const res = await autoCutout(main.dataURL, {
      useAi: state.tryAi,
      onStatus: setOverlayText,
      onProgress: (p, key) => {
        setOverlayProgress(p);
        const label = progressLabel(key);
        if (label) setOverlayText(`${label}… ${Math.round((p || 0) * 100)}%`);
      },
    });
    state.cutoutCanvas = res.canvas;
    state.cutoutOriginal = copyCanvas(res.canvas);
    state.cutoutNat = { w: res.canvas.width, h: res.canvas.height };
    state.method = res.method;
    state.edit = { scale: 2, dx: 0, dy: 0 };
    state.undoStack = [];

    els.methodBadge.textContent = res.method === "ai" ? "AI 抠图" : "边缘抠图";
    els.scaleRange.value = state.edit.scale;
    els.scaleOut.textContent = state.edit.scale.toFixed(2);

    showEditor();
    renderPreviewGrid();
    initCutoutLayer();
    layout();
    toast(res.method === "ai" ? "AI 抠图完成" : "已用边缘抠图（可手动精修）");
  } catch (e) {
    console.error(e);
    toast("抠图失败：" + (e.message || e), 3600);
  } finally {
    hideOverlay();
  }
}

function showEditor() { els.editorCard.hidden = false; }
function hideEditor() { els.editorCard.hidden = true; }

// ---------- 预览渲染 ----------
function renderPreviewGrid() {
  const gapColor = state.gapColor;
  els.gridLayer.style.gap = "0px";
  els.gridLayer.style.background = gapColor;
  const cells = [];
  for (let i = 0; i < 9; i++) {
    if (i < state.images.length) {
      cells.push(`<div class="cell"><img src="${state.images[i].dataURL}" alt="" draggable="false"/></div>`);
    } else {
      cells.push(`<div class="cell" style="background:${gapColor}"></div>`);
    }
  }
  els.gridLayer.innerHTML = cells.join("");
}

function initCutoutLayer() {
  const layer = els.cutoutLayer;
  layer.width = state.cutoutNat.w;
  layer.height = state.cutoutNat.h;
  const ctx = layer.getContext("2d");
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.drawImage(state.cutoutCanvas, 0, 0);
  layer.style.display = "block";
}

/** 计算缩放系数 k = 显示尺寸 / 输出尺寸 */
function getK() {
  const D = els.preview.getBoundingClientRect().width;
  return D / state.outputSize;
}

/** 统一布局：网格间隙 + 顶部留白（整体缩小+下移）+ 主角变换 */
function layout() {
  if (!state.cutoutCanvas) return;
  const k = getK();
  const gapD = state.gap * k;
  const topPadD = state.topPad * k;

  const D = els.preview.getBoundingClientRect().width;
  // 画布保持正方形（适配朋友圈）；顶部留白靠九宫格整体缩小+下移实现，留白区用间隙色
  els.preview.style.aspectRatio = "";
  els.preview.style.height = "";
  els.preview.style.background = state.gapColor;

  // 九宫格缩小为 (D-topPadD)×(D-topPadD)，按 align 决定在画布内的位置
  const gridD = D - topPadD;
  const v = state.align[0], h = state.align[1];
  const gridTop = v === "t" ? 0 : v === "b" ? topPadD : topPadD / 2;
  const gridLeft = h === "l" ? 0 : h === "r" ? topPadD : topPadD / 2;
  els.gridLayer.style.inset = "auto";
  els.gridLayer.style.left = `${gridLeft}px`;
  els.gridLayer.style.top = `${gridTop}px`;
  els.gridLayer.style.width = `${gridD}px`;
  els.gridLayer.style.height = `${gridD}px`;
  els.gridLayer.style.gap = `${gapD}px`;

  // 九宫格背景格子（缩小后）；主角尺寸用满画布格子，不受留白影响
  const cellD = (gridD - 2 * gapD) / 3;
  const cellDFull = (D - 2 * gapD) / 3;
  const { w: nw, h: nh } = state.cutoutNat;
  const sc = Math.min(cellDFull / nw, cellDFull / nh); // contain，基于满格子
  const bw = nw * sc, bh = nh * sc;

  const col = state.mainIndex % 3;
  const row = Math.floor(state.mainIndex / 3);
  // 主角中心仍在缩小后格子的中心
  const cellX0 = gridLeft + col * (cellD + gapD);
  const cellY0 = gridTop + row * (cellD + gapD);
  const cx = cellX0 + cellD / 2;
  const cy = cellY0 + cellD / 2;

  const layer = els.cutoutLayer;
  layer.style.left = `${cx - bw / 2}px`;
  layer.style.top = `${cy - bh / 2}px`;
  layer.style.width = `${bw}px`;
  layer.style.height = `${bh}px`;
  applyTransform();
}

function applyTransform() {
  const k = getK();
  const { scale, dx, dy } = state.edit;
  els.cutoutLayer.style.transform =
    `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px) scale(${scale.toFixed(3)})`;
  els.scaleOut.textContent = scale.toFixed(2);
}

// ---------- 编辑交互：拖拽 / 缩放 / 擦除 ----------
function bindEditor() {
  // 缩放滑块
  els.scaleRange.addEventListener("input", () => {
    state.edit.scale = Number(els.scaleRange.value);
    applyTransform();
  });
  // 滚轮缩放
  els.preview.addEventListener("wheel", (e) => {
    if (!state.cutoutCanvas) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    state.edit.scale = clamp(state.edit.scale * (1 + delta), 0.3, 4);
    els.scaleRange.value = state.edit.scale;
    applyTransform();
  }, { passive: false });

  // 重置位置
  els.resetPosBtn.addEventListener("click", () => {
    state.edit = { scale: 2, dx: 0, dy: 0 };
    els.scaleRange.value = 2;
    layout();
  });

  // 主角拖拽 / 擦除
  const layer = els.cutoutLayer;
  let dragging = false, lastX = 0, lastY = 0;
  let brushing = false, lastPX = 0, lastPY = 0;
  let cropping = false, cropStart = null;

  layer.addEventListener("pointerdown", (e) => {
    if (!state.cutoutCanvas) return;
    layer.setPointerCapture(e.pointerId);
    if (state.brush.on) {
      brushing = true;
      pushUndo();
      const p = pointerToCanvas(e);
      eraseAt(p.x, p.y, p.r);
      lastPX = p.x; lastPY = p.y;
      els.undoBtn.disabled = false;
      els.restoreBtn.disabled = false;
    } else if (state.crop.on) {
      cropping = true;
      cropStart = { x: e.clientX, y: e.clientY };
      els.cropBox.hidden = false;
      Object.assign(els.cropBox.style, { left: "0px", top: "0px", width: "0px", height: "0px" });
    } else {
      dragging = true;
      layer.classList.add("is-dragging");
      lastX = e.clientX; lastY = e.clientY;
    }
  });

  layer.addEventListener("pointermove", (e) => {
    if (dragging) {
      const k = getK();
      state.edit.dx += (e.clientX - lastX) / k;
      state.edit.dy += (e.clientY - lastY) / k;
      lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    } else if (brushing) {
      const p = pointerToCanvas(e);
      eraseLine(lastPX, lastPY, p.x, p.y, p.r);
      lastPX = p.x; lastPY = p.y;
    } else if (cropping) {
      const pr = els.preview.getBoundingClientRect();
      const x = Math.min(cropStart.x, e.clientX) - pr.left;
      const y = Math.min(cropStart.y, e.clientY) - pr.top;
      const w = Math.abs(e.clientX - cropStart.x);
      const h = Math.abs(e.clientY - cropStart.y);
      Object.assign(els.cropBox.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    }
  });

  const end = (e) => {
    if (dragging) { dragging = false; layer.classList.remove("is-dragging"); }
    if (brushing) { brushing = false; }
    if (cropping) {
      cropping = false;
      pushUndo();
      applyCrop(cropStart.x, cropStart.y, e.clientX, e.clientY);
      els.cropBox.hidden = true;
      els.undoBtn.disabled = false;
      els.restoreBtn.disabled = false;
    }
    try { layer.releasePointerCapture(e.pointerId); } catch {}
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);

  // 擦除开关
  els.brushToggle.addEventListener("click", () => {
    state.brush.on = !state.brush.on;
    els.brushToggle.setAttribute("aria-pressed", String(state.brush.on));
    els.brushSizeWrap.hidden = !state.brush.on;
    layer.classList.toggle("is-brushing", state.brush.on);
    if (state.brush.on && state.crop.on) {
      state.crop.on = false;
      els.cropToggle.setAttribute("aria-pressed", "false");
      layer.classList.remove("is-cropping");
    }
  });
  els.cropToggle.addEventListener("click", () => {
    state.crop.on = !state.crop.on;
    els.cropToggle.setAttribute("aria-pressed", String(state.crop.on));
    layer.classList.toggle("is-cropping", state.crop.on);
    if (state.crop.on && state.brush.on) {
      state.brush.on = false;
      els.brushToggle.setAttribute("aria-pressed", "false");
      els.brushSizeWrap.hidden = true;
      layer.classList.remove("is-brushing");
    }
  });
  els.brushSize.addEventListener("input", () => {
    state.brush.size = Number(els.brushSize.value);
    els.brushSizeOut.textContent = state.brush.size;
  });
  els.undoBtn.addEventListener("click", undo);
  els.restoreBtn.addEventListener("click", restoreCutout);

  els.backBtn.addEventListener("click", () => {
    hideEditor();
    els.editorCard.scrollIntoView({ behavior: "smooth" });
  });
  els.downloadBtn.addEventListener("click", download);

  // 尺寸变化重布局
  const ro = new ResizeObserver(() => { if (state.cutoutCanvas) layout(); });
  ro.observe(els.preview);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/** 指针坐标 → 抠图画布像素坐标 */
function pointerToCanvas(e) {
  const layer = els.cutoutLayer;
  const r = layer.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * layer.width;
  const y = (e.clientY - r.top) / r.height * layer.height;
  // 笔刷半径（以画布像素计）：以显示尺寸的笔刷直径换算
  const radiusPx = (state.brush.size / 2) / r.width * layer.width;
  return { x, y, r: radiusPx };
}

function eraseAt(x, y, r) {
  const ctx = els.cutoutLayer.getContext("2d");
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function eraseLine(x1, y1, x2, y2, r) {
  const ctx = els.cutoutLayer.getContext("2d");
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineWidth = Math.max(2, r * 2);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

/** 矩形裁剪：保留选区内，裁掉选区外（4 个矩形填透明） */
function applyCrop(sx, sy, ex, ey) {
  const layer = els.cutoutLayer;
  const p1 = pointerToCanvas({ clientX: sx, clientY: sy });
  const p2 = pointerToCanvas({ clientX: ex, clientY: ey });
  const x0 = Math.max(0, Math.min(p1.x, p2.x));
  const x1 = Math.min(layer.width, Math.max(p1.x, p2.x));
  const y0 = Math.max(0, Math.min(p1.y, p2.y));
  const y1 = Math.min(layer.height, Math.max(p1.y, p2.y));
  if (x1 - x0 < 1 || y1 - y0 < 1) return; // 选区太小，跳过
  const ctx = layer.getContext("2d");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, layer.width, y0);                  // 上
  ctx.fillRect(0, y1, layer.width, layer.height - y1);  // 下
  ctx.fillRect(0, y0, x0, y1 - y0);                     // 左
  ctx.fillRect(x1, y0, layer.width - x1, y1 - y0);     // 右
  ctx.globalCompositeOperation = "source-over";
}

function pushUndo() {
  const layer = els.cutoutLayer;
  const ctx = layer.getContext("2d");
  try {
    state.undoStack.push(ctx.getImageData(0, 0, layer.width, layer.height));
    if (state.undoStack.length > 12) state.undoStack.shift();
  } catch (e) { /* ignore */ }
}

function undo() {
  const layer = els.cutoutLayer;
  const ctx = layer.getContext("2d");
  const snap = state.undoStack.pop();
  if (!snap) { toast("没有可撤销的操作"); return; }
  ctx.putImageData(snap, 0, 0);
  if (!state.undoStack.length) els.undoBtn.disabled = true;
}

function restoreCutout() {
  const layer = els.cutoutLayer;
  const ctx = layer.getContext("2d");
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.drawImage(state.cutoutOriginal, 0, 0);
  state.undoStack = [];
  els.undoBtn.disabled = true;
  els.restoreBtn.disabled = true;
  toast("已恢复原始抠图");
}

// ---------- 下载：合成输出 ----------
function coverDraw(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function download() {
  const S = state.outputSize, gap = state.gap, topPad = state.topPad;
  const canvas = document.createElement("canvas");
  canvas.width = S; canvas.height = S; // 正方形，适配朋友圈
  const ctx = canvas.getContext("2d");

  // 背景（间隙颜色，含留白区）
  ctx.fillStyle = state.gapColor;
  ctx.fillRect(0, 0, S, S);

  // 九宫格缩小为 (S-topPad)×(S-topPad)，按 align 决定在画布内的位置
  const gridS = S - topPad;
  const v = state.align[0], h = state.align[1];
  const gridTop = v === "t" ? 0 : v === "b" ? topPad : topPad / 2;
  const gridLeft = h === "l" ? 0 : h === "r" ? topPad : topPad / 2;
  const cellS = (gridS - 2 * gap) / 3;
  for (let i = 0; i < 9; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gridLeft + col * (cellS + gap);
    const y = gridTop + row * (cellS + gap);
    if (i < state.images.length) {
      coverDraw(ctx, state.images[i].el, x, y, cellS, cellS);
    }
  }

  // 主角抠图层（与预览变换一致）：尺寸基于满画布格子，不受留白影响
  const layer = els.cutoutLayer;
  const { w: nw, h: nh } = state.cutoutNat;
  const cellSFull = (S - 2 * gap) / 3;
  const sc = Math.min(cellSFull / nw, cellSFull / nh);
  const bw = nw * sc, bh = nh * sc;
  const col = state.mainIndex % 3, row = Math.floor(state.mainIndex / 3);
  const cellX0 = gridLeft + col * (cellS + gap);
  const cellY0 = gridTop + row * (cellS + gap);
  const cx = cellX0 + cellS / 2, cy = cellY0 + cellS / 2;

  ctx.save();
  ctx.translate(cx + state.edit.dx, cy + state.edit.dy);
  ctx.scale(state.edit.scale, state.edit.scale);
  ctx.drawImage(layer, -bw / 2, -bh / 2, bw, bh);
  ctx.restore();

  // 触发下载
  const a = document.createElement("a");
  a.download = `冲出九宫格_${timestamp()}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
  toast("已生成并下载图片");
}

// ---------- 初始化 ----------
function init() {
  els.fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  els.grid.addEventListener("click", handleSlotClick);
  bindDragReorder();
  bindFileDrop();
  bindSettings();
  bindEditor();
  els.generateBtn.addEventListener("click", generate);

  renderUploadGrid();
}

init();

/* gifenc 以全局版脚本引入（兼容 file:// 双击打开），API 挂载在 window.gifenc */
const { GIFEncoder, quantize, applyPalette } = window.gifenc || {};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const fileInfo = $('fileInfo');
const fileNameEl = $('fileName');
const fileMeta = $('fileMeta');
const removeFile = $('removeFile');
const editor = $('editor');
const options = $('options');
const genRow = $('genRow');
const video = $('video');
const tStart = $('tStart');
const tEnd = $('tEnd');
const tStartVal = $('tStartVal');
const tEndVal = $('tEndVal');
const segInfo = $('segInfo');
const previewBtn = $('previewBtn');
const convertBtn = $('convertBtn');
const status = $('status');
const statusText = $('statusText');
const progTrack = $('progTrack');
const progBar = $('progBar');
const progText = $('progText');
const modeNote = $('modeNote');
const result = $('result');
const gifImg = $('gifImg');
const gifSize = $('gifSize');
const gifDim = $('gifDim');
const gifParam = $('gifParam');
const wechatNote = $('wechatNote');
const mobileHint = $('mobileHint');
const downloadBtn = $('downloadBtn');
const againBtn = $('againBtn');

/* ---------- 状态 ---------- */
let duration = 0;
let srcURL = '';
let fileOnly = null; // 仅保留原始文件名，便于导出命名

const WECHAT_BUDGET = 2 * 1024 * 1024; // 微信动图目标上限约 2MB
const MAX_FRAMES = 300; // 防止长片段导致浏览器卡死

/* ---------- 通用工具 ---------- */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(0);
}
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
function baseName(name) {
  return (name || 'video').replace(/\.[^.]+$/, '') + '.gif';
}
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/* ---------- 上传 ---------- */
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadVideo(f);
});
fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) loadVideo(f);
});

removeFile.addEventListener('click', resetAll);

function loadVideo(file) {
  fileOnly = file;
  if (srcURL) URL.revokeObjectURL(srcURL);
  srcURL = URL.createObjectURL(file);
  // 预载并开启播放内联 / 静音，部分应用内浏览器需要这些属性才会真正解码视频帧
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = srcURL;

  fileNameEl.textContent = file.name;
  fileMeta.textContent = fmtBytes(file.size);

  video.onloadedmetadata = () => {
    hide(result);
    show(editor);
    show(options);
    show(genRow);
    hide(progTrack); hide(progText); hide(status);
    fileInput.value = '';
    prepareRange();
    activatePlayback();
    // 等首帧解码后检测画面是否全黑（常见于 HEVC/H.265 等浏览器不支持的编码）
    checkBlackVideo();
  };
}

/* 静音播放一下再暂停，激活解码管线：避免部分内置浏览器/应用内浏览器不自动出帧导致黑屏 */
function activatePlayback() {
  if (video.readyState < 2) return;
  const p = video.play();
  if (p && p.then) {
    p.then(() => { video.pause(); }).catch(() => {});
  }
}

/* 检测视频是否是全黑的（常见于 HEVC/H.265 等浏览器无法解码的编码）。
   策略：跳到一个偏中间的时间点，抽一帧到 canvas，取样判断是否有正常颜色。
   如果全黑，在页面上显示友好提示。 */
let blackWarnShown = false;
function checkBlackVideo() {
  blackWarnShown = false;
  const warn = document.getElementById('blackWarn');
  if (warn) warn.remove();
  // 等 1.2 秒让解码完成，再抽一帧中间位置的画面检测
  setTimeout(() => {
    const dur = getDuration();
    if (!dur || dur < 0.2) return;
    const probeTime = Math.min(dur * 0.3, dur - 0.1);
    const testW = 160;
    const testH = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * testW));
    ensureCanvas(testW, testH);
    // 用一个独立的临时 canvas 做检测，避免影响主流程
    const tc = document.createElement('canvas');
    tc.width = testW; tc.height = testH;
    const tctx = tc.getContext('2d', { willReadFrequently: true, preserveDrawingBuffer: true });

    const doCheck = () => {
      try {
        tctx.drawImage(video, 0, 0, testW, testH);
      } catch (e) { return; }
      const data = tctx.getImageData(0, 0, testW, testH).data;
      let maxBright = 0;
      let nonBlack = 0;
      // 取样：每隔若干像素采一个，不用全采
      const step = Math.max(1, Math.floor(data.length / 4 / 400));
      for (let i = 0; i < data.length; i += 4 * step) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const bright = (r + g + b) / 3;
        if (bright > maxBright) maxBright = bright;
        if (bright > 25) nonBlack++;
      }
      const total = Math.floor(data.length / 4 / step);
      const ratio = total > 0 ? nonBlack / total : 0;
      // 判断：最亮点也很暗 且 非黑像素占比极低 → 认为画面是黑的
      if (maxBright < 20 && ratio < 0.02) {
        showBlackWarn();
      }
    };

    const seekCheck = () => {
      video.removeEventListener('seeked', seekCheck);
      // 等 loadeddata 确保帧真正解码
      if (video.readyState < 2) {
        video.addEventListener('loadeddata', doCheck, { once: true });
        setTimeout(doCheck, 1500); // 兜底
      } else {
        doCheck();
      }
    };
    video.addEventListener('seeked', seekCheck);
    try { video.currentTime = probeTime; } catch (e) {}
  }, 1200);
}

function showBlackWarn() {
  if (blackWarnShown) return;
  blackWarnShown = true;
  const box = document.createElement('div');
  box.id = 'blackWarn';
  box.className = 'wechat-fit-note';
  box.style.cssText = 'margin-top:14px;background:#FFF7ED;border:1px solid #FDBA74;color:#92400E;';
  box.innerHTML =
    '<strong>⚠️ 视频画面可能无法解码</strong><br>' +
    '检测到视频画面是全黑的（有声音但没画面）。这通常是因为视频使用了浏览器不支持的编码（例如 iPhone 拍摄的 HEVC / H.265）。<br>' +
    '<strong>解决方法：</strong>先用格式转换工具把视频转成 H.264 编码的 MP4，再上传到本工具即可。也可以试试在电脑上用「照片」或「剪映」导出一遍再上传。';
  const target = document.getElementById('editor');
  if (target) target.appendChild(box);
}

/* 部分 WebM（如 MediaRecorder/录屏）duration 为 Infinity，需等 buffered 填好后才能确定真实时长 */
let rangeFinalized = false;
function prepareRange() {
  rangeFinalized = false;
  const tryInit = () => {
    if (rangeFinalized) return;
    const d = getDuration();
    if (isFinite(d) && d > 0.2) {
      rangeFinalized = true;
      duration = d;
      setupRange();
    }
  };
  // progress / durationchange 会在 buffered 数据可用时触发
  video.addEventListener('progress', tryInit);
  video.addEventListener('durationchange', tryInit);
  tryInit();
}

function setupRange() {
  const max = Math.max(duration, 0.1);
  const step = duration > 60 ? 0.1 : 0.05;
  [tStart, tEnd].forEach((r) => { r.min = 0; r.max = max; r.step = step; });
  tStart.value = 0;
  tEnd.value = max;
  tStartVal.textContent = fmtTime(0);
  tEndVal.textContent = fmtTime(max);
  updateSeg();
  seekFrame(0);
}

function updateSeg() {
  const start = parseFloat(tStart.value) || 0;
  const end = parseFloat(tEnd.value) || 0;
  const seg = Math.max(0, end - start);
  const fps = parseFloat($('fps').value) || 10;
  const frames = Math.ceil(seg * fps);
  segInfo.textContent = '片段 ' + seg.toFixed(1) + ' 秒 · 约 ' + frames + ' 帧';
  const hasSeg = seg >= 0.05;
  previewBtn.disabled = !hasSeg;
  convertBtn.disabled = !hasSeg;
}

function seekFrame(t) {
  if (!video) return;
  try {
    video.muted = true;
    video.currentTime = Math.min(Math.max(0, t), video.duration - 0.001);
  } catch (e) { /* 忽略 seek 过程中的偶发异常 */ }
}

tStart.addEventListener('input', () => {
  let s = parseFloat(tStart.value) || 0;
  let e = parseFloat(tEnd.value) || 0;
  if (e < s + 0.05) { tEnd.value = Math.min(parseFloat(tEnd.max), s + 0.05); e = parseFloat(tEnd.value); }
  tStartVal.textContent = fmtTime(s);
  tEndVal.textContent = fmtTime(e);
  updateSeg();
  seekFrame(s);
});
tEnd.addEventListener('input', () => {
  let s = parseFloat(tStart.value) || 0;
  let e = parseFloat(tEnd.value) || 0;
  if (e < s + 0.05) { tStart.value = Math.max(0, e - 0.05); s = parseFloat(tStart.value); }
  tStartVal.textContent = fmtTime(s);
  tEndVal.textContent = fmtTime(e);
  updateSeg();
  seekFrame(s);
});

previewBtn.addEventListener('click', () => {
  const start = parseFloat(tStart.value) || 0;
  const end = Math.min(parseFloat(tEnd.value) || 0, video.duration);
  video.muted = false;
  video.currentTime = start;
  const stop = () => { if (video.currentTime >= end || video.ended) { video.pause(); video.removeEventListener('timeupdate', stop); } };
  video.removeEventListener('timeupdate', stop);
  video.addEventListener('timeupdate', stop);
  video.play().catch(() => {});
});

/* 模式切换：微信模式给更保守的文案提示 */
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    const wechat = $('modeWechat').checked;
    if (wechat) {
      modeNote.textContent = '微信表情包：会自动把体积压缩到约 2 MB 以内（以微信客户端实际提示为准），必要时自动降低帧率与尺寸。';
    } else {
      modeNote.textContent = '普通 GIF：按你选择的尺寸与帧率导出，体积可能较大，适合本地保存。';
    }
  })
);

/* ---------- 抽帧 ---------- */
function captureTime(t) {
  return new Promise((resolve, reject) => {
    let cleaned = false;
    let guard = null;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (guard) clearTimeout(guard);
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('loadeddata', doDraw);
      video.removeEventListener('error', onErr);
    };
    const doDraw = () => {
      try {
        drawCtx.drawImage(video, 0, 0, cw, ch);
        cleanup();
        resolve(drawCtx.getImageData(0, 0, cw, ch).data);
      } catch (err) { cleanup(); reject(err); }
    };
    const onSeek = () => {
      // 部分环境下 seek 后画面可能尚未解码，等 loadeddata 再绘制，避免抽到黑帧
      if (video.readyState < 2) { video.addEventListener('loadeddata', doDraw, { once: true }); guard = setTimeout(doDraw, 1200); }
      else doDraw();
    };
    const onErr = () => { cleanup(); reject(new Error('seek failed')); };
    video.addEventListener('seeked', onSeek);
    video.addEventListener('error', onErr);
    video.muted = true;
    try { video.currentTime = Math.min(Math.max(0, t), video.duration - 0.001); } catch (e) { cleanup(); reject(e); }
  });
}

let drawCtx = null;
let cw = 0;
let ch = 0;
function ensureCanvas(w, h) {
  if (w !== cw || h !== ch || !drawCtx) {
    cw = w; ch = h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    // preserveDrawingBuffer:true 避免嵌入式 WebView / 应用内浏览器读帧后缓冲区被清空导致黑色
    drawCtx = c.getContext('2d', { willReadFrequently: true, preserveDrawingBuffer: true });
  }
}

/* ---------- 编码 ---------- */
async function buildGif(params, onProgress) {
  const { start, end, cw, ch, fps, colors } = params;
  ensureCanvas(cw, ch);
  const seg = Math.max(0.05, end - start);
  const nFrames = Math.max(1, Math.round(seg * fps));
  const delayMs = Math.round(1000 / fps);
  const gif = GIFEncoder();
  let i = 0;
  while (i < nFrames) {
    const t = start + (seg * i) / nFrames;
    const data = await captureTime(t);
    const palette = quantize(data, colors);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, cw, ch, { palette, delay: delayMs, repeat: 0 });
    i += 1;
    if (onProgress) onProgress(i, nFrames);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // 让出主线程刷新进度
  }
  gif.finish();
  return new Blob([gif.bytesView()], { type: 'image/gif' });
}

function computeSize(vw, vh, widthOpt) {
  let w = vw;
  if (widthOpt !== 'auto') w = parseInt(widthOpt, 10) || vw;
  w = Math.max(1, Math.min(w, 720));
  const h = Math.max(1, Math.round((vh / vw) * w));
  return { w, h };
}

/* 微信模式：按预算自动降级直到满足体积。返回 { blob, usedParams, fitted } */
async function fitToBudget(start, end, vw, vh, widthOpt, fpsOpt, onProgress) {
  const base = computeSize(vw, vh, widthOpt);
  // 候选方案：优先实现"先调帧率、再调尺寸、最后减色"
  const widthCands = [...new Set([base.w, 320, 240, 200].filter((x) => x <= base.w && x >= 120))];
  const fps = Math.min(fpsOpt, 12); // 微信场景把初始帧率压到 12 以内，避免大体积
  const fpsCands = [...new Set([fps, Math.max(5, Math.round(fps * 0.75)), 5])];
  const colorCands = [256, 128, 96, 64];

  let best = null;
  outer:
  for (const w of widthCands) {
    for (const f of fpsCands) {
      for (const c of colorCands) {
        const h = Math.max(1, Math.round((vh / vw) * w));
        const blob = await buildGif({ start, end, cw: w, ch: h, fps: f, colors: c }, onProgress);
        const bytes = blob.size;
        if (!best || bytes < best.bytes) best = { blob, w, h, fps: f, colors: c, bytes };
        if (bytes <= WECHAT_BUDGET) { best.fitted = true; break outer; }
      }
    }
  }
  return best;
}

/* ---------- 主流程 ---------- */
convertBtn.addEventListener('click', async () => {
  const start = parseFloat(tStart.value) || 0;
  const end = Math.min(parseFloat(tEnd.value) || 0, video.duration);
  const widthOpt = $('outWidth').value;
  const fpsOpt = parseFloat($('fps').value) || 10;
  const isWechat = $('modeWechat').checked;

  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const base = computeSize(vw, vh, widthOpt);
  const seg = Math.max(0.05, end - start);

  // 帧数上限保护：超时自动降帧率
  let effFps = fpsOpt;
  if (Math.ceil(seg * effFps) > MAX_FRAMES) {
    effFps = Math.max(3, Math.floor(MAX_FRAMES / seg));
  }

  setBusy(true);
  progTrack.classList.remove('hidden');
  progText.classList.remove('hidden');
  statusText.textContent = '正在读取视频帧并生成动图，请稍候…';

  try {
    let blob, usedW, usedH, usedFps, usedColors, fitted = false;
    if (isWechat) {
      statusText.textContent = '正在生成微信表情包并自动控制体积…';
      const res = await fitToBudget(start, end, vw, vh, widthOpt, effFps, updateProgress);
      blob = res.blob; usedW = res.w; usedH = res.h; usedFps = res.fps; usedColors = res.colors; fitted = res.fitted;
    } else {
      usedW = base.w; usedH = base.h; usedFps = effFps; usedColors = 256;
      blob = await buildGif({ start, end, cw: base.w, ch: base.h, fps: effFps, colors: 256 }, updateProgress);
    }

    const url = URL.createObjectURL(blob);
    gifImg.src = url;
    gifSize.textContent = fmtBytes(blob.size);
    gifDim.textContent = usedW + ' × ' + usedH;
    gifParam.textContent = usedFps + ' FPS · ' + usedColors + ' 色';

    if (isWechat) {
      wechatNote.textContent = fitted
        ? '已自动将体积控制在 2 MB 以内，这个尺寸基本可以正常添加到微信自定义表情。'
        : '已尽量压缩，但当前片段仍略超 2 MB，建议缩短片段或降低宽度后重试。';
      wechatNote.classList.remove('hidden');
    } else {
      wechatNote.classList.add('hidden');
    }
    mobileHint.classList.toggle('hidden', !isMobile());

    const dl = downloadBtn;
    dl.href = url;
    dl.download = baseName(fileOnly ? fileOnly.name : '');

    show(result);
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    alert('生成失败：' + (err && err.message ? err.message : err));
  } finally {
    setBusy(false);
    progTrack.classList.add('hidden');
    progText.classList.add('hidden');
  }
});

function updateProgress(done, total) {
  const p = Math.max(0, Math.min(100, (done / total) * 100));
  progBar.style.width = p + '%';
  progText.textContent = '处理中 ' + Math.round(p) + '%（' + done + '/' + total + ' 帧）';
}

function setBusy(yes) {
  convertBtn.disabled = yes;
  if (yes) status.classList.remove('hidden');
  else status.classList.add('hidden');
}

againBtn.addEventListener('click', () => {
  resetAll();
});

function resetAll() {
  rangeFinalized = false;
  blackWarnShown = false;
  const w = document.getElementById('blackWarn');
  if (w) w.remove();
  duration = 0;
  hide(result);
  editor.classList.add('hidden');
  options.classList.add('hidden');
  genRow.classList.add('hidden');
  progTrack.classList.add('hidden');
  progText.classList.add('hidden');
  status.classList.add('hidden');
  fileInfo.classList.add('hidden');
  dropzone.classList.remove('hidden');
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (srcURL) { URL.revokeObjectURL(srcURL); srcURL = ''; }
  fileOnly = null;
  progBar.style.width = '0%';
}

function show(el) {
  el.classList.remove('hidden');
  el.hidden = false;
  if (el === result) el.classList.add('show');
}
function hide(el) {
  el.classList.add('hidden');
  el.hidden = true;
  if (el === result) el.classList.remove('show');
}
// 部分 WebM（如 MediaRecorder 生成）可能没有 duration 元数据，回退到实际缓冲时长
function getDuration() {
  let d = video.duration;
  if (!d || !isFinite(d)) {
    const b = video.buffered;
    if (b && b.length) d = b.end(b.length - 1);
  }
  return isFinite(d) && d > 0 ? d : 0;
}

/* 初始：未导入视频前隐藏编辑区 */
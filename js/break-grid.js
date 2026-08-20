(function () {
  'use strict';

  var FINAL = 1080, GAP = 10, OUTER = 36, START = 0;
  // 抠图模型已内置到项目 js/lib/mediapipe/ 目录，完全本地运行，无需联网下载（避免国内访问 CDN 卡死）
  function cellLen() { return (FINAL - 2 * OUTER - 2 * GAP) / 3; }
  function stepLen() { return cellLen() + GAP; }
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

  var $ = function (id) { return document.getElementById(id); };

  var subjectDrop = $('subjectDrop'), subjectInput = $('subjectInput'),
      subjectThumb = $('subjectThumb'), subjectThumbImg = $('subjectThumbImg'), subjectRemove = $('subjectRemove'),
      bgDrop = $('bgDrop'), bgInput = $('bgInput'), bgTray = $('bgTray'), bgCount = $('bgCount'),
      editor = $('editor'), bgGrid = $('bgGrid'), previewBox = $('previewBox'), subjectLayer = $('subjectLayer'),
      segStatus = $('segStatus'), subjectSize = $('subjectSize'), subjectSizeVal = $('subjectSizeVal'),
      centerBtn = $('centerBtn'), downloadBtn = $('downloadBtn'), againBtn = $('againBtn'),
     status = $('status'), statusText = $('statusText'), mobileHint = $('mobileHint'),
         dlProgress = $('dlProgress'), dlFill = $('dlFill'), dlLabel = $('dlLabel'),
         segActions = $('segActions'), useFullBtn = $('useFullBtn'), retryCutBtn = $('retryCutBtn'),
         modeSwitch = $('modeSwitch'), modeLabel = $('modeLabel'),
         featherRange = $('featherRange'), featherVal = $('featherVal'), featherNoneBtn = $('featherNoneBtn');

  var bgList = [];            // {url, img}
  var grid = new Array(9).fill(-1);  // slot -> bgList index or -1
  var customGrid = false;
  var selIdx = -1;            // click-select for move
  var subjectCutUrl = null;
  var subjAspect = 1;
  var subj = { l: 0, t: 0, w: 0 };
  // 羽化：软化抠图边缘、消除格线处的白色齿痕。featherRef 保存原始遮罩，供滑块实时重羽化
  var featherRadius = 2.0;
  var featherRef = null;
  var seg = null;

  var drag = null;
  var lastDragEndAt = 0;

  /* ---------- 基础工具 ---------- */
  function canvasOf(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function c2d(c) { return c.getContext('2d'); }
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('load fail')); };
      i.src = src;
    });
  }
  function drawCoverFit(x, img, tx, ty, tw, th) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var s = Math.max(tw / iw, th / ih);
    var sw = iw * s, sh = ih * s;
    x.drawImage(img, tx + (tw - sw) / 2, ty + (th - sh) / 2, sw, sh);
  }
  function scaleToFit(img, maxDim) {
    var s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    return { w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) };
  }
  function setBusy(t) { status.classList.remove('hidden'); statusText.textContent = t; }
  function endBusy() { status.classList.add('hidden'); }

  /* ---------- 人像分割（TensorFlow.js + BodyPix，纯 CPU / WASM 推理，无需 WebGL） ---------- */
  // 库与模型都放在项目 js/lib/tfjs/ 里，本地运行、免联网；使用 tfjs 的 WASM 后端在 CPU 上推理，
  // 彻底摆脱 WebGL2 依赖——之前 MediaPipe 在 WebGL 受限的电脑（软件渲染/已关闭硬件加速）上推理必失败
  var TF_DIR = new URL('../js/lib/tfjs/', location.href).href;
  var segInst = null;    // BodyPix 模型实例
  var segWorking = null; // 正在初始化中的 Promise（防止并发重复加载）

  function showDl(show) { dlProgress.classList.toggle('hidden', !show); }
  function dlMsg(label, indeterminate) {
    dlLabel.textContent = label;
    if (indeterminate) { dlFill.classList.add('indeterminate'); dlFill.style.width = ''; }
    else { dlFill.classList.remove('indeterminate'); dlFill.style.width = '100%'; }
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        rej(new Error('脚本加载失败：' + src));
      };
      document.head.appendChild(s);
    });
  }

  function waitForGlobal(name, timeout) {
    timeout = timeout || 30000;
    return new Promise(function (res, rej) {
      var start = Date.now();
      function check() {
        if (window[name]) res();
        else if (Date.now() - start > timeout) rej(new Error('等待全局变量 ' + name + ' 超时'));
        else setTimeout(check, 50);
      }
      check();
    });
  }

  function initSeg() {
    if (segInst) return Promise.resolve(segInst);
    if (segWorking) return segWorking;
    segWorking = loadScript(TF_DIR + 'tf.min.js')
      .then(function () { return waitForGlobal('tf'); })
      .then(function () { return loadScript(TF_DIR + 'tf-backend-wasm.js'); })
      .then(function () { return loadScript(TF_DIR + 'body-pix.min.js'); })
      .then(function () { return waitForGlobal('bodyPix'); })
      .then(function () {
        try {
          if (tf && tf.wasm) {
            tf.wasm.setWasmPaths(TF_DIR);
          }
        } catch (e) {
          console.warn('setWasmPaths 警告:', e);
        }
        return tf.setBackend('wasm').catch(function (err) {
          console.warn('WASM 后端切换失败，尝试用 CPU 后端:', err);
          return tf.setBackend('cpu');
        });
      })
      .then(function () { return tf.ready(); })
      .then(function () {
        var modelConfig = {
          multiplier: 0.75,
          outputStride: 16,
          quantBytes: 2,
          modelUrl: TF_DIR + 'bp/model-stride16.json'
        };
        return bodyPix.load(modelConfig);
      })
      .then(function (model) { segInst = model; console.log('抠图模型加载成功'); return model; })
      .catch(function (err) { console.error('抠图模型初始化失败:', err); throw err; })
      .finally(function () { segWorking = null; });
    return segWorking;
  }

  function segMaskCanvas(src, threshold) {
    return initSeg()
      .then(function () {
        // 使用 high 分辨率和更低的阈值，保留更多边缘细节
        return segInst.segmentPerson(src, {
          flipHorizontal: false,
          internalResolution: 'high',
          segmentationThreshold: threshold == null ? 0.3 : threshold
        });
      })
      .then(function (seg) {
        var mw = Math.max(1, Math.round(seg.width));
        var mh = Math.max(1, Math.round(seg.height));
        var data = seg.data;
        if (!data || data.length === 0 || mw <= 0 || mh <= 0) {
          throw new Error('抠图模型输出无效（尺寸=' + mw + 'x' + mh + '，数据长度=' + (data ? data.length : 0) + '）');
        }
        var mcv = canvasOf(mw, mh);
        var mctx = mcv.getContext('2d');
        var id = mctx.createImageData(mw, mh);
        var d = id.data;
        var n = Math.min(data.length, mw * mh);
        for (var i = 0; i < n; i++) {
          d[i * 4 + 3] = data[i] ? 255 : 0;
        }
        mctx.putImageData(id, 0, 0);
        return mcv;
      });
  }

  // 把模型输出的低分辨率遮罩上采样到工作图全尺寸
  function scaleToFull(small, w, h) {
    var c = canvasOf(w, h), cx = c2d(c);
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(small, 0, 0, w, h);
    // 二值化，为后续处理做准备
    var id = cx.getImageData(0, 0, w, h);
    for (var i = 0; i < id.data.length; i += 4) {
      id.data[i + 3] = (id.data[i + 3] >= 128) ? 255 : 0;
    }
    cx.putImageData(id, 0, 0);
    return c;
  }

  // 填充被前景完全包围的小背景洞
  function buildForeground(cv) {
    var w = cv.width, h = cv.height;
    var id = c2d(cv).getImageData(0, 0, w, h), d = id.data;
    var n = w * h, isF = new Uint8Array(n), i;
    for (i = 0; i < n; i++) isF[i] = (d[i * 4 + 3] >= 128) ? 1 : 0;

    // 连通域分析，找出背景区域
    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var comps = [];
    var x, y, nb, top;
    for (i = 0; i < n; i++) {
      if (isF[i] || seen[i]) continue;
      var sp = 0, cnt = 0, borderB = 0, cells = [];
      stack[sp] = i; sp++; seen[i] = 1;
      while (sp > 0) {
        sp--; var c = stack[sp];
        cells.push(c); cnt++;
        x = c % w; y = (c / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) borderB = 1;
        if (x > 0)      { nb = c - 1;     if (!isF[nb] && !seen[nb]) { seen[nb] = 1; stack[sp] = nb; sp++; } }
        if (y > 0)      { nb = c - w;     if (!isF[nb] && !seen[nb]) { seen[nb] = 1; stack[sp] = nb; sp++; } }
        if (x < w - 1)  { nb = c + 1;     if (!isF[nb] && !seen[nb]) { seen[nb] = 1; stack[sp] = nb; sp++; } }
        if (y < h - 1)  { nb = c + w;     if (!isF[nb] && !seen[nb]) { seen[nb] = 1; stack[sp] = nb; sp++; } }
      }
      comps.push({ cells: cells, cnt: cnt, border: borderB });
    }

    // 填充封闭的小孔洞
    var maxHole = Math.max(100, Math.round(n * 0.002));
    for (i = 0; i < comps.length; i++) {
      var cp = comps[i];
      if (!cp.border && cp.cnt <= maxHole) {
        for (top = 0; top < cp.cells.length; top++) {
          var ci = cp.cells[top];
          d[ci * 4 + 3] = 255;
        }
      }
    }
    c2d(cv).putImageData(id, 0, 0);
    return cv;
  }

  // 分离式一维高斯卷积：对单通道 alpha 加权平滑
  function gauss1D(src, w, h, radius) {
    var sigma = Math.max(1.0, radius / 2);
    var r = Math.max(2, Math.ceil(sigma * 3));
    var k = new Float32Array(r * 2 + 1), sum = 0, i;
    for (i = -r; i <= r; i++) { var v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; sum += v; }
    for (i = 0; i < k.length; i++) k[i] /= sum;
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    var x, y, j, acc;
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) {
        acc = 0;
        for (j = -r; j <= r; j++) {
          var xx = x + j; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          acc += src[row + xx] * k[j + r];
        }
        tmp[row + x] = acc;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        acc = 0;
        for (j = -r; j <= r; j++) {
          var yy = y + j; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          acc += tmp[yy * w + x] * k[j + r];
        }
        out[y * w + x] = acc;
      }
    }
    return out;
  }

  // 把二值遮罩羽化成柔和边缘
  function featherMask(maskCv, radius) {
    var w = maskCv.width, h = maskCv.height;
    var id = c2d(maskCv).getImageData(0, 0, w, h).data;
    var n = w * h, src = new Float32Array(n), i;
    for (i = 0; i < n; i++) src[i] = id[i * 4 + 3] / 255;
    var blur = gauss1D(src, w, h, radius);
    // 更宽的过渡带（0.1~0.9），让边缘更柔和自然
    var lo = 0.1, hi = 0.9;
    var out = canvasOf(w, h), oc = c2d(out);
    var od = oc.createImageData(w, h), d = od.data;
    for (i = 0; i < n; i++) {
      var a = blur[i];
      d[i * 4 + 3] = (a <= lo) ? 0 : (a >= hi) ? 255 : Math.round((a - lo) / (hi - lo) * 255);
    }
    oc.putImageData(od, 0, 0);
    return out;
  }

  // 用当前羽化强度重新合成主体（滑块实时调用，无需重跑模型）
  function applyFeather() {
    var f = featherRef, w = f.sc.w, h = f.sc.h;
    var mask = featherMask(f.mask, featherRadius);
    var cut = canvasOf(w, h), cx = c2d(cut);
    cx.drawImage(f.work, 0, 0);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(mask, 0, 0, w, h);
    cx.globalCompositeOperation = 'source-over';
    updateCut(cropAlpha(cut));
  }

  function cropAlpha(cv) {
    var w = cv.width, h = cv.height, x = c2d(cv), d = x.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var p = 0; p < w; p++) {
        if (d[(y * w + p) * 4 + 3] > 8) {
          if (p < minX) minX = p; if (p > maxX) maxX = p;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { w: w, h: h, url: cv.toDataURL('image/png') };
    var pad = Math.round(Math.min(w, h) * 0.02);
    var sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    var sw = Math.min(w - sx, maxX - minX + 1 + pad * 2), sh = Math.min(h - sy, maxY - minY + 1 + pad * 2);
    var out = canvasOf(sw, sh);
    c2d(out).drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return { w: sw, h: sh, url: out.toDataURL('image/png') };
  }

  function finishSubject(cropped, fallback) {
    subjectCutUrl = cropped.url;
    subjectLayer.src = cropped.url;
    subjectLayer.hidden = false;
    subjAspect = cropped.w / cropped.h;
    var cell = cellLen();
    subj.w = Math.round(cell * (parseInt(subjectSize.value, 10) / 100));
    var h = subj.w / subjAspect;
    subj.l = Math.round((FINAL - subj.w) / 2);
    subj.t = Math.round((FINAL - h) / 2) - Math.round(cell * 0.25);
    showDl(false);
    endBusy();
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
    editor.classList.remove('hidden');
    downloadBtn.disabled = false;
    updatePreviewScaling();
    renderGrid();
    segStatus.textContent = fallback
      ? '（已用整张主体、未抠图。可点「重新试一次抠图」再试）'
      : '抠图完成 ✓  拖动主体摆出冲出格子的效果';
    renderSubject();
  }

  // 仅更新主体图与宽高比（羽化滑块实时调整时用），保持已拖好的位置与缩放
  function updateCut(cropped) {
    subjectCutUrl = cropped.url;
    subjectLayer.src = cropped.url;
    subjAspect = cropped.w / cropped.h;
    setSubjectWidth(subj.w);
    renderSubject();
  }

  /* 不自动跳过：失败只提示，由用户手动选择继续方式 */
  function processSubject(imgEl, rawUrl) {
    setBusy('正在准备抠图…');
    showDl(true);
    dlMsg('正在加载抠图引擎并抠图（首次约 6MB，本地 CPU 处理）…', true);
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
    var sc = scaleToFit(imgEl, 640);
    var work = drawCanvas(imgEl, sc.w, sc.h);
    return initSeg()
      .then(function () { return segMaskCanvas(work, 0.55); })
      .then(function (mask) {
        // 低分辨率遮罩 → 上采样到工作图全分辨率 → 填充被包围的背景洞，再羽化出精细边缘
        mask = buildForeground(scaleToFull(mask, sc.w, sc.h));
        featherRef = { work: work, mask: mask, sc: sc };
        var fmask = featherMask(mask, featherRadius);
        var cut = canvasOf(sc.w, sc.h), cx = c2d(cut);
        cx.drawImage(work, 0, 0);
        cx.globalCompositeOperation = 'destination-in';
        cx.drawImage(fmask, 0, 0, sc.w, sc.h);
        cx.globalCompositeOperation = 'source-over';
        finishSubject(cropAlpha(cut), false);
        return true;
      })
      .catch(function (err) {
        showDl(false);
        endBusy();
        // 兜底操作区要整体显示，否则按钮被父容器 hidden 挡住，用户会以为页面卡死
        segActions.classList.remove('hidden');
        useFullBtn.classList.remove('hidden');
        retryCutBtn.classList.remove('hidden');
        segStatus.textContent = '自动抠图未成功，可用下方按钮选择继续方式。';
        console.error('抠图失败：', err);
        return false;
      });
  }

  function drawCanvas(img, w, h) { var c = canvasOf(w, h); c2d(c).drawImage(img, 0, 0, w, h); return c; }

  /* 让 DOM 预览与导出完全一致：根据画布宽度同步换算外围白边与格子间距 */
  function updatePreviewScaling() {
    var w = previewBox ? previewBox.getBoundingClientRect().width : 0;
    if (!w) return;
    var s = w / FINAL;
    bgGrid.style.padding = (OUTER * s) + 'px';
    bgGrid.style.columnGap = (GAP * s) + 'px';
    bgGrid.style.rowGap = (GAP * s) + 'px';
  }

  /* ---------- 背景图管理与九宫格摆放 ---------- */
  function buildSlots() {
    bgGrid.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      var s = document.createElement('div');
      s.className = 'slot';
      s.dataset.slot = i;
      var im = document.createElement('img');
      im.className = 'slot-img';
      im.alt = '';
      var e = document.createElement('span');
      e.className = 'slot-empty';
      e.textContent = '空';
      s.appendChild(im); s.appendChild(e);
      bgGrid.appendChild(s);
    }
  }
  buildSlots();

  function renderTray() {
    bgTray.textContent = '';
    var used = {};
    for (var i = 0; i < 9; i++) if (grid[i] !== -1) used[grid[i]] = true;
    bgList.forEach(function (b, idx) {
      var d = document.createElement('div');
      d.className = 'tray-thumb';
      d.dataset.drag = idx;
      d.draggable = false;
      d.style.touchAction = 'none';
      if (selIdx === idx) d.classList.add('selected');
      if (used[idx]) d.classList.add('placed');
      var im = document.createElement('img');
      im.src = b.url; im.alt = '';
      d.appendChild(im);
      if (used[idx]) {
        var tag = document.createElement('span');
        tag.className = 'placed-tag';
        tag.textContent = '已入格';
        d.appendChild(tag);
      }
      bgTray.appendChild(d);
    });
    if (bgList.length) {
      var hint = document.createElement('div');
      hint.className = 'tray-hint';
      hint.textContent = (selIdx !== -1 ? '已选中 1 张，点右方格子放置/交换；选中的图会在下方高亮' : '拖动缩略图到格子，或先点选再点格子；标「已入格」的图已在九宫格里');
      bgTray.appendChild(hint);
    }
  }

  function renderGrid() {
    var cells = bgGrid.children;
    for (var i = 0; i < 9; i++) {
      var s = cells[i], idx = grid[i];
      var im = s.querySelector('.slot-img'), e = s.querySelector('.slot-empty');
      if (idx !== -1 && bgList[idx]) {
        im.src = bgList[idx].url; im.hidden = false;
        e.classList.add('hidden');
        if (selIdx === idx) s.style.outline = '2px solid var(--accent)';
        else s.style.outline = '';
      } else {
        im.src = ''; im.hidden = true;
        e.classList.remove('hidden');
        s.style.outline = '';
      }
    }
    var usedCount = 0;
    for (var j = 0; j < 9; j++) if (grid[j] !== -1) usedCount++;
    bgCount.textContent = '背景 ' + usedCount + '/9 张';
  }
  function updateSel() { renderTray(); renderGrid(); }

  function addBgFiles(files) {
    var arr = Array.prototype.slice.call(files);
    if (!arr.length) return;
    // 每张图独立 catch：单张失败不阻断其余图的加载与渲染
    var proms = arr.map(function (f) {
      var url = URL.createObjectURL(f);
      return loadImg(url).then(function (img) {
        bgList.push({ url: url, img: img });
      }).catch(function () {
        URL.revokeObjectURL(url);
      });
    });
    Promise.all(proms).then(function () {
      if (!customGrid) {
        for (var i = 0; i < 9; i++) grid[i] = (i < bgList.length) ? i : -1;
      }
      customGrid = true;
      renderTray(); renderGrid();
      if (!editor.classList.contains('hidden')) {
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function place(bgIdx, slot) {
    var cur = -1, i;
    for (i = 0; i < 9; i++) if (grid[i] === bgIdx) { cur = i; break; }
    var at = grid[slot];
    if (slot === cur) return;
    if (cur !== -1) grid[cur] = (at === -1 ? -1 : at);
    grid[slot] = bgIdx;
    customGrid = true;
    updateSel();
  }

  function slotHit(cx, cy) {
    var r = previewBox.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return -1;
    var s = r.width / FINAL;
    var lx = (cx - r.left) / s, ly = (cy - r.top) / s;
    var step = stepLen();
    var col = Math.floor((lx - OUTER) / step), row = Math.floor((ly - OUTER) / step);
    if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
    return row * 3 + col;
  }

  /* ---------- 拖拽（背景摆放 / 换位） ---------- */
  function startDrag(ev, bgIdx) {
    if (ev.cancelable) ev.preventDefault();
    lastDragEndAt = 0;
    var url = bgList[bgIdx].url;
    var g = document.createElement('div');
    g.className = 'drag-ghost';
    var im = document.createElement('img');
    im.src = url; im.alt = '';
    g.appendChild(im);
    document.body.appendChild(g);
    drag = { idx: bgIdx, slot: -1, ghost: g, b0: ev.clientX, y0: ev.clientY };
    g.style.left = (ev.clientX - 32) + 'px';
    g.style.top = (ev.clientY - 32) + 'px';
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragCancel);
  }
  function onDragMove(ev) {
    if (!drag) return;
    drag.ghost.style.left = (ev.clientX - 32) + 'px';
    drag.ghost.style.top = (ev.clientY - 32) + 'px';
    var s = slotHit(ev.clientX, ev.clientY);
    var last = drag.slot;
    if (last !== s) {
      var cells = bgGrid.children;
      if (last >= 0) cells[last].classList.remove('drag-over');
      drag.slot = s;
      if (s >= 0) cells[s].classList.add('drag-over');
    }
  }
  function onDragUp(ev) {
    if (!drag) return;
    var s = drag.slot, c = drag.ghost;
    var cells = bgGrid.children;
    if (s >= 0) cells[s].classList.remove('drag-over');
    endDrag();
    lastDragEndAt = Date.now();
    if (s >= 0) place(drag.idx, s);
    if (c) c.remove();
  }
  function onDragCancel() {
    if (!drag) return;
    var cells = bgGrid.children;
    if (drag.slot >= 0) cells[drag.slot].classList.remove('drag-over');
    if (drag.ghost) drag.ghost.remove();
    endDrag();
  }
  function endDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragCancel);
    drag = null;
  }

  document.addEventListener('pointerdown', function (ev) {
    var t = ev.target.closest('[data-drag]');
    if (t && bgList[parseInt(t.dataset.drag, 10)]) {
      startDrag(ev, parseInt(t.dataset.drag, 10));
    }
  });

  /* 点击式摆放（辅助移动端/无障碍） */
  bgTray.addEventListener('click', function (ev) {
    if (Date.now() - lastDragEndAt < 300) return;
    var d = ev.target.closest('[data-drag]');
    if (!d) return;
    var idx = parseInt(d.dataset.drag, 10);
    selIdx = (selIdx === idx ? -1 : idx);
    updateSel();
  });
  bgGrid.addEventListener('click', function (ev) {
    if (Date.now() - lastDragEndAt < 300) return;
    var s = ev.target.closest('.slot');
    if (!s) return;
    var slotIdx = parseInt(s.dataset.slot, 10);
    if (selIdx !== -1) {
      if (grid[slotIdx] === selIdx) { selIdx = -1; }
      else { place(selIdx, slotIdx); selIdx = -1; }
      updateSel();
    } else if (grid[slotIdx] !== -1) {
      selIdx = grid[slotIdx];
      updateSel();
    }
  });

  /* ---------- 主体拖动 / 缩放 ---------- */
  function renderSubject() {
    var s = previewBox.getBoundingClientRect().width / FINAL;
    subjectLayer.style.width = (subj.w * s) + 'px';
    subjectLayer.style.left = (subj.l * s) + 'px';
    subjectLayer.style.top = (subj.t * s) + 'px';
  }

  (function subjectInteractions() {
    var active = null;
    function toLogical(dx, dy) {
      var s = previewBox.getBoundingClientRect().width / FINAL;
      return { dx: dx / s, dy: dy / s };
    }
    subjectLayer.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      active = { x: ev.clientX, y: ev.clientY, l: subj.l, t: subj.t };
      subjectLayer.classList.add('dragging');
      subjectLayer.setPointerCapture && subjectLayer.setPointerCapture(ev.pointerId);
    });
    subjectLayer.addEventListener('pointermove', function (ev) {
      if (!active) return;
      var d = toLogical(ev.clientX - active.x, ev.clientY - active.y);
      subj.l = Math.max(-subj.w * 0.6, Math.min(FINAL - subj.w * 0.3, active.l + d.dx));
      subj.t = Math.max(-subj.h * 0.6, Math.min(FINAL - subj.h * 0.3, active.t + d.dy));
      renderSubject();
    });
    function up() { active = null; subjectLayer.classList.remove('dragging'); }
    subjectLayer.addEventListener('pointerup', up);
    subjectLayer.addEventListener('pointercancel', up);
    subjectLayer.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      setSubjectWidth(subj.w + (ev.deltaY > 0 ? -1 : 1) * (subj.w * 0.1));
    }, { passive: false });
  })();

  function subjHeight() { return subj.w / subjAspect; }
  Object.defineProperty(subj, 'h', { get: subjHeight, configurable: true });
  function setSubjectWidth(nw) {
    var min = cellLen() * 0.5, max = FINAL * 1.6;
    subj.w = Math.max(min, Math.min(max, Math.round(nw)));
    if (subj.l + subj.w < 0) subj.l = -subj.w;
    if (subj.l > FINAL) subj.l = FINAL - 1;
    renderSubject();
  }

  subjectSize.addEventListener('input', function () {
    var cell = cellLen();
    subjectSizeVal.textContent = subjectSize.value + '%';
    if (subjectCutUrl) setSubjectWidth(cell * (parseInt(subjectSize.value, 10) / 100));
  });

  function setFeatherLabel() { if (featherVal) featherVal.textContent = '羽化 ' + featherRadius.toFixed(1).replace(/\.0$/, ''); }
  featherRange.addEventListener('input', function () {
    featherRadius = parseFloat(featherRange.value);
    setFeatherLabel();
    if (featherRef) applyFeather();
  });
  featherNoneBtn.addEventListener('click', function () {
    featherRange.value = 0;
    featherRadius = 0;
    setFeatherLabel();
    if (featherRef) applyFeather();
  });
  centerBtn.addEventListener('click', function () {
    var w = subj.w, h = subj.h;
    subj.l = Math.round((FINAL - w) / 2);
    subj.t = Math.round((FINAL - h) / 2) - Math.round(cellLen() * 0.25);
    renderSubject();
  });

  window.addEventListener('resize', function () { if (subjectCutUrl) { updatePreviewScaling(); renderSubject(); } });

  /* ---------- 上传入口 ---------- */
  subjectDrop.addEventListener('click', function () { subjectInput.click(); });
  subjectInput.addEventListener('change', function () {
    var f = subjectInput.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    loadImg(url).then(function (img) {
      subjectThumbImg.src = url;
      subjectThumb.classList.remove('hidden');
      subjectThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      processSubject(img, url);
    });
  });
  subjectRemove.addEventListener('click', function () {
    subjectInput.value = '';
    subjectThumb.classList.add('hidden');
    subjectThumbImg.src = '';
    subjectCutUrl = null;
    featherRef = null;
    editor.classList.add('hidden');
    downloadBtn.disabled = true;
    segStatus.textContent = '';
    showDl(false);
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
  });

  /* 抠图引擎：模型已内置到本地并自动优化（SIMD/通用自动适配），无需手动切换 */
  if (modeLabel) modeLabel.textContent = '内置模型 · 本地处理';

  /* 失败时手动选择：用整张主体 / 重试抠图 */
  useFullBtn.addEventListener('click', function () {
    var img = subjectThumbImg;
    if (!img || !img.src) return;
    var c = drawCanvas(img, img.naturalWidth || 300, img.naturalHeight || 300);
    finishSubject(cropAlpha(c), true);
  });
  retryCutBtn.addEventListener('click', function () {
    var img = subjectThumbImg;
    if (!img || !img.src) return;
    processSubject(img, img.src);
  });

  bgDrop.addEventListener('click', function () { bgInput.click(); });
  bgInput.addEventListener('change', function () {
    addBgFiles(bgInput.files);
    bgInput.value = '';
  });

  /* 拖放文件到上传区（桌面体验） */
  [subjectDrop, bgDrop].forEach(function (zone) {
    zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
    zone.addEventListener('dragleave', function () { zone.style.borderColor = ''; });
    zone.addEventListener('drop', function (ev) {
      ev.preventDefault();
      zone.style.borderColor = '';
      var files = ev.dataTransfer.files;
      if (!files.length) return;
      if (zone === subjectDrop && files[0]) {
        var url = URL.createObjectURL(files[0]);
        loadImg(url).then(function (img) {
          subjectThumbImg.src = url;
          subjectThumb.classList.remove('hidden');
          processSubject(img, url);
        });
      } else {
        addBgFiles(files);
      }
    });
  });

  /* ---------- 合成与下载 ---------- */
  downloadBtn.addEventListener('click', function () {
    if (!subjectCutUrl) return;
    downloadBtn.disabled = true;
    try {
      var res = compose();
      var url = res.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = url;
      a.download = '冲出九宫格.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (isTouch) mobileHint.classList.remove('hidden');
    } finally {
      setTimeout(function () { downloadBtn.disabled = false; }, 200);
    }
  });

  function compose() {
    var S = FINAL, c = canvasOf(S, S), x = c2d(c);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, S, S);
    var cell = (S - 2 * OUTER - 2 * GAP) / 3, step = cell + GAP;
    for (var i = 0; i < 9; i++) {
      var col = i % 3, row = Math.floor(i / 3), idx = grid[i];
      var X = OUTER + col * step, Y = OUTER + row * step;
      if (idx !== -1 && bgList[idx]) {
        drawCoverFit(x, bgList[idx].img, X, Y, cell, cell);
        x.strokeStyle = 'rgba(0,0,0,0.07)';
        x.lineWidth = 1;
        x.strokeRect(X + 0.5, Y + 0.5, cell, cell);
      }
    }
    if (subjectLayer && subjectLayer.src) {
      x.save();
      x.shadowColor = 'rgba(0,0,0,0.30)';
      x.shadowBlur = 18;
      x.shadowOffsetY = 8;
      x.drawImage(subjectLayer, subj.l, subj.t, subj.w, subj.h);
      x.restore();
      x.drawImage(subjectLayer, subj.l, subj.t, subj.w, subj.h);
    }
    return c;
  }

  /* ---------- 重置 ---------- */
  againBtn.addEventListener('click', function () {
    bgList.forEach(function (b) { if (b.url) URL.revokeObjectURL(b.url); });
    bgList = [];
    grid = new Array(9).fill(-1);
    customGrid = false;
    selIdx = -1;
    subjectInput.value = '';
    subjectThumb.classList.add('hidden');
    subjectThumbImg.src = '';
    subjectCutUrl = null;
    featherRef = null;
    subjectLayer.hidden = true;
    editor.classList.add('hidden');
    downloadBtn.disabled = true;
    mobileHint.classList.add('hidden');
    segStatus.textContent = '';
    showDl(false);
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
    renderTray(); renderGrid();
  });
})();
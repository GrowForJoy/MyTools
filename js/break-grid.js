(function () {
  'use strict';

  var FINAL = 1080, GAP = 10, OUTER = 36, START = 0;
  // 抠图模型 CDN：国内优先 npmmirror → jsDelivr → unpkg，失败自动尝试下一个
  var SEG_BASES = [
    'https://registry.npmmirror.com/@mediapipe/selfie_segmentation/0.1.1675465747/files',
    'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747',
    'https://unpkg.com/@mediapipe/selfie_segmentation@0.1.1675465747'
  ];
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
         modeSwitch = $('modeSwitch'), modeLabel = $('modeLabel');

  var bgList = [];            // {url, img}
  var grid = new Array(9).fill(-1);  // slot -> bgList index or -1
  var customGrid = false;
  var selIdx = -1;            // click-select for move
  var subjectCutUrl = null;
  var subjAspect = 1;
  var subj = { l: 0, t: 0, w: 0 };
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

  /* ---------- 人像分割（MediaPipe selfie，本地抠图） ---------- */
  /* MediaPipe 的 WASM 大文件在 Web Worker 内部下载，主线程的 fetch 拦截根本看不到。
     改用 XHR 在主线程预下载全部模型文件（XHR 有原生 onprogress），创建 blob URL 让 MediaPipe 直接用。 */
  // 两套模型：hd = SIMD 高清版（精度高、初始化慢），lite = 非 SIMD 轻量版（初始化快、精度略低）
  var SEG_FILES_HD = [
    { name: 'selfie_segmentation.js', size: 44542 },
    { name: 'selfie_segmentation_solution_simd_wasm_bin.js', size: 276493 },
    { name: 'selfie_segmentation_solution_simd_wasm_bin.wasm', size: 5694839 },
    { name: 'selfie_segmentation.tflite', size: 249024 },
    { name: 'selfie_segmentation.binarypb', size: 362 }
  ];
  var SEG_FILES_LITE = [
    { name: 'selfie_segmentation.js', size: 44542 },
    { name: 'selfie_segmentation_solution_wasm_bin.js', size: 276488 },
    { name: 'selfie_segmentation_solution_wasm_bin.wasm', size: 5587523 },
    { name: 'selfie_segmentation.tflite', size: 249024 },
    { name: 'selfie_segmentation.binarypb', size: 362 }
  ];
  var segMode = 'hd';  // 'hd' or 'lite'
  function segFiles() { return segMode === 'lite' ? SEG_FILES_LITE : SEG_FILES_HD; }

  function xhrDownload(url, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onprogress = function (e) { onProgress(e.lengthComputable ? e.loaded : 0, e.lengthComputable ? e.total : 0, e.loaded); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = function () { reject(new Error('network')); };
      xhr.ontimeout = function () { reject(new Error('timeout')); };
      xhr.timeout = 90000;
      xhr.send();
    });
  }

  /* ---------- 模型下载进度 ---------- */
  var dlState = { files: {} };
  function showDl(show) { dlProgress.classList.toggle('hidden', !show); }
  function updateDl() {
    var loaded = 0, size = 0;
    for (var f in dlState.files) {
      var p = dlState.files[f];
      if (p.total > 0) { loaded += p.loaded; size += p.total; }
      else { loaded += p.loaded; size += p.known; }
    }
    if (size > 0) {
      dlFill.classList.remove('indeterminate');
      var pct = Math.min(100, Math.round(loaded / size * 100));
      dlFill.style.width = pct + '%';
      var mb = (loaded / 1048576).toFixed(1), totalMb = (size / 1048576).toFixed(1);
      dlLabel.textContent = '模型下载中 ' + pct + '%  (' + mb + ' / ' + totalMb + ' MB)';
    } else {
      dlFill.classList.add('indeterminate');
      dlLabel.textContent = '正在连接模型服务器…';
    }
  }

  function preDownloadModel(base) {
    dlState = { files: {} };
    segFiles().forEach(function (f) { dlState.files[f.name] = { loaded: 0, total: 0, known: f.size }; });
    updateDl();
    var blobUrls = {};
    var promises = segFiles().map(function (f) {
      return xhrDownload(base + '/' + f.name, function (loaded, total, raw) {
        var p = dlState.files[f.name];
        p.loaded = total > 0 ? loaded : raw;  // 没有content-length时用raw已传字节
        p.total = total;
        updateDl();
      }).then(function (blob) {
        blobUrls[f.name] = URL.createObjectURL(blob);
      });
    });
    return Promise.all(promises).then(function () { return blobUrls; });
  }

  function loadScriptFromBlob(blobUrl) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = blobUrl;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script exec')); };
      document.head.appendChild(s);
    });
  }

  function initSeg() {
    if (seg) return Promise.resolve(seg);
    var cdnIdx = 0;
    function tryCdn() {
      if (cdnIdx >= SEG_BASES.length) return Promise.reject(new Error('all CDN failed'));
      var base = SEG_BASES[cdnIdx++];
      return preDownloadModel(base)
        .then(function (blobUrls) {
          // 下载完成，先停留 300ms 显示 100% ✓，让用户明确知道"下载完了"
          dlFill.classList.remove('indeterminate');
          dlFill.style.width = '100%';
          dlLabel.textContent = '模型下载完成 ✓  正在初始化…';
          statusText.textContent = '模型下载完成，正在初始化…';
          return new Promise(function (r) { setTimeout(r, 300); }).then(function () {
            // 进入初始化阶段（WASM 编译 + 模型加载，没有进度）
            dlFill.classList.add('indeterminate');
            dlLabel.textContent = '模型初始化中…（首次使用需编译 WASM，请稍候）';
            statusText.textContent = '模型初始化中…';
            return loadScriptFromBlob(blobUrls['selfie_segmentation.js']);
          }).then(function () {
            window.__segBase = base;
            seg = new SelfieSegmentation({
              locateFile: function (f) { return blobUrls[f] || (base + '/' + f); }
            });
            seg.setOptions({ modelSelection: 1 });
            return seg.initialize().then(function () { return seg; });
          });
        })
        .catch(function () { return tryCdn(); });
    }
    return tryCdn();
  }

  function segMaskCanvas(src) {
    return initSeg().then(function () {
      return new Promise(function (resolve, reject) {
        seg.onResults = function (r) { resolve(r.segmentationMask); };
        seg.send({ image: src }).catch(reject);
      });
    });
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
    dlState = { files: {} };
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

  /* 不自动跳过：失败只提示，由用户手动选择继续方式 */
  function processSubject(imgEl, rawUrl) {
    setBusy('正在下载抠图模型并抠图（首次约 6MB）…');
    showDl(true);
    updateDl();
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
    var sc = scaleToFit(imgEl, 640);
    var work = drawCanvas(imgEl, sc.w, sc.h);
    return initSeg()
      .then(function () { return segMaskCanvas(work); })
      .then(function (mask) {
        var cut = canvasOf(sc.w, sc.h), cx = c2d(cut);
        cx.drawImage(work, 0, 0);
        cx.globalCompositeOperation = 'destination-in';
        cx.drawImage(mask, 0, 0, sc.w, sc.h);
        cx.globalCompositeOperation = 'source-over';
        finishSubject(cropAlpha(cut), false);
        return true;
      })
      .catch(function () {
        showDl(false);
        dlState = { files: {} };
        endBusy();
        useFullBtn.classList.remove('hidden');
        segStatus.textContent = '抠图未就绪：模型下载或本地抠图失败。可重试，或用整张主体继续。';
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
    editor.classList.add('hidden');
    downloadBtn.disabled = true;
    segStatus.textContent = '';
    showDl(false);
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
  });

  /* 模型模式切换：高清版 / 轻量版 */
  function updateModeLabel() {
    if (modeLabel) modeLabel.textContent = segMode === 'lite' ? '轻量版（快）' : '高清版（慢）';
  }
  updateModeLabel();
  if (modeSwitch) {
    modeSwitch.addEventListener('change', function () {
      var newMode = modeSwitch.checked ? 'lite' : 'hd';
      if (newMode === segMode) return;
      segMode = newMode;
      seg = null;  // 清空旧模型，下次抠图会重新加载
      updateModeLabel();
      // 如果已经有主体图，提示用户重新抠图
      if (subjectThumbImg && subjectThumbImg.src && !subjectThumb.classList.contains('hidden')) {
        segStatus.textContent = '已切换到' + (segMode === 'lite' ? '轻量版' : '高清版') + '，点击「重新试一次抠图」应用新模式';
        segActions.classList.remove('hidden');
        retryCutBtn.classList.remove('hidden');
      }
    });
  }

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
    subjectLayer.hidden = true;
    editor.classList.add('hidden');
    downloadBtn.disabled = true;
    mobileHint.classList.add('hidden');
    segStatus.textContent = '';
    showDl(false);
    segActions.classList.add('hidden');
    useFullBtn.classList.add('hidden');
    retryCutBtn.classList.add('hidden');
    dlState = { files: {} };
    renderTray(); renderGrid();
  });
})();
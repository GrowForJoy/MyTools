/* 九宫格切图逻辑：全部在浏览器本地完成，不依赖任何外部库。
   上传图片后即按当前选项实时预览切片效果，无需手动点切图。 */
(function () {
  'use strict';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileInfo = document.getElementById('fileInfo');
  var fileNameEl = document.getElementById('fileName');
  var fileMetaEl = document.getElementById('fileMeta');
  var removeFileBtn = document.getElementById('removeFile');

  var gridChips = document.getElementById('gridChips');
  var rowsInput = document.getElementById('rows');
  var colsInput = document.getElementById('cols');
  var canvasNote = document.getElementById('canvasNote');
  var borderInput = document.getElementById('borderInput');
  var borderValue = document.getElementById('borderValue');

  var statusEl = document.getElementById('status');
  var statusText = document.getElementById('statusText');

  var resultEl = document.getElementById('result');
  var statTotal = document.getElementById('statTotal');
  var statHoles = document.getElementById('statHoles');
  var statFiles = document.getElementById('statFiles');
  var tileGrid = document.getElementById('tileGrid');
  var orderHint = document.getElementById('orderHint');
  var downloadAllBtn = document.getElementById('downloadAllBtn');
  var downloadImgBtn = document.getElementById('downloadImgBtn');
  var againBtn = document.getElementById('againBtn');
  var mobileHint = document.getElementById('mobileHint');
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 768);
  var mobileHintDefault = '手机/平板：点「下载全部图片」，在系统分享里选「存储到照片」即可逐张存成图片；想打包压缩包再点第二个按钮。';

  var currentFile = null;
  var currentSource = null;      // {el, w, h, close}
  var tiles = [];                // {index,row,col,canvas,dataUrl,included,url}
  var baseName = '';
  var zipUrl = null;
  var busyCount = 0;
  var renderTimer = null;
  var currentCols = 3, currentRows = 3;   // 预览网格需严格按 行×列 排布

  /* ---------- 工具函数 ---------- */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function canvasToBlob(canvas, mime, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, mime, q); });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getCanvasMode() {
    return (document.querySelector('input[name="canvas"]:checked') || {}).value || 'ratio';
  }
  function getPlayMode() {
    return (document.querySelector('input[name="play"]:checked') || {}).value || 'full';
  }
  function showNumber() {
    return (document.querySelector('input[name="num"]:checked') || {}).value !== 'off';
  }
  function clampInt(val, min, max, def) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function setBusyText(text) {
    statusText.textContent = text || '正在更新…';
  }
  function beginBusy() {
    busyCount++;
    statusEl.classList.remove('hidden');
  }
  function endBusy() {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) statusEl.classList.add('hidden');
  }

  /* ---------- 图片加载 ---------- */
  function loadSource(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
        return { el: bmp, w: bmp.width, h: bmp.height, close: function () { bmp.close(); } };
      }).catch(function () { return loadViaImage(file); });
    }
    return loadViaImage(file);
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ el: img, w: img.naturalWidth, h: img.naturalHeight, close: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片加载失败，请换一张试试')); };
      img.src = url;
    });
  }

  /* ---------- 切图主体 ---------- */
  function computeGeometry(mode, cols, rows) {
    var sw = currentSource.w, sh = currentSource.h;
    if (mode === 'square') {
      var sideSq = Math.min(sw, sh);
      return { planeW: sideSq, planeH: sideSq, offsetX: (sw - sideSq) / 2, offsetY: (sh - sideSq) / 2, tileW: sideSq / cols, tileH: sideSq / rows };
    }
    if (mode === 'pad') {
      var full = Math.max(sw, sh);
      return { planeW: full, planeH: full, offsetX: (full - sw) / 2, offsetY: (full - sh) / 2, tileW: full / cols, tileH: full / rows };
    }
    return { planeW: sw, planeH: sh, offsetX: 0, offsetY: 0, tileW: sw / cols, tileH: sh / rows };
  }

  // 序号只作为预览区的 UI 角标，不烙进下载的图片文件里
  function render() {
    if (!currentSource) return;
    var cols = clampInt(colsInput.value, 1, 8, 3);
    var rows = clampInt(rowsInput.value, 1, 8, 3);
    var mode = getCanvasMode();
    var hole = getPlayMode() === 'hole';
    var num = showNumber();
    var border = parseInt(borderInput.value, 10) || 0;

    colsInput.value = cols;
    rowsInput.value = rows;
    currentCols = cols;
    currentRows = rows;

    var g = computeGeometry(mode, cols, rows);
    var total = rows * cols;
    buildTiles(g, rows, cols, border);

    setBusyText('正在生成预览…');
    beginBusy();
    Promise.all(tiles.map(function (t) {
      return canvasToBlob(t.canvas, 'image/jpeg', 0.92).then(blobToDataURL).then(function (d) { t.dataUrl = d; });
    })).then(function () {
      renderTiles();
      updateStats(total);
      orderHint.classList.toggle('hidden', !num || hole);
      resultEl.classList.add('show');
      if (isTouch) {
        downloadImgBtn.hidden = false;
        mobileHint.classList.remove('hidden');
      } else {
        downloadImgBtn.hidden = true;
        mobileHint.classList.add('hidden');
      }
      endBusy();
    }).catch(function () {
      endBusy();
    });
  }

  function buildTiles(g, rows, cols, border) {
    tiles.forEach(function (t) { if (t.url) URL.revokeObjectURL(t.url); });
    tiles = [];
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var srcX = Math.round(g.offsetX + x * g.tileW);
        var srcY = Math.round(g.offsetY + y * g.tileH);
        var tw = Math.round(g.tileW);
        var th = Math.round(g.tileH);

        var canvas = document.createElement('canvas');
        var cw = tw, ch = th;
        if (border > 0) { cw = tw + border * 2; ch = th + border * 2; }
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (border > 0) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cw, ch); }
        ctx.drawImage(currentSource.el, srcX, srcY, tw, th, border, border, tw, th);

        tiles.push({ index: y * cols + x, row: y, col: x, canvas: canvas, included: true, dataUrl: '' });
      }
    }
  }

  function renderTiles() {
    var hole = getPlayMode() === 'hole';
    var num = showNumber();
    tileGrid.innerHTML = '';
    // 预览网格列数严格跟随所选列数，直观呈现 行×列 拼图效果
    tileGrid.style.gridTemplateColumns = 'repeat(' + currentCols + ', minmax(0, 1fr))';
    tiles.forEach(function (t) {
      var cell = document.createElement('div');
      cell.className = 'tile' + (t.included ? '' : ' holed');
      cell.dataset.index = t.index;

      var media = document.createElement('div');
      media.className = 'tile-media';
      // 让图片按真实分块比例填满所在格子，不额外留白
      media.style.aspectRatio = t.canvas.width + ' / ' + t.canvas.height;
      var img = document.createElement('img');
      img.src = t.dataUrl;
      img.alt = '分块 ' + (t.index + 1);

      var empty = document.createElement('span');
      empty.className = 'tile-empty';
      empty.textContent = '已留空';

      var chip = document.createElement('span');
      chip.className = 'tile-chip';
      chip.textContent = String(t.index + 1);

      var actions = document.createElement('div');
      actions.className = 'tile-actions';
      if (hole) {
        var holeBtn = document.createElement('button');
        holeBtn.type = 'button';
        holeBtn.className = 'tile-btn hole';
        holeBtn.textContent = t.included ? '留空' : '恢复';
        holeBtn.addEventListener('click', function () {
          t.included = !t.included;
          renderTiles();
          updateStats(tiles.length);
          refreshDownloadBtn();
        });
        actions.appendChild(holeBtn);
      }
      var dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'tile-btn dl';
      dlBtn.setAttribute('aria-label', '下载分块 ' + (t.index + 1));
      dlBtn.textContent = '↓';
      dlBtn.addEventListener('click', function (e) { downloadTile(t, e); });
      actions.appendChild(dlBtn);

      media.appendChild(img);
      media.appendChild(empty);
      if (num) media.appendChild(chip);
      media.appendChild(actions);
      cell.appendChild(media);
      tileGrid.appendChild(cell);
    });
  }

  function updateStats(total) {
    var holes = tiles.filter(function (t) { return !t.included; }).length;
    statTotal.textContent = total;
    statHoles.textContent = holes;
    statFiles.textContent = tiles.length - holes;
    refreshDownloadBtn();
  }

  function refreshDownloadBtn() {
    downloadAllBtn.disabled = tiles.filter(function (t) { return t.included; }).length === 0;
  }

  /* ---------- 单块下载 ---------- */
  function downloadTile(t, ev) {
    canvasToBlob(t.canvas, 'image/jpeg', 0.92).then(function (blob) {
      var name = baseName + '_' + String(t.index + 1).padStart(2, '0') + '.jpg';
      if (isMobile && navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: 'image/jpeg' })] })) {
        navigator.share({ files: [new File([blob], name, { type: 'image/jpeg' })], title: baseName, text: '九宫格分块 ' + (t.index + 1) }).catch(function () {});
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    });
  }

  /* ---------- 下载全部图片（移动端：多文件分享存到相册） ---------- */
  function zipFallbackHint() {
    mobileHint.classList.remove('hidden');
    mobileHint.textContent = '当前浏览器不支持一次分享多张图片，已改为打包 ZIP 下载（解压后即为分块图）。';
  }
  function downloadAllImages() {
    var els = tiles.filter(function (t) { return t.included; });
    if (!els.length) return;
    downloadImgBtn.disabled = true;
    Promise.all(els.map(function (t) {
      return canvasToBlob(t.canvas, 'image/jpeg', 0.92).then(function (b) {
        return new File([b], baseName + '_' + String(t.index + 1).padStart(2, '0') + '.jpg', { type: 'image/jpeg' });
      });
    })).then(function (files) {
      if (navigator.canShare && navigator.canShare({ files: files })) {
        // 系统分享面板 → 选「存储到照片」逐张保存；用户取消或失败都在此结束，不落入退回逻辑
        return navigator.share({ files: files, title: baseName + ' 九宫格切图' }).catch(function () {});
      }
      // 不支持多文件分享 → 退回 ZIP
      zipFallbackHint();
      downloadAllBtn.click();
      return Promise.resolve();
    }).then(function () {
      downloadImgBtn.disabled = false;
    }).catch(function () {
      downloadImgBtn.disabled = false;
    });
  }

  /* ---------- ZIP 打包（存储法，纯前端实现） ---------- */
  var crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }
  function crc32(bytes) {
    var t = getCrcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }

  function buildZip(entries) {
    var enc = new TextEncoder();
    var chunks = [];
    var central = [];
    var offset = 0;
    var date = new Date();
    var dt = dosTime(date), dd = dosDate(date);

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var size = e.bytes.length;
      var crc = crc32(e.bytes);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);   // bit 11：文件名按 UTF-8 编码，避免中文名乱码
      local.setUint16(8, 0, true);
      local.setUint16(10, dt, true);
      local.setUint16(12, dd, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      var localArr = new Uint8Array(local.buffer);
      chunks.push(localArr, nameBytes, e.bytes);

      central.push({ nameBytes: nameBytes, crc: crc, size: size, offset: offset });
      offset += localArr.length + nameBytes.length + size;
    });

    var cdSize = 0;
    entries.forEach(function (e, i) {
      var c = central[i];
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);   // bit 11：文件名 UTF-8
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dt, true);
      cd.setUint16(14, dd, true);
      cd.setUint32(16, c.crc, true);
      cd.setUint32(20, c.size, true);
      cd.setUint32(24, c.size, true);
      cd.setUint16(28, c.nameBytes.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, c.offset, true);
      var cdArr = new Uint8Array(cd.buffer);
      chunks.push(cdArr, c.nameBytes);
      cdSize += cdArr.length + c.nameBytes.length;
    });

    var cdOffset = offset;
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdOffset, true);
    eocd.setUint16(20, 0, true);
    chunks.push(new Uint8Array(eocd.buffer));

    var totalLen = chunks.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(totalLen);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  function packageZip() {
    if (zipUrl) { URL.revokeObjectURL(zipUrl); zipUrl = null; }
    var els = tiles.filter(function (t) { return t.included; });
    return Promise.all(els.map(function (t) {
      return canvasToBlob(t.canvas, 'image/jpeg', 0.92).then(function (blob) { return blob.arrayBuffer(); }).then(function (ab) {
        return { name: baseName + '_' + String(t.index + 1).padStart(2, '0') + '.jpg', bytes: new Uint8Array(ab) };
      });
    })).then(function (entries) {
      return new Blob([buildZip(entries).buffer], { type: 'application/zip' });
    });
  }

  /* ---------- 事件绑定 ---------- */
  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件（JPG / PNG / WebP 等）'); return; }
    resets();
    currentFile = file;
    baseName = file.name.replace(/\.[^.]+$/, '');
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = formatBytes(file.size) + ' · ' + (file.type || '未知格式');
    fileInfo.classList.add('show');
    dropzone.classList.remove('drag');

    setBusyText('正在加载图片…');
    beginBusy();
    if (currentSource) { currentSource.close(); currentSource = null; }
    loadSource(file).then(function (src) {
      currentSource = src;
      scheduleRender();
    }).catch(function (err) {
      endBusy();
      alert(err && err.message ? err.message : '图片加载失败，请换一张试试');
    });
  }

  function resets() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    busyCount = 0; statusEl.classList.add('hidden');
    tiles.forEach(function (t) { if (t.url) URL.revokeObjectURL(t.url); });
    tiles = [];
    tileGrid.innerHTML = '';
    resultEl.classList.remove('show');
    if (zipUrl) { URL.revokeObjectURL(zipUrl); zipUrl = null; }
    orderHint.classList.add('hidden');
    mobileHint.textContent = mobileHintDefault;
    mobileHint.classList.add('hidden');
  }

  function clearFile() {
    resets();
    currentFile = null;
    if (currentSource) { currentSource.close(); currentSource = null; }
    fileInfo.classList.remove('show');
    fileInput.value = '';
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderTimer = null; render(); }, 120);
  }

  function syncChip() {
    gridChips.querySelectorAll('.gc-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.r === rowsInput.value && c.dataset.c === colsInput.value);
    });
  }

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });

  removeFileBtn.addEventListener('click', clearFile);
  againBtn.addEventListener('click', function () {
    clearFile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  downloadAllBtn.addEventListener('click', function () {
    downloadAllBtn.disabled = true;
    packageZip().then(function (blob) {
      zipUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = zipUrl;
      a.download = baseName + '_九宫格切图.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(refreshDownloadBtn, 200);
    }).catch(function () {
      alert('打包失败，请重试');
      refreshDownloadBtn();
    });
  });

  if (downloadImgBtn) {
    downloadImgBtn.addEventListener('click', downloadAllImages);
  }

  gridChips.addEventListener('click', function (e) {
    var chip = e.target.closest('.gc-chip');
    if (!chip) return;
    gridChips.querySelectorAll('.gc-chip').forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    rowsInput.value = chip.dataset.r;
    colsInput.value = chip.dataset.c;
    syncChip();
    scheduleRender();
  });
  rowsInput.addEventListener('input', function () { syncChip(); scheduleRender(); });
  colsInput.addEventListener('input', function () { syncChip(); scheduleRender(); });
  borderInput.addEventListener('input', updateBorderValue);
  borderInput.addEventListener('change', scheduleRender);
  document.querySelectorAll('input[name="canvas"]').forEach(function (r) { r.addEventListener('change', function () { updateCanvasNote(); scheduleRender(); }); });
  document.querySelectorAll('input[name="play"]').forEach(function (r) { r.addEventListener('change', scheduleRender); });
  document.querySelectorAll('input[name="num"]').forEach(function (r) { r.addEventListener('change', scheduleRender); });

  /* ---------- 初始化 ---------- */
  function updateCanvasNote() {
    var m = getCanvasMode();
    canvasNote.textContent = m === 'square'
      ? '裁成方形：取居中最大正方形裁切，九张拼图最标准。'
      : m === 'pad'
        ? '加白边补方：四周补白成为正方形，保留整张图不裁切。'
        : '原图等比：按原图比例直接切，非正方形的分块会是长方形。';
  }
  function updateBorderValue() {
    borderValue.textContent = borderInput.value + ' px';
  }
  updateCanvasNote();
  updateBorderValue();
})();
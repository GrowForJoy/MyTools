/* 图片压缩工具逻辑：全部在浏览器本地完成 */
(function () {
  'use strict';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileInfo = document.getElementById('fileInfo');
  var fileNameEl = document.getElementById('fileName');
  var fileMetaEl = document.getElementById('fileMeta');
  var removeFileBtn = document.getElementById('removeFile');

  var targetSelect = document.getElementById('targetSize');
  var targetNote = document.getElementById('targetNote');
  var customSizeWrap = document.getElementById('customSizeWrap');
  var customSizeInput = document.getElementById('customSize');
  var qualityWrap = document.getElementById('qualityWrap');
  var qualityInput = document.getElementById('quality');
  var qualityValue = document.getElementById('qualityValue');
  var formatNote = document.getElementById('formatNote');

  var compressBtn = document.getElementById('compressBtn');
  var statusEl = document.getElementById('status');
  var statusText = document.getElementById('statusText');

  var resultEl = document.getElementById('result');
  var beforeImg = document.getElementById('beforeImg');
  var afterImg = document.getElementById('afterImg');
  var beforeSize = document.getElementById('beforeSize');
  var beforeDim = document.getElementById('beforeDim');
  var afterSize = document.getElementById('afterSize');
  var afterDim = document.getElementById('afterDim');
  var statSaved = document.getElementById('statSaved');
  var statRatio = document.getElementById('statRatio');
  var statFormat = document.getElementById('statFormat');
  var downloadBtn = document.getElementById('downloadBtn');
  var againBtn = document.getElementById('againBtn');

  var currentFile = null;
  var currentSource = null;
  var beforeUrl = null;
  var afterUrl = null;

  /* ---------- 工具函数 ---------- */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function getFormatLabel(mime) {
    return mime === 'image/webp' ? 'WebP' : mime === 'image/png' ? 'PNG' : 'JPEG';
  }

  function getSelectedFormat() {
    var checked = document.querySelector('input[name="format"]:checked');
    return checked ? checked.value : 'image/jpeg';
  }

  function getTargetBytes() {
    var v = targetSelect.value;
    if (v === 'none') return null;
    if (v === 'custom') {
      var n = parseInt(customSizeInput.value, 10);
      return isNaN(n) || n < 1 ? null : n * 1024;
    }
    return parseInt(v, 10) * 1024;
  }

  /* ---------- 图片加载 ---------- */
  function loadSource(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
        return {
          width: bmp.width,
          height: bmp.height,
          render: function (w, h, mime, q) {
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bmp, 0, 0, w, h);
            return new Promise(function (resolve) {
              canvas.toBlob(resolve, mime, q);
            });
          },
          close: function () { bmp.close(); }
        };
      }).catch(function () {
        return loadViaImage(file);
      });
    }
    return loadViaImage(file);
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          render: function (w, h, mime, q) {
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            return new Promise(function (res) {
              canvas.toBlob(res, mime, q);
            });
          },
          close: function () { URL.revokeObjectURL(url); }
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败，请换一张试试'));
      };
      img.src = url;
    });
  }

  /* ---------- 压缩算法 ---------- */
  // 按目标大小：二分查找质量，仍超限则逐步缩小尺寸
  async function compressToTarget(source, targetBytes, mime) {
    var scale = 1;
    var width = source.width;
    var height = source.height;
    var lossy = mime !== 'image/png';

    for (var attempt = 0; attempt < 12; attempt++) {
      if (lossy) {
        var lo = 0.06, hi = 0.95;
        var best = null;
        for (var i = 0; i < 8; i++) {
          var q = (lo + hi) / 2;
          var blob = await source.render(width, height, mime, q);
          if (blob.size <= targetBytes) { best = blob; lo = q; }
          else { hi = q; }
        }
        if (best) return { blob: best, width: width, height: height };
      } else {
        var pngBlob = await source.render(width, height, mime, 1);
        if (pngBlob.size <= targetBytes) return { blob: pngBlob, width: width, height: height };
      }
      scale *= 0.75;
      width = Math.max(1, Math.round(source.width * scale));
      height = Math.max(1, Math.round(source.height * scale));
      if (width < 8 || height < 8) break;
    }

    var last = await source.render(width, height, mime, lossy ? 0.06 : 1);
    return { blob: last, width: width, height: height };
  }

  async function compressByQuality(source, mime, quality) {
    var blob = await source.render(source.width, source.height, mime, quality);
    return { blob: blob, width: source.width, height: source.height };
  }

  /* ---------- UI 交互 ---------- */
  function setBusy(busy, text) {
    compressBtn.disabled = busy || !currentFile;
    if (busy) {
      statusText.textContent = text || '正在压缩…';
      statusEl.classList.remove('hidden');
    } else {
      statusEl.classList.add('hidden');
    }
  }

  function resetResult() {
    resultEl.classList.remove('show');
    if (beforeUrl) { URL.revokeObjectURL(beforeUrl); beforeUrl = null; }
    if (afterUrl) { URL.revokeObjectURL(afterUrl); afterUrl = null; }
  }

  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      alert('请选择图片文件（JPG / PNG / WebP）');
      return;
    }
    resetResult();
    currentFile = file;
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = formatBytes(file.size);
    fileInfo.classList.add('show');
    compressBtn.disabled = false;
    dropzone.classList.remove('drag');
  }

  function clearFile() {
    currentFile = null;
    if (currentSource) { currentSource.close(); currentSource = null; }
    fileInfo.classList.remove('show');
    resetResult();
    compressBtn.disabled = true;
    fileInput.value = '';
  }

  function updateOptions() {
    var v = targetSelect.value;
    var isCustom = v === 'custom';
    var isNone = v === 'none';
    customSizeWrap.classList.toggle('hidden', !isCustom);
    qualityWrap.classList.toggle('hidden', !isNone);
    targetNote.textContent = isNone
      ? '手动调节质量，不限制最终大小。'
      : isCustom
        ? '将自动调整质量与尺寸，尽量达到自定义目标。'
        : '将自动调整质量与尺寸，尽量达到目标大小。';
  }

  function updateFormatNote() {
    var mime = getSelectedFormat();
    formatNote.textContent = mime === 'image/png'
      ? 'PNG 为无损格式，主要通过缩小尺寸来减小体积。'
      : mime === 'image/webp'
        ? 'WebP 通常比 JPEG 更小，但部分旧软件可能不支持。'
        : 'JPEG 为有损压缩，适合照片类图片。';
  }

  /* ---------- 压缩主流程 ---------- */
  compressBtn.addEventListener('click', async function () {
    if (!currentFile) return;
    setBusy(true, '正在压缩…');
    resetResult();

    try {
      var mime = getSelectedFormat();
      var targetBytes = getTargetBytes();
      currentSource = await loadSource(currentFile);
      var result;

      if (targetBytes && currentFile.size > targetBytes) {
        result = await compressToTarget(currentSource, targetBytes, mime);
      } else if (targetBytes) {
        // 原图已小于目标，直接返回原文件
        result = { blob: currentFile, width: currentSource.width, height: currentSource.height };
      } else {
        var q = parseInt(qualityInput.value, 10) / 100;
        result = await compressByQuality(currentSource, mime, q);
      }

      var beforeBytes = currentFile.size;
      var afterBytes = result.blob.size;
      var savedPercent = Math.max(0, Math.round((1 - afterBytes / beforeBytes) * 100));

      beforeUrl = URL.createObjectURL(currentFile);
      afterUrl = URL.createObjectURL(result.blob);

      beforeImg.src = beforeUrl;
      afterImg.src = afterUrl;
      beforeSize.textContent = formatBytes(beforeBytes);
      afterSize.textContent = formatBytes(afterBytes);
      beforeDim.textContent = currentSource.width + ' × ' + currentSource.height;
      afterDim.textContent = result.width + ' × ' + result.height;
      statSaved.textContent = savedPercent + '%';
      statRatio.textContent = (afterBytes / beforeBytes).toFixed(2) + '×';
      statFormat.textContent = getFormatLabel(mime);

      var base = currentFile.name.replace(/\.[^.]+$/, '');
      downloadBtn.href = afterUrl;
      downloadBtn.download = base + '_compressed.' + (mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg');

      resultEl.classList.add('show');
    } catch (err) {
      alert(err && err.message ? err.message : '压缩失败，请重试');
    } finally {
      setBusy(false);
    }
  });

  /* ---------- 事件绑定 ---------- */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    handleFile(e.dataTransfer.files[0]);
  });

  removeFileBtn.addEventListener('click', clearFile);
  againBtn.addEventListener('click', function () {
    clearFile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  targetSelect.addEventListener('change', updateOptions);
  qualityInput.addEventListener('input', function () {
    qualityValue.textContent = qualityInput.value + '%';
  });
  document.querySelectorAll('input[name="format"]').forEach(function (r) {
    r.addEventListener('change', updateFormatNote);
  });

  updateOptions();
  updateFormatNote();
})();

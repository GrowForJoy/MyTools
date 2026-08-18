/* 图片格式转换逻辑：全部在浏览器本地完成 */
(function () {
  'use strict';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileInfo = document.getElementById('fileInfo');
  var fileNameEl = document.getElementById('fileName');
  var fileMetaEl = document.getElementById('fileMeta');
  var removeFileBtn = document.getElementById('removeFile');

  var qualityWrap = document.getElementById('qualityWrap');
  var qualityInput = document.getElementById('quality');
  var qualityValue = document.getElementById('qualityValue');
  var formatNote = document.getElementById('formatNote');

  var convertBtn = document.getElementById('convertBtn');
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
  var statDim = document.getElementById('statDim');
  var statFormat = document.getElementById('statFormat');
  var downloadBtn = document.getElementById('downloadBtn');
  var againBtn = document.getElementById('againBtn');
  var mobileHint = document.getElementById('mobileHint');
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

  var currentFile = null;
  var currentSource = null;
  var beforeUrl = null;
  var afterUrl = null;
  var currentResultBlob = null;

  /* ---------- 工具函数 ---------- */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function getFormatLabel(mime) {
    return mime === 'image/webp' ? 'WebP' : mime === 'image/png' ? 'PNG' : 'JPEG';
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getSelectedFormat() {
    var checked = document.querySelector('input[name="format"]:checked');
    return checked ? checked.value : 'image/jpeg';
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

  /* ---------- UI 交互 ---------- */
  function setBusy(busy, text) {
    convertBtn.disabled = busy || !currentFile;
    if (busy) {
      statusText.textContent = text || '正在转换…';
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
      alert('请选择图片文件（JPG / PNG / WebP 等）');
      return;
    }
    resetResult();
    currentFile = file;
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = formatBytes(file.size) + ' · ' + (file.type || '未知格式');
    fileInfo.classList.add('show');
    convertBtn.disabled = false;
    dropzone.classList.remove('drag');
  }

  function clearFile() {
    currentFile = null;
    if (currentSource) { currentSource.close(); currentSource = null; }
    fileInfo.classList.remove('show');
    resetResult();
    currentResultBlob = null;
    mobileHint.classList.add('hidden');
    convertBtn.disabled = true;
    fileInput.value = '';
  }

  function updateFormatUI() {
    var mime = getSelectedFormat();
    var isPng = mime === 'image/png';
    qualityWrap.classList.toggle('hidden', isPng);
    formatNote.textContent = isPng
      ? 'PNG 为无损格式，不压缩画质，体积通常较大。'
      : mime === 'image/webp'
        ? 'WebP 通常比 JPEG 更小，支持透明，但部分旧软件可能不支持。'
        : 'JPEG 为有损格式，适合照片，不支持透明背景。';
  }

  /* ---------- 转换主流程 ---------- */
  convertBtn.addEventListener('click', async function () {
    if (!currentFile) return;
    setBusy(true, '正在转换…');
    resetResult();

    try {
      var mime = getSelectedFormat();
      var q = parseInt(qualityInput.value, 10) / 100;
      currentSource = await loadSource(currentFile);

      var blob = await currentSource.render(currentSource.width, currentSource.height, mime, q);
      currentResultBlob = blob;
      var beforeBytes = currentFile.size;
      var afterBytes = blob.size;
      var diffPercent = Math.round(((afterBytes - beforeBytes) / beforeBytes) * 100);

      beforeUrl = URL.createObjectURL(currentFile);
      afterUrl = URL.createObjectURL(blob);

      beforeImg.src = beforeUrl;
      afterImg.src = await blobToDataURL(blob);
      beforeSize.textContent = formatBytes(beforeBytes);
      afterSize.textContent = formatBytes(afterBytes);
      beforeDim.textContent = currentSource.width + ' × ' + currentSource.height;
      afterDim.textContent = currentSource.width + ' × ' + currentSource.height;
      statSaved.textContent = (diffPercent >= 0 ? '+' : '') + diffPercent + '%';
      statSaved.classList.toggle('good', diffPercent <= 0);
      statSaved.classList.toggle('teal', diffPercent > 0);
      statDim.textContent = currentSource.width + ' × ' + currentSource.height;
      statFormat.textContent = getFormatLabel(mime);

      var base = currentFile.name.replace(/\.[^.]+$/, '');
      downloadBtn.href = afterUrl;
      downloadBtn.download = base + '.' + (mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg');

      resultEl.classList.add('show');
      if (isMobile) mobileHint.classList.remove('hidden');
    } catch (err) {
      alert(err && err.message ? err.message : '转换失败，请重试');
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

  downloadBtn.addEventListener('click', function (e) {
    if (!isMobile || !currentResultBlob) return;
    e.preventDefault();
    var file = new File([currentResultBlob], downloadBtn.download, { type: getSelectedFormat() });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '转换图片', text: '转换后的图片' }).catch(function () {});
    }
  });

  qualityInput.addEventListener('input', function () {
    qualityValue.textContent = qualityInput.value + '%';
  });
  document.querySelectorAll('input[name="format"]').forEach(function (r) {
    r.addEventListener('change', updateFormatUI);
  });

  updateFormatUI();
})();

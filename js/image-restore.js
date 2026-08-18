/* 旧图片修复 */
(function () {
  'use strict';

  var MODEL_URL = '../js/lib/realesr-general-x4v3.onnx';
  var WASM_PATH = new URL('../js/lib/onnx/', location.href).href;

  var originalImg = null;
  var originalData = null;
  var currentData = null;
  var params = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0 };
  var previewTimer = null;
  var ortSession = null;
  var aiRunning = false;

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var fileInfo = document.getElementById('fileInfo');
  var fileName = document.getElementById('fileName');
  var fileMeta = document.getElementById('fileMeta');
  var removeFile = document.getElementById('removeFile');
  var previewBox = document.getElementById('previewBox');
  var previewCanvas = document.getElementById('previewCanvas');
  var compareSlider = document.getElementById('compareSlider');
  var adjustPanel = document.getElementById('adjustPanel');
  var aiPanel = document.getElementById('aiPanel');
  var autoBtn = document.getElementById('autoBtn');
  var resetBtn = document.getElementById('resetBtn');
  var aiBtn = document.getElementById('aiBtn');
  var aiStatus = document.getElementById('aiStatus');
  var aiStatusText = document.getElementById('aiStatusText');
  var aiProgress = document.getElementById('aiProgress');
  var aiProgressBar = document.getElementById('aiProgressBar');
  var downloadRow = document.getElementById('downloadRow');
  var downloadBtn = document.getElementById('downloadBtn');
  var downloadSize = document.getElementById('downloadSize');

  var RANGES = [
    { id: 'brightness', key: 'brightness', val: 'valBrightness' },
    { id: 'contrast', key: 'contrast', val: 'valContrast' },
    { id: 'saturation', key: 'saturation', val: 'valSaturation' },
    { id: 'warmth', key: 'warmth', val: 'valWarmth' },
    { id: 'sharpen', key: 'sharpen', val: 'valSharpen' }
  ];

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  /* ---------- 图片加载 ---------- */
  function loadFile(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () { onImageLoaded(img, file); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function onImageLoaded(img, file) {
    originalImg = img;
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    fileName.textContent = file ? file.name : '图片';
    fileMeta.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    fileInfo.style.display = 'flex';
    dropzone.style.display = 'none';
    previewBox.classList.remove('hidden');
    adjustPanel.classList.remove('hidden');
    aiPanel.classList.remove('hidden');
    downloadRow.classList.add('hidden');

    resetParams();
    schedulePreview();
  }

  /* ---------- 像素调节 ---------- */
  function adjustImageData(src, p) {
    var w = src.width, h = src.height;
    var out = new ImageData(w, h);
    var d = src.data, o = out.data;
    var n = w * h;

    var bright = p.brightness * 1.28;
    var contrast = 1 + p.contrast / 100;
    var sat = 1 + p.saturation / 100;
    var warm = p.warmth * 0.4;
    var sharpen = p.sharpen / 100;

    var blur = null;
    if (sharpen > 0) blur = boxBlur(d, w, h);

    for (var i = 0; i < n; i++) {
      var j = i * 4;
      var r = d[j], g = d[j + 1], b = d[j + 2];

      // 亮度 + 对比度
      r = (r - 128) * contrast + 128 + bright;
      g = (g - 128) * contrast + 128 + bright;
      b = (b - 128) * contrast + 128 + bright;

      // 色温
      r += warm;
      b -= warm;

      // 饱和度
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;

      // 锐化（非锐化掩模）
      if (sharpen > 0) {
        var br = blur[j], bg = blur[j + 1], bb = blur[j + 2];
        r = r + (r - br) * sharpen;
        g = g + (g - bg) * sharpen;
        b = b + (b - bb) * sharpen;
      }

      o[j] = clamp(r);
      o[j + 1] = clamp(g);
      o[j + 2] = clamp(b);
      o[j + 3] = d[j + 3];
    }
    return out;
  }

  function boxBlur(d, w, h) {
    var out = new Uint8ClampedArray(d.length);
    var r = 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sumR = 0, sumG = 0, sumB = 0, cnt = 0;
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            var yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
            var j = (yy * w + xx) * 4;
            sumR += d[j]; sumG += d[j + 1]; sumB += d[j + 2];
            cnt++;
          }
        }
        var k = (y * w + x) * 4;
        out[k] = sumR / cnt;
        out[k + 1] = sumG / cnt;
        out[k + 2] = sumB / cnt;
        out[k + 3] = d[k + 3];
      }
    }
    return out;
  }

  function clamp(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  /* ---------- 预览 ---------- */
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function renderPreview() {
    if (!originalData) return;
    currentData = adjustImageData(originalData, params);
    drawPreview();
  }

  function drawPreview() {
    var canvas = previewCanvas;
    var box = previewBox;
    var maxW = box.clientWidth - 2;
    var maxH = 420;
    var scale = Math.min(maxW / currentData.width, maxH / currentData.height, 1);
    canvas.width = Math.max(1, Math.round(currentData.width * scale));
    canvas.height = Math.max(1, Math.round(currentData.height * scale));
    var ctx = canvas.getContext('2d');

    // 画调整后的图
    var tmp = document.createElement('canvas');
    tmp.width = currentData.width;
    tmp.height = currentData.height;
    tmp.getContext('2d').putImageData(currentData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);

    // 对比原图：左侧显示原图
    var pos = compareSlider.value / 100;
    if (pos > 0) {
      var orig = document.createElement('canvas');
      orig.width = originalData.width;
      orig.height = originalData.height;
      orig.getContext('2d').putImageData(originalData, 0, 0);
      var cw = canvas.width * pos;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cw, canvas.height);
      ctx.clip();
      ctx.drawImage(orig, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      // 分割线
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(cw - 1, 0, 2, canvas.height);
    }
  }

  /* ---------- 自动修复 ---------- */
  function autoRepair() {
    if (!originalData) return;
    var d = originalData.data;
    var n = originalData.width * originalData.height;
    var sum = 0, sumSat = 0;
    var hist = new Array(256).fill(0);
    for (var i = 0; i < n; i++) {
      var j = i * 4;
      var r = d[j], g = d[j + 1], b = d[j + 2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += lum;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumSat += mx === 0 ? 0 : (mx - mn) / mx;
      hist[Math.round(lum)]++;
    }
    var avg = sum / n;
    var avgSat = sumSat / n;

    // 亮度：目标平均亮度约 145
    var brightness = Math.round((145 - avg) * 0.55);
    brightness = Math.max(-80, Math.min(80, brightness));

    // 对比度：基于 5%/95% 分位
    var cum = 0, p5 = 0, p95 = 0;
    for (var k = 0; k < 256; k++) {
      cum += hist[k];
      if (p5 === 0 && cum >= n * 0.05) p5 = k;
      if (cum >= n * 0.95) { p95 = k; break; }
    }
    var spread = p95 - p5;
    var contrast = Math.round((160 - spread) * 0.35);
    contrast = Math.max(-40, Math.min(60, contrast));

    // 饱和度：褪色则增强
    var saturation = avgSat < 0.35 ? Math.round((0.35 - avgSat) * 120) : 0;
    saturation = Math.max(0, Math.min(60, saturation));

    params.brightness = brightness;
    params.contrast = contrast;
    params.saturation = saturation;
    params.warmth = 0;
    params.sharpen = 0;
    syncSliders();
    schedulePreview();
  }

  function resetParams() {
    params.brightness = 0;
    params.contrast = 0;
    params.saturation = 0;
    params.warmth = 0;
    params.sharpen = 0;
    syncSliders();
  }

  function syncSliders() {
    RANGES.forEach(function (r) {
      var el = document.getElementById(r.id);
      el.value = params[r.key];
      document.getElementById(r.val).textContent = params[r.key];
    });
  }

  /* ---------- AI 增强 ---------- */
  function setAIStatus(show, text) {
    aiStatus.classList.toggle('hidden', !show);
    if (text) aiStatusText.textContent = text;
  }
  function setAIProgress(show, pct) {
    aiProgress.classList.toggle('hidden', !show);
    if (pct !== undefined) aiProgressBar.style.width = Math.round(pct * 100) + '%';
  }

  async function ensureSession() {
    if (ortSession) return ortSession;
    setAIStatus(true, '正在加载 AI 模型…');
    ort.env.wasm.wasmPaths = WASM_PATH;
    ortSession = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm']
    });
    return ortSession;
  }

  function extractTile(src, tx, ty, tw, th) {
    var tile = new ImageData(tw, th);
    var s = src.data, t = tile.data;
    for (var y = 0; y < th; y++) {
      for (var x = 0; x < tw; x++) {
        var si = ((ty + y) * src.width + (tx + x)) * 4;
        var ti = (y * tw + x) * 4;
        t[ti] = s[si];
        t[ti + 1] = s[si + 1];
        t[ti + 2] = s[si + 2];
        t[ti + 3] = 255;
      }
    }
    return tile;
  }

  async function runModelOnTile(session, tile) {
    var w = tile.width, h = tile.height;
    // Real-ESRGAN 要求输入宽高为 4 的倍数，边缘瓦片需填充
    var pw = Math.ceil(w / 4) * 4;
    var ph = Math.ceil(h / 4) * 4;
    var input = new Float32Array(1 * 3 * ph * pw);
    var d = tile.data;
    for (var y = 0; y < ph; y++) {
      var sy = y < h ? y : h - 1;
      for (var x = 0; x < pw; x++) {
        var sx = x < w ? x : w - 1;
        var j = (sy * w + sx) * 4;
        var i = y * pw + x;
        input[i] = (d[j] / 255 - 0.5) / 0.5;
        input[ph * pw + i] = (d[j + 1] / 255 - 0.5) / 0.5;
        input[2 * ph * pw + i] = (d[j + 2] / 255 - 0.5) / 0.5;
      }
    }
    var tensor = new ort.Tensor('float32', input, [1, 3, ph, pw]);
    var results = await session.run({ input: tensor });
    var od = results.output.data;
    // 裁剪回原尺寸（输出为 4 倍）。
    // 模型输出为 NCHW 布局：R、G、B 三个通道各自连续存放，
    // 每个通道的大小 = (ph*4) * (pw*4)。
    var outW = w * 4, outH = h * 4;
    var out = new Float32Array(3 * outH * outW);
    var srcRow = pw * 4;
    var srcChan = srcRow * (ph * 4);
    for (var yy = 0; yy < outH; yy++) {
      for (var xx = 0; xx < outW; xx++) {
        var s = yy * srcRow + xx;
        var t = yy * outW + xx;
        out[t] = od[s];
        out[outH * outW + t] = od[srcChan + s];
        out[2 * outH * outW + t] = od[2 * srcChan + s];
      }
    }
    return { data: out, width: outW, height: outH };
  }

  async function aiEnhance() {
    if (!originalData || aiRunning) return;
    aiRunning = true;
    aiBtn.disabled = true;
    setAIStatus(true, '正在加载 AI 模型…');
    setAIProgress(true, 0);

    try {
      var session = await ensureSession();

      // 先应用基础调节
      var base = adjustImageData(originalData, params);

      // 过大图片先缩小到长边 1024
      var maxSide = 1024;
      var scaleDown = Math.min(1, maxSide / Math.max(base.width, base.height));
      var srcW = Math.round(base.width * scaleDown);
      var srcH = Math.round(base.height * scaleDown);
      var srcCanvas = document.createElement('canvas');
      srcCanvas.width = srcW;
      srcCanvas.height = srcH;
      var srcCtx = srcCanvas.getContext('2d');
      var full = document.createElement('canvas');
      full.width = base.width;
      full.height = base.height;
      full.getContext('2d').putImageData(base, 0, 0);
      srcCtx.drawImage(full, 0, 0, srcW, srcH);
      var srcData = srcCtx.getImageData(0, 0, srcW, srcH);

      var scaleMode = document.querySelector('input[name="scale"]:checked').value;
      var keepSize = document.querySelector('input[name="aiMode"]:checked').value === 'keep';
      var targetScale = keepSize ? 1 : parseInt(scaleMode, 10);
      var outW = Math.round(srcW * targetScale);
      var outH = Math.round(srcH * targetScale);

      // 4x 拼接画布
      var bigCanvas = document.createElement('canvas');
      bigCanvas.width = srcW * 4;
      bigCanvas.height = srcH * 4;
      var bigCtx = bigCanvas.getContext('2d');

      var TILE = 128, OVERLAP = 16, HALF = OVERLAP / 2;
      var step = TILE - OVERLAP;
      var tilesX = Math.ceil(srcW / step);
      var tilesY = Math.ceil(srcH / step);
      var total = tilesX * tilesY;
      var done = 0;

      for (var ty = 0; ty < srcH; ty += step) {
        for (var tx = 0; tx < srcW; tx += step) {
          var tw = Math.min(TILE, srcW - tx);
          var th = Math.min(TILE, srcH - ty);
          var tile = extractTile(srcData, tx, ty, tw, th);
          var out = await runModelOnTile(session, tile);
          var od = out.data;
          var ow = out.width, oh = out.height;

          // 安全区域（避开重叠）
          var sx = tx > 0 ? HALF : 0;
          var sy = ty > 0 ? HALF : 0;
          var sw = tw - (tx + tw < srcW ? HALF : 0) - sx;
          var sh = th - (ty + th < srcH ? HALF : 0) - sy;

          var tileCanvas = document.createElement('canvas');
          tileCanvas.width = ow;
          tileCanvas.height = oh;
          var tctx = tileCanvas.getContext('2d');
          var tImg = tctx.createImageData(ow, oh);
          var td = tImg.data;
          for (var p = 0; p < ow * oh; p++) {
            var q = p * 4;
            td[q] = Math.round(od[p] * 255);
            td[q + 1] = Math.round(od[ow * oh + p] * 255);
            td[q + 2] = Math.round(od[2 * ow * oh + p] * 255);
            td[q + 3] = 255;
          }
          tctx.putImageData(tImg, 0, 0);
          bigCtx.drawImage(tileCanvas,
            sx * 4, sy * 4, sw * 4, sh * 4,
            (tx + sx) * 4, (ty + sy) * 4, sw * 4, sh * 4);

          done++;
          setAIProgress(true, done / total);
          setAIStatus(true, 'AI 处理中 ' + done + ' / ' + total + '…');
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }

      // 输出到目标尺寸
      var outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      var octx = outCanvas.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(bigCanvas, 0, 0, outW, outH);

      // 显示结果
      currentData = octx.getImageData(0, 0, outW, outH);
      originalData = currentData;
      originalImg = null;
      drawPreview();
      prepareDownload(outCanvas);
      setAIProgress(false);
      setAIStatus(false);
    } catch (e) {
      console.error(e);
      setAIStatus(true, 'AI 处理失败：' + (e && e.message ? e.message : '未知错误'));
      setAIProgress(false);
    } finally {
      aiRunning = false;
      aiBtn.disabled = false;
    }
  }

  /* ---------- 下载 ---------- */
  function prepareDownload(canvas) {
    canvas.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      downloadBtn.href = url;
      downloadBtn.download = 'restored-' + Date.now() + '.png';
      downloadSize.textContent = formatBytes(blob.size);
      downloadRow.classList.remove('hidden');
    }, 'image/png');
  }

  /* ---------- 事件绑定 ---------- */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  removeFile.addEventListener('click', function () {
    originalImg = null;
    originalData = null;
    currentData = null;
    fileInfo.style.display = 'none';
    dropzone.style.display = '';
    previewBox.classList.add('hidden');
    adjustPanel.classList.add('hidden');
    aiPanel.classList.add('hidden');
    downloadRow.classList.add('hidden');
    fileInput.value = '';
  });

  RANGES.forEach(function (r) {
    var el = document.getElementById(r.id);
    el.addEventListener('input', function () {
      params[r.key] = parseInt(el.value, 10);
      document.getElementById(r.val).textContent = el.value;
      schedulePreview();
    });
  });

  compareSlider.addEventListener('input', function () {
    if (currentData) drawPreview();
  });

  autoBtn.addEventListener('click', autoRepair);
  resetBtn.addEventListener('click', function () {
    resetParams();
    schedulePreview();
  });
  aiBtn.addEventListener('click', aiEnhance);

  window.addEventListener('resize', function () {
    if (currentData) drawPreview();
  });
})();

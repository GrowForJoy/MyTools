/* 图片转 PDF 工具逻辑：使用 pdf-lib 在浏览器本地生成 PDF */
(function () {
  'use strict';

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var imgList = document.getElementById('imgList');
  var emptyHint = document.getElementById('emptyHint');
  var pageNote = document.getElementById('pageNote');
  var generateBtn = document.getElementById('generateBtn');
  var statusEl = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var resultEl = document.getElementById('result');
  var statPages = document.getElementById('statPages');
  var statSize = document.getElementById('statSize');
  var downloadBtn = document.getElementById('downloadBtn');
  var againBtn = document.getElementById('againBtn');
  var mobileHint = document.getElementById('mobileHint');
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

  var items = []; // { file, url }
  var dragIndex = -1;
  var currentBlob = null;

  /* ---------- 工具函数 ---------- */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function setBusy(busy, text) {
    generateBtn.disabled = busy || !items.length;
    if (busy) {
      statusText.textContent = text || '正在处理…';
      statusEl.classList.remove('hidden');
    } else {
      statusEl.classList.add('hidden');
    }
  }

  /* ---------- 文件列表 ---------- */
  function addFiles(files) {
    var added = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      items.push({ file: f, url: URL.createObjectURL(f) });
      added = true;
    }
    if (added) renderList();
  }

  function renderList() {
    imgList.innerHTML = '';
    if (!items.length) {
      emptyHint.textContent = '尚未添加图片';
      imgList.appendChild(emptyHint);
      generateBtn.disabled = true;
      return;
    }
    items.forEach(function (it, idx) {
      var el = document.createElement('div');
      el.className = 'file-item';
      el.draggable = true;
      el.dataset.index = idx;

      var drag = document.createElement('span');
      drag.className = 'fi-drag';
      drag.setAttribute('aria-hidden', 'true');
      drag.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

      var thumb = document.createElement('img');
      thumb.className = 'fi-thumb';
      thumb.src = it.url;
      thumb.alt = '';

      var info = document.createElement('div');
      info.className = 'fi-info';
      var name = document.createElement('div');
      name.className = 'fi-name';
      name.textContent = it.file.name;
      var meta = document.createElement('div');
      meta.className = 'fi-meta';
      meta.textContent = formatBytes(it.file.size);
      info.appendChild(name);
      info.appendChild(meta);

      var remove = document.createElement('button');
      remove.className = 'fi-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', '移除');
      remove.title = '移除';
      remove.textContent = '×';
      remove.addEventListener('click', function () {
        URL.revokeObjectURL(it.url);
        items.splice(idx, 1);
        renderList();
      });

      el.appendChild(drag);
      el.appendChild(thumb);
      el.appendChild(info);
      el.appendChild(remove);

      el.addEventListener('dragstart', function (e) {
        dragIndex = idx;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) {}
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        dragIndex = -1;
      });
      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (dragIndex >= 0 && dragIndex !== idx) el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', function () {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (dragIndex < 0 || dragIndex === idx) return;
        var moved = items.splice(dragIndex, 1)[0];
        items.splice(idx, 0, moved);
        renderList();
      });

      imgList.appendChild(el);
    });
    generateBtn.disabled = false;
  }

  /* ---------- PDF 生成 ---------- */
  function embedViaCanvas(pdfDoc, file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error('图片转换失败')); return; }
          blob.arrayBuffer().then(function (bytes) {
            resolve(pdfDoc.embedPng(bytes));
          }, reject);
        }, 'image/png');
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      img.src = url;
    });
  }

  function embedImage(pdfDoc, it) {
    if (it.file.type === 'image/jpeg') {
      return it.file.arrayBuffer().then(function (b) { return pdfDoc.embedJpg(b); });
    }
    if (it.file.type === 'image/png') {
      return it.file.arrayBuffer().then(function (b) { return pdfDoc.embedPng(b); });
    }
    return embedViaCanvas(pdfDoc, it.file);
  }

  generateBtn.addEventListener('click', async function () {
    if (!items.length) return;
    setBusy(true, '正在生成 PDF…');
    try {
      var pdfDoc = await PDFLib.PDFDocument.create();
      var pageSize = document.querySelector('input[name="pageSize"]:checked').value;

      for (var i = 0; i < items.length; i++) {
        var img = await embedImage(pdfDoc, items[i]);
        if (pageSize === 'a4') {
          var pw = 595.28, ph = 841.89;
          var scale = Math.min((pw - 40) / img.width, (ph - 40) / img.height);
          var w = img.width * scale, h = img.height * scale;
          var page = pdfDoc.addPage([pw, ph]);
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        } else {
          var pw2 = Math.round(img.width * 72 / 96 * 100) / 100;
          var ph2 = Math.round(img.height * 72 / 96 * 100) / 100;
          var page2 = pdfDoc.addPage([pw2, ph2]);
          page2.drawImage(img, { x: 0, y: 0, width: pw2, height: ph2 });
        }
      }

      var pdfBytes = await pdfDoc.save();
      currentBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(currentBlob);
      downloadBtn.href = url;
      downloadBtn.download = 'images.pdf';
      statPages.textContent = items.length + ' 页';
      statSize.textContent = formatBytes(currentBlob.size);
      resultEl.classList.add('show');
      if (isMobile) mobileHint.classList.remove('hidden');
    } catch (err) {
      alert(err && err.message ? err.message : '生成失败，请重试');
    } finally {
      setBusy(false);
    }
  });

  /* ---------- 事件绑定 ---------- */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

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
    addFiles(e.dataTransfer.files);
  });

  document.querySelectorAll('input[name="pageSize"]').forEach(function (r) {
    r.addEventListener('change', function () {
      pageNote.textContent = r.value === 'a4'
        ? '所有图片按 A4 纸张排版，图片自动居中并保持比例。'
        : '每张图片单独一页，页面大小与图片一致。';
    });
  });

  downloadBtn.addEventListener('click', function (e) {
    if (!isMobile || !currentBlob) return;
    e.preventDefault();
    var file = new File([currentBlob], 'images.pdf', { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '图片转 PDF', text: '生成的 PDF 文件' }).catch(function () {});
    }
  });

  againBtn.addEventListener('click', function () {
    items.forEach(function (it) { URL.revokeObjectURL(it.url); });
    items = [];
    currentBlob = null;
    resultEl.classList.remove('show');
    mobileHint.classList.add('hidden');
    renderList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  renderList();
})();

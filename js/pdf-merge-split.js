/* PDF 合并 / 拆分工具逻辑：使用 pdf-lib 在浏览器本地处理 */
(function () {
  'use strict';

  var tabMerge = document.getElementById('tabMerge');
  var tabSplit = document.getElementById('tabSplit');
  var mergePanel = document.getElementById('mergePanel');
  var splitPanel = document.getElementById('splitPanel');

  var mergeDropzone = document.getElementById('mergeDropzone');
  var mergeInput = document.getElementById('mergeInput');
  var mergeList = document.getElementById('mergeList');
  var mergeEmpty = document.getElementById('mergeEmpty');
  var mergeBtn = document.getElementById('mergeBtn');
  var mergeStatus = document.getElementById('mergeStatus');
  var mergeStatusText = document.getElementById('mergeStatusText');
  var mergeResult = document.getElementById('mergeResult');
  var mergePages = document.getElementById('mergePages');
  var mergeSize = document.getElementById('mergeSize');
  var mergeDownload = document.getElementById('mergeDownload');
  var mergeAgain = document.getElementById('mergeAgain');
  var mergeMobileHint = document.getElementById('mergeMobileHint');

  var splitDropzone = document.getElementById('splitDropzone');
  var splitInput = document.getElementById('splitInput');
  var splitFileInfo = document.getElementById('splitFileInfo');
  var splitFileName = document.getElementById('splitFileName');
  var splitFileMeta = document.getElementById('splitFileMeta');
  var splitRemove = document.getElementById('splitRemove');
  var splitOptions = document.getElementById('splitOptions');
  var rangeWrap = document.getElementById('rangeWrap');
  var eachWrap = document.getElementById('eachWrap');
  var rangeInput = document.getElementById('rangeInput');
  var splitBtn = document.getElementById('splitBtn');
  var splitStatus = document.getElementById('splitStatus');
  var splitStatusText = document.getElementById('splitStatusText');
  var splitResult = document.getElementById('splitResult');
  var splitCount = document.getElementById('splitCount');
  var splitSize = document.getElementById('splitSize');
  var splitDownload = document.getElementById('splitDownload');
  var splitAgain = document.getElementById('splitAgain');
  var splitMobileHint = document.getElementById('splitMobileHint');

  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 768);

  var mergeItems = []; // { file, url }
  var mergeDragIndex = -1;
  var splitFile = null;
  var splitDoc = null; // 已加载的 PDFDocument
  var currentMergeBlob = null;
  var currentSplitBlob = null;
  var currentSplitName = '';

  /* ---------- 工具函数 ---------- */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function setMergeBusy(busy, text) {
    mergeBtn.disabled = busy || !mergeItems.length;
    if (busy) {
      mergeStatusText.textContent = text || '正在合并…';
      mergeStatus.classList.remove('hidden');
    } else {
      mergeStatus.classList.add('hidden');
    }
  }

  function setSplitBusy(busy, text) {
    splitBtn.disabled = busy || !splitFile;
    if (busy) {
      splitStatusText.textContent = text || '正在拆分…';
      splitStatus.classList.remove('hidden');
    } else {
      splitStatus.classList.add('hidden');
    }
  }

  /* ---------- 模式切换 ---------- */
  function switchMode(mode) {
    var isMerge = mode === 'merge';
    tabMerge.classList.toggle('active', isMerge);
    tabSplit.classList.toggle('active', !isMerge);
    tabMerge.setAttribute('aria-selected', isMerge ? 'true' : 'false');
    tabSplit.setAttribute('aria-selected', isMerge ? 'false' : 'true');
    mergePanel.classList.toggle('hidden', !isMerge);
    splitPanel.classList.toggle('hidden', isMerge);
  }

  /* ---------- 合并：文件列表 ---------- */
  function addMergeFiles(files) {
    var added = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) continue;
      mergeItems.push({ file: f, url: URL.createObjectURL(f) });
      added = true;
    }
    if (added) renderMergeList();
  }

  function renderMergeList() {
    mergeList.innerHTML = '';
    if (!mergeItems.length) {
      mergeEmpty.textContent = '尚未添加 PDF 文件';
      mergeList.appendChild(mergeEmpty);
      mergeBtn.disabled = true;
      return;
    }
    mergeItems.forEach(function (it, idx) {
      var el = document.createElement('div');
      el.className = 'file-item';
      el.draggable = true;
      el.dataset.index = idx;

      var drag = document.createElement('span');
      drag.className = 'fi-drag';
      drag.setAttribute('aria-hidden', 'true');
      drag.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

      var thumb = document.createElement('div');
      thumb.className = 'fi-thumb';
      thumb.style.display = 'flex';
      thumb.style.alignItems = 'center';
      thumb.style.justifyContent = 'center';
      thumb.style.color = 'var(--accent)';
      thumb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/></svg>';

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
        mergeItems.splice(idx, 1);
        renderMergeList();
      });

      el.appendChild(drag);
      el.appendChild(thumb);
      el.appendChild(info);
      el.appendChild(remove);

      el.addEventListener('dragstart', function (e) {
        mergeDragIndex = idx;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) {}
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        mergeDragIndex = -1;
      });
      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (mergeDragIndex >= 0 && mergeDragIndex !== idx) el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', function () {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (mergeDragIndex < 0 || mergeDragIndex === idx) return;
        var moved = mergeItems.splice(mergeDragIndex, 1)[0];
        mergeItems.splice(idx, 0, moved);
        renderMergeList();
      });

      mergeList.appendChild(el);
    });
    mergeBtn.disabled = false;
  }

  /* ---------- 合并 ---------- */
  mergeBtn.addEventListener('click', async function () {
    if (!mergeItems.length) return;
    setMergeBusy(true, '正在合并…');
    try {
      var dest = await PDFLib.PDFDocument.create();
      var totalPages = 0;
      for (var i = 0; i < mergeItems.length; i++) {
        var bytes = await mergeItems[i].file.arrayBuffer();
        var src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        var pages = await dest.copyPages(src, src.getPageIndices());
        pages.forEach(function (p) { dest.addPage(p); });
        totalPages += pages.length;
      }
      var pdfBytes = await dest.save();
      currentMergeBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(currentMergeBlob);
      mergeDownload.href = url;
      mergeDownload.download = 'merged.pdf';
      mergePages.textContent = totalPages + ' 页';
      mergeSize.textContent = formatBytes(currentMergeBlob.size);
      mergeResult.classList.add('show');
      if (isMobile) mergeMobileHint.classList.remove('hidden');
    } catch (err) {
      alert('合并失败：' + (err && err.message ? err.message : '文件可能已加密或损坏'));
    } finally {
      setMergeBusy(false);
    }
  });

  /* ---------- 拆分：文件加载 ---------- */
  function handleSplitFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      alert('请选择 PDF 文件');
      return;
    }
    splitFile = file;
    splitFileName.textContent = file.name;
    splitFileMeta.textContent = formatBytes(file.size);
    splitFileInfo.classList.add('show');
    splitOptions.classList.remove('hidden');
    splitBtn.disabled = false;
    splitResult.classList.remove('show');
    splitDoc = null;
    currentSplitBlob = null;
    // 预加载以获取页数
    file.arrayBuffer().then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    }).then(function (doc) {
      splitDoc = doc;
      splitFileMeta.textContent = formatBytes(file.size) + ' · 共 ' + doc.getPageCount() + ' 页';
    }).catch(function () {
      splitDoc = null;
      splitFileMeta.textContent = formatBytes(file.size) + ' · 无法读取（可能已加密）';
    });
  }

  function clearSplitFile() {
    splitFile = null;
    splitDoc = null;
    currentSplitBlob = null;
    splitFileInfo.classList.remove('show');
    splitOptions.classList.add('hidden');
    splitResult.classList.remove('show');
    splitMobileHint.classList.add('hidden');
    splitBtn.disabled = true;
    splitInput.value = '';
  }

  /* ---------- 拆分 ---------- */
  function parseRanges(str, total) {
    var pages = [];
    var parts = String(str || '').split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      if (p.indexOf('-') > -1) {
        var m = p.split('-');
        var a = parseInt(m[0], 10), b = parseInt(m[1], 10);
        if (isNaN(a) || isNaN(b) || a < 1 || b < a) return null;
        for (var j = a; j <= b; j++) pages.push(j);
      } else {
        var n = parseInt(p, 10);
        if (isNaN(n) || n < 1) return null;
        pages.push(n);
      }
    }
    if (!pages.length) return null;
    for (var k = 0; k < pages.length; k++) {
      if (pages[k] > total) return null;
    }
    return pages;
  }

  splitBtn.addEventListener('click', async function () {
    if (!splitFile || !splitDoc) return;
    var mode = document.querySelector('input[name="splitMode"]:checked').value;
    setSplitBusy(true, '正在拆分…');
    try {
      var src = splitDoc;
      var total = src.getPageCount();
      var pdfBytes, blob, name;

      if (mode === 'range') {
        var pages = parseRanges(rangeInput.value, total);
        if (!pages) {
          alert('页码范围格式不正确，请检查（例如：1-3,5）');
          setSplitBusy(false);
          return;
        }
        var doc = await PDFLib.PDFDocument.create();
        var copied = await doc.copyPages(src, pages.map(function (p) { return p - 1; }));
        copied.forEach(function (p) { doc.addPage(p); });
        pdfBytes = await doc.save();
        blob = new Blob([pdfBytes], { type: 'application/pdf' });
        name = 'extracted.pdf';
        currentSplitName = name;
        currentSplitBlob = blob;
        splitCount.textContent = pages.length + ' 页';
      } else {
        var zip = new JSZip();
        for (var i = 0; i < total; i++) {
          var d = await PDFLib.PDFDocument.create();
          var one = await d.copyPages(src, [i]);
          d.addPage(one[0]);
          var b = await d.save();
          zip.file('page_' + (i + 1) + '.pdf', b);
        }
        blob = await zip.generateAsync({ type: 'blob' });
        name = 'split_pages.zip';
        currentSplitName = name;
        currentSplitBlob = blob;
        splitCount.textContent = total + ' 个文件';
      }

      var url = URL.createObjectURL(blob);
      splitDownload.href = url;
      splitDownload.download = name;
      splitSize.textContent = formatBytes(blob.size);
      splitResult.classList.add('show');
      if (isMobile) splitMobileHint.classList.remove('hidden');
    } catch (err) {
      alert('拆分失败：' + (err && err.message ? err.message : '文件可能已加密或损坏'));
    } finally {
      setSplitBusy(false);
    }
  });

  /* ---------- 事件绑定 ---------- */
  tabMerge.addEventListener('click', function () { switchMode('merge'); });
  tabSplit.addEventListener('click', function () { switchMode('split'); });

  mergeDropzone.addEventListener('click', function () { mergeInput.click(); });
  mergeDropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mergeInput.click(); }
  });
  mergeInput.addEventListener('change', function () {
    addMergeFiles(mergeInput.files);
    mergeInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    mergeDropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      mergeDropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    mergeDropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      mergeDropzone.classList.remove('drag');
    });
  });
  mergeDropzone.addEventListener('drop', function (e) {
    addMergeFiles(e.dataTransfer.files);
  });

  splitDropzone.addEventListener('click', function () { splitInput.click(); });
  splitDropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); splitInput.click(); }
  });
  splitInput.addEventListener('change', function () { handleSplitFile(splitInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (evt) {
    splitDropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      splitDropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    splitDropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      splitDropzone.classList.remove('drag');
    });
  });
  splitDropzone.addEventListener('drop', function (e) {
    handleSplitFile(e.dataTransfer.files[0]);
  });

  splitRemove.addEventListener('click', clearSplitFile);

  document.querySelectorAll('input[name="splitMode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var isRange = r.value === 'range';
      rangeWrap.classList.toggle('hidden', !isRange);
      eachWrap.classList.toggle('hidden', isRange);
    });
  });

  mergeDownload.addEventListener('click', function (e) {
    if (!isMobile || !currentMergeBlob) return;
    e.preventDefault();
    var file = new File([currentMergeBlob], 'merged.pdf', { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '合并 PDF', text: '合并后的 PDF 文件' }).catch(function () {});
    }
  });

  splitDownload.addEventListener('click', function (e) {
    if (!isMobile || !currentSplitBlob) return;
    e.preventDefault();
    var file = new File([currentSplitBlob], currentSplitName, { type: currentSplitBlob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '拆分结果', text: '拆分后的文件' }).catch(function () {});
    }
  });

  mergeAgain.addEventListener('click', function () {
    mergeItems.forEach(function (it) { URL.revokeObjectURL(it.url); });
    mergeItems = [];
    currentMergeBlob = null;
    mergeResult.classList.remove('show');
    mergeMobileHint.classList.add('hidden');
    renderMergeList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  splitAgain.addEventListener('click', function () {
    clearSplitFile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  renderMergeList();
})();

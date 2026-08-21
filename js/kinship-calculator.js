/* 亲戚称呼计算器 —— 计算器风格，同时显示两个方向 */
(function () {
  'use strict';

  /* 主网格（计算器布局，含功能键） */
  var GRID = [
    ['爸爸', '妈妈', '爷爷', '奶奶'],
    ['哥哥', '姐姐', '外公', '外婆'],
    ['弟弟', '妹妹', '叔叔', '姑姑'],
    ['舅舅', '阿姨', '↺', 'AC']
  ];

  /* 更多称呼（折叠区） */
  var MORE = [
    ['配偶', ['丈夫', '妻子']],
    ['子女', ['儿子', '女儿']],
    ['父系长辈', ['伯父', '伯母', '婶婶', '姑父']],
    ['母系长辈', ['舅妈', '姨父']],
    ['平辈亲戚', ['堂哥', '堂弟', '堂姐', '堂妹', '表哥', '表弟', '表姐', '表妹']],
    ['晚辈', ['侄子', '侄女', '外甥', '外甥女', '孙子', '孙女', '外孙', '外孙女']],
    ['姻亲', ['公公', '婆婆', '岳父', '岳母', '女婿', '儿媳', '嫂子', '弟媳', '姐夫', '妹夫']]
  ];

  var chain = [];

  /* 普通话称呼 → 广东话（粤语）叫法。未收录的罕见称谓（曾祖、玄孙等）保留普通话 */
  var YUE = {
    '自己': '自己',
    '爸爸': '老豆', '妈妈': '阿妈',
    '爷爷': '阿爷', '奶奶': '阿嫲',
    '外公': '阿公', '外婆': '阿婆',
    '哥哥': '阿哥', '姐姐': '家姐', '弟弟': '细佬', '妹妹': '细妹',
    '堂哥': '堂哥', '堂弟': '堂细佬', '堂姐': '堂姐', '堂妹': '堂细妹',
    '表哥': '表哥', '表弟': '表细佬', '表姐': '表姐', '表妹': '表细妹',
    '叔叔': '阿叔', '伯父': '阿伯', '伯母': '伯娘',
    '姑姑': '姑妈', '大姑': '姑妈', '小姑': '姑姐', '姑父': '姑丈',
    '舅舅': '舅父', '舅妈': '舅母',
    '姨妈': '姨妈', '大姨': '大姨', '小姨': '阿细姨', '阿姨': '阿姨',
    '丈夫': '老公', '老公': '老公', '妻子': '老婆', '老婆': '老婆',
    '儿子': '仔', '女儿': '女',
    '孙子': '孙', '孙女': '孙女', '外孙': '外孙', '外孙女': '外孙女',
    '侄子': '侄', '侄女': '侄女', '外甥': '外甥', '外甥女': '外甥女',
    '女婿': '女婿', '儿媳': '新抱',
    '公公': '老爷', '婆婆': '家婆', '岳父': '外父', '岳母': '外母',
    '嫂子': '阿嫂', '弟媳': '弟妇', '弟妹': '弟妇', '姐夫': '姐夫', '妹夫': '妹夫',
    '大伯子': '大伯', '大姑子': '姑家姐', '小叔子': '叔仔', '小姑子': '姑仔',
    '大舅子': '大舅', '小舅子': '舅仔', '大姨子': '姨姐', '小姨子': '姨妹',
    '曾祖父': '太公', '曾祖母': '太婆',
    '叔公': '叔公', '伯公': '伯公', '舅爷爷': '舅公', '姑奶奶': '姑婆'
  };

  function toYue(term) {
    return YUE[term] || term;
  }

  function currentDialect() {
    var el = document.querySelector('input[name="dialect"]:checked');
    return el ? el.value : 'mand';
  }

  var calcQuery = document.getElementById('calcQuery');
  var resI = document.getElementById('resI');
  var resTa = document.getElementById('resTa');
  var gridEl = document.getElementById('calcGrid');
  var moreTitle = document.getElementById('moreTitle');
  var moreBox = document.getElementById('moreBox');
  var directInput = document.getElementById('directInput');
  var directBtn = document.getElementById('directBtn');

  function currentSex() {
    var el = document.querySelector('input[name="sex"]:checked');
    return el ? el.value : '1';
  }

  function run(text, reverse) {
    if (!text) return null;
    var result;
    try {
      result = relationship({ text: text, sex: currentSex(), reverse: reverse });
    } catch (e) {
      result = null;
    }
    if (!result || !result.length) return null;
    if (currentDialect() === 'yue') result = result.map(toYue);
    return result.join(' / ');
  }

  function render() {
    if (chain.length) {
      calcQuery.textContent = chain.join('的');
      calcQuery.classList.remove('prompt');
    } else {
      calcQuery.textContent = '点击下方按键，组成关系链…';
      calcQuery.classList.add('prompt');
    }

    var text = chain.length ? chain.join('的') : '';

    var rI = run(text, false);
    var rTa = run(text, true);

    if (rI) {
      resI.textContent = rI;
      resI.classList.remove('empty');
    } else {
      resI.textContent = text ? '无法识别' : '—';
      resI.classList.add('empty');
    }
    if (rTa) {
      resTa.textContent = rTa;
      resTa.classList.remove('empty');
    } else {
      resTa.textContent = text ? '无法识别' : '—';
      resTa.classList.add('empty');
    }
  }

  function addStep(term) {
    chain.push(term);
    render();
  }
  function undo() {
    chain.pop();
    render();
  }
  function clearAll() {
    chain = [];
    render();
  }

  function buildGrid() {
    GRID.forEach(function (row) {
      row.forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calc-key';
        if (key === '↺' || key === 'AC') {
          btn.classList.add('fn', 'danger');
          btn.textContent = key;
          btn.addEventListener('click', key === '↺' ? undo : clearAll);
        } else {
          btn.textContent = key;
          btn.addEventListener('click', function () { addStep(key); });
        }
        gridEl.appendChild(btn);
      });
    });
  }

  function buildMore() {
    MORE.forEach(function (group) {
      var title = group[0];
      var items = group[1];
      {
        var name = document.createElement('div');
        name.className = 'rel-group-name';
        name.textContent = title;
        moreBox.appendChild(name);
      }
      var chips = document.createElement('div');
      chips.className = 'rel-chips';
      items.forEach(function (term) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'rel-chip';
        chip.textContent = term;
        chip.addEventListener('click', function () { addStep(term); });
        chips.appendChild(chip);
      });
      moreBox.appendChild(chips);
    });
  }

  function handleDirect() {
    var text = directInput.value.trim().replace(/\s+/g, '');
    if (!text) return;
    chain = text.split('的').filter(Boolean);
    directInput.value = '';
    render();
  }

  moreTitle.addEventListener('click', function () {
    document.getElementById('moreTitle').textContent = moreBox.classList.toggle('open')
      ? '－ 收起更多'
      : '＋ 更多称呼';
  });
  directBtn.addEventListener('click', handleDirect);
  directInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleDirect();
  });
  document.querySelectorAll('input[name="sex"], input[name="dialect"]').forEach(function (el) {
    el.addEventListener('change', render);
  });

  buildGrid();
  buildMore();
  render();
})();
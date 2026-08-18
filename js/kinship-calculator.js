/* 亲戚称呼计算器 */
(function () {
  'use strict';

  var GROUPS = [
    { name: '父母', items: ['爸爸', '妈妈'] },
    { name: '兄弟姐妹', items: ['哥哥', '弟弟', '姐姐', '妹妹'] },
    { name: '配偶', items: ['丈夫', '妻子'] },
    { name: '子女', items: ['儿子', '女儿'] },
    { name: '祖辈', items: ['爷爷', '奶奶', '外公', '外婆'] },
    { name: '父系长辈', items: ['伯父', '伯母', '叔叔', '婶婶', '姑姑', '姑父'] },
    { name: '母系长辈', items: ['舅舅', '舅妈', '姨妈', '姨父'] },
    { name: '平辈亲戚', items: ['堂哥', '堂弟', '堂姐', '堂妹', '表哥', '表弟', '表姐', '表妹'] },
    { name: '晚辈', items: ['侄子', '侄女', '外甥', '外甥女', '孙子', '孙女', '外孙', '外孙女'] },
    { name: '姻亲', items: ['公公', '婆婆', '岳父', '岳母', '女婿', '儿媳', '嫂子', '弟媳', '姐夫', '妹夫'] }
  ];

  var chain = [];

  var chainEl = document.getElementById('chain');
  var undoBtn = document.getElementById('undoBtn');
  var clearBtn = document.getElementById('clearBtn');
  var relResult = document.getElementById('relResult');
  var relQuestion = document.getElementById('relQuestion');
  var relAnswer = document.getElementById('relAnswer');
  var groupsEl = document.getElementById('relGroups');
  var directInput = document.getElementById('directInput');
  var directBtn = document.getElementById('directBtn');

  function currentMode() {
    var el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : 'fwd';
  }
  function currentSex() {
    var el = document.querySelector('input[name="sex"]:checked');
    return el ? el.value : '1';
  }

  function renderChain() {
    chainEl.innerHTML = '';
    var me = document.createElement('span');
    me.className = 'chain-chip chain-me';
    me.textContent = '我';
    chainEl.appendChild(me);
    for (var i = 0; i < chain.length; i++) {
      var arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.textContent = '→';
      chainEl.appendChild(arrow);
      var chip = document.createElement('span');
      chip.className = 'chain-chip';
      chip.textContent = chain[i];
      chainEl.appendChild(chip);
    }
    undoBtn.disabled = chain.length === 0;
    clearBtn.disabled = chain.length === 0;
  }

  function compute(text) {
    if (!text) return null;
    var opts = {
      text: text,
      sex: currentSex(),
      reverse: currentMode() === 'rev'
    };
    var result;
    try {
      result = relationship(opts);
    } catch (e) {
      return null;
    }
    if (!result || !result.length) return null;
    return result;
  }

  function showResult(text, result) {
    if (!result) {
      relResult.classList.add('hidden');
      return;
    }
    var mode = currentMode();
    var question = mode === 'rev'
      ? text + ' 应该叫我：'
      : text + ' 我应该叫：';
    relQuestion.textContent = question;
    relAnswer.textContent = result.join(' / ');
    relResult.classList.remove('hidden');
  }

  function update() {
    renderChain();
    var text = chain.join('的');
    var result = compute(text);
    showResult(text, result);
  }

  function addStep(term) {
    chain.push(term);
    update();
  }

  function undo() {
    chain.pop();
    update();
  }

  function clearAll() {
    chain = [];
    update();
  }

  function buildGroups() {
    GROUPS.forEach(function (group) {
      var box = document.createElement('div');
      box.className = 'rel-group';

      var name = document.createElement('div');
      name.className = 'rel-group-name';
      name.textContent = group.name;
      box.appendChild(name);

      var chips = document.createElement('div');
      chips.className = 'rel-chips';
      group.items.forEach(function (term) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rel-chip';
        btn.textContent = term;
        btn.addEventListener('click', function () { addStep(term); });
        chips.appendChild(btn);
      });
      box.appendChild(chips);
      groupsEl.appendChild(box);
    });
  }

  function handleDirect() {
    var text = directInput.value.trim().replace(/\s+/g, '');
    if (!text) {
      directInput.focus();
      return;
    }
    var result = compute(text);
    showResult(text, result);
    if (!result) {
      relQuestion.textContent = text + ' 无法识别，请检查输入。';
      relAnswer.textContent = '可尝试用「爸爸」「妈妈」「哥哥」等常见叫法，用「的」分隔。';
      relResult.classList.remove('hidden');
    }
  }

  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearAll);
  directBtn.addEventListener('click', handleDirect);
  directInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handleDirect();
  });
  document.querySelectorAll('input[name="mode"], input[name="sex"]').forEach(function (el) {
    el.addEventListener('change', update);
  });

  buildGroups();
  update();
})();

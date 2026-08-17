/* 全局脚本：主题切换 */
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('toolbox-theme'); } catch (e) {}

  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    root.setAttribute('data-theme', 'dark');
  }

  var btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var isDark = root.getAttribute('data-theme') === 'dark';
      root.setAttribute('data-theme', isDark ? 'light' : 'dark');
      try { localStorage.setItem('toolbox-theme', isDark ? 'light' : 'dark'); } catch (e) {}
    });
  }
})();

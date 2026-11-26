// Affiche les erreurs JavaScript inattendues en bas de l'écran (aide au diagnostic)
(function () {
  function show(msg) {
    var d = document.getElementById('jserr') || document.createElement('pre');
    d.id = 'jserr';
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;margin:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:#a52626;color:#fff;font:12px/1.4 Consolas,monospace;white-space:pre-wrap;max-height:40vh;overflow:auto';
    d.textContent = 'Erreur : ' + msg;
    d.onclick = function () { d.remove(); };
    (document.body || document.documentElement).appendChild(d);
  }
  window.addEventListener('error', function (e) { show(e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')'); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; if (r && /Failed to fetch|Load failed|NetworkError/.test(r.message || '')) return; show((r && r.stack) || r); });
})();

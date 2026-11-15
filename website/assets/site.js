/* ShareOS website: theme, navigation, live data (releases, discussions, apps) */
(function () {
  'use strict';
  var REPO = 'UniqueDroid/ShareOS';
  var API = 'https://api.github.com/repos/' + REPO;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- theme ---------- */
  function currentTheme() {
    var t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('sos-theme', t); } catch (e) { /* private mode */ }
    });
  });

  /* ---------- mobile nav ---------- */
  var navBtn = $('[data-nav-toggle]'), nav = $('[data-nav]');
  if (navBtn && nav) {
    navBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); navBtn.setAttribute('aria-expanded', 'false'); }); });
  }

  /* ---------- lightbox ---------- */
  var lb = $('[data-lightbox]');
  if (lb) {
    var lbImg = $('img', lb);
    $$('[data-shots] figure').forEach(function (f) {
      f.addEventListener('click', function () { lbImg.src = f.dataset.full; lbImg.alt = $('img', f).alt; lb.hidden = false; });
    });
    lb.addEventListener('click', function () { lb.hidden = true; lbImg.src = ''; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) { lb.hidden = true; lbImg.src = ''; } });
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function fmtSize(n) { if (!n) return ''; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function getJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false, t = setTimeout(function () { done = true; reject(new Error('timeout')); }, ms || 6000);
      fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { if (!done) { clearTimeout(t); resolve(j); } }, function (e) { if (!done) { clearTimeout(t); reject(e); } });
    });
  }
  var snapshot = getJSON('data.json', 8000).catch(function () { return {}; });

  var mdReady = null;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function markdown() {
    if (!mdReady) mdReady = Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js')
    ]);
    return mdReady.then(function () { return function (src) { return DOMPurify.sanitize(marked.parse(src || '')); }; });
  }
  window.ShareOSSite = { markdown: markdown, esc: esc, getJSON: getJSON, fmtDate: fmtDate };

  /* ---------- releases ---------- */
  function normRelease(r) {
    return {
      tag: r.tag_name || r.tag, name: r.name || r.tag_name || r.tag, date: r.published_at || r.date,
      url: r.html_url || r.url, body: r.body || '', prerelease: r.prerelease !== false,
      assets: (r.assets || []).map(function (a) { return { name: a.name, size: a.size, url: a.browser_download_url || a.url }; })
    };
  }
  function renderReleases(list) {
    if (!list || !list.length) return;
    var rel = list[0], ver = String(rel.tag).replace(/^v/, '');
    $$('[data-latest-tag]').forEach(function (e) { e.textContent = rel.tag; });
    var name = $('[data-rel-name]'); if (name) name.textContent = rel.name;
    var date = $('[data-rel-date]'); if (date) date.textContent = fmtDate(rel.date);
    var link = $('[data-rel-link]'); if (link) link.href = rel.url;
    var box = $('[data-rel-files]');
    if (box) {
      var models = {}, sums = {}, sigs = {}, prefix = 'ShareOS-' + ver + '-';
      rel.assets.forEach(function (a) {
        if (a.name.indexOf(prefix) !== 0) return;
        var m = a.name.slice(prefix.length).match(/^(.+?)\.(bin|sysupgrade\.tar)(\.sha256|\.sig)?$/);
        if (!m) return;
        if (m[3] === '.sha256') sums[a.name.slice(0, -7)] = a.url;
        else if (m[3] === '.sig') sigs[a.name.slice(0, -4)] = a.url;
        else (models[m[1]] = models[m[1]] || []).push(a);
      });
      var order = ['DNS-320L-rev-Ax', 'DNS-325-rev-Ax', 'DNS-320-rev-Bx', 'DNS-320-rev-Ax'];
      var keys = Object.keys(models).sort(function (a, b) { var i = order.indexOf(a), j = order.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b); });
      var label = { 'DNS-320L-rev-Ax': 'DNS-320L / DNS-320LW', 'DNS-325-rev-Ax': 'DNS-325 rev A', 'DNS-320-rev-Bx': 'DNS-320 rev B', 'DNS-320-rev-Ax': 'DNS-320 rev A' };
      var html = keys.map(function (k) {
        return '<div class="model"><h5>' + esc(label[k] || k) + '</h5>' + models[k].sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (a) {
          var bin = /\.bin$/.test(a.name);
          return '<a href="' + esc(a.url) + '" rel="noopener" title="' + esc(a.name) + '"><b>' + (bin ? 'Firmware (.bin)' : 'System (.sysupgrade.tar)') + '</b><span>' + fmtSize(a.size) + '</span></a>' +
            (sums[a.name] ? '<a class="sum" href="' + esc(sums[a.name]) + '" rel="noopener">SHA-256</a>' : '') +
            (sigs[a.name] ? '<a class="sum" href="' + esc(sigs[a.name]) + '" rel="noopener" title="Signature (ECDSA P-256) – checked by the box">Signature</a>' : '');
        }).join('') + '</div>';
      }).join('');
      box.innerHTML = html || '<p class="muted">The files of this release are still being built (about 45 minutes after publishing). <a href="' + esc(rel.url) + '" rel="noopener">Open the release on GitHub ↗</a></p>';
    }
    var notes = $('[data-rel-notes]');
    if (notes) markdown().then(function (md) { notes.innerHTML = md(rel.body); }).catch(function () { notes.textContent = rel.body; });
    var older = $('[data-rel-older]');
    if (older) older.innerHTML = list.slice(1, 7).map(function (r) { return '<a href="' + esc(r.url) + '" rel="noopener">' + esc(r.tag) + '</a>'; }).join('');
  }
  if ($('[data-release]')) getJSON(API + '/releases?per_page=8').then(function (l) { return l.map(normRelease); })
    .catch(function () { return snapshot.then(function (s) { return (s.releases || []).map(normRelease); }); })
    .then(renderReleases);

  /* ---------- stars ---------- */
  function stars(n) { if (typeof n === 'number') $$('[data-stars]').forEach(function (e) { e.textContent = '★ ' + n; }); }
  snapshot.then(function (s) { stars(s.repo && s.repo.stars); });

  /* ---------- discussions ---------- */
  function renderDiscussions(list) {
    var ul = $('[data-discussions]'); if (!ul) return;
    if (!list || !list.length) { ul.innerHTML = '<li class="muted">No discussions loaded – <a href="https://github.com/' + REPO + '/discussions" rel="noopener">open them on GitHub ↗</a></li>'; return; }
    ul.innerHTML = list.slice(0, 7).map(function (d) {
      return '<li><a href="' + esc(d.url) + '" rel="noopener">' + esc(d.title) + '</a><div class="meta"><span class="cat">' + esc(d.category) + '</span><span>' + esc(d.author) + '</span><span>' + d.comments + ' comments</span><span>updated ' + fmtDate(d.updated) + '</span></div></li>';
    }).join('');
  }
  if ($('[data-discussions]')) {
    getJSON(API + '/discussions?per_page=20').then(function (l) {
      return l.map(function (d) { return { title: d.title, url: d.html_url, category: d.category && d.category.name, author: d.user && d.user.login, comments: d.comments, updated: d.updated_at }; })
        .sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
    }).catch(function () { return snapshot.then(function (s) { return s.discussions || []; }); }).then(renderDiscussions);
  }

  /* ---------- apps ---------- */
  var appsBox = $('[data-apps]');
  if (appsBox) snapshot.then(function (s) {
    var apps = (s.apps || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    $$('[data-app-count]').forEach(function (e) { if (apps.length) e.textContent = apps.length; });
    if (!apps.length) { appsBox.innerHTML = '<p class="muted">The catalog could not be loaded – <a href="https://github.com/UniqueDroid/ShareOS-Apps" rel="noopener">browse the apps on GitHub ↗</a></p>'; return; }
    var cats = ['all'].concat(Array.from(new Set(apps.map(function (a) { return a.category || 'other'; }))).sort());
    var cat = 'all', q = '';
    var chips = $('[data-app-cats]');
    chips.innerHTML = cats.map(function (c) { return '<button type="button" data-cat="' + esc(c) + '" aria-pressed="' + (c === 'all') + '">' + esc(c) + '</button>'; }).join('');
    function draw() {
      var ql = q.toLowerCase();
      var shown = apps.filter(function (a) {
        return (cat === 'all' || (a.category || 'other') === cat) && (!ql || (a.name + ' ' + a.description + ' ' + a.id).toLowerCase().indexOf(ql) >= 0);
      });
      appsBox.innerHTML = shown.length ? shown.map(function (a) {
        return '<a class="app" href="' + esc(a.homepage) + '" rel="noopener"><img loading="lazy" src="' + esc(a.icon) + '" alt="" width="44" height="44" onerror="this.style.visibility=\'hidden\'"><div><h5>' + esc(a.name) + ' <small>' + esc(a.version) + '</small>' + (a.type === 'system' ? '<span class="sys">system app</span>' : '') + '</h5><p>' + esc(a.description) + '</p></div></a>';
      }).join('') : '<p class="muted">No app matches.</p>';
    }
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      cat = b.dataset.cat;
      $$('button', chips).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      draw();
    });
    $('[data-app-search]').addEventListener('input', function (e) { q = e.target.value.trim(); draw(); });
    draw();
  });
})();

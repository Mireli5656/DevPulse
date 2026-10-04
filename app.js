(() => {
  'use strict';

  /* ---------- Config ---------- */
  const TTL = 15 * 60 * 1000; // cache lifetime: 15 minutes
  const TIMEOUT = 12000;      // network timeout per request
  const KEYS = { bm: 'devpulse_bookmarks', prefs: 'devpulse_prefs', cache: 'devpulse_cache_' };
  const VIEWS = ['all', 'repos', 'articles', 'saved'];
  // [GitHub language qualifier, Dev.to tag]
  const LANGS = {
    JavaScript: ['javascript', 'javascript'], TypeScript: ['typescript', 'typescript'],
    Python: ['python', 'python'], Rust: ['rust', 'rust'], Go: ['go', 'go'],
    'C++': ['c++', 'cpp'], PHP: ['php', 'php'], Java: ['java', 'java'],
    Kotlin: ['kotlin', 'kotlin'],
  };
  const TF = { weekly: { days: 7, label: 'this week' }, monthly: { days: 30, label: 'this month' } };

  /* ---------- Helpers ---------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n || 0));
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : `${m} min ago`; };
  const isoDaysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  // Only http(s) links are ever placed in an href (bookmarks come from editable storage)
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };

  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  /* ---------- Cache (LocalStorage, 15 min TTL) ---------- */
  const cache = {
    key: (lang, tf) => `${KEYS.cache}${lang}_${tf}`,
    valid: (e) => !!e && Date.now() - e.ts < TTL && Array.isArray(e.data?.repos) && Array.isArray(e.data?.articles),
    read(lang, tf) {
      const e = store.get(this.key(lang, tf), null);
      if (this.valid(e)) return e;
      store.del(this.key(lang, tf));
      return null;
    },
    write(lang, tf, data) {
      const entry = { ts: Date.now(), data };
      if (!store.set(this.key(lang, tf), entry)) { this.prune(true); store.set(this.key(lang, tf), entry); }
      return entry.ts;
    },
    prune(all = false) {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(KEYS.cache)).forEach((k) => {
          if (all || !this.valid(store.get(k, null))) store.del(k);
        });
      } catch { /* storage unavailable */ }
    },
  };

  /* ---------- API layer ---------- */
  async function getJSON(url, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Request timed out. Try again.' : 'Network error. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
        throw new Error(mins ? `Rate limit reached. Resets in about ${mins} min.` : 'Rate limit reached. Try again in a few minutes.');
      }
      throw new Error(`Request failed (${res.status}).`);
    }
    try { return await res.json(); } catch { throw new Error('Unexpected response from the server.'); }
  }

  const fromRepo = (r) => ({
    id: `gh-${r.id}`, type: 'repo', title: r.full_name || r.name || 'Untitled', desc: r.description || 'No description provided.',
    url: r.html_url, clone: r.clone_url, avatar: r.owner?.avatar_url || '', author: r.owner?.login || '',
    stars: r.stargazers_count || 0, forks: r.forks_count || 0, lang: r.language || '',
  });
  const fromArticle = (a) => ({
    id: `dt-${a.id}`, type: 'article', title: a.title || 'Untitled', desc: a.description || '', url: a.url,
    avatar: a.user?.profile_image_90 || a.user?.profile_image || '', author: a.user?.name || 'Unknown author',
    reactions: a.public_reactions_count || 0, comments: a.comments_count || 0, read: a.reading_time_minutes || 1,
  });

  async function fetchRepos(lang, days) {
    const q = `language:${LANGS[lang][0]} created:>${isoDaysAgo(days)}`;
    const data = await getJSON(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`,
      { Accept: 'application/vnd.github+json' }
    );
    return (data.items || []).map(fromRepo);
  }
  async function fetchArticles(lang, days) {
    const data = await getJSON(`https://dev.to/api/articles?tag=${encodeURIComponent(LANGS[lang][1])}&top=${days}&per_page=30`);
    return Array.isArray(data) ? data.map(fromArticle) : [];
  }

  /* ---------- State ---------- */
  const readBookmarks = () => {
    const v = store.get(KEYS.bm, []);
    return Array.isArray(v) ? v.filter((b) => b && b.id && b.url && (b.type === 'repo' || b.type === 'article')) : [];
  };
  const state = {
    lang: 'JavaScript', tf: 'weekly', view: 'all', q: '',
    repos: [], articles: [], errors: [], loading: true, source: 'live', ts: Date.now(), req: 0,
    bookmarks: [],
  };

  async function load(force = false) {
    const id = ++state.req;
    const { lang, tf } = state;
    const hit = force ? null : cache.read(lang, tf);
    if (hit) {
      Object.assign(state, { repos: hit.data.repos, articles: hit.data.articles, errors: [], loading: false, source: 'cache', ts: hit.ts });
      return render();
    }
    state.loading = true;
    render();
    const days = TF[tf].days;
    const [r, a] = await Promise.allSettled([fetchRepos(lang, days), fetchArticles(lang, days)]);
    if (id !== state.req) return; // a newer request superseded this one
    state.repos = r.status === 'fulfilled' ? r.value : [];
    state.articles = a.status === 'fulfilled' ? a.value : [];
    state.errors = [];
    if (r.status === 'rejected') state.errors.push(`GitHub repositories: ${r.reason.message}`);
    if (a.status === 'rejected') state.errors.push(`Dev.to articles: ${a.reason.message}`);
    state.source = 'live';
    // Only fully successful responses are cached, so a transient error never sticks for 15 minutes
    state.ts = state.errors.length ? Date.now() : cache.write(lang, tf, { repos: state.repos, articles: state.articles });
    state.loading = false;
    render();
  }

  /* ---------- Selectors ---------- */
  const interleave = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]).flat().filter(Boolean);
  const isSaved = (id) => state.bookmarks.some((b) => b.id === id);
  const findItem = (id) => [...state.repos, ...state.articles, ...state.bookmarks].find((i) => i.id === id);

  function visible() {
    const pool = { saved: state.bookmarks, repos: state.repos, articles: state.articles }[state.view] ?? interleave(state.repos, state.articles);
    const q = state.q.trim().toLowerCase();
    return q ? pool.filter((i) => `${i.title} ${i.desc} ${i.author}`.toLowerCase().includes(q)) : pool;
  }

  /* ---------- Templates ---------- */
  const bmIcon = (on) => `fa-star ${on ? 'fa-solid' : 'fa-regular'}`;
  const stat = (icon, text, label) => `<span class="stat" title="${label}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${text}</span>`;

  function card(it) {
    const repo = it.type === 'repo';
    const on = isSaved(it.id);
    const slash = it.title.indexOf('/');
    const heading = repo && slash > 0
      ? `<span class="font-medium text-slate-400">${esc(it.title.slice(0, slash + 1))}</span>${esc(it.title.slice(slash + 1))}`
      : esc(it.title);
    const stats = repo
      ? [it.lang ? `<span class="pill">${esc(it.lang)}</span>` : '', stat('fa-fire', `${fmt(it.stars)} stars`, 'Stars'), stat('fa-code-fork', `${fmt(it.forks)} forks`, 'Forks')]
      : [stat('fa-heart', `${fmt(it.reactions)} reactions`, 'Reactions'), stat('fa-comment', fmt(it.comments), 'Comments'), stat('fa-clock', `${it.read} min read`, 'Reading time')];
    return `
<article class="card" data-type="${it.type}" data-id="${esc(it.id)}">
  <div class="flex items-start gap-3">
    ${it.avatar ? `<img class="avatar" src="${esc(it.avatar)}" alt="" width="40" height="40" loading="lazy">` : '<div class="avatar"></div>'}
    <div class="min-w-0 flex-1">
      <p class="flex items-center gap-1.5 truncate text-xs text-slate-400"><i class="fa-brands ${repo ? 'fa-github' : 'fa-dev'}" aria-hidden="true"></i>${esc(it.author)}</p>
      <h2 class="mt-0.5 break-words text-base font-bold leading-snug text-white ${repo ? '' : 'line-clamp-2'}">${heading}</h2>
    </div>
    <button type="button" class="bm ${on ? 'on' : ''}" data-act="save" aria-pressed="${on}" aria-label="${on ? 'Remove bookmark' : 'Save bookmark'}"><i class="${bmIcon(on)}"></i></button>
  </div>
  <p class="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-300">${esc(it.desc)}</p>
  <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">${stats.join('')}</div>
  <div class="mt-4 flex flex-wrap gap-2">
    ${repo && it.clone ? '<button type="button" class="btn" data-act="copy"><i class="fa-regular fa-copy"></i> Copy clone link</button>' : ''}
    <a class="btn btn-go" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${repo ? 'View on GitHub' : 'Read article'}</a>
  </div>
</article>`;
  }

  const SKELETON = `<div class="card" aria-hidden="true">
  <div class="flex gap-3"><div class="sk h-10 w-10 !rounded-full"></div><div class="flex-1 space-y-2 pt-1"><div class="sk h-3 w-1/3"></div><div class="sk h-4 w-3/4"></div></div></div>
  <div class="mt-5 space-y-2"><div class="sk h-3"></div><div class="sk h-3"></div><div class="sk h-3 w-2/3"></div></div>
  <div class="sk mt-5 h-3 w-1/2"></div><div class="sk mt-5 h-8 w-2/3"></div></div>`.repeat(6);

  function empty(icon, title, text, act = '', label = '') {
    return `<div class="empty col-span-full"><div class="ico"><i class="fa-solid ${icon}"></i></div>
<h2 class="mt-5 text-lg font-bold text-white">${title}</h2><p class="mt-1 max-w-sm text-sm text-slate-400">${text}</p>
${act ? `<button type="button" class="btn btn-go mt-5" data-act="${act}">${label}</button>` : ''}</div>`;
  }

  function emptyState() {
    const q = state.q.trim();
    if (q) return empty('fa-magnifying-glass', `No matches for "${esc(q)}"`, 'Try a different keyword or clear the filter.', 'clear', 'Clear filter');
    if (state.view === 'saved') return empty('fa-star', 'No saved items yet', 'Tap the star on any repository or article to keep it here.');
    if (state.errors.length) return empty('fa-triangle-exclamation', 'Could not load data', 'Check your connection, then try again.', 'retry', 'Try again');
    return empty('fa-satellite-dish', 'Nothing trending here yet', 'No results for this language and timeframe. Try monthly or another language.');
  }

  /* ---------- Render ---------- */
  function syncCounts() {
    const c = { all: state.repos.length + state.articles.length, repos: state.repos.length, articles: state.articles.length, saved: state.bookmarks.length };
    $$('[data-count]').forEach((el) => { el.textContent = c[el.dataset.count]; });
  }

  function render() {
    const { lang, tf, view, loading } = state;
    $('#lang').value = lang;
    $$('#tf button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tf === tf));
    $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
    $('#title').textContent = view === 'saved' ? 'Saved bookmarks' : `Trending ${TF[tf].label} in ${lang}`;
    $('#refresh i').classList.toggle('fa-spin', loading);
    $('#refresh').disabled = loading;
    const grid = $('#grid');
    grid.setAttribute('aria-busy', loading);
    syncCounts();
    if (loading) {
      $('#meta').textContent = 'Fetching the latest data';
      $('#notice').innerHTML = '';
      grid.innerHTML = SKELETON;
      return;
    }
    const items = visible();
    $('#meta').textContent = view === 'saved'
      ? `${items.length} saved`
      : `${items.length} shown, ${state.source === 'cache' ? `cached ${ago(state.ts)}` : 'fetched just now'}`;
    $('#notice').innerHTML = state.errors.map((e) => `<div class="banner" role="alert"><i class="fa-solid fa-triangle-exclamation mr-2"></i>${esc(e)}</div>`).join('');
    grid.innerHTML = items.length ? items.map(card).join('') : emptyState();
  }

  /* ---------- Actions ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignored */ }
      ta.remove();
      return ok;
    }
  }

  function toggleBookmark(id, btn) {
    const item = findItem(id);
    if (!item) return;
    const idx = state.bookmarks.findIndex((b) => b.id === id);
    const on = idx < 0;
    if (on) state.bookmarks.unshift(item); else state.bookmarks.splice(idx, 1);
    if (!store.set(KEYS.bm, state.bookmarks)) toast('Storage is full or blocked. Bookmark kept for this session only.');
    else toast(on ? 'Saved to bookmarks' : 'Bookmark removed');
    if (state.view === 'saved') return render();
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.setAttribute('aria-label', on ? 'Remove bookmark' : 'Save bookmark');
    btn.firstElementChild.className = bmIcon(on);
    syncCounts();
  }

  function setSearch(v) { state.q = v; render(); }
  const persistPrefs = () => store.set(KEYS.prefs, { lang: state.lang, tf: state.tf });

  /* ---------- Events ---------- */
  function bind() {
    const search = $('#search');
    const grid = $('#grid');

    $('#lang').addEventListener('change', (e) => { state.lang = e.target.value; persistPrefs(); load(); });
    $('#tf').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tf]');
      if (!b || b.dataset.tf === state.tf) return;
      state.tf = b.dataset.tf;
      persistPrefs();
      load();
    });
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) { state.view = b.dataset.view; render(); }
    });
    $('#tabs').addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      state.view = VIEWS[(VIEWS.indexOf(state.view) + step + VIEWS.length) % VIEWS.length];
      render();
      $(`#tabs [data-view="${state.view}"]`).focus();
    });
    $('#refresh').addEventListener('click', () => load(true));
    search.addEventListener('input', debounce(() => setSearch(search.value), 120));

    grid.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const id = el.closest('[data-id]')?.dataset.id;
      switch (el.dataset.act) {
        case 'save': toggleBookmark(id, el); break;
        case 'copy': {
          const it = findItem(id);
          const ok = !!it?.clone && (await copyText(it.clone));
          toast(ok ? 'Clone link copied' : 'Could not copy to the clipboard');
          break;
        }
        case 'clear': search.value = ''; setSearch(''); search.focus(); break;
        case 'retry': load(true); break;
      }
    });
    // Image errors do not bubble, so listen in the capture phase
    grid.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); search.focus(); }
      if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; setSearch(''); }
    });

    // Keep bookmarks in sync across browser tabs
    window.addEventListener('storage', (e) => {
      if (e.key !== KEYS.bm) return;
      state.bookmarks = readBookmarks();
      if (!state.loading) render();
    });
  }

  /* ---------- Init ---------- */
  function init() {
    const prefs = store.get(KEYS.prefs, {}) || {};
    if (LANGS[prefs.lang]) state.lang = prefs.lang;
    if (TF[prefs.tf]) state.tf = prefs.tf;
    state.bookmarks = readBookmarks();
    $('#lang').innerHTML = Object.keys(LANGS).map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    cache.prune();
    bind();
    load();
  }

  init();
})();

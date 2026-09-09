/* Invenio — Carpe Diem. Static gallery app. Vanilla JS, no build step. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  let DATA = { artists: [], works: [] };
  let byArtist = {};
  const state = { search: '', mediums: new Set(), styles: new Set(), confidence: new Set(), prices: new Set(), licOnly: false, sort: 'featured', view: 'works' };

  /* ---------- favorites ---------- */
  const LS = 'invenio_picks_v1';
  let picks = new Set();
  try { picks = new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch (e) {}
  const savePicks = () => { try { localStorage.setItem(LS, JSON.stringify([...picks])); } catch (e) {} updatePicksCount(); };
  const updatePicksCount = () => { const el = $('#picksCount'); if (el) el.textContent = picks.size; };
  const priceRank = p => (p ? (p.match(/\$/g) || []).length : 0);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const priceDisp = p => p ? esc(p.split(' - ')[0].trim()) : '—';
  const priceFull = p => p ? esc(p) : '—';

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1900); }

  /* ---------- crypto (password gate) ---------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decryptBlob(blob, pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(blob.salt), iterations: blob.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ---------- boot ---------- */
  async function boot() {
    let enc = null;
    try { const r = await fetch('data.enc', { cache: 'no-store' }); if (r.ok) enc = await r.json(); } catch (e) {}
    if (enc) return gate(enc);
    let data = null;
    for (const f of ['data.json', 'data.sample.json']) {
      try { const r = await fetch(f, { cache: 'no-store' }); if (r.ok) { data = await r.json(); break; } } catch (e) {}
    }
    init(data || DATA);
  }
  function gate(enc) {
    const saved = sessionStorage.getItem('invenio_pw');
    const tryPw = async (pw, onErr) => {
      try { const d = await decryptBlob(enc, pw); sessionStorage.setItem('invenio_pw', pw); document.body.classList.remove('locked'); $('#gate')?.remove(); init(d); }
      catch (e) { if (onErr) onErr(); }
    };
    if (saved) { tryPw(saved, () => sessionStorage.removeItem('invenio_pw')); }
    document.body.classList.add('locked');
    const g = document.createElement('div'); g.id = 'gate'; g.className = 'gate';
    g.innerHTML = `<div class="gate-card">
      <div class="brand" style="justify-content:center;margin-bottom:6px"><span class="brand-mark"></span> Invenio</div>
      <p class="gate-sub">Carpe Diem Gallery &amp; Consulting</p>
      <input id="gpw" type="password" placeholder="Gallery password" autofocus>
      <button id="gbtn" class="btn btn-dark" style="width:100%;justify-content:center">Enter</button>
      <p class="gate-err" id="gerr" hidden>Incorrect password — try again.</p>
    </div>`;
    document.body.appendChild(g);
    const submit = () => tryPw($('#gpw').value, () => { $('#gerr').hidden = false; $('#gpw').select(); });
    $('#gbtn').addEventListener('click', submit);
    $('#gpw').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function init(data) {
    DATA = data; byArtist = {}; DATA.artists.forEach(a => byArtist[a.id] = a);
    DATA.works.forEach(w => {
      const a = byArtist[w.artistId];
      if (a) {
        w.artistName = a.name; w.location = a.location;
        w.mediums = a.mediums || []; w.styles = a.styles || [];
        w.price = a.price; w.confidence = a.confidence; w.licensing = !!a.licensing;
      }
      w.priceRank = priceRank(w.price);
    });
    DATA.artists.forEach(a => { a.priceRank = priceRank(a.price); a.images = a.images || (a.workThumbs || []); });
    const st = $('#dataStamp'); if (st) st.textContent = DATA.generated ? ('Updated ' + new Date(DATA.generated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) : '';
    updatePicksCount();
    window.addEventListener('hashchange', route);
    route();
  }

  /* ---------- facets ---------- */
  function facets(list) {
    const multi = (key) => { const m = new Map(); list.forEach(x => (x[key] || []).forEach(v => m.set(v, (m.get(v) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const single = (key) => { const m = new Map(); list.forEach(x => { if (x[key]) m.set(x[key], (m.get(x[key]) || 0) + 1); }); return [...m.entries()]; };
    const prices = single('price').sort((a, b) => priceRank(a[0]) - priceRank(b[0]));
    const conf = single('confidence').sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a[0]] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b[0]] ?? 3));
    return { mediums: multi('mediums'), styles: multi('styles'), confidence: conf, prices };
  }

  const matchFacets = x =>
    (!state.mediums.size || (x.mediums || []).some(m => state.mediums.has(m))) &&
    (!state.styles.size || (x.styles || []).some(s => state.styles.has(s))) &&
    (!state.confidence.size || (x.confidence && state.confidence.has(x.confidence))) &&
    (!state.prices.size || state.prices.has(x.price)) &&
    (!state.licOnly || x.licensing);

  function filteredWorks() {
    const q = state.search.trim().toLowerCase();
    let list = DATA.works.filter(w => matchFacets(w) && (!q || (w.title + ' ' + w.artistName + ' ' + (w.mediums || []).join(' ') + ' ' + (w.styles || []).join(' ') + ' ' + (w.location || '')).toLowerCase().includes(q)));
    if (state.sort === 'price-asc') list.sort((a, b) => a.priceRank - b.priceRank);
    else if (state.sort === 'price-desc') list.sort((a, b) => b.priceRank - a.priceRank);
    else if (state.sort === 'artist') list.sort((a, b) => (a.artistName || '').localeCompare(b.artistName || ''));
    return list;
  }
  function filteredArtists() {
    const q = state.search.trim().toLowerCase();
    let list = DATA.artists.filter(a => matchFacets(a) && (!q || (a.name + ' ' + (a.location || '') + ' ' + (a.mediums || []).join(' ') + ' ' + (a.styles || []).join(' ')).toLowerCase().includes(q)));
    if (state.sort === 'artist') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'price-asc') list.sort((a, b) => a.priceRank - b.priceRank);
    else if (state.sort === 'price-desc') list.sort((a, b) => b.priceRank - a.priceRank);
    return list;
  }

  /* ---------- components ---------- */
  const confBadge = c => (c && c.toLowerCase() !== 'high') ? `<span class="conf conf-${esc(c.toLowerCase())}" title="Internal data-confidence">${esc(c)} confidence</span>` : '';

  function workCard(w) {
    const on = picks.has(w.id) ? 'on' : '';
    const img = (w.img && (w.img.thumb || w.img.full)) || '';
    return `<div class="work-card" data-work="${esc(w.id)}">
      <div class="work-imgwrap">
        ${w.licensing ? '<span class="avail-dot" title="Open for licensing"></span>' : ''}
        <button class="heart ${on}" data-heart="${esc(w.id)}" title="Save to my picks">♥</button>
        <img loading="lazy" src="${esc(img)}" alt="${esc(w.title)} — ${esc(w.artistName)}">
      </div>
      <p class="work-title">${esc(w.title || 'Untitled')}</p>
      <p class="work-artist">${esc(w.artistName)}</p>
      <div class="work-meta"><span>${(w.mediums || []).slice(0, 1).map(esc).join('')}</span><span class="priceind">${priceDisp(w.price)}</span></div>
    </div>`;
  }

  function carousel(images, id) {
    const imgs = (images || []).slice(0, 6);
    if (!imgs.length) return `<div class="carousel"><div class="carousel-track"><div class="cslide" style="background:var(--bg-soft)"></div></div></div>`;
    return `<div class="carousel" data-cid="${id}">
      <div class="carousel-track">${imgs.map(u => `<div class="cslide"><img loading="lazy" src="${esc(u)}" alt=""></div>`).join('')}</div>
      ${imgs.length > 1 ? `<button class="cbtn cprev" data-dir="-1" aria-label="Previous">‹</button><button class="cbtn cnext" data-dir="1" aria-label="Next">›</button>
      <div class="cdots">${imgs.map((_, i) => `<span class="cdot ${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : ''}
    </div>`;
  }

  function artistCard(a) {
    return `<div class="artist-card">
      ${carousel(a.images, 'a' + a.id)}
      <div data-artist="${esc(a.id)}" class="artist-card-body">
        <p class="a-name">${esc(a.name)}</p>
        <p class="a-loc">${esc(a.location || '')}</p>
        <div class="a-tags">${(a.mediums || []).slice(0, 1).map(s => `<span class="tag">${esc(s)}</span>`).join('')}${(a.styles || []).slice(0, 1).map(s => `<span class="tag">${esc(s)}</span>`).join('')}<span class="tag priceind">${priceDisp(a.price)}</span></div>
      </div>
    </div>`;
  }

  // full details block shared by work + artist detail
  function detailsBlock(a) {
    const row = (label, val) => val ? `<div class="drow"><span class="dlabel">${label}</span><span class="dval">${val}</span></div>` : '';
    const link = (label, href, text, mail) => href ? `<div class="drow"><span class="dlabel">${label}</span><span class="dval"><a href="${mail ? 'mailto:' : ''}${esc(href)}" ${mail ? '' : 'target="_blank" rel="noopener"'}>${esc(text || href)} ${mail ? '' : '↗'}</a></span></div>` : '';
    const ig = a.instagram ? (a.instagram.startsWith('http') ? a.instagram : 'https://instagram.com/' + a.instagram.replace('@', '')) : null;
    return `<div class="details">
      ${row('Country / State', esc(a.location))}
      ${row('Primary medium', (a.mediums || []).map(esc).join(', '))}
      ${row('Style', (a.styles || []).map(esc).join(', '))}
      ${row('Price range', priceFull(a.price))}
      ${row('Open for licensing', a.licensing ? 'Yes' : 'No')}
      ${link('Website', a.website, a.website && a.website.replace(/^https?:\/\/(www\.)?/, ''))}
      ${link('Email', a.email, a.email, true)}
      ${link('Instagram', ig, a.instagram)}
      ${link('Contact form', a.contactUrl, 'Open contact page')}
      ${a.notes ? `<div class="drow drow-col"><span class="dlabel">Notes</span><span class="dval note">${esc(a.notes)}</span></div>` : ''}
      ${a.sources ? `<div class="drow drow-col"><span class="dlabel">Sources</span><span class="dval note sources">${esc(a.sources)}</span></div>` : ''}
      ${(a.confidence && a.confidence.toLowerCase() !== 'high') ? `<div class="drow"><span class="dlabel">Confidence</span><span class="dval">${confBadge(a.confidence)}</span></div>` : ''}
    </div>`;
  }

  /* ---------- pages ---------- */
  function renderGallery(mode) {
    state.view = mode;
    const base = mode === 'works' ? DATA.works : DATA.artists;
    const fc = facets(base);
    const items = mode === 'works' ? filteredWorks() : filteredArtists();
    const grid = mode === 'works'
      ? `<div class="works-grid">${items.map(workCard).join('') || empty()}</div>`
      : `<div class="artists-grid">${items.map(artistCard).join('') || empty()}</div>`;
    app.innerHTML = `<div class="gallery-layout">
      ${filtersPanel(fc)}
      <section class="gallery-main">
        <div class="gallery-toolbar">
          <div><h1 class="gallery-h1">${mode === 'works' ? 'Works' : 'Artists'}</h1>
            <div class="gallery-meta">${items.length.toLocaleString()} ${mode === 'works' ? 'artworks' : 'artists'}${anyFilter() ? ' match your filters' : ' in the collection'}</div></div>
          <div class="toolbar-right">
            <div class="seg"><button class="${mode === 'works' ? 'active' : ''}" data-mode="works">Works</button><button class="${mode === 'artists' ? 'active' : ''}" data-mode="artists">Artists</button></div>
            ${sortDropdown()}
          </div>
        </div>
        ${activeChips()}
        ${grid}
      </section>
    </div>`;
    wireGallery(); setActiveNav(mode === 'works' ? 'gallery' : 'artists');
  }
  const empty = () => `<div class="empty" style="grid-column:1/-1"><h2>No matches</h2><p>Try clearing a filter or two.</p></div>`;
  const anyFilter = () => state.search || state.mediums.size || state.styles.size || state.confidence.size || state.prices.size || state.licOnly;

  function filtersPanel(fc) {
    const grp = (label, key, opts, sel, subtle) => `<div class="filter-group">
      <div class="filter-label">${label}${sel.size ? `<span class="clear" data-clear="${key}">clear</span>` : ''}</div>
      ${opts.map(([v, c]) => `<label class="checkbox-row ${sel.has(v) ? 'on' : ''} ${subtle ? 'subtle' : ''}" data-facet="${key}" data-val="${esc(v)}"><span class="cb"></span>${esc(v.split(' - ')[0])}<span class="count">${c}</span></label>`).join('')}
    </div>`;
    return `<aside class="filters" id="filters">
      <input class="filter-search" id="fsearch" placeholder="Search art, artist, city…" value="${esc(state.search)}">
      ${grp('Style', 'styles', fc.styles, state.styles)}
      ${grp('Primary medium', 'mediums', fc.mediums, state.mediums)}
      ${grp('Price range', 'prices', fc.prices, state.prices)}
      <div class="filter-group"><div class="toggle-row" id="licToggle"><span>Open for licensing</span><span class="toggle ${state.licOnly ? 'on' : ''}"></span></div></div>
      ${fc.confidence.length ? grp('Confidence', 'confidence', fc.confidence, state.confidence, true) : ''}
    </aside>`;
  }
  function activeChips() {
    const chips = []; const add = (k, v) => chips.push(`<span class="chip">${esc(v.split(' - ')[0])}<span class="x" data-facet="${k}" data-val="${esc(v)}">✕</span></span>`);
    state.styles.forEach(v => add('styles', v)); state.mediums.forEach(v => add('mediums', v)); state.prices.forEach(v => add('prices', v)); state.confidence.forEach(v => add('confidence', v));
    if (state.licOnly) chips.push(`<span class="chip">Licensing<span class="x" id="chipLic">✕</span></span>`);
    if (!chips.length) return '';
    return `<div class="active-filters">${chips.join('')}<span class="chip" style="cursor:pointer" id="clearAll">Clear all</span></div>`;
  }
  const sortDropdown = () => `<select class="dropdown" id="sortSel">
    <option value="featured"${state.sort === 'featured' ? ' selected' : ''}>Featured</option>
    <option value="artist"${state.sort === 'artist' ? ' selected' : ''}>Artist A–Z</option>
    <option value="price-asc"${state.sort === 'price-asc' ? ' selected' : ''}>Price: low→high</option>
    <option value="price-desc"${state.sort === 'price-desc' ? ' selected' : ''}>Price: high→low</option></select>`;

  function renderWork(id) {
    const w = DATA.works.find(x => x.id === id); if (!w) return notFound();
    const a = byArtist[w.artistId] || {};
    const more = DATA.works.filter(x => x.artistId === w.artistId && x.id !== id).slice(0, 8);
    app.innerHTML = `
      <div class="detail-back"><a href="#/gallery">← Works</a></div>
      <div class="work-detail">
        <div class="wd-img" id="wdImg"><img src="${esc((w.img && (w.img.full || w.img.thumb)) || '')}" alt="${esc(w.title)}"></div>
        <div class="wd-side">
          <h1 class="wd-title">${esc(w.title || 'Untitled')}</h1>
          <p class="wd-artist"><a href="#/artist/${esc(w.artistId)}">${esc(a.name || w.artistName)}</a></p>
          <div class="artist-actions" style="margin:14px 0 18px">
            <button class="btn btn-dark" data-heart="${esc(w.id)}">${picks.has(w.id) ? '♥ Saved' : '♥ Save to picks'}</button>
            <button class="btn btn-light" id="zoomBtn">Zoom ⤢</button>
          </div>
          ${detailsBlock(a)}
        </div>
      </div>
      ${more.length ? `<div class="section-wrap"><h2 class="section-h">More by ${esc(a.name || w.artistName)}</h2><div class="detail-works">${more.map(workCard).join('')}</div></div>` : ''}`;
    $('#zoomBtn')?.addEventListener('click', () => openLightbox(w));
    $('#wdImg')?.addEventListener('click', () => openLightbox(w));
    wireCards(app); wireHearts(app); setActiveNav('gallery'); window.scrollTo(0, 0);
  }

  function renderArtist(id) {
    const a = byArtist[id]; if (!a) return notFound();
    const works = DATA.works.filter(w => w.artistId === id);
    const similar = findSimilar(a).slice(0, 8);
    app.innerHTML = `
      <div class="detail-back"><a href="#/artists">← Artists</a></div>
      <div class="artist-hero">
        <div class="artist-hero-media">${carousel(a.images, 'hero' + a.id)}</div>
        <div>
          <h1 class="artist-name">${esc(a.name)}</h1>
          <div class="artist-location">${esc(a.location || '')}</div>
          <div class="artist-tags">${(a.mediums || []).concat(a.styles || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="artist-actions">
            <button class="btn btn-dark" id="saveAllBtn">♥ Save artist's works</button>
          </div>
          ${detailsBlock(a)}
        </div>
      </div>
      <div class="artist-stats">
        <div class="stat"><div class="stat-num">${works.length}</div><div class="stat-label">Works</div></div>
        <div class="stat"><div class="stat-num">${priceDisp(a.price)}</div><div class="stat-label">Price range</div></div>
        <div class="stat"><div class="stat-num">${(a.mediums || []).length}</div><div class="stat-label">Mediums</div></div>
        <div class="stat"><div class="stat-num">${a.licensing ? 'Yes' : '—'}</div><div class="stat-label">Licensing</div></div>
      </div>
      <div class="section-wrap"><h2 class="section-h">Works</h2><div class="section-sub">${works.length} available</div>
        <div class="detail-works">${works.map(workCard).join('')}</div></div>
      ${similar.length ? `<div class="section-wrap"><h2 class="section-h">Similar artists</h2><div class="section-sub">Sharing medium &amp; style with ${esc(a.name)}</div>
        <div class="artists-grid">${similar.map(artistCard).join('')}</div></div>` : ''}`;
    $('#saveAllBtn')?.addEventListener('click', () => { works.forEach(w => picks.add(w.id)); savePicks(); wireHearts(app); toast(`Added ${works.length} works to your picks`); });
    wireCards(app); wireHearts(app); wireCarousels(app); setActiveNav('artists'); window.scrollTo(0, 0);
  }
  const notFound = () => { app.innerHTML = `<div class="empty"><h2>Not found</h2><p><a href="#/gallery">Back to gallery</a></p></div>`; };

  function findSimilar(a) {
    const ms = new Set(a.mediums || []), ss = new Set(a.styles || []);
    return DATA.artists.filter(o => o.id !== a.id).map(o => {
      let s = 0; (o.mediums || []).forEach(m => ms.has(m) && (s += 1)); (o.styles || []).forEach(x => ss.has(x) && (s += 2)); if (o.price === a.price) s += 1;
      return { o, s };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s).map(x => x.o);
  }

  function renderPicks(sharedIds) {
    const ids = sharedIds || [...picks];
    const works = ids.map(id => DATA.works.find(w => w.id === id)).filter(Boolean);
    const isShared = !!sharedIds;
    if (!works.length) { app.innerHTML = `<div class="empty"><h2>${isShared ? 'This shared list is empty' : 'No picks yet'}</h2><p>${isShared ? '' : 'Tap the ♥ on any artwork to start a collection, then share it in one link.'}</p><p style="margin-top:18px"><a class="btn btn-dark" href="#/gallery" style="text-decoration:none">Browse works</a></p></div>`; setActiveNav('picks'); return; }
    const link = location.origin + location.pathname + '#/shared?ids=' + encodeURIComponent([...(sharedIds || picks)].join(','));
    app.innerHTML = `<div class="picks-hero"><h1 class="gallery-h1">${isShared ? 'Shared selection' : 'My picks'}</h1>
      <div class="gallery-meta">${works.length} artwork${works.length > 1 ? 's' : ''}${isShared ? ' shared with you' : ' saved in this browser'}</div>
      ${isShared ? '' : `<div class="picks-actionbar"><div class="share-box"><span>Share link:</span><input id="shareInput" readonly value="${esc(link)}"><button class="btn btn-dark" id="copyBtn">Copy</button></div><button class="btn btn-light" id="clearPicks">Clear all</button></div>`}</div>
      <section class="gallery-main"><div class="works-grid">${works.map(workCard).join('')}</div></section>`;
    $('#copyBtn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); } catch (e) { $('#shareInput').select(); document.execCommand('copy'); } toast('Link copied — send it to your client'); });
    $('#clearPicks')?.addEventListener('click', () => { if (confirm('Clear all your picks?')) { picks.clear(); savePicks(); renderPicks(); } });
    wireCards(app); wireHearts(app); setActiveNav('picks');
  }

  /* ---------- wiring ---------- */
  function wireGallery() {
    const f = $('#filters');
    $('#fsearch')?.addEventListener('input', e => { state.search = e.target.value; debounce(); });
    $('#licToggle')?.addEventListener('click', () => { state.licOnly = !state.licOnly; renderGallery(state.view); });
    f?.querySelectorAll('[data-facet]').forEach(el => el.addEventListener('click', () => { const s = state[el.dataset.facet]; const v = el.dataset.val; s.has(v) ? s.delete(v) : s.add(v); renderGallery(state.view); }));
    f?.querySelectorAll('[data-clear]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); state[el.dataset.clear].clear(); renderGallery(state.view); }));
    app.querySelectorAll('.active-filters [data-facet]').forEach(el => el.addEventListener('click', () => { state[el.dataset.facet].delete(el.dataset.val); renderGallery(state.view); }));
    $('#chipLic')?.addEventListener('click', () => { state.licOnly = false; renderGallery(state.view); });
    $('#clearAll')?.addEventListener('click', () => { ['mediums', 'styles', 'confidence', 'prices'].forEach(k => state[k].clear()); state.licOnly = false; state.search = ''; renderGallery(state.view); });
    $('#sortSel')?.addEventListener('change', e => { state.sort = e.target.value; renderGallery(state.view); });
    app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.mode === 'works' ? '#/gallery' : '#/artists'; }));
    wireCards(app); wireHearts(app); wireCarousels(app);
  }
  let _dt; function debounce() { clearTimeout(_dt); _dt = setTimeout(() => { renderGallery(state.view); const n = $('#fsearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 220); }

  function wireCards(root) {
    root.querySelectorAll('[data-work]').forEach(c => c.addEventListener('click', e => { if (e.target.closest('[data-heart]')) return; location.hash = '#/work/' + c.dataset.work; }));
    root.querySelectorAll('[data-artist]').forEach(c => c.addEventListener('click', () => { location.hash = '#/artist/' + c.dataset.artist; }));
  }
  function wireHearts(root) {
    root.querySelectorAll('[data-heart]').forEach(h => h.addEventListener('click', e => { e.stopPropagation(); const id = h.dataset.heart; picks.has(id) ? picks.delete(id) : picks.add(id); savePicks(); h.classList.toggle('on', picks.has(id)); if (h.classList.contains('btn')) h.textContent = picks.has(id) ? '♥ Saved' : '♥ Save to picks'; }));
  }
  function wireCarousels(root) {
    root.querySelectorAll('.carousel').forEach(c => {
      const track = c.querySelector('.carousel-track'); if (!track) return;
      const dots = [...c.querySelectorAll('.cdot')];
      const go = dir => { const w = c.clientWidth; track.scrollBy({ left: dir * w, behavior: 'smooth' }); };
      c.querySelector('.cprev')?.addEventListener('click', e => { e.stopPropagation(); go(-1); });
      c.querySelector('.cnext')?.addEventListener('click', e => { e.stopPropagation(); go(1); });
      track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / c.clientWidth); dots.forEach((d, j) => d.classList.toggle('on', j === i)); });
    });
  }

  /* ---------- lightbox ---------- */
  function openLightbox(w) { $('#lbImg').src = (w.img && (w.img.full || w.img.thumb)) || ''; $('#lbCap').innerHTML = `<em>${esc(w.title || 'Untitled')}</em> — ${esc(w.artistName)}`; $('#lightbox').classList.add('open'); }
  window.closeLightbox = () => $('#lightbox').classList.remove('open');
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  function setActiveNav(r) { document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === r)); }

  /* ---------- router ---------- */
  function route() {
    const h = location.hash || '#/gallery';
    if (h.startsWith('#/work/')) return renderWork(decodeURIComponent(h.slice(7)));
    if (h.startsWith('#/artist/')) return renderArtist(decodeURIComponent(h.slice(9)));
    if (h.startsWith('#/artists')) return renderGallery('artists');
    if (h.startsWith('#/shared')) { const ids = new URLSearchParams(h.split('?')[1] || '').get('ids'); return renderPicks((ids || '').split(',').filter(Boolean)); }
    if (h.startsWith('#/picks')) return renderPicks();
    return renderGallery('works');
  }
  boot();
})();

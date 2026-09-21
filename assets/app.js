/* Art Sourcing Database — Carpe Diem. Static gallery app. Vanilla JS, no build step. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  let DATA = { artists: [], works: [] };
  let byArtist = {};
  const state = { search: '', mediums: new Set(), styles: new Set(), confidence: new Set(), prices: new Set(), licOnly: false, origin: '', region: '', sort: 'featured', view: 'works' };

  // Location is free text like "Brooklyn, NY" (US) or "Turin, Italy" (international).
  // Classified by checking whether the part after the last comma is a US state/DC/"USA".
  const US_STATES = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'USA', 'US', 'UNITED STATES']);
  const isDomestic = loc => { if (!loc) return false; const last = loc.split(',').pop().trim().toUpperCase(); return US_STATES.has(last); };

  /* ---------- favorites ---------- */
  const LS = 'invenio_picks_v1';
  let picks = new Set();
  try { picks = new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch (e) {}
  const savePicks = () => { try { localStorage.setItem(LS, JSON.stringify([...picks])); } catch (e) {} updatePicksCount(); };
  const updatePicksCount = () => { const el = $('#picksCount'); if (el) el.textContent = picks.size; };
  // Counts $ signs for the base tier, plus a fractional bump for the "+" (uncapped) tier
  // so "$$$$$+" ranks strictly above "$$$$$" instead of tying with it.
  const priceRank = p => p ? (p.match(/\$/g) || []).length + (p.includes('+') ? 0.5 : 0) : 0;
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const priceDisp = p => p ? esc(p.split(' - ')[0].trim()) : '—';
  const priceFull = p => p ? esc(p) : '—';
  const fmtMoney = n => (n == null || n === '') ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  // "Yes — $1,200" when a licensing price is set, otherwise plain "Yes" / "No"
  const licensingText = x => !x.licensing ? 'No' : (fmtMoney(x.licensingPrice) ? `Yes — ${fmtMoney(x.licensingPrice)}` : 'Yes');

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1900); }

  /* ---------- projects (shared folders, backed by Airtable) ---------- */
  const PCFG = () => DATA.projects || { enabled: false };
  const airHeaders = () => ({ 'Authorization': `Bearer ${PCFG().writeToken}`, 'Content-Type': 'application/json' });
  const airUrl = (table, path = '') => `https://api.airtable.com/v0/${PCFG().baseId}/${table}${path}`;
  async function airList(table, filterFormula) {
    const qs = '?returnFieldsByFieldId=true' + (filterFormula ? '&filterByFormula=' + encodeURIComponent(filterFormula) : '');
    const r = await fetch(airUrl(table) + qs, { headers: airHeaders() });
    if (!r.ok) throw new Error('Airtable read failed (' + r.status + ')');
    return (await r.json()).records;
  }
  async function airCreate(table, fields) {
    const r = await fetch(airUrl(table), { method: 'POST', headers: airHeaders(), body: JSON.stringify({ records: [{ fields }], typecast: true, returnFieldsByFieldId: true }) });
    if (!r.ok) throw new Error('Airtable write failed (' + r.status + ')');
    return (await r.json()).records[0];
  }
  async function airUpdate(table, id, fields) {
    const r = await fetch(airUrl(table, '/' + id), { method: 'PATCH', headers: airHeaders(), body: JSON.stringify({ fields, typecast: true, returnFieldsByFieldId: true }) });
    if (!r.ok) throw new Error('Airtable update failed (' + r.status + ')');
    return await r.json();
  }
  async function airGet(table, id) {
    const r = await fetch(airUrl(table, '/' + id) + '?returnFieldsByFieldId=true', { headers: airHeaders() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Airtable read failed (' + r.status + ')');
    return await r.json();
  }
  async function airDelete(table, id) {
    const r = await fetch(airUrl(table, '/' + id), { method: 'DELETE', headers: airHeaders() });
    if (!r.ok) throw new Error('Airtable delete failed (' + r.status + ')');
  }
  const esc1 = s => String(s == null ? '' : s).replace(/"/g, ''); // strip quotes for safe formula embedding

  const ME_KEY = 'invenio_me';
  let myEmail = ''; try { myEmail = localStorage.getItem(ME_KEY) || ''; } catch (e) {}
  function ensureEmail() {
    if (myEmail) return myEmail;
    const v = prompt("Quick one-time setup — what's your email? (so we know who added items to a project)");
    if (v && v.trim()) { myEmail = v.trim(); try { localStorage.setItem(ME_KEY, myEmail); } catch (e) {} }
    return myEmail;
  }

  const MYPROJ_KEY = 'invenio_myprojects';
  let myProjects = []; try { myProjects = JSON.parse(localStorage.getItem(MYPROJ_KEY) || '[]'); } catch (e) {}
  const saveMyProjects = () => { try { localStorage.setItem(MYPROJ_KEY, JSON.stringify(myProjects)); } catch (e) {} };
  function rememberProject(p) {
    const i = myProjects.findIndex(x => x.id === p.id);
    if (i === -1) myProjects.push(p); else myProjects[i] = p;
    saveMyProjects();
  }
  function forgetProject(id) { myProjects = myProjects.filter(x => x.id !== id); saveMyProjects(); }

  async function createProject(name) {
    const email = ensureEmail(); if (!email) return null;
    const F = PCFG().fields;
    const rec = await airCreate(PCFG().tables.projects, { [F.projectName]: name, [F.ownerEmail]: email });
    const p = { id: rec.id, shareId: rec.fields[F.shareId], name };
    rememberProject(p);
    return p;
  }
  async function renameProjectRemote(id, name) {
    const F = PCFG().fields;
    await airUpdate(PCFG().tables.projects, id, { [F.projectName]: name });
    const i = myProjects.findIndex(x => x.id === id); if (i > -1) { myProjects[i].name = name; saveMyProjects(); }
  }
  async function addToProject(project, item, kind) {
    const F = PCFG().fields;
    const artistId = kind === 'work' ? item.artistId : item.id;
    const fields = {
      [F.siProject]: [project.id],
      [F.siArtists]: [artistId],
      [F.siType]: kind === 'work' ? 'Work' : 'Artist',
      [F.siName]: kind === 'work' ? (item.artistName || 'Untitled') : item.name,
    };
    await airCreate(PCFG().tables.savedItems, fields);
    rememberProject(project);
  }
  async function loadProjectByShareId(shareId) {
    // Share ID is a formula field that just evaluates to RECORD_ID(), so the
    // share id IS the project's record id — fetch it directly rather than
    // searching, and sidestep filterByFormula (which needs field NAMES, never
    // field IDs — a bug that used to live here).
    const proj = await airGet(PCFG().tables.projects, shareId);
    if (!proj) return null;
    const items = await airList(PCFG().tables.savedItems, `FIND("${esc1(shareId)}", ARRAYJOIN({Project Share ID}))`);
    return { proj, items };
  }

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
      <div class="brand" style="justify-content:center;margin-bottom:6px"><span class="brand-mark"></span> Art Sourcing Database</div>
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
        w.price = a.price; w.confidence = a.confidence; w.licensing = !!a.licensing; w.licensingPrice = a.licensingPrice;
        w.location = a.location;
      }
      w.origin = isDomestic(w.location) ? 'domestic' : 'international';
      w.region = (w.location || '').split(',').pop().trim();
      w.priceRank = priceRank(w.price);
    });
    DATA.artists.forEach(a => {
      a.priceRank = priceRank(a.price); a.images = a.images || (a.workThumbs || []);
      a.origin = isDomestic(a.location) ? 'domestic' : 'international';
      a.region = (a.location || '').split(',').pop().trim();
    });
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
    (!state.origin || x.origin === state.origin) &&
    (!state.region || x.region === state.region) &&
    (!state.licOnly || x.licensing);

  function filteredWorks() {
    const q = state.search.trim().toLowerCase();
    let list = DATA.works.filter(w => matchFacets(w) && (!q || (w.artistName + ' ' + (w.mediums || []).join(' ') + ' ' + (w.styles || []).join(' ') + ' ' + (w.location || '')).toLowerCase().includes(q)));
    if (state.sort === 'price-asc') list.sort((a, b) => a.priceRank - b.priceRank);
    else if (state.sort === 'price-desc') list.sort((a, b) => b.priceRank - a.priceRank);
    else if (state.sort === 'artist') list.sort((a, b) => (a.artistName || '').localeCompare(b.artistName || ''));
    else if (state.sort === 'location') list.sort((a, b) => (a.location || '').localeCompare(b.location || ''));
    return list;
  }
  function filteredArtists() {
    const q = state.search.trim().toLowerCase();
    let list = DATA.artists.filter(a => matchFacets(a) && (!q || (a.name + ' ' + (a.location || '') + ' ' + (a.mediums || []).join(' ') + ' ' + (a.styles || []).join(' ')).toLowerCase().includes(q)));
    if (state.sort === 'artist') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'price-asc') list.sort((a, b) => a.priceRank - b.priceRank);
    else if (state.sort === 'price-desc') list.sort((a, b) => b.priceRank - a.priceRank);
    else if (state.sort === 'location') list.sort((a, b) => (a.location || '').localeCompare(b.location || ''));
    return list;
  }

  /* ---------- components ---------- */
  const confBadge = c => (c && c.toLowerCase() !== 'high') ? `<span class="conf conf-${esc(c.toLowerCase())}" title="Internal data-confidence">${esc(c)} confidence</span>` : '';

  function workCard(w) {
    const on = picks.has(w.id) ? 'on' : '';
    const img = (w.img && (w.img.thumb || w.img.full)) || '';
    return `<div class="work-card" data-work="${esc(w.id)}">
      <div class="work-imgwrap">
        ${w.licensing ? `<span class="avail-dot" title="Open for licensing${fmtMoney(w.licensingPrice) ? ' — ' + fmtMoney(w.licensingPrice) : ''}"></span>` : ''}
        <button class="heart ${on}" data-heart="${esc(w.id)}" title="Save to my picks">♥</button>
        <img loading="lazy" src="${esc(img)}" alt="Artwork by ${esc(w.artistName)}">
      </div>
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
      ${row('Open for licensing', licensingText(a))}
      ${link('Website', a.website, a.website && a.website.replace(/^https?:\/\/(www\.)?/, ''))}
      ${link('Email', a.email, a.email, true)}
      ${link('Instagram', ig, a.instagram)}
      ${link('Contact form', a.contactUrl, 'Open contact page')}
      ${a.notes ? `<div class="drow drow-col"><span class="dlabel">Notes</span><span class="dval note">${esc(a.notes)}</span></div>` : ''}
      ${a.sources ? `<div class="drow drow-col"><span class="dlabel">Sources</span><span class="dval note sources">${esc(a.sources)}</span></div>` : ''}
      ${(a.confidence && a.confidence.toLowerCase() !== 'high') ? `<div class="drow"><span class="dlabel">Confidence</span><span class="dval">${confBadge(a.confidence)}</span></div>` : ''}
    </div>`;
  }

  const addToBtnHtml = uid => PCFG().enabled ? `<div class="addto-wrap" data-addto="${uid}"><button class="btn btn-light" data-addto-btn="${uid}">+ Add to project</button></div>` : '';
  function wireAddTo(root, item, kind) {
    root.querySelectorAll('[data-addto-btn]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const wrap = btn.closest('.addto-wrap');
        const existing = wrap.querySelector('.addto-menu');
        if (existing) { existing.remove(); return; }
        const menu = document.createElement('div'); menu.className = 'addto-menu';
        const rows = myProjects.map(p => `<button data-pid="${esc(p.id)}">${esc(p.name)}</button>`).join('') || `<div style="padding:9px 10px;color:var(--ink-3);font-size:12.5px">No projects yet</div>`;
        menu.innerHTML = rows + `<div class="divider"></div><button data-newproj="1">+ New project</button>`;
        wrap.appendChild(menu);
        menu.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', async ev => {
          ev.stopPropagation(); menu.remove();
          const proj = myProjects.find(p => p.id === b.dataset.pid); if (!proj) return;
          try { await addToProject(proj, item, kind); toast(`Added to "${proj.name}"`); }
          catch (err) { toast('Could not add — try again'); }
        }));
        menu.querySelector('[data-newproj]').addEventListener('click', async ev => {
          ev.stopPropagation(); menu.remove();
          const name = prompt('Name this project:'); if (!name || !name.trim()) return;
          try { const p = await createProject(name.trim()); if (p) { await addToProject(p, item, kind); toast(`Created "${p.name}" and added`); } }
          catch (err) { toast('Could not create project — try again'); }
        });
        const closer = ev => { if (!wrap.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); } };
        setTimeout(() => document.addEventListener('click', closer), 0);
      });
    });
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
      ${filtersPanel(fc, base)}
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
  const anyFilter = () => state.search || state.mediums.size || state.styles.size || state.confidence.size || state.prices.size || state.licOnly || state.origin || state.region;

  function regionDropdown(base) {
    if (!state.origin) return '';
    const opts = [...new Set(base.filter(x => x.origin === state.origin && x.region).map(x => x.region))].sort((a, b) => a.localeCompare(b));
    const label = state.origin === 'domestic' ? 'state' : 'country';
    return `<select class="dropdown" id="regionSel" style="margin-top:8px">
      <option value="">All ${label}s</option>
      ${opts.map(r => `<option value="${esc(r)}"${state.region === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
  }
  function filtersPanel(fc, base) {
    const grp = (label, key, opts, sel, subtle) => `<div class="filter-group">
      <div class="filter-label">${label}${sel.size ? `<span class="clear" data-clear="${key}">clear</span>` : ''}</div>
      ${opts.map(([v, c]) => `<label class="checkbox-row ${sel.has(v) ? 'on' : ''} ${subtle ? 'subtle' : ''}" data-facet="${key}" data-val="${esc(v)}"><span class="cb"></span>${key === 'prices' ? esc(v) : esc(v.split(' - ')[0])}<span class="count">${c}</span></label>`).join('')}
    </div>`;
    return `<aside class="filters" id="filters">
      <input class="filter-search" id="fsearch" placeholder="Search art, artist, city…" value="${esc(state.search)}">
      <div class="filter-group"><div class="filter-label">Location</div>${originDropdown()}${regionDropdown(base)}</div>
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
    if (state.region) chips.push(`<span class="chip">${esc(state.region)}<span class="x" id="chipRegion">✕</span></span>`);
    if (!chips.length) return '';
    return `<div class="active-filters">${chips.join('')}<span class="chip" style="cursor:pointer" id="clearAll">Clear all</span></div>`;
  }
  const sortDropdown = () => `<select class="dropdown" id="sortSel">
    <option value="featured"${state.sort === 'featured' ? ' selected' : ''}>Featured</option>
    <option value="artist"${state.sort === 'artist' ? ' selected' : ''}>Artist A–Z</option>
    <option value="location"${state.sort === 'location' ? ' selected' : ''}>Location A–Z</option>
    <option value="price-asc"${state.sort === 'price-asc' ? ' selected' : ''}>Price: low→high</option>
    <option value="price-desc"${state.sort === 'price-desc' ? ' selected' : ''}>Price: high→low</option></select>`;
  const originDropdown = () => `<select class="dropdown" id="originSel">
    <option value=""${state.origin === '' ? ' selected' : ''}>All locations</option>
    <option value="domestic"${state.origin === 'domestic' ? ' selected' : ''}>Domestic (USA)</option>
    <option value="international"${state.origin === 'international' ? ' selected' : ''}>International</option></select>`;

  function renderWork(id) {
    const w = DATA.works.find(x => x.id === id); if (!w) return notFound();
    const a = byArtist[w.artistId] || {};
    const more = DATA.works.filter(x => x.artistId === w.artistId && x.id !== id).slice(0, 8);
    const similarWorks = findSimilarWorks(w).slice(0, 8);
    app.innerHTML = `
      <div class="detail-back"><a href="#/gallery">← Works</a></div>
      <div class="work-detail">
        <div class="wd-img" id="wdImg"><img src="${esc((w.img && (w.img.full || w.img.thumb)) || '')}" alt="Artwork by ${esc(a.name || w.artistName)}"></div>
        <div class="wd-side">
          <h1 class="wd-title"><a href="#/artist/${esc(w.artistId)}">${esc(a.name || w.artistName)}</a></h1>
          <div class="artist-actions" style="margin:14px 0 18px">
            <button class="btn btn-dark" data-heart="${esc(w.id)}">${picks.has(w.id) ? '♥ Saved' : '♥ Save to picks'}</button>
            <button class="btn btn-light" id="zoomBtn">Zoom ⤢</button>
            ${addToBtnHtml('w-' + w.id)}
          </div>
          ${detailsBlock(a)}
        </div>
      </div>
      ${more.length ? `<div class="section-wrap"><h2 class="section-h">More by ${esc(a.name || w.artistName)}</h2><div class="detail-works">${more.map(workCard).join('')}</div></div>` : ''}
      ${similarWorks.length ? `<div class="section-wrap"><h2 class="section-h">Similar works</h2><div class="section-sub">Sharing medium &amp; style, from other artists</div><div class="detail-works">${similarWorks.map(workCard).join('')}</div></div>` : ''}`;
    $('#zoomBtn')?.addEventListener('click', () => openLightbox(w));
    $('#wdImg')?.addEventListener('click', () => openLightbox(w));
    wireCards(app); wireHearts(app); wireAddTo(app, w, 'work'); setActiveNav('gallery'); window.scrollTo(0, 0);
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
            ${addToBtnHtml('a-' + a.id)}
          </div>
          ${detailsBlock(a)}
        </div>
      </div>
      <div class="artist-stats">
        <div class="stat"><div class="stat-num">${works.length}</div><div class="stat-label">Works</div></div>
        <div class="stat"><div class="stat-num">${priceDisp(a.price)}</div><div class="stat-label">Price range</div></div>
        <div class="stat"><div class="stat-num">${(a.mediums || []).length}</div><div class="stat-label">Mediums</div></div>
        <div class="stat"><div class="stat-num">${a.licensing ? (fmtMoney(a.licensingPrice) || 'Yes') : '—'}</div><div class="stat-label">Licensing</div></div>
      </div>
      <div class="section-wrap"><h2 class="section-h">Works</h2><div class="section-sub">${works.length} available</div>
        <div class="detail-works">${works.map(workCard).join('')}</div></div>
      ${similar.length ? `<div class="section-wrap"><h2 class="section-h">Similar artists</h2><div class="section-sub">Sharing medium &amp; style with ${esc(a.name)}</div>
        <div class="artists-grid">${similar.map(artistCard).join('')}</div></div>` : ''}`;
    $('#saveAllBtn')?.addEventListener('click', () => { works.forEach(w => picks.add(w.id)); savePicks(); wireHearts(app); toast(`Added ${works.length} works to your picks`); });
    wireCards(app); wireHearts(app); wireCarousels(app); wireAddTo(app, a, 'artist'); setActiveNav('artists'); window.scrollTo(0, 0);
  }
  const notFound = () => { app.innerHTML = `<div class="empty"><h2>Not found</h2><p><a href="#/gallery">Back to gallery</a></p></div>`; };

  function findSimilarWorks(w) {
    const ms = new Set(w.mediums || []), ss = new Set(w.styles || []);
    return DATA.works.filter(o => o.id !== w.id && o.artistId !== w.artistId).map(o => {
      let s = 0; (o.mediums || []).forEach(m => ms.has(m) && (s += 1)); (o.styles || []).forEach(x => ss.has(x) && (s += 2)); if (o.price === w.price) s += 1;
      return { o, s };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s).map(x => x.o);
  }

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
      ${isShared ? '' : `<div class="picks-actionbar"><div class="share-box"><span>Share link:</span><input id="shareInput" readonly value="${esc(link)}"><button class="btn btn-dark" id="copyBtn">Copy</button></div><button class="btn btn-light" id="clearPicks">Clear all</button>${PCFG().enabled ? '<button class="btn btn-light" id="sendProjBtn">Send to a project</button>' : ''}</div>`}</div>
      <section class="gallery-main"><div class="works-grid">${works.map(workCard).join('')}</div></section>`;
    $('#copyBtn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); } catch (e) { $('#shareInput').select(); document.execCommand('copy'); } toast('Link copied — send it to your client'); });
    $('#clearPicks')?.addEventListener('click', () => { if (confirm('Clear all your picks?')) { picks.clear(); savePicks(); renderPicks(); } });
    $('#sendProjBtn')?.addEventListener('click', async () => {
      let proj = null;
      if (myProjects.length) {
        const label = myProjects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
        const pick = prompt(`Send ${works.length} picks to which project?\n${label}\n\nType a number, or type a new name to create one:`);
        if (!pick) return;
        const idx = parseInt(pick, 10);
        proj = (!isNaN(idx) && myProjects[idx - 1]) ? myProjects[idx - 1] : await createProject(pick.trim());
      } else {
        const name = prompt('Name this project:'); if (!name || !name.trim()) return;
        proj = await createProject(name.trim());
      }
      if (!proj) return;
      try { for (const w of works) await addToProject(proj, w, 'work'); toast(`Sent ${works.length} picks to "${proj.name}"`); }
      catch (e) { toast('Something went wrong partway through — check the project'); }
    });
    wireCards(app); wireHearts(app); setActiveNav('picks');
  }

  function renderProjects() {
    if (!PCFG().enabled) {
      app.innerHTML = `<div class="empty"><h2>Projects aren't set up yet</h2><p>Ask whoever runs the site to add the write-access token.</p></div>`;
      setActiveNav('projects'); return;
    }
    const rows = myProjects.map(p => `<div class="project-row">
        <div><p class="project-row-name">${esc(p.name)}</p><p class="project-row-meta">Shared folder · anyone with the link can view &amp; add</p></div>
        <div class="project-row-actions">
          <button class="btn btn-light" data-copy="${esc(p.shareId)}">Copy link</button>
          <button class="btn btn-dark" data-open="${esc(p.shareId)}">Open</button>
        </div>
      </div>`).join('');
    app.innerHTML = `<div class="picks-hero"><h1 class="gallery-h1">Projects</h1>
      <div class="gallery-meta">Shared folders you've created or opened in this browser</div>
      <div class="picks-actionbar"><button class="btn btn-dark" id="newProjBtn">+ New project</button><button class="btn btn-light" id="openLinkBtn">Open a shared link</button></div></div>
      <section class="gallery-main" style="padding:34px 40px">${rows || `<div class="empty"><h2>No projects yet</h2><p>Create one, or open a link someone shared with you.</p></div>`}</section>`;
    $('#newProjBtn')?.addEventListener('click', async () => {
      const name = prompt('Name this project:'); if (!name || !name.trim()) return;
      try { const p = await createProject(name.trim()); if (p) { toast(`Created "${p.name}"`); location.hash = '#/project/' + encodeURIComponent(p.shareId); } }
      catch (e) { toast('Could not create project — try again'); }
    });
    $('#openLinkBtn')?.addEventListener('click', () => {
      const v = prompt('Paste the project link or just its code:'); if (!v) return;
      const m = v.match(/#\/project\/([^/?#]+)/);
      const shareId = m ? decodeURIComponent(m[1]) : v.trim();
      if (shareId) location.hash = '#/project/' + encodeURIComponent(shareId);
    });
    app.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => location.hash = '#/project/' + encodeURIComponent(b.dataset.open)));
    app.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const link = location.origin + location.pathname + '#/project/' + encodeURIComponent(b.dataset.copy);
      try { await navigator.clipboard.writeText(link); } catch (e) {}
      toast('Link copied — share it with your team or client');
    }));
    setActiveNav('projects');
  }

  async function renderProject(shareId) {
    if (!PCFG().enabled) { app.innerHTML = `<div class="empty"><h2>Projects aren't set up yet</h2></div>`; setActiveNav('projects'); return; }
    app.innerHTML = `<div class="empty"><h2>Loading…</h2></div>`;
    let data; try { data = await loadProjectByShareId(shareId); } catch (e) { app.innerHTML = `<div class="empty"><h2>Couldn't load this project</h2><p>Check your connection and try again.</p></div>`; return; }
    if (!data) { app.innerHTML = `<div class="empty"><h2>Project not found</h2><p>The link may be wrong, or the project was deleted.</p></div>`; setActiveNav('projects'); return; }
    const { proj, items } = data;
    const F = PCFG().fields;
    const name = proj.fields[F.projectName] || 'Untitled project';
    rememberProject({ id: proj.id, shareId, name });
    const link = location.origin + location.pathname + '#/project/' + encodeURIComponent(shareId);
    const rows = items.map(it => {
      // Item thumbnails aren't wired up yet (would need another lookup call per item) — placeholder box for now.
      const title = it.fields[F.siName] || 'Untitled';
      return `<div class="project-item-row" data-siid="${esc(it.id)}">
        <div style="width:44px;height:44px;border-radius:6px;background:var(--bg-soft);flex-shrink:0"></div>
        <span>${esc(title)}</span>
        <button class="pir-x" data-remove="${esc(it.id)}" title="Remove">✕</button>
      </div>`;
    }).join('');
    app.innerHTML = `<div class="detail-back"><a href="#/projects">← Projects</a></div>
      <div class="picks-hero">
        <input class="rename-input" id="projName" value="${esc(name)}">
        <div class="gallery-meta" style="margin-top:8px">${items.length} item${items.length === 1 ? '' : 's'} · anyone with this link can view and add</div>
        <div class="picks-actionbar"><div class="share-box"><span>Share link:</span><input id="shareInput" readonly value="${esc(link)}"><button class="btn btn-dark" id="copyBtn">Copy</button></div></div>
      </div>
      <section class="gallery-main" style="padding:20px 40px 60px">${rows || `<div class="empty"><h2>Nothing saved here yet</h2><p>Browse the gallery and use "+ Add to project" on any work or artist.</p></div>`}</section>`;
    $('#copyBtn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); } catch (e) {} toast('Link copied'); });
    $('#projName')?.addEventListener('change', async e => {
      const v = e.target.value.trim(); if (!v || v === name) return;
      try { await renameProjectRemote(proj.id, v); toast('Renamed'); } catch (err) { toast('Could not rename — try again'); }
    });
    app.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const row = b.closest('.project-item-row'); row.style.opacity = '.4';
      try { await airDelete(PCFG().tables.savedItems, b.dataset.remove); row.remove(); }
      catch (e) { row.style.opacity = '1'; toast('Could not remove — try again'); }
    }));
    setActiveNav('projects');
  }

  /* ---------- wiring ---------- */
  function wireGallery() {
    const f = $('#filters');
    $('#fsearch')?.addEventListener('input', e => { state.search = e.target.value; debounce(); });
    $('#licToggle')?.addEventListener('click', () => { state.licOnly = !state.licOnly; renderGallery(state.view); });
    $('#originSel')?.addEventListener('change', e => { state.origin = e.target.value; state.region = ''; renderGallery(state.view); });
    $('#regionSel')?.addEventListener('change', e => { state.region = e.target.value; renderGallery(state.view); });
    f?.querySelectorAll('[data-facet]').forEach(el => el.addEventListener('click', () => { const s = state[el.dataset.facet]; const v = el.dataset.val; s.has(v) ? s.delete(v) : s.add(v); renderGallery(state.view); }));
    f?.querySelectorAll('[data-clear]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); state[el.dataset.clear].clear(); renderGallery(state.view); }));
    app.querySelectorAll('.active-filters [data-facet]').forEach(el => el.addEventListener('click', () => { state[el.dataset.facet].delete(el.dataset.val); renderGallery(state.view); }));
    $('#chipLic')?.addEventListener('click', () => { state.licOnly = false; renderGallery(state.view); });
    $('#chipRegion')?.addEventListener('click', () => { state.region = ''; renderGallery(state.view); });
    $('#clearAll')?.addEventListener('click', () => { ['mediums', 'styles', 'confidence', 'prices'].forEach(k => state[k].clear()); state.licOnly = false; state.origin = ''; state.region = ''; state.search = ''; renderGallery(state.view); });
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
  function openLightbox(w) { $('#lbImg').src = (w.img && (w.img.full || w.img.thumb)) || ''; $('#lbCap').textContent = w.artistName || ''; $('#lightbox').classList.add('open'); }
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
    if (h.startsWith('#/project/')) return renderProject(decodeURIComponent(h.slice(10)));
    if (h.startsWith('#/projects')) return renderProjects();
    return renderGallery('works');
  }
  boot();
})();

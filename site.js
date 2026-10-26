/* Pay Streak site: one stream per visit, running live behind every page and steered by the scroll */
(() => {
  const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', VALID = /^[2-9A-HJ-NP-Z]{7}$/;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // the game's own encoding: a 32-bit seed written in base 32, so a code on this page is the code the game shows
  const draw = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); let n = a[0], c = ''; for (let i = 0; i < 7; i++) { c += ABC[n % 32]; n = Math.floor(n / 32); } return c; };
  let code;
  try { code = sessionStorage.getItem('paystreak.site.code'); } catch (e) { code = null; }
  if (!code || !VALID.test(code)) { code = draw(); try { sessionStorage.setItem('paystreak.site.code', code); } catch (e) { /* private mode */ } }

  // every place on the page that shows the code, and every button that plays it
  const showCode = () => {
    document.querySelectorAll('[data-code]').forEach((el) => { el.textContent = code; });
    document.querySelectorAll('[data-play]').forEach((a) => { a.href = 'play.html?stream=' + code; });
  };
  showCode();

  // the river: loaded once the page has painted; the share image stands in until it's ready, or for good without WebGL2
  const river = document.querySelector('.river');
  let frame = null, ready = false, place = null;
  const send = (m) => { if (frame && ready) frame.contentWindow.postMessage(Object.assign({ type: 'paystreak' }, m), '*'); };
  const canRun = () => {
    if (navigator.connection && navigator.connection.saveData) return false;
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  };
  const loadRiver = () => {
    if (!river || !canRun()) return;
    if (frame) frame.remove();
    ready = false; river.classList.remove('live');
    frame = document.createElement('iframe');
    frame.title = 'The stream behind this page';
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    const packed = document.getElementById('gameSrc');
    if (packed) {
      // the self-contained preview carries the game inside the page, so it needs no other file: the game is told it is
      // the ambient stream, and which one, in place of the address it would otherwise read
      try {
        const raw = atob(packed.textContent.trim()), game = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
        const shim = '<script>(()=>{const U=URLSearchParams;window.URLSearchParams=class extends U{constructor(i){super(i===undefined||i===""?"mode=ambient&stream=' + code + '":i)}}})();<\/script>';
        frame.srcdoc = game.replace('<head>', '<head>' + shim);
      } catch (e) { return; }
    } else {
      // beside the stylesheet, so the river loads from the right folder even on a 404 page served from a deeper path
      const sheet = document.querySelector('link[rel="stylesheet"][href*="site.css"]'), ver = (document.querySelector('meta[name="asset-version"]') || {}).content;
      const rel = 'river.html?mode=ambient&stream=' + code + (ver ? '&v=' + ver : '');
      frame.src = sheet ? new URL(rel, sheet.href).href : rel;
    }
    river.appendChild(frame);
  };
  addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'paystreak-ready') { ready = true; river.classList.add('live'); place = null; pickPlace(); setTimeout(askInk, 700); }
    if (e.data.type === 'paystreak-luma') chooseInk(e.data.values);
    if (e.data.type === 'paystreak-fail') { frame.remove(); frame = null; }
  });
  addEventListener('load', () => setTimeout(loadRiver, 250));
  document.addEventListener('visibilitychange', () => send({ pause: document.hidden }));

  // the home hero has no plate, so each line of its lettering picks light or dark ink for the water directly behind it:
  // the stream reports how bright its picture is there, and without WebGL the poster is measured instead
  const inkEls = [...document.querySelectorAll('[data-ink]')];
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const LIGHT = 0.95, DARK = 0.0103;
  const inkRects = () => inkEls.map((el, id) => {
    const r = document.createRange(); r.selectNodeContents(el);
    let l = Infinity, t = Infinity, rt = 0, b = 0;
    for (const c of r.getClientRects()) if (c.width > 4) { l = Math.min(l, c.left); t = Math.min(t, c.top); rt = Math.max(rt, c.right); b = Math.max(b, c.bottom); }
    if (l === Infinity) return null;
    const x = Math.max(0, l) / innerWidth, y = Math.max(0, t) / innerHeight;
    return { id, x, y, w: Math.min(rt, innerWidth) / innerWidth - x, h: Math.min(b, innerHeight) / innerHeight - y };
  }).filter((r) => r && r.w > 0.01 && r.h > 0.005);
  // values are the deciles of the brightness behind a line; each ink is judged by the share of the line it would leave below
  // 3:1, and the ink changes only when the other is clearly better, so it never flickers
  const cdf = (qs, x) => {
    if (x <= qs[0]) return 0; if (x >= qs[qs.length - 1]) return 1;
    for (let i = 1; i < qs.length; i++) if (x <= qs[i]) { const span = qs[i] - qs[i - 1]; return (i - 1 + (span > 0 ? (x - qs[i - 1]) / span : 1)) / (qs.length - 1); }
    return 1;
  };
  const QS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const chooseInk = (values) => {
    // the label's two inks are teals, not white and near-black, so it is judged against its own luminances
    const groups = [];
    for (const [id, v] of Object.entries(values || {})) {
      const el = inkEls[id]; if (!el || !v || v.length < 3) continue;
      const label = el.classList.contains('place'), [lt, dk] = label ? [0.728, 0.0153] : [LIGHT, DARK], key = label ? 'label' : 'words';
      let g = groups.find((x) => x.key === key); if (!g) groups.push(g = { key, els: [] });
      el._ink = [1 - cdf(v, (lt + 0.05) / 3 - 0.05), cdf(v, 3 * (dk + 0.05) - 0.05)]; g.els.push(el);
    }
    // one ink for the pair when one ink serves both lines, judged by the worse of the two; when the sky behind the
    // headline and the water behind the lede want different inks, each line takes its own, because legibility comes first
    const pick = (cur, light, dark) => (cur === 'light' ? (dark < light - 0.08 ? 'dark' : 'light') : (light < dark - 0.08 ? 'light' : 'dark'));
    for (const g of groups) {
      const worstLight = Math.max(...g.els.map((el) => el._ink[0])), worstDark = Math.max(...g.els.map((el) => el._ink[1]));
      if (g.els.length > 1 && Math.min(worstLight, worstDark) > 0.15) g.els.forEach((el) => { el.dataset.ink = pick(el.dataset.ink === 'dark' ? 'dark' : 'light', el._ink[0], el._ink[1]); });
      else { const next = pick(g.els[0].dataset.ink === 'dark' ? 'dark' : 'light', worstLight, worstDark); g.els.forEach((el) => { el.dataset.ink = next; }); }
    }
  };
  const inkFromPoster = () => {
    if (!inkEls.length || scrollY > innerHeight * 0.6) return;
    const m = /url\("?([^")]+)"?\)/.exec(getComputedStyle(river).backgroundImage); if (!m) return;
    const img = new Image();
    img.onload = () => {
      try {
        const sw = Math.max(8, Math.round(innerWidth / 4)), sh = Math.max(8, Math.round(innerHeight / 4)), cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
        const g = cv.getContext('2d'), k = Math.max(sw / img.width, sh / img.height), dw = img.width * k, dh = img.height * k, values = {};
        g.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
        for (const r of inkRects()) {
          const x = Math.min(sw - 2, Math.floor(r.x * sw)), y = Math.min(sh - 2, Math.floor(r.y * sh)), d = g.getImageData(x, y, Math.max(2, Math.min(Math.floor(r.w * sw), sw - x)), Math.max(2, Math.min(Math.floor(r.h * sh), sh - y))).data, ls = [];
          for (let i = 0; i < d.length; i += 4) ls.push(0.2126 * lin(d[i] / 255) + 0.7152 * lin(d[i + 1] / 255) + 0.0722 * lin(d[i + 2] / 255));
          ls.sort((a, b) => a - b); values[r.id] = QS.map((q) => ls[Math.min(ls.length - 1, Math.floor(ls.length * q))]);
        }
        chooseInk(values);
      } catch (e) { /* the poster can't be read, so the lettering stays light */ }
    };
    img.src = m[1];
  };
  const askInk = () => { if (!ready || document.hidden || scrollY > innerHeight * 0.6) return; const rects = inkRects(); if (rects.length) send({ luma: rects }); };
  if (inkEls.length) {
    inkFromPoster(); addEventListener('load', inkFromPoster); if (document.fonts && document.fonts.ready) document.fonts.ready.then(inkFromPoster);
    addEventListener('resize', () => { inkFromPoster(); askInk(); }); setInterval(askInk, 2500);
  }

  // the scroll steers the river: whichever stretch of the page fills the most of the screen sets the place
  const stops = [...document.querySelectorAll('[data-place]')];
  const pickPlace = () => {
    let best = null, most = 0;
    stops.forEach((el) => { const r = el.getBoundingClientRect(), v = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); if (v > most) { most = v; best = el; } });
    if (best && best.dataset.place !== place) { place = best.dataset.place; send({ place }); }
  };
  // a timer rather than a frame callback, so a busy or throttled page can never leave the river waiting
  let steering = 0;
  addEventListener('scroll', () => { if (!steering) steering = setTimeout(() => { steering = 0; pickPlace(); }, 90); }, { passive: true });
  addEventListener('resize', pickPlace);
  pickPlace();

  // the course strip and the dock tuck away while you read down, and come back the moment you scroll up
  const strip = document.querySelector('.strip'), dock = document.querySelector('.dock');
  let lastY = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, far = y > Math.max(80, document.documentElement.scrollHeight * 0.07);
      const down = y > lastY + 4, up = y < lastY - 4;
      if (down && far) { strip && strip.classList.add('tuck'); dock && dock.classList.add('tuck'); }
      if (up || y < 80) { strip && strip.classList.remove('tuck'); dock && dock.classList.remove('tuck'); }
      lastY = y; ticking = false;
    });
  }, { passive: true });
  document.addEventListener('focusin', () => { strip && strip.classList.remove('tuck'); dock && dock.classList.remove('tuck'); });

  // plates arrive from the side they hang on
  const rises = document.querySelectorAll('.rise');
  if (reduce.matches || !('IntersectionObserver' in window)) rises.forEach((el) => el.classList.add('in'));
  else {
    const io2 = new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io2.unobserve(en.target); } }), { threshold: 0.15 });
    rises.forEach((el) => io2.observe(el));
  }

  // the stream code form: build a code you were given, or draw a new stream behind the page
  const form = document.getElementById('codeForm');
  if (form) {
    const input = form.querySelector('input'), msg = form.querySelector('.msg');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7); msg.textContent = ''; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim().toUpperCase();
      if (!VALID.test(v)) { msg.textContent = 'A stream code is seven letters and numbers, without O, I, 0 or 1.'; input.focus(); return; }
      location.href = 'play.html?stream=' + v;
    });
    const again = document.getElementById('drawNew');
    if (again) again.addEventListener('click', () => {
      code = draw();
      try { sessionStorage.setItem('paystreak.site.code', code); } catch (e) { /* private mode */ }
      showCode(); loadRiver();
      msg.textContent = 'A new stream is building behind this page: ' + code + '.';
    });
  }

  // one answer open at a time
  const qs = document.querySelectorAll('.faq details');
  qs.forEach((d) => d.addEventListener('toggle', () => { if (d.open) qs.forEach((o) => { if (o !== d) o.open = false; }); }));
})();

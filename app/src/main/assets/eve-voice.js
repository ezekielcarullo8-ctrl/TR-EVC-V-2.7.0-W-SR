/* =====================================================================
   EVE VOICE ASSISTANT  —  offline, hands-free control for the Treasurer app
   ---------------------------------------------------------------------
   Native side (Vosk + foreground service) does the listening and decides
   whether you said the wake word "Eve". This file receives the command
   text and turns it into actions inside the app.

   Everything here works with NO internet and NO account.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Small utilities
   * ------------------------------------------------------------------ */
  const K = { enabled: 'eveVoice.enabled', speak: 'eveVoice.speak', bg: 'eveVoice.bgLaunch' };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : v === 'true' ? true : v === 'false' ? false : v;
      } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }
  };
  const $ = (id) => document.getElementById(id);
  const plug = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EveVoice) || null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** lowercase, strip punctuation, unify a few spellings so matching is forgiving */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\bcashbook\b/g, 'cash book')
      .replace(/\bbackup\b/g, 'back up')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- spoken numbers  ("two hundred fifty point five" -> "250.5") ---------- */
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const DIGIT = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const NOISE = ['and', 'pesos', 'peso', 'dollars', 'dollar', 'centavos', 'only', 'a', 'the'];

  function numWords(n) {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10), o = n % 10;
    const tens = Object.keys(TENS).find((k) => TENS[k] === t * 10);
    return tens + (o ? ' ' + ONES[o] : '');
  }

  function spokenToNumber(text) {
    // "one hundred fifty pesos and fifty centavos" -> 150.50
    const pc = norm(text).match(/^(.*?)\s+pesos?\s+(?:and\s+)?(.+?)\s+centavos?$/);
    if (pc) {
      const main = spokenToNumber(pc[1]);
      const cents = parseInt(spokenToNumber(pc[2]), 10);
      if (main !== null && cents >= 0 && cents < 100) return main.split('.')[0] + '.' + String(cents).padStart(2, '0');
    }
    const all = norm(text).split(' ').filter(Boolean).filter((w) => NOISE.indexOf(w) < 0);
    const pi = all.findIndex((w) => w === 'point' || w === 'dot');
    const head = pi < 0 ? all.slice() : all.slice(0, pi);
    const tail = pi < 0 ? [] : all.slice(pi + 1);
    let neg = false;
    if (head[0] === 'minus' || head[0] === 'negative') { neg = true; head.shift(); }

    let intStr = '';
    if (head.length) {
      if (head.every((w) => /^\d+$/.test(w))) {
        intStr = head.join('');
      } else if (head.length >= 2 && head.every((w) => w in DIGIT)) {
        intStr = head.map((w) => DIGIT[w]).join('');            // "one two three" -> 123
      } else {
        let total = 0, cur = 0, ok = false;
        for (const w of head) {
          if (/^\d+$/.test(w)) { cur += parseInt(w, 10); ok = true; }
          else if (w in DIGIT) { cur += DIGIT[w]; ok = true; }
          else if (ONES.indexOf(w) >= 0) { cur += ONES.indexOf(w); ok = true; }
          else if (w in TENS) { cur += TENS[w]; ok = true; }
          else if (w === 'hundred') { cur = (cur || 1) * 100; ok = true; }
          else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; ok = true; }
          else if (w === 'million') { total += (cur || 1) * 1000000; cur = 0; ok = true; }
          /* unknown words ("uh") are ignored */
        }
        if (ok) intStr = String(total + cur);
      }
    }
    let dec = '';
    tail.forEach((w) => {
      if (/^\d+$/.test(w)) dec += w;
      else if (w in DIGIT) dec += DIGIT[w];
      else if (w in TENS) dec += TENS[w];
      else if (ONES.indexOf(w) >= 0) dec += ONES.indexOf(w);
    });
    if (!intStr && !dec) return null;
    return (neg ? '-' : '') + (intStr || '0') + (dec ? '.' + dec : '');
  }

  function pesosSpoken(n) {
    const v = Number(n) || 0;
    const [w, c] = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? 'minus ' : '') + Number(w).toLocaleString('en-US') + ' pesos' +
      (c !== '00' ? ' and ' + Number(c) + ' centavos' : '');
  }
  const pesosShown = (n) => (Number(n) < 0 ? '-' : '') + '₱' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function isoDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */
  const S = {
    cfg: null,                 // voice-phrases.json
    phraseMap: new Map(),      // normalized phrase -> command id
    ui: 'off',                 // off | loading | listening | awake | dictating | error
    enabled: false,
    speak: true,
    bg: false,
    attached: false,
    speaking: false,
    awakeTimer: null,
    heardTimer: null,
    lastChime: 0,
    numbers: { on: false, map: new Map(), sig: '', ids: new WeakMap(), nextId: 1, timer: null },
    target: null,              // field chosen for dictation
    dict: null,                // active dictation session
    confirm: null,             // pending "say confirm" action
    status: null
  };

  /* ------------------------------------------------------------------ *
   *  Config + grammar
   * ------------------------------------------------------------------ */
  async function loadConfig() {
    if (S.cfg) return S.cfg;
    try {
      const res = await fetch('voice-phrases.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const cfg = await res.json();
      cfg.wakeWords = (cfg.wakeWords || ['eve']).map(norm);
      cfg.wakePrefixes = (cfg.wakePrefixes || ['hey']).map(norm);
      cfg.numberVerbs = (cfg.numberVerbs || ['tap']).map(norm);
      cfg.maxNumber = Math.max(1, Math.min(99, cfg.maxNumber || 40));
      cfg.awakeMs = cfg.awakeMs || 8000;
      cfg.dictationEndWords = (cfg.dictationEndWords || ['done']).map(norm);
      S.cfg = cfg;
      S.phraseMap.clear();
      Object.keys(cfg.commands || {}).forEach((id) => {
        cfg.commands[id].forEach((p) => S.phraseMap.set(norm(p), id));
      });
      return cfg;
    } catch (e) {
      console.error('[EveVoice] cannot load voice-phrases.json', e);
      return null;
    }
  }

  function buildGrammar() {
    const c = S.cfg;
    const out = new Set();
    const add = (p) => {
      out.add(p);
      c.wakeWords.forEach((w) => {
        out.add(w + ' ' + p);
        c.wakePrefixes.forEach((x) => out.add(x + ' ' + w + ' ' + p));
      });
    };
    S.phraseMap.forEach((id, phrase) => add(phrase));
    c.numberVerbs.forEach((v) => { for (let n = 1; n <= c.maxNumber; n++) add(v + ' ' + numWords(n)); });
    c.wakeWords.forEach((w) => { out.add(w); c.wakePrefixes.forEach((x) => out.add(x + ' ' + w)); });
    out.add('[unk]');
    return JSON.stringify(Array.from(out));
  }

  function startArgs() {
    return {
      grammar: buildGrammar(),
      wakeWords: S.cfg.wakeWords.join(','),
      wakePrefixes: S.cfg.wakePrefixes.join(','),
      awakeMs: S.cfg.awakeMs,
      bgLaunch: !!S.bg
    };
  }

  /* ------------------------------------------------------------------ *
   *  Feedback: mic button, "heard" pill, Eve's bubble, spoken replies
   * ------------------------------------------------------------------ */
  const UI_LABEL = {
    off: 'Voice assistant is off. Tap to turn on.',
    loading: 'Voice assistant is starting.',
    listening: 'Voice assistant is listening. Say Eve, then a command. Tap to turn off.',
    awake: 'Eve is listening for your command.',
    dictating: 'Dictating. Say done when finished.',
    error: 'Voice assistant has a problem. Tap to try again.'
  };

  function setUi(name) {
    S.ui = name;
    const b = $('eve-voice-btn');
    if (b) {
      b.className = 'ev-fab is-' + name;
      b.setAttribute('aria-label', UI_LABEL[name] || '');
      b.setAttribute('aria-pressed', name === 'off' ? 'false' : 'true');
    }
    if (!$('eve-voice-panel')?.classList.contains('hidden')) renderPanel();
  }

  function setHeard(text, kind, sticky) {
    const p = $('eve-voice-heard');
    if (!p) return;
    p.textContent = text;
    p.className = 'ev-pill show ' + (kind || '');
    clearTimeout(S.heardTimer);
    if (!sticky) S.heardTimer = setTimeout(() => p.classList.remove('show'), 5200);
  }

  function eveBubble(msg, isErr) {
    try {
      if (window.EveAssistant && typeof window.EveAssistant.showMsg === 'function') {
        window.EveAssistant.showMsg(msg, !!isErr, isErr ? 'lookup' : 'smile', 4500);
      }
    } catch (e) { /* Eve is optional */ }
  }

  let audioCtx = null;
  function beep(freq, ms) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq || 880; g.gain.value = 0.05;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + (ms || 90) / 1000);
    } catch (e) { /* audio is optional */ }
    try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* optional */ }
  }

  function muteMic(flag) {
    const p = plug();
    if (p) p.setMuted({ muted: !!flag }).catch(() => {});
  }

  /** Speak with the phone's offline text-to-speech; the mic is muted meanwhile so Eve never hears herself. */
  function speak(text) {
    return new Promise((resolve) => {
      if (!S.speak || !text || !('speechSynthesis' in window)) { resolve(); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        S.speaking = false;
        setTimeout(() => { muteMic(false); resolve(); }, 350);
      };
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US'; u.rate = 1.03;
        u.onend = finish; u.onerror = finish;
        S.speaking = true;
        muteMic(true);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        setTimeout(finish, 5000 + text.length * 70);   // safety net
      } catch (e) { finish(); }
    });
  }

  function say(msg, isErr) {
    if (!msg) return Promise.resolve();
    setHeard(msg, isErr ? 'err' : 'reply');
    eveBubble(msg, isErr);
    return speak(msg);
  }

  /* ------------------------------------------------------------------ *
   *  Screen helpers (overlays, scrolling, tabs)
   * ------------------------------------------------------------------ */
  const OVERLAY_SEL = '.fullscreen-overlay, .activation-overlay, .blurred-modal-overlay';
  const PROTECTED = new Set(['pin-overlay', 'activation-overlay', 'mode-overlay']);
  const CLOSERS = {
    'eve-inventory-overlay': 'closeEveInventory',
    'mode-switch-confirm-modal': 'closeSwitchModeConfirm',
    'eve-calc-overlay': 'closeCalcModal',
    'eve-notes-overlay': 'closeNotesModal'
  };

  function shown(el) {
    if (!el || el.classList.contains('hidden')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function isLocked() {
    return Array.from(PROTECTED).some((id) => shown($(id)));
  }

  function topOverlay() {
    let best = null, bz = -Infinity;
    document.querySelectorAll(OVERLAY_SEL).forEach((el) => {
      if (PROTECTED.has(el.id) || !shown(el)) return;
      const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
      if (z >= bz) { best = el; bz = z; }
    });
    return best;
  }

  function findCloseButton(o) {
    const btns = Array.from(o.querySelectorAll('button')).filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed');
    return btns.find((b) => /(close|cancel|back)/i.test(b.getAttribute('onclick') || '')) ||
      btns.find((b) => /^(←|‹|✕|×|close|back|cancel)/i.test(b.textContent.trim())) || null;
  }

  function closeOverlay(o) {
    const fn = CLOSERS[o.id];
    try {
      if (fn && typeof window[fn] === 'function') window[fn]();
      else { const b = findCloseButton(o); if (b) b.click(); }
    } catch (e) { /* fall through to last resort */ }
    if (shown(o)) { o.classList.add('hidden'); o.style.removeProperty('display'); }
    document.body.style.overflow = topOverlay() ? 'hidden' : '';
    return !shown(o);
  }

  function closeAllOverlays() {
    for (let i = 0; i < 6; i++) {
      const o = topOverlay();
      if (!o || !closeOverlay(o)) break;
    }
  }

  function closeSettings() { try { if (typeof window.closeSettingsMenu === 'function') window.closeSettingsMenu(); } catch (e) { /* ignore */ } }

  function navLabel(btn) { return (btn.textContent || '').replace(/[^\w\s/]/g, '').replace(/\s+/g, ' ').trim() || 'that tab'; }

  function goTab(pageId, navId) {
    const btn = $(navId);
    if (pageId === 'cashbook-section' && typeof window.isClass === 'function' && window.isClass()) return 'The cash book is only in Organization mode.';
    if (pageId === 'classfund-section' && typeof window.isOrg === 'function' && window.isOrg()) return 'Class fund is only in Class mode.';
    if (!btn || btn.classList.contains('hidden')) return 'That tab is not available in this mode.';
    if (typeof window.switchTab !== 'function') throw new Error('The app is still starting.');
    closeAllOverlays();
    closeSettings();
    window.switchTab(pageId, btn);
    window.scrollTo(0, 0);
    refreshNumbersSoon();
    return 'Opening ' + navLabel(btn) + '.';
  }

  function scrollTarget() {
    const ov = topOverlay();
    if (ov) {
      const cand = [ov].concat(Array.from(ov.querySelectorAll('*'))).find((el) =>
        el.scrollHeight > el.clientHeight + 8 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      if (cand) return cand;
    }
    return null;   // null = the page itself
  }

  function doScroll(kind) {
    const el = scrollTarget();
    const h = (el ? el.clientHeight : window.innerHeight) * 0.8;
    const opts = { behavior: 'smooth' };
    if (kind === 'down') opts.top = h;
    else if (kind === 'up') opts.top = -h;
    if (kind === 'top' || kind === 'bottom') {
      const max = el ? el.scrollHeight : document.documentElement.scrollHeight;
      const t = kind === 'top' ? 0 : max;
      if (el) el.scrollTo({ top: t, behavior: 'smooth' }); else window.scrollTo({ top: t, behavior: 'smooth' });
    } else if (el) el.scrollBy(opts); else window.scrollBy(opts);
    refreshNumbersSoon(700);
  }

  /* ------------------------------------------------------------------ *
   *  Numbered targets  ("Eve, show numbers"  ->  "Eve, tap 7")
   * ------------------------------------------------------------------ */
  const CLICKABLE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [onclick], .nav-item';

  function elId(el) {
    let id = S.numbers.ids.get(el);
    if (!id) { id = S.numbers.nextId++; S.numbers.ids.set(el, id); }
    return id;
  }

  function collectTargets() {
    const root = topOverlay() || document;
    const vw = window.innerWidth, vh = window.innerHeight;
    const found = [];
    root.querySelectorAll(CLICKABLE).forEach((el) => {
      if (el.closest('#eve-voice-ui') || el.closest('#eveBot')) return;
      if (el.disabled || el.type === 'password') return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return;
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el.contains(hit) || hit.contains(el))) return;      // covered by something else
      found.push({ el, r });
    });
    // drop an outer container when an inner control starts at the same corner
    const kept = found.filter((a) => !found.some((b) => b !== a && a.el.contains(b.el) &&
      Math.abs(a.r.left - b.r.left) < 8 && Math.abs(a.r.top - b.r.top) < 8));
    kept.sort((a, b) => (Math.round(a.r.top / 12) - Math.round(b.r.top / 12)) || (a.r.left - b.r.left));
    return kept.slice(0, S.cfg ? S.cfg.maxNumber : 40);
  }

  function renderBadges(force) {
    const layer = $('eve-voice-badges');
    if (!layer || !S.numbers.on) return;
    const items = collectTargets();
    const sig = items.map((t) => elId(t.el)).join(',');
    if (force || sig !== S.numbers.sig || layer.children.length !== items.length) {
      S.numbers.sig = sig;
      S.numbers.map.clear();
      layer.innerHTML = '';
      items.forEach((t, i) => {
        S.numbers.map.set(i + 1, t.el);
        const b = document.createElement('span');
        b.className = 'ev-badge';
        b.textContent = String(i + 1);
        layer.appendChild(b);
      });
    }
    items.forEach((t, i) => {
      const b = layer.children[i];
      if (!b) return;
      b.style.left = Math.max(2, t.r.left + 2) + 'px';
      b.style.top = Math.max(2, t.r.top + 2) + 'px';
    });
    layer.classList.remove('hidden');
  }

  function refreshNumbersSoon(ms) {
    if (!S.numbers.on) return;
    clearTimeout(S.numbers.timer);
    S.numbers.timer = setTimeout(() => renderBadges(false), ms || 350);
  }

  function setNumbers(on) {
    S.numbers.on = on;
    const layer = $('eve-voice-badges');
    if (!on) {
      if (layer) { layer.classList.add('hidden'); layer.innerHTML = ''; }
      S.numbers.map.clear(); S.numbers.sig = '';
      return;
    }
    renderBadges(true);
  }

  function labelOf(el) {
    const t = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.id || 'item';
    return t.replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  const DESTRUCTIVE = /(delete|reset|remove|erase|wipe|clear all|clear data)/i;
  const FIELD_BLOCK = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'];

  function isField(el) {
    const t = el.tagName;
    if (t === 'SELECT' || t === 'TEXTAREA') return true;
    return t === 'INPUT' && FIELD_BLOCK.indexOf((el.type || 'text').toLowerCase()) < 0;
  }

  function fieldKind(el) {
    if (el.tagName === 'SELECT') return 'select';
    if (el.tagName === 'TEXTAREA') return 'text';
    const t = (el.type || 'text').toLowerCase();
    const im = (el.getAttribute('inputmode') || '').toLowerCase();
    if (t === 'number' || t === 'tel' || im === 'decimal' || im === 'numeric') return 'number';
    if (t === 'date') return 'date';
    if (t === 'password') return 'blocked';
    return 'text';
  }

  function highlight(el, on) {
    document.querySelectorAll('.ev-target').forEach((e) => e.classList.remove('ev-target'));
    if (el && on !== false) el.classList.add('ev-target');
  }

  function tapNumber(n) {
    const el = S.numbers.map.get(n);
    if (!S.numbers.on || !el || !document.contains(el)) {
      return 'I do not see number ' + n + '. Say “Eve, show numbers” first.';
    }
    const label = labelOf(el);
    if (isField(el)) {
      if (fieldKind(el) === 'blocked') return 'For your safety I do not fill PIN or password boxes.';
      S.target = el; highlight(el, true);
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
      const k = fieldKind(el);
      if (k === 'select') return 'List selected. Say “Eve, dictate”, then the option name.';
      if (k === 'date') return 'Date selected. Say “Eve, dictate”, then today, yesterday or tomorrow.';
      if (k === 'number') return 'Amount box selected. Say “Eve, dictate”, then the amount, then done.';
      return 'Box selected. Say “Eve, dictate”, then speak, then say done.';
    }
    if (DESTRUCTIVE.test(label) || DESTRUCTIVE.test(el.getAttribute('onclick') || '')) {
      S.confirm = { label, until: Date.now() + 12000, run: () => { el.click(); refreshNumbersSoon(); } };
      return '“' + label + '” could delete data. Say “Eve, confirm” to continue, or “Eve, cancel”.';
    }
    el.click();
    refreshNumbersSoon(500);
    return 'Tapped ' + label + '.';
  }

  /* ------------------------------------------------------------------ *
   *  Dictation (open vocabulary, only while filling a field)
   * ------------------------------------------------------------------ */
  function setFieldValue(el, val) {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function startDictation(el) {
    const p = plug();
    if (!p) return 'Dictation needs the Android app.';
    const kind = fieldKind(el);
    if (kind === 'blocked') return 'For your safety I do not fill PIN or password boxes.';
    S.dict = { el, kind, buf: [], idle: null };
    highlight(el, true);
    setUi('dictating');
    setHeard('🎙 Speak now… say “done” when finished', 'dict', true);
    beep(660, 110);
    p.setDictation({ on: true }).catch(() => {});
    armDictIdle(12000);
    return null;
  }

  function armDictIdle(ms) {
    if (!S.dict) return;
    clearTimeout(S.dict.idle);
    S.dict.idle = setTimeout(() => finishDictation(false), ms);
  }

  function stripEnd(text) {
    const t = norm(text);
    for (const w of S.cfg.dictationEndWords) {
      if (t === w) return { text: '', ended: true };
      if (t.endsWith(' ' + w)) return { text: t.slice(0, t.length - w.length - 1).trim(), ended: true };
    }
    return { text: t, ended: false };
  }

  function onDictation(text, final) {
    const d = S.dict;
    if (!d) return;
    armDictIdle(9000);
    if (!final) { setHeard('… ' + norm(text), 'dict', true); return; }
    const r = stripEnd(text);
    if (r.text) d.buf.push(r.text);
    setHeard('“' + d.buf.join(' ') + '”', 'dict', true);
    if (r.ended) finishDictation(false);
  }

  function applyToField(el, raw, kind) {
    if (kind === 'number') {
      const n = spokenToNumber(raw);
      if (n === null) return { ok: false, msg: 'I could not find a number in “' + raw + '”.' };
      setFieldValue(el, n);
      return { ok: true, msg: 'Entered ' + n + '.' };
    }
    if (kind === 'date') {
      const t = norm(raw);
      const off = /yesterday/.test(t) ? -1 : /tomorrow/.test(t) ? 1 : /today|now/.test(t) ? 0 : null;
      if (off === null) return { ok: false, msg: 'For dates, say today, yesterday or tomorrow.' };
      setFieldValue(el, isoDate(off));
      return { ok: true, msg: 'Date set to ' + isoDate(off) + '.' };
    }
    if (kind === 'select') {
      const t = norm(raw);
      let best = null, score = 0;
      Array.from(el.options).forEach((o) => {
        const ot = norm(o.textContent);
        if (!ot) return;
        let s = 0;
        if (ot === t) s = 100; else if (ot.includes(t) || t.includes(ot)) s = 50 + Math.min(ot.length, t.length);
        if (s > score) { score = s; best = o; }
      });
      if (!best) return { ok: false, msg: 'I could not match “' + raw + '” to an option.' };
      setFieldValue(el, best.value);
      return { ok: true, msg: 'Selected ' + best.textContent.trim() + '.' };
    }
    const cur = el.value ? el.value + ' ' : '';
    setFieldValue(el, cur + raw);
    return { ok: true, msg: 'Added: ' + raw };
  }

  function finishDictation(cancelled) {
    const d = S.dict;
    if (!d) return;
    S.dict = null;
    clearTimeout(d.idle);
    const p = plug();
    if (p) p.setDictation({ on: false }).catch(() => {});
    setUi(S.enabled ? 'listening' : 'off');
    const raw = d.buf.join(' ').trim();
    if (cancelled) { say('Dictation cancelled.'); return; }
    if (!raw) { say('I did not hear anything.', true); return; }
    const r = applyToField(d.el, raw, d.kind);
    say(r.msg, !r.ok);
  }

  /* ------------------------------------------------------------------ *
   *  Command table
   * ------------------------------------------------------------------ */
  const HELP = {
    nav_students:   ['Go to Year Level / Students tab', 'Navigate'],
    nav_records:    ['Go to Records tab', 'Navigate'],
    nav_classfund:  ['Go to Class Fund tab (Class mode)', 'Navigate'],
    nav_cashbook:   ['Go to Cash Book tab (Org mode)', 'Navigate'],
    nav_summary:    ['Go to Summary tab', 'Navigate'],
    nav_backup:     ['Go to Backup tab', 'Navigate'],
    do_backup:      ['Start a data backup / export', 'Navigate'],
    open_calculator:['Open the calculator', 'Tools'],
    open_notes:     ['Open your notes', 'Tools'],
    open_guide:     ['Open the Eve guide', 'Tools'],
    settings_open:  ['Open the settings menu', 'Tools'],
    settings_close: ['Close the settings menu', 'Tools'],
    theme_dark:     ['Switch to dark mode', 'Tools'],
    theme_light:    ['Switch to light mode', 'Tools'],
    theme_toggle:   ['Flip light / dark', 'Tools'],
    switch_mode:    ['Switch Org / Class mode (then say confirm)', 'Tools'],
    read_cash:      ['Hear your cash on hand', 'Tools'],
    undo:           ['Undo the last action', 'Screen'],
    redo:           ['Redo', 'Screen'],
    go_back:        ['Close / go back / cancel', 'Screen'],
    scroll_down:    ['Scroll down', 'Screen'],
    scroll_up:      ['Scroll up', 'Screen'],
    scroll_top:     ['Jump to the top', 'Screen'],
    scroll_bottom:  ['Jump to the bottom', 'Screen'],
    show_numbers:   ['Put a number on every button, then say “tap 5”', 'Tap & type'],
    hide_numbers:   ['Remove the numbers', 'Tap & type'],
    dictate:        ['Speak into the selected box (then say “done”)', 'Tap & type'],
    clear_field:    ['Empty the selected box', 'Tap & type'],
    confirm:        ['Confirm a delete / mode switch', 'Tap & type'],
    help:           ['Open this help', 'Voice'],
    stop_listening: ['Turn the voice assistant off', 'Voice'],
    thanks:         ['Say thank you', 'Voice']
  };

  const RUN = {
    nav_students:  () => goTab('database-section', 'nav-students'),
    nav_records:   () => goTab('inventory-section', 'nav-inventory'),
    nav_classfund: () => goTab('classfund-section', 'nav-classfund'),
    nav_cashbook:  () => goTab('cashbook-section', 'nav-cashbook'),
    nav_summary:   () => goTab('eve-summary-tab-section', 'nav-summary-tab'),
    nav_backup:    () => goTab('summary-section', 'nav-summary'),
    do_backup: () => {
      if (typeof window.exportBackup !== 'function') return 'Backup is not ready.';
      closeAllOverlays();
      window.exportBackup();
      return 'Preparing your backup. Choose where to save it.';
    },
    open_calculator: () => { closeAllOverlays(); closeSettings(); if (typeof window.openCalcModal === 'function') { window.openCalcModal(); return 'Calculator opened.'; } return 'Calculator not found.'; },
    open_notes:      () => { closeAllOverlays(); closeSettings(); if (typeof window.openNotesModal === 'function') { window.openNotesModal(); return 'Notes opened.'; } return 'Notes not found.'; },
    open_guide:      () => { closeAllOverlays(); closeSettings(); if (typeof window.openEveInventory === 'function') { window.openEveInventory(); return 'Here is the guide.'; } return 'Guide not found.'; },
    settings_open:   () => { const b = $('settings-toggle'); const m = $('settings-menu'); if (m && m.classList.contains('hidden') && b) b.click(); return 'Settings opened. Say “show numbers” to tap an item.'; },
    settings_close:  () => { closeSettings(); return 'Settings closed.'; },
    theme_dark:  () => { if ((localStorage.getItem('uiTheme') || 'light') === 'dark') return 'Already in dark mode.'; window.toggleTheme(); return 'Dark mode on.'; },
    theme_light: () => { if ((localStorage.getItem('uiTheme') || 'light') === 'light') return 'Already in light mode.'; window.toggleTheme(); return 'Light mode on.'; },
    theme_toggle: () => { window.toggleTheme(); return 'Theme changed.'; },
    switch_mode: () => { closeAllOverlays(); window.switchMode(); refreshNumbersSoon(); return 'The app will reload if you switch. Say “Eve, confirm” or “Eve, cancel”.'; },
    confirm: () => {
      if (S.confirm && Date.now() < S.confirm.until) { const c = S.confirm; S.confirm = null; c.run(); return 'Done.'; }
      S.confirm = null;
      if (shown($('mode-switch-confirm-modal')) && typeof window.confirmSwitchMode === 'function') { window.confirmSwitchMode(); return 'Switching mode.'; }
      return 'There is nothing to confirm.';
    },
    go_back: () => {
      S.confirm = null;
      const o = topOverlay();
      if (o) { closeOverlay(o); refreshNumbersSoon(); return 'Closed.'; }
      const back = Array.from(document.querySelectorAll('.page:not(.hidden) button')).find((b) => b.offsetParent !== null && /^(←|‹|back)/i.test(b.textContent.trim()));
      if (back) { back.click(); refreshNumbersSoon(); return 'Going back.'; }
      return 'There is nothing to close.';
    },
    undo: () => { const b = $('undo-btn'); if (!b || b.disabled) return 'There is nothing to undo.'; b.click(); return 'Undone.'; },
    redo: () => { const b = $('redo-btn'); if (!b || b.disabled) return 'There is nothing to redo.'; b.click(); return 'Redone.'; },
    scroll_down:   () => { doScroll('down'); return null; },
    scroll_up:     () => { doScroll('up'); return null; },
    scroll_top:    () => { doScroll('top'); return null; },
    scroll_bottom: () => { doScroll('bottom'); return null; },
    read_cash: () => {
      if (typeof window.isOrg === 'function' && !window.isOrg()) return 'Cash balance is available in Organization mode.';
      if (typeof window.computeCashbookTotals !== 'function') return 'The cash book is not ready yet.';
      const t = window.computeCashbookTotals();
      setHeard('Cash on hand ' + pesosShown(t.cashOnHand) + '  •  Income ' + pesosShown(t.totalIncome) + '  •  Expenses ' + pesosShown(t.totalExpense), 'reply');
      return 'Cash on hand is ' + pesosSpoken(t.cashOnHand) + '. Income ' + pesosSpoken(t.totalIncome) + '. Expenses ' + pesosSpoken(t.totalExpense) + '.';
    },
    show_numbers: () => { setNumbers(true); return S.numbers.map.size ? 'Numbers on. Say “tap” and a number.' : 'I do not see anything to tap here.'; },
    hide_numbers: () => { setNumbers(false); return 'Numbers hidden.'; },
    dictate: () => {
      const ae = document.activeElement;
      const el = (S.target && document.contains(S.target)) ? S.target : (ae && isField(ae) ? ae : null);
      if (!el) return 'First say “Eve, show numbers”, then “Eve, tap” and the number of the box.';
      return startDictation(el);
    },
    clear_field: () => {
      if (!S.target || !document.contains(S.target)) return 'No box is selected.';
      setFieldValue(S.target, '');
      return 'Cleared.';
    },
    help: () => { openPanel(); return 'Here is what you can say. For example: Eve, go to students.'; },
    thanks: () => 'You are welcome!',
    stop_listening: () => { setTimeout(() => disable(), 100); return 'Voice off. Tap the microphone button to turn me back on.'; }
  };

  function matchCommand(text) {
    const t = norm(text);
    if (S.phraseMap.has(t)) return { id: S.phraseMap.get(t) };
    // "tap twenty one"
    const verbs = (S.cfg && S.cfg.numberVerbs) || [];
    for (const v of verbs) {
      if (t.startsWith(v + ' ')) {
        const n = parseInt(spokenToNumber(t.slice(v.length + 1)), 10);
        if (n >= 1 && n <= 99) return { id: 'tap', n };
      }
    }
    // forgiving fallback: longest known phrase contained in what was heard
    let best = null;
    S.phraseMap.forEach((id, phrase) => {
      if ((' ' + t + ' ').includes(' ' + phrase + ' ') && (!best || phrase.length > best.len)) best = { id, len: phrase.length };
    });
    return best ? { id: best.id } : null;
  }

  async function handleCommand(raw) {
    const text = norm(raw);
    if (!text) return;
    setHeard('“' + text + '”', 'heard');
    if (S.awakeTimer) { clearTimeout(S.awakeTimer); S.awakeTimer = null; }
    if (S.ui === 'awake') setUi('listening');

    if (isLocked()) { say('Please unlock the app first. For your safety I cannot hear your PIN.', true); return; }

    const m = matchCommand(text);
    if (!m) { say('Sorry, I did not understand. Say “Eve, help” to see what I know.', true); return; }
    try {
      const reply = m.id === 'tap' ? tapNumber(m.n) : RUN[m.id] ? RUN[m.id]() : 'That command is not set up.';
      if (reply) await say(reply);
    } catch (e) {
      console.error('[EveVoice] command failed', m, e);
      say('Sorry, that did not work: ' + (e && e.message ? e.message : e), true);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Native events
   * ------------------------------------------------------------------ */
  function awakeVisual(ms) {
    if (S.ui === 'dictating') return;
    setUi('awake');
    clearTimeout(S.awakeTimer);
    S.awakeTimer = setTimeout(() => { if (S.ui === 'awake') setUi('listening'); }, ms);
  }

  function onWake(early) {
    const now = Date.now();
    if (now - S.lastChime > 2000) { beep(880, 90); S.lastChime = now; }
    try { if (window.EveAssistant && window.EveAssistant.react) window.EveAssistant.react('lookup'); } catch (e) { /* ignore */ }
    if (early) { awakeVisual(3500); setHeard('👂 Listening…', 'heard', true); return; }
    awakeVisual(S.cfg ? S.cfg.awakeMs : 8000);
    setHeard('Yes? I am listening…', 'heard', true);
    eveBubble('Yes? I am listening.', false);
  }

  function onState(st) {
    if (st === 'loading') setUi('loading');
    else if (st === 'listening') setUi(S.dict ? 'dictating' : (S.ui === 'awake' ? 'awake' : 'listening'));
    else if (st === 'error') setUi('error');
    else if (st === 'stopped') {
      if (S.enabled) { S.enabled = false; store.set(K.enabled, false); }   // e.g. "Turn off" in the notification
      setUi('off');
    }
  }

  function attachListeners() {
    const p = plug();
    if (S.attached || !p) return;
    S.attached = true;
    p.addListener('state', (e) => onState(e.text));
    p.addListener('wake_heard', () => onWake(true));
    p.addListener('wake', () => onWake(false));
    p.addListener('command', (e) => handleCommand(e.text));
    p.addListener('dictation', (e) => onDictation(e.text, !!e.flag));
    p.addListener('error', (e) => { setUi('error'); say(e.text || 'Voice error.', true); });
  }

  /* ------------------------------------------------------------------ *
   *  Turn on / off
   * ------------------------------------------------------------------ */
  async function enable(opts) {
    opts = opts || {};
    const p = plug();
    if (!p) { if (!opts.silent) say('Voice control works in the installed Android app, not in a web browser.', true); return false; }
    const cfg = await loadConfig();
    if (!cfg) { say('The phrase file voice-phrases.json is missing from this build.', true); setUi('error'); return false; }
    attachListeners();
    setUi('loading');
    try {
      try { await p.requestNotificationPermission(); } catch (e) { /* optional */ }
      await p.start(startArgs());
      S.enabled = true; store.set(K.enabled, true);
      if (!opts.silent) say('Voice control is on. Say Eve, then a command.');
      return true;
    } catch (e) {
      S.enabled = false;
      setUi('error');
      say(String((e && e.message) || e), true);
      return false;
    }
  }

  async function disable() {
    const p = plug();
    finishDictation(true);
    setNumbers(false);
    S.enabled = false; store.set(K.enabled, false);
    if (p) { try { await p.stop(); } catch (e) { /* ignore */ } }
    setUi('off');
  }

  function toggle() { return S.ui === 'off' || S.ui === 'error' ? enable() : disable(); }

  async function pushConfig() {
    const p = plug();
    if (p && S.enabled && S.cfg) { try { await p.configure(startArgs()); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ *
   *  Help / settings panel
   * ------------------------------------------------------------------ */
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function refreshStatus() {
    const p = plug();
    if (!p) { S.status = null; return; }
    try { S.status = await p.status(); } catch (e) { S.status = null; }
  }

  function chip(ok, label, actionName, actionLabel) {
    return '<div class="ev-check ' + (ok ? 'ok' : 'todo') + '"><span class="ev-check-dot" aria-hidden="true">' + (ok ? '✓' : '!') + '</span>' +
      '<span class="ev-check-label">' + esc(label) + '</span>' +
      (ok || !actionName ? '' : '<button type="button" class="ev-mini" onclick="EveVoiceAssistant.fix(\'' + actionName + '\')">' + esc(actionLabel) + '</button>') + '</div>';
  }

  function sw(id, label, sub, on) {
    return '<div class="ev-row"><div class="ev-row-text"><div class="ev-row-title">' + esc(label) + '</div>' +
      (sub ? '<div class="ev-row-sub">' + esc(sub) + '</div>' : '') + '</div>' +
      '<button type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" class="ev-switch' + (on ? ' on' : '') + '" onclick="EveVoiceAssistant.flip(\'' + id + '\')"><span></span></button></div>';
  }

  function renderPanel() {
    const body = $('eve-voice-panel-body');
    if (!body) return;
    const native = !!plug();
    const cfg = S.cfg;
    const st = S.status || {};
    const stateText = !native ? 'Not available in a browser' :
      ({ off: 'Off', loading: 'Starting…', listening: 'Listening', awake: 'Listening for your command', dictating: 'Dictating', error: 'Needs attention' }[S.ui]);
    const wake = cfg ? cfg.wakeWords[0] : 'eve';

    let html = '<div class="ev-hero is-' + S.ui + '"><div class="ev-hero-orb" aria-hidden="true"></div><div>' +
      '<div class="ev-hero-title">' + esc(stateText) + '</div>' +
      '<div class="ev-hero-sub">Say “<b>' + esc(wake) + '</b>” then a command, e.g. “' + esc(wake) + ', go to the student tab”. Works with no internet.</div></div></div>';

    html += '<div class="ev-section"><h4>Controls</h4>' +
      sw('enabled', 'Voice assistant', 'Always listening for “' + wake + '” while on', S.ui !== 'off' && S.ui !== 'error') +
      sw('speak', 'Speak replies aloud', 'Eve talks back so you know she understood', S.speak) +
      sw('bg', 'Bring app forward when I speak', 'Lets “Eve, open students” work while the app is in the background (needs “Display over other apps”)', S.bg) +
      '</div>';

    if (native) {
      html += '<div class="ev-section"><h4>Setup checklist</h4>' +
        chip(st.microphone, 'Microphone permission', 'app', 'Open settings') +
        chip(st.notifications, 'Notification (shows Eve is listening)', 'app', 'Open settings') +
        chip(st.batteryUnrestricted, 'Battery: unrestricted (keeps Eve alive with screen off)', 'battery', 'Allow') +
        chip(st.overlay, 'Display over other apps (only for background wake-up)', 'overlay', 'Allow') +
        '</div>';
    }

    if (cfg) {
      const groups = {};
      Object.keys(HELP).forEach((id) => {
        const [title, group] = HELP[id];
        const ex = (cfg.commands[id] || [])[0];
        (groups[group] = groups[group] || []).push({ title, ex });
      });
      html += '<div class="ev-section"><h4>What you can say</h4><p class="ev-note">Start with “' + esc(wake) + '” — or say just “' + esc(wake) + '”, wait for the beep, then the command.</p>';
      ['Navigate', 'Tools', 'Screen', 'Tap & type', 'Voice'].forEach((g) => {
        if (!groups[g]) return;
        html += '<div class="ev-group"><div class="ev-group-title">' + esc(g) + '</div>' +
          groups[g].map((c) => '<div class="ev-cmd"><span class="ev-cmd-say">“' + esc(c.ex || '') + '”</span><span class="ev-cmd-what">' + esc(c.title) + '</span></div>').join('') + '</div>';
      });
      html += '</div>';
    }

    html += '<div class="ev-section"><h4>Good to know</h4><ul class="ev-list">' +
      '<li><b>Fill a form by voice:</b> “Eve, show numbers” → “Eve, tap 4” (a box) → “Eve, dictate” → say “two hundred fifty” → “done” → “Eve, tap 9” (Save).</li>' +
      '<li>Numbers only appear on what is on screen. Scroll, and they update.</li>' +
      '<li>Your PIN is never spoken or filled by voice — unlock with a touch.</li>' +
      '<li>Some delete / reset pop-ups are Android system dialogs and still need a touch.</li>' +
      '<li>Everything stays on your phone. No audio is recorded or sent anywhere.</li></ul></div>';

    body.innerHTML = html;
  }

  async function openPanel() {
    await loadConfig();
    await refreshStatus();
    renderPanel();
    const p = $('eve-voice-panel');
    if (p) p.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    refreshNumbersSoon();
  }

  function closePanel() {
    const p = $('eve-voice-panel');
    if (p) p.classList.add('hidden');
    document.body.style.overflow = topOverlay() ? 'hidden' : '';
  }

  async function flip(which) {
    if (which === 'enabled') { await toggle(); }
    else if (which === 'speak') { S.speak = !S.speak; store.set(K.speak, S.speak); if (!S.speak) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }
    else if (which === 'bg') { S.bg = !S.bg; store.set(K.bg, S.bg); await pushConfig(); }
    await refreshStatus();
    renderPanel();
  }

  async function fix(what) {
    const p = plug();
    if (!p) return;
    try {
      if (what === 'battery') await p.requestBatteryExemption();
      else if (what === 'overlay') await p.openOverlaySettings();
      else await p.openAppSettings();
    } catch (e) { say(String((e && e.message) || e), true); }
  }

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */
  async function init() {
    S.speak = store.get(K.speak, true) !== false;
    S.bg = store.get(K.bg, false) === true;
    const wasOn = store.get(K.enabled, false) === true;

    const btn = $('eve-voice-btn');
    if (btn) btn.addEventListener('click', () => { toggle(); });

    await loadConfig();
    setUi('off');

    const p = plug();
    if (!p) return;                       // running in a normal browser
    attachListeners();
    await refreshStatus();

    if (wasOn) {
      if (S.status && S.status.running) {
        S.enabled = true;
        onState(S.status.state === 'listening' ? 'listening' : S.status.state);
        pushConfig();
      } else {
        enable({ silent: true });
      }
    }

    // keep numbers tidy while the screen changes
    window.addEventListener('scroll', () => refreshNumbersSoon(250), { passive: true, capture: true });
    window.addEventListener('resize', () => refreshNumbersSoon(250));
    try {
      new MutationObserver((muts) => {
        if (!S.numbers.on) return;
        const real = muts.some((m) => !(m.target.closest && (m.target.closest('#eveBot') || m.target.closest('#eve-voice-ui'))));
        if (real) refreshNumbersSoon(400);
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* optional */ }
    setInterval(() => { if (S.numbers.on) renderBadges(false); }, 3000);

    // when the app returns to the front, make sure the service is still alive
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || !store.get(K.enabled, false)) return;
      await refreshStatus();
      if (S.status && !S.status.running) enable({ silent: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ------------------------------------------------------------------ *
   *  Public API (used by the buttons in index.html and for testing)
   * ------------------------------------------------------------------ */
  window.EveVoiceAssistant = {
    openPanel, closePanel, toggle, enable, disable, flip, fix,
    /** type a command as if you had spoken it: EveVoiceAssistant.simulate('go to students') */
    simulate: async (text) => { await loadConfig(); return handleCommand(text); },
    _test: { norm, spokenToNumber, numWords, pesosSpoken, buildGrammar: async () => { await loadConfig(); return buildGrammar(); }, matchCommand }
  };
})();

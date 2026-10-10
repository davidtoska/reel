// Lysbildeavspiller: tegner en lysbildeserie (enkeltv-slideshow/1, slik serveren leverer den til TV-en)
// på et 16:9-lerret med lag – bilde, video, tekst og form – plassert i prosent av lerretet.
//
// Synlighet, toning og zoom gjøres med Web Animations API over hele lysbildets lengde, så pause,
// fortsett og innhopp midt i et lysbilde bare er å sette eller fryse `currentTime`. Avspilleren har
// sin egen klokke (posisjon i innslaget, uten pausetid) og planlegger lysbildeskifter og lydklipp
// ut fra den. Kanalvelgeren eier tiden: den sier hvor langt inn innslaget starter, og bytter innslag.
//
// Innslag: { id, title, duration, slideshow: { id, version, title, duration, music, slides } }

import { h } from '/shared/ui.js';

const INNHOPP_SLINGRING = 0.25; // s – lydklipp som begynte før dette ved innhopp, hoppes over (ingen tale midt i en setning)
const MAKS_VENT_MS = 5000;      // tikk minst så ofte, så klokka retter seg selv
const FONTER = { sans: 'var(--font)', serif: 'Georgia, "Times New Roman", serif' };
const JUSTERING = { left: 'flex-start', center: 'center', right: 'flex-end', top: 'flex-start', middle: 'center', bottom: 'flex-end' };

const klem = (v, min, maks) => Math.min(maks, Math.max(min, v));
const hv = n => `calc(var(--lerret-h) * ${n} / 100)`; // prosent av lerretets høyde

/** Keyframes for lagets synlighet over hele lysbildet: av før start, toning inn/ut, av etter end. */
export const synlighet = (lag, D) => {
  const o = klem(lag.opacity ?? 1, 0, 1);
  const s = klem(lag.start ?? 0, 0, D);
  const e = klem(lag.end ?? D, s, D);
  let fi = Math.max(0, lag.fadeIn ?? 0);
  let fo = Math.max(0, lag.fadeOut ?? 0);
  if (fi + fo > e - s) { const k = (e - s) / (fi + fo); fi *= k; fo *= k; }
  const punkter = [[0, s > 0 || fi > 0 ? 0 : o]];
  if (s > 0) punkter.push([s, 0]);
  punkter.push([s + fi, o], [e - fo, o], [e, fo > 0 ? 0 : o]);
  if (e < D) punkter.push([e, 0], [D, 0]);
  // Avrunding kan gi en offset som er litt mindre enn den forrige – da kaster animate(). Hold dem stigende.
  let forrige = 0;
  return punkter.map(([t, opacity]) => ({ offset: forrige = Math.max(forrige, D > 0 ? klem(t / D, 0, 1) : 0), opacity }));
};

/** Keyframes for rolig zoom og panorering mot et punkt i bildet, gjennom lagets tid. */
export const bevegelse = (motion, lag, D) => {
  const punkt = p => ({ transform: `scale(${klem(p?.scale ?? 1, 1, 2)})`, transformOrigin: `${p?.x ?? 50}% ${p?.y ?? 50}%` });
  const s = klem(lag.start ?? 0, 0, D);
  const e = klem(lag.end ?? D, s, D);
  const fra = punkt(motion.from);
  const til = punkt(motion.to ?? motion.from);
  return [{ offset: 0, ...fra }, { offset: s / D, ...fra }, { offset: e / D, ...til }, { offset: 1, ...til }];
};

/** Startposisjon (s) for hvert lysbilde i serien. */
export const lysbildeStarter = slides => {
  let sum = 0;
  return slides.map(s => { const start = sum; sum += s.duration; return start; });
};

export const lagSlideshowAvspiller = ({ element, onFeil = () => {}, onLydBlokkert = () => {}, onLysbilde = () => {} }) => {
  const lerret = h('div', { class: 'lerret' });
  const musikk = h('audio', { loop: true, preload: 'auto' });
  element.replaceChildren(lerret);

  let innslag = null;     // innslaget som spilles
  let serie = null;       // innslag.slideshow
  let starter = [];       // startposisjon per lysbilde
  let aktivt = null;      // lysbildet som vises nå
  let forrige = null;     // lysbildet det nye toner inn over
  let basisPos = 0;       // klokke: posisjon (s) i innslaget ved basisT
  let basisT = 0;
  let pauset = false;
  let timer;
  let rampTimer;
  let musikkMål = null;
  let meldt = new Set();  // filer som allerede er meldt som manglende i dette innslaget
  let forhånd = [];       // bilder som lastes i forkant
  let lydBlokkert = false;
  const dempetAvBlokk = new Set(); // video-lag som spiller uten lyd fordi lyd ble nektet

  const posisjon = () => (pauset ? basisPos : basisPos + (performance.now() - basisT) / 1000);
  const indeksFor = p => {
    let i = 0;
    while (i + 1 < starter.length && starter[i + 1] <= p) i++;
    return i;
  };

  // --- Lerretet: 16:9, sentrert, svarte kanter ------------------------------------------
  const tilpass = () => {
    const W = element.clientWidth;
    const H = element.clientHeight;
    if (!W || !H) return;
    const høyde = Math.min(H, W * 9 / 16);
    lerret.style.width = `${høyde * 16 / 9}px`;
    lerret.style.height = `${høyde}px`;
    lerret.style.setProperty('--lerret-h', `${høyde}px`);
  };
  if (window.ResizeObserver) new ResizeObserver(tilpass).observe(element);
  window.addEventListener('resize', tilpass);

  // --- Feil og lyd -------------------------------------------------------------------------
  const meldManglende = (src, slideId) => {
    if (!src || meldt.has(src)) return;
    meldt.add(src);
    onFeil({ kind: 'media-missing', src, ...(slideId && { slideId }), fatal: false });
  };

  const lydNektet = () => {
    if (lydBlokkert) return;
    lydBlokkert = true;
    onLydBlokkert();
  };

  const rampMusikk = mål => {
    clearInterval(rampTimer);
    const fra = musikk.volume;
    let steg = 0;
    rampTimer = setInterval(() => {
      steg++;
      musikk.volume = klem(fra + (mål - fra) * steg / 8, 0, 1);
      if (steg >= 8) clearInterval(rampTimer);
    }, 40);
  };

  // Musikken dempes mens et lydklipp med duck spiller.
  const oppdaterDemping = () => {
    const m = serie?.music;
    if (!m?.src) return;
    const demp = aktivt?.klipp.some(k => k.duck !== false && k.tilstand === 'spiller');
    const mål = klem(demp ? m.duckTo ?? 0.08 : m.volume ?? 0.25, 0, 1);
    if (mål !== musikkMål) { musikkMål = mål; rampMusikk(mål); }
  };

  const spillMusikk = () => musikk.play().catch(err => { if (err?.name === 'NotAllowedError') lydNektet(); });

  const startMusikk = pos => {
    const m = serie.music;
    clearInterval(rampTimer);
    if (!m?.src) { musikk.pause(); musikk.removeAttribute('src'); musikkMål = null; return; }
    if (musikk.getAttribute('src') !== m.src) musikk.src = m.src;
    musikk.currentTime = m.duration > 0 ? pos % m.duration : 0;
    musikkMål = klem(m.volume ?? 0.25, 0, 1);
    musikk.volume = musikkMål;
    spillMusikk();
  };
  musikk.addEventListener('error', () => { if (serie?.music?.src && musikk.getAttribute('src')) meldManglende(serie.music.src); });

  // --- Lag ---------------------------------------------------------------------------------
  const animer = (el, keyframes, D, sp) => {
    const a = el.animate(keyframes, { duration: D * 1000, fill: 'both' });
    a.currentTime = klem(sp, 0, D) * 1000;
    return a;
  };

  const lagLag = (lb, lag, sp) => {
    const D = lb.slide.duration;
    const boks = h('div', { class: ['lag', `lag-${lag.type}`] });
    Object.assign(boks.style, {
      left: `${lag.x ?? 0}%`, top: `${lag.y ?? 0}%`, width: `${lag.w ?? 100}%`,
      height: lag.type === 'text' && lag.h == null ? 'auto' : `${lag.h ?? 100}%`,
    });
    lb.el.append(boks);

    if (lag.type === 'image') {
      const img = h('img', { src: lag.src, alt: lag.alt ?? '', decoding: 'async' });
      img.style.objectFit = lag.fit ?? 'cover';
      // Skjul bildet som ikke lastet, så TV-en ikke viser nettleserens ødelagt-bilde-ikon og alt-teksten.
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; if (!lb.død) meldManglende(lag.src, lb.slide.id); });
      boks.append(img);
      if (lag.motion) lb.animasjoner.push(animer(img, bevegelse(lag.motion, lag, D), D, sp));
    } else if (lag.type === 'video') {
      const el = h('video', { src: lag.src, muted: Boolean(lag.muted), playsinline: true, preload: 'auto' });
      el.style.objectFit = lag.fit ?? 'cover';
      el.volume = klem(lag.volume ?? 1, 0, 1);
      const v = { lag, el, spiller: false, ferdig: false };
      el.addEventListener('error', () => { if (!lb.død) meldManglende(lag.src, lb.slide.id); });
      el.addEventListener('ended', () => {
        if (lb.død || !v.spiller) return;
        if (lag.loop && !pauset) { el.currentTime = lag.trimStart ?? 0; el.play().catch(() => {}); return; }
        v.spiller = false;
        v.ferdig = true; // står på siste bilde
      });
      boks.append(el);
      lb.videoer.push(v);
    } else if (lag.type === 'text') {
      const st = lag.style ?? {};
      boks.style.justifyContent = JUSTERING[lag.valign ?? 'top'];
      boks.style.alignItems = JUSTERING[lag.align ?? 'left'];
      const tekst = h('div', { class: 'lag-tekstboks' }, lag.text);
      Object.assign(tekst.style, {
        fontFamily: FONTER[st.font] ?? FONTER.sans,
        fontSize: hv(st.size ?? 5),
        fontWeight: st.weight === 'bold' ? '700' : '400',
        fontStyle: st.italic ? 'italic' : 'normal',
        color: st.color ?? '#ffffff',
        background: st.background ?? 'transparent',
        padding: hv(st.padding ?? 0),
        borderRadius: hv(st.radius ?? 0),
        lineHeight: String(st.lineHeight ?? 1.25),
        textAlign: lag.align ?? 'left',
        textShadow: st.shadow ?? !st.background ? `0 ${hv(0.15)} ${hv(0.6)} rgba(0,0,0,.9), 0 0 ${hv(1.5)} rgba(0,0,0,.6)` : 'none',
      });
      boks.append(tekst);
    } else if (lag.type === 'shape') {
      Object.assign(boks.style, {
        background: lag.fill ?? 'transparent',
        border: lag.stroke && lag.strokeWidth > 0 ? `${hv(lag.strokeWidth)} solid ${lag.stroke}` : 'none',
        borderRadius: lag.shape === 'ellipse' ? '50%' : hv(lag.radius ?? 0),
      });
    }
    lb.animasjoner.push(animer(boks, synlighet(lag, D), D, sp));
  };

  // Video-lag spiller bare innenfor sitt tidsvindu, fra trimStart + tiden siden laget begynte.
  // Returnerer sekunder til neste gang laget må sjekkes.
  const synkVideo = (lb, v, sp) => {
    const { lag, el } = v;
    const s = lag.start ?? 0;
    const e = lag.end ?? lb.slide.duration;
    if (sp < s) return s - sp;
    if (sp >= e) {
      if (v.spiller) { el.pause(); v.spiller = false; }
      return Infinity;
    }
    if (!v.spiller && !v.ferdig) {
      const trim = lag.trimStart ?? 0;
      const lengde = Math.max(0.1, (lag.duration ?? Infinity) - trim);
      let inni = sp - s;
      if (lag.loop) inni %= lengde;
      if (inni >= lengde) { el.currentTime = trim + lengde - 0.05; v.ferdig = true; return e - sp; }
      el.currentTime = trim + inni;
      v.spiller = true;
      el.play().catch(err => {
        if (lb.død || err?.name !== 'NotAllowedError' || el.muted) return;
        // Lyd nektet: vis videoen uten lyd til første tastetrykk.
        lydNektet();
        el.muted = true;
        dempetAvBlokk.add(v);
        el.play().catch(() => {});
      });
    }
    return e - sp;
  };

  // --- Lydklipp ----------------------------------------------------------------------------
  const lagKlipp = (lb, a, sp) => {
    const start = a.start ?? 0;
    const k = { ...a, start, el: null, tilstand: sp - start > INNHOPP_SLINGRING ? 'hoppet' : 'venter' };
    if (k.tilstand === 'hoppet') return k;
    k.el = h('audio', { src: a.src, preload: 'auto' });
    k.el.addEventListener('playing', () => { if (!lb.død) lb.lydSpilt = true; });
    k.el.addEventListener('ended', () => { if (lb.død) return; k.tilstand = 'ferdig'; oppdaterDemping(); });
    k.el.addEventListener('error', () => {
      if (lb.død) return;
      k.tilstand = 'feil';
      meldManglende(a.src, lb.slide.id);
      oppdaterDemping();
    });
    return k;
  };

  const startKlipp = (lb, k, sp) => {
    k.tilstand = 'spiller';
    const inni = sp - k.start;
    if (inni > 0.05) k.el.currentTime = inni;
    k.el.volume = klem(k.volume ?? 1, 0, 1);
    k.el.play().catch(err => {
      if (lb.død || k.tilstand !== 'spiller' || err?.name !== 'NotAllowedError') return;
      // Opplesningen begynner ikke senere midt i en setning – den hoppes over.
      k.tilstand = 'hoppet';
      lydNektet();
      oppdaterDemping();
    });
  };

  // --- Lysbilder ---------------------------------------------------------------------------
  const stilne = lb => {
    for (const k of lb.klipp) if (k.el && k.tilstand === 'spiller') { k.el.pause(); k.tilstand = 'ferdig'; }
    for (const v of lb.videoer) if (v.spiller) { v.el.pause(); v.spiller = false; }
  };

  const riv = lb => {
    if (!lb || lb.død) return;
    lb.død = true;
    stilne(lb);
    for (const a of lb.animasjoner) a.cancel();
    for (const el of [...lb.klipp.map(k => k.el), ...lb.videoer.map(v => v.el)]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute('src');
      el.load(); // avbryter nedlastingen
    }
    for (const v of lb.videoer) dempetAvBlokk.delete(v);
    lb.el.remove();
  };

  const rapporter = lb => {
    if (lb.rapportert) return;
    lb.rapportert = true;
    onLysbilde({
      slideId: lb.slide.id,
      seconds: Math.round(Math.max(0, lb.slide.duration - lb.startPos) * 10) / 10,
      audioPlayed: lb.lydSpilt,
      item: innslag,
    });
  };

  const forhåndslast = i => {
    const neste = serie.slides[i];
    forhånd = (neste?.layers ?? []).filter(l => l.type === 'image' && l.src).map(l => {
      const img = new Image();
      img.decoding = 'async';
      img.src = l.src;
      return img;
    });
  };

  const visLysbilde = (i, sp) => {
    const slide = serie.slides[i];
    const D = slide.duration;
    const el = h('div', { class: 'lysbilde' });
    el.style.background = slide.background || '#000000';
    lerret.append(el);
    const lb = { indeks: i, slide, el, animasjoner: [], videoer: [], klipp: [], startPos: sp, rapportert: false, lydSpilt: false, død: false, pauset: [] };
    for (const lag of slide.layers ?? []) lagLag(lb, lag, sp);
    if (slide.credit) el.append(h('div', { class: 'lysbilde-kreditering' }, slide.credit));

    // Overgang: det nye lysbildet toner inn over det forrige (eller fra svart ved innhopp).
    const overgang = slide.transition ?? { type: 'fade', duration: 1 };
    const d = overgang.type === 'fade' ? klem(overgang.duration ?? 1, 0, D) : 0;
    if (d > 0) {
      const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d * 1000, fill: 'both', easing: 'ease-in-out' });
      a.currentTime = Math.min(sp, d) * 1000;
      a.onfinish = () => { if (aktivt === lb && forrige) { riv(forrige); forrige = null; } };
      lb.animasjoner.push(a);
    } else if (forrige) { riv(forrige); forrige = null; }

    lb.klipp = (slide.audio ?? []).map(a => lagKlipp(lb, a, sp));
    forhåndslast(i + 1);
    return lb;
  };

  const bytt = (i, p) => {
    const gammel = aktivt;
    if (gammel) {
      if (p >= starter[gammel.indeks] + gammel.slide.duration - 0.05) rapporter(gammel);
      stilne(gammel);
      riv(forrige);
      forrige = gammel;
    }
    aktivt = visLysbilde(i, p - starter[i]);
  };

  // Gjør alt som skal skje ved posisjonen nå, og planlegger neste gang noe skal skje.
  const tikk = () => {
    clearTimeout(timer);
    if (!serie || pauset) return;
    const p = posisjon();
    const i = indeksFor(p);
    if (!aktivt || aktivt.indeks !== i) bytt(i, p);
    const lb = aktivt;
    const sp = p - starter[i];
    const sist = i === serie.slides.length - 1;
    if (sist && sp >= lb.slide.duration - 0.05) rapporter(lb);

    let neste = lb.slide.duration - sp; // til lysbildet er over
    for (const k of lb.klipp) {
      if (k.tilstand !== 'venter') continue;
      if (sp >= k.start - 0.02) startKlipp(lb, k, sp);
      else neste = Math.min(neste, k.start - sp);
    }
    for (const v of lb.videoer) neste = Math.min(neste, synkVideo(lb, v, sp));
    oppdaterDemping();
    if (sist && lb.rapportert) return;
    timer = setTimeout(tikk, klem(neste * 1000, 20, MAKS_VENT_MS));
  };

  const rivAlt = () => {
    clearTimeout(timer);
    clearInterval(rampTimer);
    // Siste lysbilde er som regel akkurat ferdig når kanalvelgeren går videre.
    if (aktivt && serie && posisjon() >= starter[aktivt.indeks] + aktivt.slide.duration - 0.5) rapporter(aktivt);
    riv(forrige);
    riv(aktivt);
    forrige = aktivt = null;
    forhånd = [];
    musikk.pause();
  };

  return {
    start: (item, offset = 0) => {
      rivAlt();
      innslag = item;
      serie = item.slideshow;
      starter = lysbildeStarter(serie.slides ?? []);
      meldt = new Set();
      pauset = false;
      if (!starter.length) { serie = null; return; }
      const total = starter.at(-1) + serie.slides.at(-1).duration;
      basisPos = klem(offset, 0, total);
      basisT = performance.now();
      tilpass();
      startMusikk(basisPos);
      tikk();
    },
    stopp: () => {
      rivAlt();
      innslag = serie = null;
      pauset = false;
      musikk.removeAttribute('src');
      musikk.load();
      musikkMål = null;
    },
    pause: () => {
      if (pauset) return;
      basisPos = posisjon();
      pauset = true;
      clearTimeout(timer);
      if (!serie) return;
      for (const lb of [forrige, aktivt]) {
        if (!lb || lb.død) continue;
        lb.pauset = lb.animasjoner.filter(a => a.playState === 'running');
        lb.pauset.forEach(a => a.pause());
      }
      for (const k of aktivt?.klipp ?? []) if (k.tilstand === 'spiller') k.el.pause();
      for (const v of aktivt?.videoer ?? []) if (v.spiller) v.el.pause();
      musikk.pause();
      clearInterval(rampTimer);
    },
    fortsett: () => {
      if (!pauset) return;
      basisT = performance.now();
      pauset = false;
      if (!serie) return;
      for (const lb of [forrige, aktivt]) {
        if (!lb || lb.død) continue;
        lb.pauset.forEach(a => a.play());
        lb.pauset = [];
      }
      for (const k of aktivt?.klipp ?? []) if (k.tilstand === 'spiller') k.el.play().catch(() => {});
      for (const v of aktivt?.videoer ?? []) if (v.spiller) v.el.play().catch(() => {});
      if (musikk.getAttribute('src')) {
        if (musikkMål != null) musikk.volume = musikkMål;
        spillMusikk();
      }
      tikk();
    },
    låsOppLyd: () => {
      if (!lydBlokkert) return;
      lydBlokkert = false;
      for (const v of dempetAvBlokk) v.el.muted = Boolean(v.lag.muted);
      dempetAvBlokk.clear();
      if (serie && !pauset && musikk.getAttribute('src') && musikk.paused) spillMusikk();
    },
  };
};

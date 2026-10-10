#!/usr/bin/env python3
"""Generates the studio's demo library: music and sound effects (WAV) and meaningless demo images (SVG).

Everything is synthesised here, so the project needs no ffmpeg, text-to-speech or downloads.
Run:  npm run media -w reel-studio
"""
import math
import random
import struct
import wave
from array import array
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent / "library"
SR = 22050  # Hz, mono – holder filene små
TAU = 2 * math.pi


def hz(note: str) -> float:
    """'A4' → 440.0, 'C#5' → …"""
    navn = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    n = navn[note[0]]
    rest = note[1:]
    if rest.startswith("#"):
        n += 1
        rest = rest[1:]
    elif rest.startswith("b"):
        n -= 1
        rest = rest[1:]
    return 440.0 * 2 ** ((n + 12 * (int(rest) - 4)) / 12)


class Spor:
    def __init__(self, sekunder: float):
        self.n = int(sekunder * SR)
        self.buf = array("f", [0.0]) * self.n

    def tone(self, t0, lengde, f, amp=0.2, attack=0.01, release=0.3, partials=((1, 1.0),), decay=None, loop=True):
        """Legger inn en tone. decay = eksponentiell nedklinging (s); loop = brett halen rundt (sømløs løkke)."""
        start = int(t0 * SR)
        total = int((lengde + release) * SR)
        a = max(1, int(attack * SR))
        l = int(lengde * SR)
        r = max(1, int(release * SR))
        ws = [(TAU * f * k / SR, w) for k, w in partials]
        norm = sum(w for _, w in ws)
        for i in range(total):
            if i < a:
                env = i / a
            elif i < l:
                env = 1.0
            else:
                env = max(0.0, 1 - (i - l) / r)
            if decay:
                env *= math.exp(-i / (decay * SR))
            s = sum(w * math.sin(dw * i) for dw, w in ws) / norm
            j = start + i
            if j >= self.n:
                if not loop:
                    break
                j %= self.n
            self.buf[j] += amp * env * s

    def støy(self, t0, lengde, amp=0.1, glatt=0.9, seed=1):
        rnd = random.Random(seed)
        start = int(t0 * SR)
        total = int(lengde * SR)
        y = 0.0
        for i in range(total):
            y = glatt * y + (1 - glatt) * (rnd.random() * 2 - 1)
            env = math.sin(math.pi * i / total) ** 2
            j = start + i
            if j < self.n:
                self.buf[j] += amp * env * y * 4

    def kvitter(self, t0, lengde, f0, f1, amp=0.2):
        """Fuglekvitter: rask frekvenssveip med vibrato."""
        start = int(t0 * SR)
        total = int(lengde * SR)
        fase = 0.0
        for i in range(total):
            x = i / total
            f = f0 + (f1 - f0) * x + 180 * math.sin(TAU * 38 * i / SR)
            fase += TAU * f / SR
            env = math.sin(math.pi * x) ** 1.5
            j = start + i
            if j < self.n:
                self.buf[j] += amp * env * math.sin(fase)

    def lagre(self, sti: Path, inn=0.0, ut=0.0):
        topp = max(1e-9, max(abs(v) for v in self.buf))
        k = 0.89 / topp
        data = array("h")
        for i, v in enumerate(self.buf):
            g = 1.0
            if inn and i < inn * SR:
                g = i / (inn * SR)
            if ut and i > self.n - ut * SR:
                g = (self.n - i) / (ut * SR)
            data.append(int(max(-1, min(1, v * k * g)) * 32767))
        sti.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(sti), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(data.tobytes())
        print(f"{sti.relative_to(ROT)}  {self.n / SR:.2f} s")


PAD = ((1, 1.0), (2, 0.35), (3, 0.12), (1.003, 0.5))
KLOKKE = ((1, 1.0), (2.76, 0.45), (5.4, 0.2), (8.9, 0.08))
PLUKK = ((1, 1.0), (2, 0.5), (3, 0.25), (4, 0.12))


def musikk_fjord():
    """Rolige flater, Am–F–C–G, 4 s per akkord, 32 s løkke."""
    s = Spor(32)
    akkorder = [("A2", "A3", "C4", "E4"), ("F2", "F3", "A3", "C4"), ("C3", "G3", "C4", "E4"), ("G2", "G3", "B3", "D4")]
    for runde in range(2):
        for i, ak in enumerate(akkorder):
            t = runde * 16 + i * 4
            for n in ak:
                s.tone(t, 3.6, hz(n), amp=0.09, attack=1.2, release=1.6, partials=PAD)
            # spredte klokketoner oppå
            for k, n in enumerate(ak[1:]):
                s.tone(t + 0.5 + k * 1.1 + runde * 0.3, 0.1, hz(n) * 2, amp=0.06, attack=0.005, release=2.5, partials=KLOKKE, decay=1.2)
    return s


def musikk_morgen():
    """Lett plukkemelodi i C, 100 bpm, C–G–Am–F, 19,2 s løkke."""
    takt = 60 / 100 * 4
    s = Spor(takt * 8)
    akkorder = [("C3", "C4", "E4", "G4"), ("G2", "B3", "D4", "G4"), ("A2", "A3", "C4", "E4"), ("F2", "A3", "C4", "F4")]
    åttendel = takt / 8
    mønster = [1, 2, 3, 2, 1, 2, 3, 2]
    for runde in range(2):
        for i, ak in enumerate(akkorder):
            t = (runde * 4 + i) * takt
            s.tone(t, takt * 0.9, hz(ak[0]), amp=0.16, attack=0.02, release=0.4, partials=PLUKK, decay=1.5)
            for k, m in enumerate(mønster):
                s.tone(t + k * åttendel, 0.05, hz(ak[m]), amp=0.08, attack=0.004, release=0.5, partials=PLUKK, decay=0.35)
    melodi = ["E5", "D5", "C5", "D5", "E5", "G5", "E5", "D5", "C5", "B4", "A4", "C5", "D5", "C5", "A4", "G4"]
    for k, n in enumerate(melodi):
        s.tone(k * takt / 2 + takt / 4, 0.1, hz(n), amp=0.05, attack=0.005, release=1.2, partials=KLOKKE, decay=0.6)
    return s


def musikk_hage():
    """Spilledåse i 3/4, 30 s løkke."""
    slag = 0.625  # 96 bpm
    s = Spor(slag * 48)
    melodi = ["G4", "C5", "E5", "D5", "C5", "A4", "F4", "A4", "C5", "B4", "G4", "B4",
              "C5", "E5", "G5", "F5", "E5", "D5", "C5", "B4", "D5", "C5", "E5", "C5"]
    bass = ["C3", "F3", "G3", "C3", "C3", "F3", "G3", "C3"]
    for i, n in enumerate(melodi):
        s.tone(i * slag * 2, 0.08, hz(n), amp=0.12, attack=0.003, release=2.2, partials=KLOKKE, decay=0.9)
    for i, b in enumerate(bass):
        t = i * slag * 6
        s.tone(t, slag * 5, hz(b), amp=0.07, attack=0.4, release=1.0, partials=PAD)
        for k in (2, 4):
            s.tone(t + k * slag, 0.06, hz(b) * 4, amp=0.03, attack=0.003, release=0.6, partials=KLOKKE, decay=0.3)
    return s


def lyd_klokke():
    s = Spor(3.0)
    for k, n in enumerate(["E5", "G5", "C6"]):
        s.tone(0.05 + k * 0.28, 0.05, hz(n), amp=0.3, attack=0.003, release=2.2, partials=KLOKKE, decay=0.8, loop=False)
    return s


def lyd_dingdong():
    s = Spor(2.6)
    s.tone(0.05, 0.05, hz("E5"), amp=0.35, attack=0.003, release=1.4, partials=KLOKKE, decay=0.7, loop=False)
    s.tone(0.75, 0.05, hz("C5"), amp=0.35, attack=0.003, release=1.8, partials=KLOKKE, decay=0.9, loop=False)
    return s


def lyd_fugler():
    s = Spor(4.0)
    rnd = random.Random(7)
    t = 0.1
    while t < 3.6:
        f0 = rnd.uniform(2600, 3800)
        lengde = rnd.uniform(0.06, 0.16)
        s.kvitter(t, lengde, f0, f0 + rnd.uniform(-900, 900), amp=0.25)
        t += lengde + rnd.choice([0.03, 0.05, 0.08, 0.3, 0.45])
    return s


def lyd_bølger():
    s = Spor(5.0)
    s.støy(0.0, 2.6, amp=0.4, glatt=0.96, seed=3)
    s.støy(2.2, 2.8, amp=0.35, glatt=0.97, seed=4)
    return s


# --- Bilder (SVG, 1920×1080) ---------------------------------------------------------------

def svg(innhold: str, defs: str = "") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080"><defs>{defs}</defs>{innhold}</svg>'


def fjell(rnd, y0, topp, farge, n=9, opacity=1.0):
    pkt = [(0, 1080), (0, y0)]
    for i in range(1, n + 1):
        x = i * 1920 / n
        pkt.append((x - 1920 / n / 2, y0 - rnd.uniform(topp * 0.5, topp)))
        pkt.append((x, y0 - rnd.uniform(0, topp * 0.3)))
    pkt.append((1920, 1080))
    d = " ".join(f"{x:.0f},{y:.0f}" for x, y in pkt)
    return f'<polygon points="{d}" fill="{farge}" opacity="{opacity}"/>'


def bilde_fjord():
    rnd = random.Random(1)
    defs = ('<linearGradient id="himmel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb3e0"/><stop offset="1" stop-color="#f3d9b1"/></linearGradient>'
            '<linearGradient id="vann" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a7fa8"/><stop offset="1" stop-color="#1d3d5c"/></linearGradient>')
    deler = ['<rect width="1920" height="1080" fill="url(#himmel)"/>', '<circle cx="1420" cy="300" r="90" fill="#fff6dc" opacity=".9"/>',
             fjell(rnd, 690, 380, "#8aa4bf"), fjell(rnd, 720, 300, "#5d7d99"), fjell(rnd, 740, 200, "#3d5d76"),
             '<rect y="730" width="1920" height="350" fill="url(#vann)"/>']
    for i in range(40):
        y = rnd.uniform(760, 1060)
        x = rnd.uniform(0, 1800)
        deler.append(f'<rect x="{x:.0f}" y="{y:.0f}" width="{rnd.uniform(60, 220):.0f}" height="3" fill="#cfe3f2" opacity="{rnd.uniform(.15, .45):.2f}"/>')
    deler.append('<g transform="translate(980 805)"><path d="M-60 0 L60 0 L42 22 L-42 22 Z" fill="#a33b2b"/><rect x="-4" y="-70" width="6" height="70" fill="#3b2a1e"/><path d="M2 -66 L48 -8 L2 -8 Z" fill="#f5f0e6"/></g>')
    return svg("".join(deler), defs)


def bilde_nordlys():
    rnd = random.Random(2)
    defs = ('<linearGradient id="natt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050b1f"/><stop offset="1" stop-color="#14304a"/></linearGradient>'
            '<linearGradient id="lys" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6dffb0" stop-opacity="0"/><stop offset=".5" stop-color="#4dffa0" stop-opacity=".55"/><stop offset="1" stop-color="#2bd4a0" stop-opacity="0"/></linearGradient>'
            '<filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>')
    deler = ['<rect width="1920" height="1080" fill="url(#natt)"/>']
    for _ in range(260):
        deler.append(f'<circle cx="{rnd.uniform(0, 1920):.0f}" cy="{rnd.uniform(0, 760):.0f}" r="{rnd.uniform(.8, 2.6):.1f}" fill="#fff" opacity="{rnd.uniform(.3, 1):.2f}"/>')
    for k in range(3):
        y = 260 + k * 90
        d = f"M-100 {y} " + " ".join(f"Q {x - 120} {y + rnd.uniform(-160, 160):.0f} {x} {y + rnd.uniform(-60, 60):.0f}" for x in range(200, 2200, 300))
        deler.append(f'<path d="{d} L2100 {y + 260} L-100 {y + 260} Z" fill="url(#lys)" filter="url(#blur)" opacity="{.9 - k * .2:.1f}"/>')
    deler.append(fjell(rnd, 900, 260, "#0a1626"))
    deler.append('<rect y="900" width="1920" height="180" fill="#0d1b2c"/>')
    deler.append('<g transform="translate(560 900)"><rect x="-70" y="-80" width="140" height="80" fill="#3a1f17"/><path d="M-90 -80 L0 -150 L90 -80 Z" fill="#26150f"/><rect x="-20" y="-55" width="34" height="30" fill="#ffcf6b"/></g>')
    return svg("".join(deler), defs)


def bilde_solnedgang():
    rnd = random.Random(3)
    defs = ('<linearGradient id="kveld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1e4f"/><stop offset=".45" stop-color="#d4566b"/><stop offset=".62" stop-color="#ffb35c"/></linearGradient>'
            '<linearGradient id="hav" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e48a5a"/><stop offset="1" stop-color="#2a2340"/></linearGradient>'
            '<radialGradient id="sol"><stop offset="0" stop-color="#fff2c4"/><stop offset=".6" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>')
    deler = ['<rect width="1920" height="1080" fill="url(#kveld)"/>', '<circle cx="960" cy="640" r="260" fill="url(#sol)"/>',
             '<rect y="660" width="1920" height="420" fill="url(#hav)"/>']
    for i in range(30):
        w = 400 - i * 11
        deler.append(f'<rect x="{960 - w / 2 + rnd.uniform(-30, 30):.0f}" y="{670 + i * 13}" width="{w:.0f}" height="4" fill="#ffe2a8" opacity="{.7 - i * .02:.2f}"/>')
    deler.append('<path d="M0 760 L260 700 L420 720 L560 760 Z" fill="#1c1630"/><path d="M1500 770 L1700 690 L1920 720 L1920 770 Z" fill="#1c1630"/>')
    for k in range(5):
        x, y = 600 + k * 70, 300 + (k % 2) * 30
        deler.append(f'<path d="M{x} {y} q12 -10 24 0 q12 -10 24 0" stroke="#2b1e4f" stroke-width="4" fill="none"/>')
    return svg("".join(deler), defs)


def bilde_morgen():
    defs = ('<linearGradient id="vegg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe9cf"/><stop offset="1" stop-color="#f1c99b"/></linearGradient>'
            '<radialGradient id="glød" cx=".75" cy=".3" r=".6"><stop offset="0" stop-color="#fff8e6"/><stop offset="1" stop-color="#fff8e6" stop-opacity="0"/></radialGradient>')
    deler = ['<rect width="1920" height="1080" fill="url(#vegg)"/>', '<rect width="1920" height="1080" fill="url(#glød)"/>',
             '<g transform="translate(1180 140)"><rect width="560" height="460" rx="12" fill="#cfe8f5" stroke="#f8f3ea" stroke-width="22"/><rect x="269" width="22" height="460" fill="#f8f3ea"/><rect y="219" width="560" height="22" fill="#f8f3ea"/>'
             '<circle cx="420" cy="120" r="56" fill="#ffe08a"/><path d="M0 380 Q140 300 280 360 T560 340 V460 H0 Z" fill="#8fc49a"/></g>',
             '<rect y="820" width="1920" height="260" fill="#a8774f"/><rect y="820" width="1920" height="18" fill="#c4935f"/>',
             '<g transform="translate(560 640)"><ellipse cx="120" cy="200" rx="200" ry="34" fill="#efe6da"/><path d="M0 20 H240 V150 Q240 200 190 200 H50 Q0 200 0 150 Z" fill="#2f6d8f"/>'
             '<path d="M240 50 Q320 50 320 110 Q320 170 240 165" stroke="#2f6d8f" stroke-width="26" fill="none"/><ellipse cx="120" cy="20" rx="120" ry="16" fill="#5b3a26"/>'
             '<path d="M70 -20 q-20 -40 0 -80 q20 -40 0 -80" stroke="#fff" stroke-width="8" fill="none" opacity=".55" stroke-linecap="round"/>'
             '<path d="M150 -10 q-20 -40 0 -80 q20 -40 0 -80" stroke="#fff" stroke-width="8" fill="none" opacity=".45" stroke-linecap="round"/></g>',
             '<g transform="translate(1020 760)"><rect width="260" height="60" rx="6" fill="#d0533f"/><rect y="-50" width="240" height="50" rx="6" fill="#3f7d5a"/><rect x="10" y="-96" width="220" height="46" rx="6" fill="#e2b04a"/></g>']
    return svg("".join(deler), defs)


def bilde_hage():
    rnd = random.Random(5)
    defs = ('<linearGradient id="dag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3f0"/><stop offset="1" stop-color="#e8f6fb"/></linearGradient>')
    deler = ['<rect width="1920" height="1080" fill="url(#dag)"/>', '<circle cx="300" cy="180" r="80" fill="#fff3b0"/>',
             '<path d="M0 640 Q480 560 960 620 T1920 600 V1080 H0 Z" fill="#7fbf6a"/>', '<path d="M0 760 Q600 690 1200 740 T1920 720 V1080 H0 Z" fill="#5ea552"/>']
    # epletre
    deler.append('<g transform="translate(1380 720)"><rect x="-30" y="-240" width="60" height="260" rx="20" fill="#6b4a2f"/>'
                 '<circle cx="0" cy="-330" r="190" fill="#3f8a3f"/><circle cx="-140" cy="-260" r="120" fill="#4b9a46"/><circle cx="150" cy="-270" r="130" fill="#459442"/>')
    for _ in range(26):
        a, r = rnd.uniform(0, TAU), rnd.uniform(20, 210)
        deler.append(f'<circle cx="{math.cos(a) * r:.0f}" cy="{-310 + math.sin(a) * r * .7:.0f}" r="16" fill="#d8342c"/>')
    deler.append('</g>')
    # blomster
    farger = ["#f26b8a", "#ffd23f", "#ffffff", "#a77bf3", "#ff8c42"]
    for _ in range(90):
        x, y = rnd.uniform(0, 1920), rnd.uniform(800, 1060)
        f = rnd.choice(farger)
        deler.append(f'<g transform="translate({x:.0f} {y:.0f})"><rect x="-2" y="0" width="4" height="40" fill="#3f7d3a"/>' +
                     "".join(f'<circle cx="{math.cos(k * TAU / 5) * 11:.1f}" cy="{math.sin(k * TAU / 5) * 11:.1f}" r="9" fill="{f}"/>' for k in range(5)) +
                     '<circle r="7" fill="#f5b700"/></g>')
    # hus
    deler.append('<g transform="translate(380 700)"><rect x="-160" y="-200" width="320" height="200" fill="#c0392b"/><path d="M-190 -200 L0 -330 L190 -200 Z" fill="#3b3b3b"/>'
                 '<rect x="-110" y="-150" width="70" height="60" fill="#fdf2d0" stroke="#fff" stroke-width="8"/><rect x="40" y="-150" width="70" height="60" fill="#fdf2d0" stroke="#fff" stroke-width="8"/>'
                 '<rect x="-30" y="-90" width="60" height="90" fill="#5b3a26"/></g>')
    return svg("".join(deler), defs)



def bilde_former(seed, figur, bakgrunn, farger):
    """Meningsløse abstrakte demobilder: tilfeldige figurer på en flate."""
    rnd = random.Random(seed)
    deler = [f'<rect width="1920" height="1080" fill="{bakgrunn}"/>']
    for _ in range(26):
        x, y, r = rnd.uniform(0, 1920), rnd.uniform(0, 1080), rnd.uniform(40, 220)
        f = rnd.choice(farger)
        o = rnd.uniform(.35, .9)
        if figur == "sirkel":
            deler.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.0f}" fill="{f}" opacity="{o:.2f}"/>')
        elif figur == "trekant":
            a = rnd.uniform(0, TAU)
            p = " ".join(f"{x + r * math.cos(a + k * TAU / 3):.0f},{y + r * math.sin(a + k * TAU / 3):.0f}" for k in range(3))
            deler.append(f'<polygon points="{p}" fill="{f}" opacity="{o:.2f}"/>')
        else:
            deler.append(f'<rect x="{x - r:.0f}" y="0" width="{r / 2:.0f}" height="1080" fill="{f}" opacity="{o * .6:.2f}" transform="rotate({rnd.uniform(-20, 20):.0f} {x:.0f} 540)"/>')
    return svg("".join(deler))


if __name__ == "__main__":
    for navn, lyd in [("music-calm", musikk_fjord), ("music-pluck", musikk_morgen), ("music-box", musikk_hage)]:
        lyd().lagre(ROT / "audio" / f"{navn}.wav")
    lyd_klokke().lagre(ROT / "audio" / "chime.wav", ut=0.3)
    lyd_dingdong().lagre(ROT / "audio" / "ding-dong.wav", ut=0.3)
    lyd_fugler().lagre(ROT / "audio" / "birds.wav", ut=0.2)
    lyd_bølger().lagre(ROT / "audio" / "waves.wav", inn=0.3, ut=0.5)
    bilder = [("fjord", bilde_fjord), ("aurora", bilde_nordlys), ("sunset", bilde_solnedgang), ("morning", bilde_morgen), ("garden", bilde_hage),
              ("shapes-1", lambda: bilde_former(11, "sirkel", "#1b1f3b", ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff"])),
              ("shapes-2", lambda: bilde_former(12, "trekant", "#f7f1e3", ["#ff793f", "#706fd3", "#33d9b2", "#34ace0"])),
              ("stripes", lambda: bilde_former(13, "stripe", "#0d0d0d", ["#e84393", "#00cec9", "#fdcb6e"]))]
    (ROT / "images").mkdir(parents=True, exist_ok=True)
    for navn, f in bilder:
        sti = ROT / "images" / f"{navn}.svg"
        sti.write_text(f(), encoding="utf-8")
        print(sti.relative_to(ROT))

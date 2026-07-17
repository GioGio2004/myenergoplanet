"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
// Import core + plugin from the SAME build (dist) — mixing the ESM core with
// the plugin subpath can give two gsap instances under some bundlers, which
// crashes with "cannot read _gsap". One build = one instance.
import { gsap } from "gsap/dist/gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// ─── EnerGo landing — game lobby ─────────────────────────────────────────────
// Minimal type-driven page (noth.in-inspired): huge headline, marquee, list of
// games with a cursor-following preview image, GSAP everywhere. Palette is
// white + greens only (no HUD orange here — this page has its own skin).

const GAMES = [
  {
    id: "01",
    title: "ENERGO PLANET",
    tag: "Third-person island explorer",
    desc: "The island is being rebuilt — the cyber courier returns soon.",
    href: null,
    img: "/landing/energoplanet.jpg",
    live: false,
  },
  {
    id: "02",
    title: "BLACKOUT",
    tag: "PvP arena shooter",
    desc: "SCAR-H in hand: fight your friends until their lights go out. Full touch controls on phones.",
    href: "/lobby",
    img: "/landing/training-ground.jpg",
    live: true,
  },
  {
    id: "03",
    title: "ENERGO STRATEGY",
    tag: "Power the whole of Georgia",
    desc: "Build the nation's grid region by region. Solar, wind, hydro — every megawatt counts.",
    href: null,
    img: null,
    live: false,
  },
] as const;

const MARQUEE = "PLAY · LEARN · BUILD · ENERGY · GEORGIA · ";

// Signed-in chip fed by CONVEX (not Clerk) — proves the full auth round-trip:
// Clerk JWT → Convex identity → users row. Also ensures the row exists (in
// case the Clerk webhook isn't configured) and beats presence every 30 s.
function ProfileChip() {
  const profile = useQuery(api.users.current);
  const ensure = useMutation(api.users.ensureUser);
  const beat = useMutation(api.users.heartbeat);
  useEffect(() => {
    ensure().catch(() => {});
    const t = setInterval(() => {
      beat().catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [ensure, beat]);
  if (!profile || profile.externalId === "demo_guest") return null;
  const handle = "username" in profile && profile.username ? profile.username : profile.name;
  return <span className="profile-chip">@{handle}</span>;
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // The page scrolls inside the root div (globals.css pins body overflow for
    // the games). Pass the ELEMENT as ScrollTrigger's scroller — a ".landing"
    // selector string would be scoped by gsap.context to the root's
    // descendants and resolve to nothing.
    const scrollerEl = root.current;

    const ctx = gsap.context(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return; // static page for reduced-motion users

      // 1. Hero headline: characters rise in with stagger
      gsap.fromTo(
        ".hero-char",
        { yPercent: 120, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.05, ease: "power4.out", stagger: 0.035, delay: 0.15 },
      );
      gsap.fromTo(
        ".hero-sub",
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.9, ease: "power3.out", delay: 0.75 },
      );
      gsap.fromTo(
        ".nav-item",
        { y: -18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", stagger: 0.08, delay: 0.3 },
      );

      // 2. Background blobs drift forever
      gsap.to(".blob-a", { xPercent: 18, yPercent: -12, duration: 16, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to(".blob-b", { xPercent: -14, yPercent: 14, duration: 20, yoyo: true, repeat: -1, ease: "sine.inOut" });

      // 3. Marquee — two copies, endless scroll
      gsap.to(".marquee-track", { xPercent: -50, duration: 22, repeat: -1, ease: "none" });

      // 4. Game rows reveal on scroll
      gsap.utils.toArray<HTMLElement>(".game-row").forEach((row, i) => {
        gsap.fromTo(
          row,
          { y: 70, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            ease: "power3.out",
            delay: i * 0.06,
            scrollTrigger: { trigger: row, start: "top 88%", scroller: scrollerEl },
          },
        );
      });

      // 5. About + footer reveals
      gsap.fromTo(
        ".about-line",
        { y: 40, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.8, ease: "power3.out", stagger: 0.12,
          scrollTrigger: { trigger: ".about", start: "top 80%", scroller: scrollerEl },
        },
      );
      gsap.fromTo(
        ".footer-cta",
        { scale: 0.92, opacity: 0 },
        {
          scale: 1, opacity: 1, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: ".footer", start: "top 85%", scroller: scrollerEl },
        },
      );

      // 6. Cursor-following game preview (desktop pointers only)
      if (window.matchMedia("(pointer: fine)").matches) {
        const xTo = gsap.quickTo(previewRef.current, "x", { duration: 0.45, ease: "power3.out" });
        const yTo = gsap.quickTo(previewRef.current, "y", { duration: 0.45, ease: "power3.out" });
        const onMove = (e: MouseEvent) => {
          xTo(e.clientX + 28);
          yTo(e.clientY - 110);
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
      }
    }, root);

    return () => ctx.revert();
  }, []);

  // Hover handlers for the floating preview
  const showPreview = (img: string | null) => {
    const el = previewRef.current;
    const im = previewImgRef.current;
    if (!el || !im) return;
    if (img) {
      im.src = img;
      gsap.to(el, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "power3.out" });
    } else {
      gsap.to(el, { autoAlpha: 0, scale: 0.9, duration: 0.25, ease: "power3.in" });
    }
  };

  const heroLine1 = "PLAY THE";
  const heroLine2 = "FUTURE";

  return (
    <div ref={root} className="landing">
      <style>{CSS}</style>

      {/* drifting background blobs */}
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="grain" />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-item logo">
          ENERGO<span>LAB</span>
        </div>
        <div className="nav-item nav-right">
          <span className="dot" /> GEORGIA · {new Date().getFullYear()}
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="nav-auth-btn">SIGN IN</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="nav-auth-btn nav-auth-btn-solid">SIGN UP</button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <ProfileChip />
            <UserButton />
          </Show>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header className="hero">
        <h1 className="hero-title" aria-label={`${heroLine1} ${heroLine2}`}>
          <span className="hero-line">
            {heroLine1.split("").map((c, i) => (
              <span className="hero-char" key={`a${i}`}>
                {c === " " ? " " : c}
              </span>
            ))}
          </span>
          <span className="hero-line hero-line-accent">
            {heroLine2.split("").map((c, i) => (
              <span className="hero-char" key={`b${i}`}>
                {c}
              </span>
            ))}
          </span>
        </h1>
        <p className="hero-sub">
          Browser games about energy, built in Georgia. No installs — pick one and play.
        </p>
        <div className="hero-sub scroll-cue">SCROLL ↓</div>
      </header>

      {/* ── Marquee ─────────────────────────────────────────────────────── */}
      <div className="marquee" aria-hidden>
        <div className="marquee-track">
          <span>{MARQUEE.repeat(4)}</span>
          <span>{MARQUEE.repeat(4)}</span>
        </div>
      </div>

      {/* ── Games ───────────────────────────────────────────────────────── */}
      <main className="games" onMouseLeave={() => showPreview(null)}>
        <div className="games-label">SELECT GAME</div>
        {GAMES.map((g) =>
          g.live && g.href ? (
            <Link
              key={g.id}
              href={g.href}
              className="game-row"
              onMouseEnter={() => showPreview(g.img)}
              onMouseLeave={() => showPreview(null)}
            >
              <span className="game-id">{g.id}</span>
              <span className="game-main">
                <span className="game-title">{g.title}</span>
                <span className="game-tag">{g.tag}</span>
              </span>
              {g.img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="game-thumb" src={g.img} alt={g.title} loading="lazy" />
              )}
              <span className="game-desc">{g.desc}</span>
              <span className="game-cta">PLAY&nbsp;→</span>
            </Link>
          ) : (
            <div key={g.id} className="game-row locked">
              <span className="game-id">{g.id}</span>
              <span className="game-main">
                <span className="game-title">{g.title}</span>
                <span className="game-tag">{g.tag}</span>
              </span>
              <span className="game-desc">{g.desc}</span>
              <span className="game-cta soon">SOON</span>
            </div>
          ),
        )}
      </main>

      {/* ── About ───────────────────────────────────────────────────────── */}
      <section className="about">
        <p className="about-line">
          EnerGo Lab is a tiny game studio with a big question — <em>what powers a country?</em>
        </p>
        <p className="about-line">
          We build playable answers: explorers, shooters and strategy games about Georgia&apos;s
          energy future. Everything runs in the browser, on your phone too.
        </p>
        <div className="about-stats about-line">
          <div>
            <b>{GAMES.filter((g) => g.live).length}</b>
            <i>playable now</i>
          </div>
          <div>
            <b>{GAMES.length}</b>
            <i>games total</i>
          </div>
          <div>
            <b>0</b>
            <i>installs needed</i>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="footer">
        <Link href="/game-simulation" className="footer-cta">
          START&nbsp;PLAYING
        </Link>
        <div className="footer-row">
          <span>ENERGOLAB © {new Date().getFullYear()}</span>
          <span>TBILISI, GEORGIA</span>
        </div>
      </footer>

      {/* cursor-following preview (desktop) */}
      <div className="preview" ref={previewRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={previewImgRef} alt="" />
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const CSS = `
.landing {
  --paper: #f2f7f0;
  --ink: #0b1f12;
  --g-900: #0f3d24;
  --g-700: #1b5e3b;
  --g-500: #3f915f;
  --g-300: #9ed4ae;
  --g-100: #ddeede;
  position: relative;
  min-height: 100dvh;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-geist-sans, system-ui), 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  overflow-x: hidden;
  overflow-y: auto;
  height: 100dvh;
}
.landing::selection, .landing *::selection { background: var(--g-300); }

/* background */
.blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: 0.5; pointer-events: none; z-index: 0; }
.blob-a { width: 55vw; height: 55vw; background: var(--g-300); top: -18vw; right: -14vw; }
.blob-b { width: 44vw; height: 44vw; background: var(--g-100); bottom: -12vw; left: -10vw; }
.grain { position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E"); }

.landing > nav, .landing > header, .landing > main, .landing > section, .landing > footer, .marquee { position: relative; z-index: 2; }

/* nav */
.nav { display: flex; justify-content: space-between; align-items: center; padding: 26px clamp(20px, 4vw, 56px); }
.logo { font-weight: 800; letter-spacing: 0.06em; font-size: 17px; color: var(--g-900); }
.logo span { color: var(--g-500); }
.nav-right { display: flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 0.22em; color: var(--g-700); }
.nav-auth-btn { margin-left: 10px; padding: 8px 14px; font: inherit; font-size: 11px; letter-spacing: 0.22em; color: var(--g-700); background: transparent; border: 1px solid var(--g-700); border-radius: 999px; cursor: pointer; transition: color 0.2s, background 0.2s; }
.nav-auth-btn:hover { color: #fff; border-color: #fff; }
.nav-auth-btn-solid { color: #0a0f0a; background: var(--g-700); }
.profile-chip { margin: 0 10px; padding: 7px 12px; font-size: 11px; letter-spacing: 0.16em; color: var(--g-900); background: var(--g-100); border: 1px solid var(--g-300); border-radius: 999px; font-weight: 700; }
.nav-auth-btn-solid:hover { color: #0a0f0a; background: #fff; border-color: #fff; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--g-500); box-shadow: 0 0 0 4px rgba(63,145,95,0.18); }

/* hero */
.hero { padding: clamp(40px, 9vh, 110px) clamp(20px, 4vw, 56px) clamp(30px, 6vh, 70px); }
.hero-title { margin: 0; line-height: 0.92; font-weight: 900; letter-spacing: -0.02em;
  font-size: clamp(56px, 13.5vw, 190px); color: var(--g-900); text-transform: uppercase; }
.hero-line { display: block; overflow: hidden; }
.hero-line-accent { color: var(--g-500); -webkit-text-stroke: 0; }
.hero-char { display: inline-block; will-change: transform; }
.hero-sub { margin-top: 26px; max-width: 460px; font-size: clamp(15px, 1.6vw, 19px); line-height: 1.55; color: var(--g-700); }
.scroll-cue { letter-spacing: 0.3em; font-size: 11px; margin-top: 34px; color: var(--g-500); }

/* marquee */
.marquee { border-top: 1.5px solid var(--g-900); border-bottom: 1.5px solid var(--g-900);
  background: var(--g-900); color: var(--g-100); overflow: hidden; white-space: nowrap; }
.marquee-track { display: inline-flex; padding: 12px 0; font-weight: 700; letter-spacing: 0.28em; font-size: 13px; will-change: transform; }
.marquee-track span { padding-right: 2em; }

/* games list */
.games { padding: clamp(48px, 8vh, 90px) clamp(20px, 4vw, 56px); }
.games-label { font-size: 12px; letter-spacing: 0.32em; color: var(--g-500); margin-bottom: 18px; font-weight: 700; }
.game-row { position: relative; display: grid; grid-template-columns: 64px 1fr auto; align-items: center;
  gap: 18px; padding: clamp(22px, 3.4vh, 34px) 8px; border-top: 1.5px solid rgba(15, 61, 36, 0.25);
  text-decoration: none; color: var(--ink); transition: background 0.25s ease, padding-left 0.35s ease; }
.game-row:last-of-type { border-bottom: 1.5px solid rgba(15, 61, 36, 0.25); }
.game-row:not(.locked):hover { background: var(--g-900); padding-left: 22px; }
.game-row:not(.locked):hover .game-title { color: var(--g-100); }
.game-row:not(.locked):hover .game-id, .game-row:not(.locked):hover .game-tag { color: var(--g-300); }
.game-row:not(.locked):hover .game-cta { background: var(--g-300); color: var(--g-900); transform: translateX(-4px); }
.game-id { font-size: 13px; font-weight: 700; color: var(--g-500); letter-spacing: 0.1em; }
.game-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.game-title { font-size: clamp(30px, 5.4vw, 66px); font-weight: 900; letter-spacing: -0.01em; line-height: 1;
  text-transform: uppercase; color: var(--g-900); transition: color 0.25s ease; }
.game-tag { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--g-700); transition: color 0.25s ease; }
.game-desc { display: none; }
.game-thumb { display: none; }
.game-cta { justify-self: end; font-size: 12px; font-weight: 800; letter-spacing: 0.18em; padding: 12px 18px;
  border-radius: 999px; background: var(--g-100); color: var(--g-900); transition: all 0.25s ease; white-space: nowrap; }
.game-cta.soon { background: transparent; border: 1.5px dashed var(--g-500); color: var(--g-500); }
.locked { opacity: 0.55; cursor: default; }

/* cursor preview */
.preview { position: fixed; top: 0; left: 0; z-index: 50; width: min(340px, 26vw); aspect-ratio: 16/10;
  pointer-events: none; opacity: 0; visibility: hidden; transform: scale(0.9);
  border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(11, 31, 18, 0.35); }
.preview img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* about */
.about { padding: clamp(40px, 8vh, 90px) clamp(20px, 4vw, 56px); max-width: 900px; }
.about-line { font-size: clamp(19px, 2.6vw, 30px); line-height: 1.45; color: var(--g-900); margin: 0 0 18px; font-weight: 500; }
.about-line em { color: var(--g-500); font-style: normal; font-weight: 800; }
.about-stats { display: flex; gap: clamp(24px, 6vw, 80px); margin-top: 34px; }
.about-stats b { display: block; font-size: clamp(34px, 5vw, 58px); font-weight: 900; color: var(--g-500); line-height: 1; }
.about-stats i { font-style: normal; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--g-700); }

/* footer */
.footer { padding: clamp(50px, 9vh, 110px) clamp(20px, 4vw, 56px) 34px; background: var(--g-900); color: var(--g-100);
  display: flex; flex-direction: column; align-items: center; gap: 46px; }
.footer-cta { font-size: clamp(34px, 7.5vw, 96px); font-weight: 900; letter-spacing: -0.01em; text-transform: uppercase;
  color: var(--g-100); text-decoration: none; border-bottom: 4px solid var(--g-500); line-height: 1.15;
  transition: color 0.25s ease, border-color 0.25s ease, letter-spacing 0.35s ease; }
.footer-cta:hover { color: var(--g-300); border-color: var(--g-300); letter-spacing: 0.03em; }
.footer-row { width: 100%; display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.24em; color: var(--g-300); }

/* ── mobile: rows become cards with inline images ── */
@media (max-width: 720px) {
  .game-row { grid-template-columns: 1fr; gap: 12px; }
  .game-id { order: 1; }
  .game-main { order: 2; }
  .game-thumb { display: block; order: 3; width: 100%; border-radius: 12px; aspect-ratio: 16/10; object-fit: cover; }
  .game-desc { display: block; order: 4; font-size: 14px; line-height: 1.5; color: var(--g-700); }
  .game-cta { order: 5; justify-self: start; }
  .game-row:not(.locked):hover { padding-left: 8px; }
  .game-row:not(.locked):hover .game-desc { color: var(--g-300); }
  .preview { display: none; }
  .footer-row { flex-direction: column; gap: 6px; align-items: center; }
}
`;

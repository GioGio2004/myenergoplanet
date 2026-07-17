"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { gsap } from "gsap/dist/gsap";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SKINS, GUNS } from "@/components/simulation/skins";
import { LobbyHero } from "@/components/lobby/LobbyHero";
import {
  Users,
  Swords,
  Shirt,
  Target,
  Play,
  X,
  Copy,
  Check,
  UserPlus,
} from "lucide-react";

type Modal = null | "friends" | "loadout";
type Mode = "training" | "duel";

const MODES: { id: Mode; label: string; sub: string; Icon: typeof Target }[] = [
  { id: "training", label: "TRAINING", sub: "Solo range", Icon: Target },
  { id: "duel", label: "1V1 DUEL", sub: "Fight a friend", Icon: Swords },
];

// ─── BLACKOUT lobby — Brawl-Stars style hub ──────────────────────────────────
export default function Lobby() {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const overview = useQuery(api.friends.overview);
  const matchState = useQuery(api.matches.mine);

  const ensure = useMutation(api.users.ensureUser);
  const beat = useMutation(api.users.heartbeat);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const setLoadout = useMutation(api.users.setLoadout);
  const sendRequest = useMutation(api.friends.sendRequest);
  const acceptFriend = useMutation(api.friends.accept);
  const removeFriend = useMutation(api.friends.remove);
  const challenge = useMutation(api.matches.challenge);
  const respond = useMutation(api.matches.respond);
  const leaveMatch = useMutation(api.matches.leave);

  const [modal, setModal] = useState<Modal>(null);
  const [mode, setMode] = useState<Mode>("training");
  const [bestOf, setBestOf] = useState(5); // 1v1 length: 5 | 10 | 15
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const flash = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    ensure().catch(() => {});
    const t = setInterval(() => beat().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [ensure, beat]);

  // ambient backdrop
  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.to(".lb-blob-a", { xPercent: 20, yPercent: 14, duration: 18, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to(".lb-blob-b", { xPercent: -16, yPercent: -12, duration: 22, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to(".lb-blob-c", { xPercent: 12, yPercent: -18, duration: 26, yoyo: true, repeat: -1, ease: "sine.inOut" });
      gsap.to(".lb-grid", { backgroundPosition: "120px 120px", duration: 26, repeat: -1, ease: "none" });
      gsap.utils.toArray<HTMLElement>(".lb-spark").forEach((el, i) => {
        gsap.to(el, {
          y: -26 - (i % 4) * 12, x: (i % 2 ? 1 : -1) * (8 + (i % 5) * 5), opacity: 0.15,
          duration: 5 + (i % 5) * 1.6, yoyo: true, repeat: -1, ease: "sine.inOut", delay: i * 0.3,
        });
      });
      gsap.fromTo(".lb-anim-in", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: "power3.out", stagger: 0.08, delay: 0.1 });
    }, root);
    return () => ctx.revert();
  }, []);

  const me = overview?.me;
  const mySkin = me?.skin ?? "volt";
  const myGun = me?.gun ?? "desert";
  const requestCount = overview?.pendingIncoming.length ?? 0;
  const needsOnboarding = overview !== undefined && overview !== null && (!me?.isOnboarded || !me?.friendId);
  const incoming = matchState?.incoming ?? [];
  const activeMatch = matchState?.active ?? null;

  const copyId = async () => {
    if (!me?.friendId) return;
    try {
      await navigator.clipboard.writeText(me.friendId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  const onPlay = () => {
    if (mode === "training") router.push("/game-simulation");
    else if (activeMatch) return; // match-ready modal handles it
    else {
      setModal("friends");
      flash("ok", "Challenge an online friend to a 1v1 ⚔");
    }
  };

  return (
    <div ref={root} className="lobby">
      <style>{CSS}</style>

      {/* backdrop */}
      <div className="lb-grid" />
      <div className="lb-blob lb-blob-a" />
      <div className="lb-blob lb-blob-b" />
      <div className="lb-blob lb-blob-c" />
      {Array.from({ length: 12 }).map((_, i) => (
        <span key={i} className="lb-spark" style={{ left: `${(i * 8.1 + 5) % 95}%`, top: `${(i * 15.3 + 10) % 90}%` }} />
      ))}

      {/* signed-out */}
      <Show when="signed-out">
        <div className="lb-gate">
          <div className="lb-gate-card">
            <div className="lb-logo big">BLACK<span>OUT</span></div>
            <p>Sign in to build your loadout, add friends and duel them 1v1.</p>
            <SignInButton mode="modal">
              <button className="lb-btn lb-btn-solid lg">SIGN IN TO PLAY</button>
            </SignInButton>
            <Link href="/" className="lb-back">← back to EnergoLab</Link>
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        {/* ── top bar ── */}
        <nav className="lb-top lb-anim-in">
          <Link href="/" className="lb-back">← ENERGOLAB</Link>
          <div className="lb-logo">BLACK<span>OUT</span></div>
          <div className="lb-profile">
            {me?.username && (
              <div className="lb-id">
                <span className="lb-uname">@{me.username}</span>
                {me.friendId && (
                  <button className="lb-idpill" onClick={copyId} title="Copy your friend ID">
                    #{me.friendId} {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            )}
            <UserButton />
          </div>
        </nav>

        {/* ── incoming challenge banner ── */}
        {incoming.map((inv) => (
          <div key={inv.matchId} className="lb-challenge">
            <span><b>@{inv.host.username ?? inv.host.name}</b> is calling you out! · BEST OF {inv.bestOf}</span>
            <span className="lb-row-actions">
              <button className="lb-btn lb-btn-solid sm" onClick={() => respond({ matchId: inv.matchId, accept: true }).catch(() => {})}>ACCEPT</button>
              <button className="lb-btn lb-btn-ghost sm" onClick={() => respond({ matchId: inv.matchId, accept: false }).catch(() => {})}>DECLINE</button>
            </span>
          </div>
        ))}

        {/* ── centre stage ── */}
        <div className="lb-stage">
          <div className="lb-platform" />
          {me?.isOnboarded && me?.friendId && (
            <div className="lb-hero-wrap">
              <LobbyHero skinId={mySkin} />
            </div>
          )}
          <div className="lb-skinname">{SKINS.find((s) => s.id === mySkin)?.label ?? "VOLT"}</div>
        </div>

        {/* ── left rail ── */}
        <div className="lb-rail lb-rail-left lb-anim-in">
          <RailButton Icon={Shirt} label="OPERATIVES" onClick={() => setModal("loadout")} />
        </div>

        {/* ── right rail ── */}
        <div className="lb-rail lb-rail-right lb-anim-in">
          <RailButton Icon={Users} label="FRIENDS" badge={requestCount} onClick={() => setModal("friends")} />
        </div>

        {/* ── bottom bar: modes + PLAY ── */}
        <div className="lb-bottom lb-anim-in">
          <div className="lb-modes-col">
            <div className="lb-modes">
              {MODES.map((m) => (
                <button key={m.id} className={`lb-mode ${mode === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}>
                  <m.Icon size={16} />
                  <span className="lb-mode-lbl">{m.label}</span>
                  <span className="lb-mode-sub">{m.sub}</span>
                </button>
              ))}
            </div>
            {mode === "duel" && (
              <div className="lb-bo">
                <span className="lb-bo-lbl">BEST OF</span>
                {[5, 10, 15].map((n) => (
                  <button key={n} className={`lb-bo-btn ${bestOf === n ? "on" : ""}`} onClick={() => setBestOf(n)}>
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="lb-play" onClick={onPlay}>
            <Play size={26} fill="currentColor" />
            <span>PLAY</span>
          </button>
        </div>

        {/* ── onboarding popup ── */}
        {needsOnboarding && (
          <OnboardingGate
            initial={me?.username ?? ""}
            onDone={async (username) => {
              const r = await completeOnboarding({ username });
              flash("ok", `Welcome! Your friend ID is #${r.friendId}`);
            }}
          />
        )}

        {/* ── loadout modal ── */}
        {modal === "loadout" && (
          <Overlay title="OPERATIVES" onClose={() => setModal(null)}>
            <div className="lb-sublabel">CHARACTER SKIN</div>
            <div className="lb-cards">
              {SKINS.map((s) => (
                <button key={s.id} className={`lb-card ${mySkin === s.id ? "on" : ""}`}
                  onClick={() => setLoadout({ skin: s.id }).then(() => flash("ok", `${s.label} equipped`)).catch(() => {})}>
                  <span className="lb-swatch" style={{ background: s.swatch }} />
                  <span className="lb-card-name">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="lb-sublabel">SCAR-H FINISH</div>
            <div className="lb-cards">
              {GUNS.map((g) => (
                <button key={g.id} className={`lb-card ${myGun === g.id ? "on" : ""}`}
                  onClick={() => setLoadout({ gun: g.id }).then(() => flash("ok", `${g.label} finish equipped`)).catch(() => {})}>
                  <span className="lb-swatch sq" style={{ background: g.swatch }} />
                  <span className="lb-card-name">{g.label}</span>
                </button>
              ))}
            </div>
            <p className="lb-hint">More operatives are on the way — the second character is in the works.</p>
          </Overlay>
        )}

        {/* ── friends modal ── */}
        {modal === "friends" && overview && (
          <FriendsModal
            overview={overview}
            onClose={() => setModal(null)}
            onAdd={(code) => sendRequest({ friendId: code })}
            onAccept={(id) => acceptFriend({ friendshipId: id })}
            onRemove={(id) => removeFriend({ friendshipId: id })}
            onChallenge={(uid, label) =>
              challenge({ friendUserId: uid, bestOf })
                .then(() => flash("ok", `Challenge sent to ${label} ⚔`))
                .catch((e) => flash("err", String(e instanceof Error ? e.message : e)))
            }
            flash={flash}
          />
        )}

        {/* ── match-ready modal ── */}
        {activeMatch && (
          <div className="lb-modal-scrim">
            <div className="lb-matchready">
              <div className="lb-mr-title">MATCH READY</div>
              <div className="lb-mr-vs">YOU <em>vs</em> @{activeMatch.opponent.username ?? activeMatch.opponent.name}</div>
              <div className="lb-mr-room">ROOM <b>{activeMatch.roomCode}</b></div>
              <div className="lb-mr-room">
                BEST OF {activeMatch.bestOf} · FIRST TO {Math.ceil((activeMatch.bestOf + 1) / 2)}
              </div>
              <button
                className="lb-btn lb-btn-solid lg"
                onClick={() =>
                  router.push(
                    `/game-simulation?room=${activeMatch.roomCode}&match=${activeMatch.matchId}&bo=${activeMatch.bestOf}&host=${activeMatch.iAmHost ? 1 : 0}`,
                  )
                }
              >
                ENTER ARENA
              </button>
              <button className="lb-btn lb-btn-ghost sm" onClick={() => leaveMatch({ matchId: activeMatch.matchId }).catch(() => {})}>ABANDON</button>
            </div>
          </div>
        )}

        {toast && <div className={`lb-toast ${toast.kind}`}>{toast.text}</div>}
      </Show>
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────
function RailButton({ Icon, label, badge, onClick }: { Icon: typeof Target; label: string; badge?: number; onClick: () => void }) {
  return (
    <button className="lb-rail-btn" onClick={onClick}>
      <Icon size={22} />
      <span className="lb-rail-lbl">{label}</span>
      {badge ? <span className="lb-badge">{badge}</span> : null}
    </button>
  );
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="lb-modal-scrim" onClick={onClose}>
      <div className="lb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lb-modal-head">
          <span>{title}</span>
          <button className="lb-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lb-modal-body">{children}</div>
      </div>
    </div>
  );
}

function OnboardingGate({ initial, onDone }: { initial: string; onDone: (username: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await onDone(name.trim());
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).replace(/^.*Error: /, ""));
      setBusy(false);
    }
  };
  return (
    <div className="lb-modal-scrim solid">
      <div className="lb-onboard">
        <div className="lb-ob-badge"><UserPlus size={26} /></div>
        <div className="lb-ob-title">FINISH YOUR PROFILE</div>
        <p className="lb-ob-sub">Choose a display name. We&apos;ll mint you a unique friend ID that others use to add you.</p>
        <input
          className="lb-input lg" value={name} maxLength={16} autoFocus
          placeholder="your username" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 3) submit(); }}
        />
        {err && <div className="lb-note err">{err}</div>}
        <button className="lb-btn lb-btn-solid lg" disabled={busy || name.trim().length < 3} onClick={submit}>
          {busy ? "CREATING…" : "ENTER BLACKOUT"}
        </button>
        <div className="lb-ob-foot">3–16 characters · letters, numbers, spaces</div>
      </div>
    </div>
  );
}

type OverviewT = NonNullable<ReturnType<typeof useQuery<typeof api.friends.overview>>>;

function FriendsModal({
  overview, onClose, onAdd, onAccept, onRemove, onChallenge, flash,
}: {
  overview: OverviewT;
  onClose: () => void;
  onAdd: (code: string) => Promise<{ autoAccepted: boolean }>;
  onAccept: (id: Id<"friendships">) => Promise<unknown>;
  onRemove: (id: Id<"friendships">) => Promise<unknown>;
  onChallenge: (uid: Id<"users">, label: string) => void;
  flash: (k: "ok" | "err", t: string) => void;
}) {
  const [code, setCode] = useState("");
  const add = async () => {
    if (!code.trim()) return;
    try {
      const r = await onAdd(code);
      flash("ok", r.autoAccepted ? "You're now friends!" : "Request sent ⚡");
      setCode("");
    } catch (e) {
      flash("err", String(e instanceof Error ? e.message : e).replace(/^.*Error: /, ""));
    }
  };
  const onlineCount = useMemo(() => overview.friends.filter((f) => f.online).length, [overview.friends]);
  return (
    <Overlay title={`FRIENDS · ${onlineCount} ONLINE`} onClose={onClose}>
      <div className="lb-addrow">
        <input className="lb-input" value={code} placeholder="add by friend ID (e.g. K7X2M9PQ)"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="lb-btn lb-btn-solid" onClick={add}>ADD</button>
      </div>

      {overview.pendingIncoming.length > 0 && (
        <>
          <div className="lb-sublabel">REQUESTS</div>
          {overview.pendingIncoming.map((r) => (
            <div key={r.friendshipId} className="lb-row">
              <span className="lb-row-name">@{r.from.username ?? r.from.name}</span>
              <span className="lb-row-actions">
                <button className="lb-btn lb-btn-solid sm" onClick={() => onAccept(r.friendshipId).catch(() => {})}>ACCEPT</button>
                <button className="lb-btn lb-btn-ghost sm" onClick={() => onRemove(r.friendshipId).catch(() => {})}><X size={13} /></button>
              </span>
            </div>
          ))}
        </>
      )}

      <div className="lb-sublabel">SQUAD · {overview.friends.length}</div>
      {overview.friends.length === 0 && <div className="lb-empty">No friends yet — share your friend ID and add theirs above.</div>}
      {overview.friends.map((f) => (
        <div key={f.friendshipId} className="lb-row">
          <span className="lb-row-name">
            <i className={`lb-dot ${f.online ? "on" : ""}`} />
            @{f.username ?? f.name}
            <span className="lb-status">{f.online ? "online" : "offline"}</span>
          </span>
          <span className="lb-row-actions">
            <button className="lb-btn lb-btn-solid sm" disabled={!f.online} title={f.online ? "Challenge 1v1" : "Offline"}
              onClick={() => onChallenge(f.id as Id<"users">, `@${f.username ?? f.name}`)}>
              <Swords size={13} /> 1V1
            </button>
            <button className="lb-btn lb-btn-ghost sm" title="Unfriend" onClick={() => onRemove(f.friendshipId).catch(() => {})}><X size={13} /></button>
          </span>
        </div>
      ))}

      {overview.pendingOutgoing.length > 0 && (
        <>
          <div className="lb-sublabel">SENT</div>
          {overview.pendingOutgoing.map((r) => (
            <div key={r.friendshipId} className="lb-row dim">
              <span className="lb-row-name">@{r.to.username ?? r.to.name} · pending…</span>
              <button className="lb-btn lb-btn-ghost sm" onClick={() => onRemove(r.friendshipId).catch(() => {})}><X size={13} /></button>
            </div>
          ))}
        </>
      )}
    </Overlay>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────
const CSS = `
.lobby {
  --paper:#f2f7f0; --ink:#0b1f12; --g-900:#0f3d24; --g-700:#1b5e3b; --g-500:#3f915f; --g-300:#9ed4ae; --g-100:#ddeede;
  position:relative; width:100%; height:100dvh; overflow:hidden; background:var(--paper); color:var(--ink);
  font-family:var(--font-geist-sans, system-ui), 'Segoe UI', Roboto, sans-serif;
}
.lobby::selection,.lobby *::selection{ background:var(--g-300); }
.lb-grid{ position:absolute; inset:0; opacity:0.45; z-index:0; pointer-events:none;
  background-image:linear-gradient(var(--g-100) 1px,transparent 1px),linear-gradient(90deg,var(--g-100) 1px,transparent 1px); background-size:64px 64px; }
.lb-blob{ position:absolute; border-radius:50%; filter:blur(100px); pointer-events:none; z-index:0; }
.lb-blob-a{ width:46vw;height:46vw;background:var(--g-300);opacity:0.5;top:-14vw;right:-8vw; }
.lb-blob-b{ width:40vw;height:40vw;background:var(--g-100);opacity:0.8;bottom:-14vw;left:-8vw; }
.lb-blob-c{ width:24vw;height:24vw;background:var(--g-500);opacity:0.14;top:36%;left:44%; }
.lb-spark{ position:absolute; width:6px;height:6px;border-radius:50%;background:var(--g-500);opacity:0.32;box-shadow:0 0 12px var(--g-500);z-index:0;pointer-events:none; }

.lb-top,.lb-stage,.lb-rail,.lb-bottom,.lb-challenge{ position:relative; z-index:3; }

/* top */
.lb-top{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px clamp(14px,3vw,36px); }
.lb-back{ font-size:11px;letter-spacing:0.2em;font-weight:700;color:var(--g-700);text-decoration:none; }
.lb-back:hover{ color:var(--g-900); }
.lb-logo{ font-weight:900;letter-spacing:0.12em;font-size:20px;color:var(--g-900); }
.lb-logo span{ color:var(--g-500); }
.lb-logo.big{ font-size:40px; }
.lb-profile{ display:flex; align-items:center; gap:12px; }
.lb-id{ display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
.lb-uname{ font-size:13px; font-weight:800; color:var(--g-900); letter-spacing:0.04em; }
.lb-idpill{ display:inline-flex; align-items:center; gap:5px; font-family:inherit; font-size:11px; font-weight:700; letter-spacing:0.14em;
  color:var(--g-700); background:var(--g-100); border:1px solid var(--g-300); border-radius:999px; padding:3px 9px; cursor:pointer; }
.lb-idpill:hover{ color:var(--g-900); border-color:var(--g-500); }

/* challenge banner */
.lb-challenge{ margin:0 clamp(14px,3vw,36px); padding:12px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px;
  background:var(--g-900); color:var(--g-100); border-radius:14px; font-size:14px; animation:lbpop 0.4s ease-out; }
@keyframes lbpop{ from{ transform:translateY(-8px); opacity:0; } to{ transform:none; opacity:1; } }
.lb-challenge b{ color:#fff; }

/* stage */
.lb-stage{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:1; }
.lb-platform{ position:absolute; bottom:20vh; width:min(420px,60vw); height:120px; border-radius:50%;
  background:radial-gradient(ellipse at center, rgba(63,145,95,0.35) 0%, transparent 70%); filter:blur(6px); }
.lb-hero-wrap{ position:absolute; inset:0; z-index:2; }
.lb-skinname{ position:absolute; bottom:calc(20vh - 6px); font-family:var(--font-hud, inherit); font-size:12px; font-weight:800;
  letter-spacing:0.34em; color:var(--g-700); background:rgba(255,255,255,0.5); backdrop-filter:blur(6px);
  border:1px solid var(--g-300); border-radius:999px; padding:5px 16px; z-index:3; }

/* rails */
.lb-rail{ position:absolute; top:50%; transform:translateY(-50%); display:flex; flex-direction:column; gap:12px; }
.lb-rail-left{ left:clamp(10px,2.5vw,28px); }
.lb-rail-right{ right:clamp(10px,2.5vw,28px); }
.lb-rail-btn{ position:relative; width:78px; height:78px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  background:rgba(255,255,255,0.62); backdrop-filter:blur(14px); border:1.5px solid var(--g-300); border-radius:18px; cursor:pointer;
  color:var(--g-700); transition:transform 0.18s ease, border-color 0.18s, box-shadow 0.18s; }
.lb-rail-btn:hover{ transform:translateY(-3px); border-color:var(--g-500); color:var(--g-900); box-shadow:0 10px 26px rgba(15,61,36,0.15); }
.lb-rail-lbl{ font-size:9px; font-weight:800; letter-spacing:0.14em; }
.lb-badge{ position:absolute; top:-6px; right:-6px; min-width:20px; height:20px; padding:0 5px; border-radius:999px; background:#ef4444; color:#fff;
  font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 3px var(--paper); }

/* bottom */
.lb-bottom{ position:absolute; bottom:clamp(16px,3vh,30px); left:50%; transform:translateX(-50%); display:flex; align-items:flex-end; gap:16px; z-index:3; }
.lb-modes-col{ display:flex; flex-direction:column; align-items:center; gap:8px; }
.lb-modes{ display:flex; gap:10px; }
.lb-bo{ display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px;
  background:rgba(255,255,255,0.6); backdrop-filter:blur(12px); border:1.5px solid var(--g-100); }
.lb-bo-lbl{ font-size:9px; font-weight:800; letter-spacing:0.18em; color:var(--g-700); padding-right:2px; }
.lb-bo-btn{ font-family:inherit; min-width:34px; padding:5px 8px; border-radius:999px; cursor:pointer; font-size:11px; font-weight:900;
  color:var(--g-700); background:transparent; border:1.5px solid var(--g-100); transition:all 0.15s ease; }
.lb-bo-btn:hover{ border-color:var(--g-300); }
.lb-bo-btn.on{ color:#fff; background:var(--g-700); border-color:var(--g-700); }
.lb-mode{ display:flex; flex-direction:column; align-items:center; gap:2px; width:110px; padding:12px 8px; cursor:pointer;
  background:rgba(255,255,255,0.6); backdrop-filter:blur(12px); border:2px solid var(--g-100); border-radius:14px; color:var(--g-700); transition:all 0.18s ease; }
.lb-mode:hover{ border-color:var(--g-300); }
.lb-mode.on{ border-color:var(--g-500); background:var(--g-100); color:var(--g-900); box-shadow:0 8px 22px rgba(63,145,95,0.22); }
.lb-mode-lbl{ font-size:12px; font-weight:900; letter-spacing:0.08em; }
.lb-mode-sub{ font-size:9px; letter-spacing:0.08em; opacity:0.75; }
.lb-play{ display:flex; align-items:center; gap:10px; padding:0 34px; height:72px; border:none; border-radius:18px; cursor:pointer;
  background:linear-gradient(180deg,#3f915f,#1b5e3b); color:#fff; font-family:var(--font-hud, inherit); font-size:24px; font-weight:900; letter-spacing:0.12em;
  box-shadow:0 12px 30px rgba(27,94,59,0.4); transition:transform 0.15s ease, box-shadow 0.15s; }
.lb-play:hover{ transform:translateY(-2px); box-shadow:0 16px 38px rgba(27,94,59,0.5); }
.lb-play:active{ transform:translateY(1px); }

/* buttons */
.lb-btn{ font-family:inherit; font-size:12px; font-weight:800; letter-spacing:0.16em; border-radius:999px; padding:11px 20px; cursor:pointer;
  transition:all 0.18s ease; border:1.5px solid var(--g-700); display:inline-flex; align-items:center; gap:6px; }
.lb-btn.sm{ padding:8px 12px; font-size:10px; }
.lb-btn.lg{ padding:14px 26px; font-size:13px; }
.lb-btn-solid{ color:#fff; background:var(--g-700); }
.lb-btn-solid:hover{ background:var(--g-900); border-color:var(--g-900); }
.lb-btn-solid:disabled{ opacity:0.5; cursor:default; }
.lb-btn-ghost{ color:var(--g-700); background:transparent; }
.lb-btn-ghost:hover{ color:var(--g-900); border-color:var(--g-900); }

/* modals */
.lb-modal-scrim{ position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center; padding:20px;
  background:rgba(8,20,12,0.42); backdrop-filter:blur(4px); animation:lbfade 0.2s ease-out; }
.lb-modal-scrim.solid{ background:rgba(8,20,12,0.72); }
@keyframes lbfade{ from{ opacity:0; } to{ opacity:1; } }
.lb-modal{ width:min(460px,94vw); max-height:80vh; overflow:auto; background:var(--paper); border:1px solid var(--g-300); border-radius:20px;
  box-shadow:0 30px 80px rgba(11,31,18,0.35); animation:lbpop 0.28s ease-out; }
.lb-modal-head{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--g-100);
  font-size:12px; font-weight:900; letter-spacing:0.24em; color:var(--g-500); }
.lb-x{ background:none; border:none; cursor:pointer; color:var(--g-700); display:flex; }
.lb-x:hover{ color:var(--g-900); }
.lb-modal-body{ padding:18px 20px 22px; }
.lb-sublabel{ margin:16px 0 8px; font-size:10px; letter-spacing:0.22em; font-weight:800; color:var(--g-700); }
.lb-sublabel:first-child{ margin-top:0; }

/* loadout cards */
.lb-cards{ display:flex; gap:10px; flex-wrap:wrap; }
.lb-card{ display:flex; flex-direction:column; align-items:center; gap:8px; width:88px; padding:14px 0 10px; border-radius:14px; cursor:pointer;
  background:rgba(255,255,255,0.8); border:2px solid var(--g-100); transition:transform 0.16s, border-color 0.16s, box-shadow 0.16s; }
.lb-card:hover{ transform:translateY(-3px); border-color:var(--g-300); }
.lb-card.on{ border-color:var(--g-500); box-shadow:0 8px 22px rgba(63,145,95,0.25); }
.lb-swatch{ width:34px; height:34px; border-radius:50%; box-shadow:inset 0 -4px 8px rgba(0,0,0,0.15); }
.lb-swatch.sq{ border-radius:8px; }
.lb-card-name{ font-size:10px; font-weight:800; letter-spacing:0.14em; color:var(--g-900); }
.lb-hint{ margin-top:16px; font-size:12px; color:var(--g-700); line-height:1.5; }

/* friends */
.lb-addrow{ display:flex; gap:8px; }
.lb-input{ flex:1; min-width:0; font-family:inherit; font-size:13px; letter-spacing:0.08em; padding:11px 14px; border-radius:999px;
  border:1.5px solid var(--g-300); background:#fff; color:var(--ink); outline:none; }
.lb-input.lg{ width:100%; text-align:center; font-size:15px; letter-spacing:0.14em; padding:14px; }
.lb-input:focus{ border-color:var(--g-500); }
.lb-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 2px; border-bottom:1px dashed var(--g-100); }
.lb-row.dim{ opacity:0.6; }
.lb-row-name{ font-size:13px; font-weight:700; color:var(--g-900); display:flex; align-items:center; gap:8px; }
.lb-row-actions{ display:flex; gap:6px; }
.lb-status{ font-size:10px; font-weight:600; letter-spacing:0.1em; color:var(--g-500); text-transform:uppercase; }
.lb-dot{ width:9px; height:9px; border-radius:50%; background:#cbd5d1; display:inline-block; }
.lb-dot.on{ background:#22c55e; box-shadow:0 0 8px #22c55e; }
.lb-empty{ font-size:13px; color:var(--g-700); line-height:1.6; }
.lb-note{ margin-top:10px; font-size:12px; padding:8px 12px; border-radius:10px; }
.lb-note.err{ color:#7f1d1d; background:#fee2e2; }

/* onboarding */
.lb-onboard{ width:min(420px,94vw); background:var(--paper); border:1px solid var(--g-300); border-radius:22px; padding:30px 26px;
  text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px; box-shadow:0 30px 80px rgba(11,31,18,0.4); animation:lbpop 0.3s ease-out; }
.lb-ob-badge{ width:58px; height:58px; border-radius:50%; background:var(--g-100); border:1px solid var(--g-300); display:flex; align-items:center; justify-content:center; color:var(--g-700); }
.lb-ob-title{ font-size:15px; font-weight:900; letter-spacing:0.2em; color:var(--g-900); }
.lb-ob-sub{ font-size:13px; color:var(--g-700); line-height:1.55; margin:0; }
.lb-ob-foot{ font-size:11px; letter-spacing:0.1em; color:var(--g-500); }

/* match ready */
.lb-matchready{ background:var(--g-900); color:var(--g-100); border-radius:20px; padding:30px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px; animation:lbpop 0.3s ease-out; }
.lb-mr-title{ font-size:11px; letter-spacing:0.34em; color:var(--g-300); font-weight:800; }
.lb-mr-vs{ font-size:22px; font-weight:900; }
.lb-mr-vs em{ font-style:normal; color:var(--g-500); padding:0 6px; }
.lb-mr-room{ font-size:13px; letter-spacing:0.2em; color:var(--g-300); }
.lb-mr-room b{ color:#fff; font-size:20px; letter-spacing:0.3em; }

/* gate + toast */
.lb-gate{ position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; }
.lb-gate-card{ text-align:center; display:flex; flex-direction:column; align-items:center; gap:16px; padding:40px; max-width:420px; }
.lb-gate-card p{ color:var(--g-700); font-size:15px; line-height:1.5; }
.lb-toast{ position:absolute; bottom:110px; left:50%; transform:translateX(-50%); z-index:60; padding:11px 20px; border-radius:999px; font-size:13px; font-weight:700;
  letter-spacing:0.04em; box-shadow:0 12px 30px rgba(11,31,18,0.25); animation:lbpop 0.3s ease-out; }
.lb-toast.ok{ background:var(--g-900); color:#fff; }
.lb-toast.err{ background:#7f1d1d; color:#fff; }

@media (max-width:820px){
  .lb-rail{ top:auto; bottom:150px; transform:none; flex-direction:row; }
  .lb-rail-left{ left:14px; } .lb-rail-right{ right:14px; }
  .lb-rail-btn{ width:64px; height:64px; }
  .lb-bottom{ flex-direction:column; align-items:center; gap:10px; }
  .lb-platform{ bottom:26vh; }
}
`;

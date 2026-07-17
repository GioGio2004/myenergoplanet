"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PCFSoftShadowMap } from "three";
import { Arena } from "@/components/simulation/Arena";
import { Player } from "@/components/simulation/Player";
import { Targets } from "@/components/simulation/Targets";
import { RemotePlayer } from "@/components/simulation/RemotePlayer";
import { initEffects, updateEffects } from "@/components/simulation/effects";
import { useSimState, simStore } from "@/components/simulation/store";
import { TouchControls } from "@/components/simulation/TouchControls";
import { SKINS } from "@/components/simulation/skins";
import {
  joinRoom,
  isJoined,
  subscribePlayers,
  inviteLink,
  myId,
  me,
  type NetPlayer,
} from "@/components/simulation/net";

// Runs the imperative fire-effects system (tracers/sparks/muzzle flash).
function EffectsRunner() {
  const { scene } = useThree();
  useEffect(() => {
    initEffects(scene);
  }, [scene]);
  useFrame((_, dt) => updateEffects(dt));
  return null;
}

// ── DOM HUD pieces ───────────────────────────────────────────────────────────
function AmmoCounter({ raised = false }: { raised?: boolean }) {
  const { ammo, magSize, reloading } = useSimState();
  return (
    <div
      className="hud-panel"
      style={{
        position: "absolute",
        bottom: raised ? 210 : 16,
        right: 16,
        minWidth: 130,
        textAlign: "right",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-hud)",
          fontSize: 24,
          fontWeight: 700,
          color: reloading ? "var(--color-text-muted)" : ammo === 0 ? "#ef4444" : "var(--color-accent)",
          letterSpacing: "0.08em",
        }}
      >
        {reloading ? "RELOADING…" : `${ammo} / ${magSize}`}
      </div>
      <div
        style={{
          fontFamily: "var(--font-game)",
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.12em",
          marginTop: 2,
        }}
      >
        SCAR-H · R TO RELOAD
      </div>
    </div>
  );
}

function ScoreCounter() {
  const { score, online } = useSimState();
  if (online) return null; // PvP uses the scoreboard instead
  return (
    <div className="hud-panel" style={{ position: "absolute", top: 16, right: 16, textAlign: "right" }}>
      <div style={{ fontFamily: "var(--font-hud)", fontSize: 18, fontWeight: 700, color: "var(--color-text)", letterSpacing: "0.1em" }}>
        ✕ {score}
      </div>
      <div style={{ fontFamily: "var(--font-game)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.12em" }}>
        TARGETS DOWN
      </div>
    </div>
  );
}

function Crosshair() {
  const { hitAt } = useSimState();
  return (
    <div
      style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}
    >
      <style>{`@keyframes hitfade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }`}</style>
      <div style={{ width: 6, height: 6, borderRadius: "50%", border: "1.5px solid rgba(249,115,22,0.9)" }} />
      {hitAt > 0 && (
        <div
          key={hitAt}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontFamily: "var(--font-hud)",
            fontSize: 18,
            fontWeight: 900,
            color: "#f97316",
            textShadow: "0 0 6px rgba(249,115,22,0.9)",
            opacity: 0,
            animation: "hitfade 160ms ease-out forwards",
          }}
        >
          ✕
        </div>
      )}
    </div>
  );
}

function HpBar() {
  const { hp, maxHp, dead, damagedAt } = useSimState();
  const pct = Math.max(0, (hp / maxHp) * 100);
  return (
    <>
      <style>{`@keyframes dmgflash { 0% { opacity: 0.55; } 100% { opacity: 0; } }`}</style>
      {/* red screen flash when hit */}
      {damagedAt > 0 && (
        <div
          key={damagedAt}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at center, transparent 55%, rgba(239,68,68,0.7) 100%)",
            opacity: 0,
            animation: "dmgflash 350ms ease-out forwards",
          }}
        />
      )}
      <div
        className="hud-panel"
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          minWidth: 220,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontFamily: "var(--font-hud)", fontSize: 10, letterSpacing: "0.18em", color: "var(--color-text-muted)" }}>
            {dead ? "ELIMINATED" : "HEALTH"}
          </span>
          <span style={{ fontFamily: "var(--font-hud)", fontSize: 12, fontWeight: 700, color: pct > 40 ? "#22c55e" : "#ef4444" }}>
            {hp}
          </span>
        </div>
        <div className="energy-bar-track" style={{ width: "100%" }}>
          <div
            className="energy-bar-fill"
            style={{
              width: `${pct}%`,
              background: pct > 40 ? "linear-gradient(90deg,#15803d,#22c55e)" : "linear-gradient(90deg,#7f1d1d,#ef4444)",
            }}
          />
        </div>
      </div>
    </>
  );
}

function KillFeed() {
  const { feed } = useSimState();
  return (
    <div style={{ position: "absolute", top: 64, right: 16, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      {feed.map((f) => (
        <div
          key={f.id}
          className="hud-panel"
          style={{ padding: "5px 10px", fontFamily: "var(--font-hud)", fontSize: 11, letterSpacing: "0.1em", color: "var(--color-text)" }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}

interface ScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
}

function Scoreboard({ roster }: { roster: NetPlayer[] }) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  useEffect(() => {
    const poll = () => {
      const all: ScoreRow[] = [];
      const self = me();
      const list = self ? [self as NetPlayer, ...roster] : roster;
      list.forEach((p) => {
        all.push({
          id: p.id,
          name: (p.getState("name") as string) ?? "…",
          kills: (p.getState("kills") as number) ?? 0,
          deaths: (p.getState("deaths") as number) ?? 0,
        });
      });
      all.sort((a, b) => b.kills - a.kills);
      setRows(all);
    };
    poll();
    const t = setInterval(poll, 700);
    return () => clearInterval(t);
  }, [roster]);

  return (
    <div className="hud-panel" style={{ position: "absolute", top: 16, right: 16, minWidth: 180, pointerEvents: "none" }}>
      <div style={{ fontFamily: "var(--font-hud)", fontSize: 10, letterSpacing: "0.2em", color: "var(--color-text-muted)", marginBottom: 6 }}>
        SCOREBOARD · K / D
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            fontFamily: "var(--font-game)",
            fontSize: 12,
            color: r.id === myId() ? "var(--color-accent)" : "var(--color-text)",
            lineHeight: 1.7,
          }}
        >
          <span>{r.name}</span>
          <span style={{ fontFamily: "var(--font-hud)" }}>
            {r.kills} / {r.deaths}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────
type Phase = "menu" | "pick" | "joining" | "play";

// Rolled once per page load — a pure render must not call Math.random.
const RANDOM_NAME = `PLAYER${Math.floor(Math.random() * 90 + 10)}`;

export default function Simulation() {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const canvasWrap = useRef<HTMLDivElement>(null);

  // ── 1v1 match mode (?room=CODE&match=ID from the lobby) ─────────────────
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = searchParams?.get("room") ?? null;
  const matchId = (searchParams?.get("match") as Id<"matches"> | null) ?? null;
  const matchMode = !!roomCode;
  const iAmHost = searchParams?.get("host") === "1";
  // Best-of-N duel (5 | 10 | 15) → first to ceil((N+1)/2) kills wins.
  const boParam = Number(searchParams?.get("bo") ?? "5");
  const bestOf = [5, 10, 15].includes(boParam) ? boParam : 5;
  const killTarget = Math.ceil((bestOf + 1) / 2);

  const overview = useQuery(api.friends.overview);
  const finishMatch = useMutation(api.matches.finish);
  const leaveMatch = useMutation(api.matches.leave);
  const beat = useMutation(api.users.heartbeat);

  const [phase, setPhase] = useState<Phase>(matchMode ? "joining" : "menu");
  const [online, setOnline] = useState(false);
  const [skinId, setSkinId] = useState("volt");
  const [joinError, setJoinError] = useState("");
  const [roster, setRoster] = useState<NetPlayer[]>([]);
  const [copied, setCopied] = useState(false);
  const [matchResult, setMatchResult] = useState<null | {
    won: boolean;
    myKills: number;
    forfeit?: boolean; // opponent left the room before anyone hit 5
  }>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const joinStarted = useRef(false); // joinRoom kicked off (guards re-runs)
  const inRoom = useRef(false); // joinRoom resolved — we're really in the arena
  const reported = useRef(false); // finish mutation already sent
  const hadOpponent = useRef(false); // an opponent was seen in the room

  // My Convex loadout — gun finish for all flows, skin/name for match mode.
  const myGun = overview?.me?.gun ?? "desert";

  const [isTouch] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window),
  );

  useEffect(() => {
    const onChange = () => {
      const isLocked = !!document.pointerLockElement;
      lockedRef.current = isLocked;
      setLocked(isLocked);
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // Roster maintenance once joined: track everyone except ourselves.
  useEffect(() => {
    if (!online || phase !== "play" || !isJoined()) return;
    const off = subscribePlayers((p) => {
      if (p.id === myId()) return;
      setRoster((r) => (r.some((x) => x.id === p.id) ? r : [...r, p]));
      p.onQuit(() => setRoster((r) => r.filter((x) => x.id !== p.id)));
    });
    return off;
  }, [online, phase]);

  // ── Match mode: auto-join the Convex match's Playroom room ──────────────
  // Needs my profile first (skin/gun/username come from Convex).
  const matchAuthError = matchMode && overview === null; // signed out
  useEffect(() => {
    if (!matchMode || !roomCode || joinStarted.current) return;
    if (!overview) return; // still loading, or signed out (handled above)
    joinStarted.current = true;
    const profile = overview.me;
    const name =
      (profile.username ?? profile.name ?? "PLAYER").trim().slice(0, 14).toUpperCase() || "PLAYER";
    joinRoom(profile.skin, name, profile.gun, roomCode)
      .then(() => {
        inRoom.current = true;
        simStore.set({ online: true, hp: 100, dead: false });
        setSkinId(profile.skin);
        setOnline(true);
        setPhase("play");
      })
      .catch((err) => {
        setJoinError(String(err).slice(0, 120) || "Could not reach the multiplayer service.");
      });
  }, [matchMode, roomCode, overview]);

  // ── Presence: keep the lobby's online status alive while fighting ───────
  const signedIn = overview !== undefined && overview !== null;
  useEffect(() => {
    if (!signedIn) return;
    const t = setInterval(() => beat().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [signedIn, beat]);

  // ── Match mode: watch the scoreboard for first-to-5 / opponent leaving ──
  useEffect(() => {
    if (!matchMode || phase !== "play" || matchResult) return;
    const t = setInterval(() => {
      const self = me();
      if (!self) return;
      const myKills = (self.getState("kills") as number) ?? 0;
      if (roster.length > 0) hadOpponent.current = true;
      else if (hadOpponent.current) {
        // Opponent quit the room mid-match — survivor wins by forfeit.
        setMatchResult({ won: true, myKills, forfeit: true });
        return;
      }
      const oppKills = roster.reduce(
        (max, p) => Math.max(max, (p.getState("kills") as number) ?? 0),
        0,
      );
      if (myKills >= killTarget || oppKills >= killTarget) {
        setMatchResult({ won: myKills >= killTarget, myKills });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [matchMode, phase, roster, matchResult, killTarget]);

  // ── Match mode: report the result to Convex once, release the mouse ─────
  useEffect(() => {
    if (!matchResult || reported.current) return;
    reported.current = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (matchId)
      finishMatch({
        matchId,
        myKills: matchResult.myKills,
        ...(matchResult.forfeit ? { claimWin: true } : {}),
      }).catch(() => {});
  }, [matchResult, matchId, finishMatch]);

  // ── Match mode: abandoning mid-match (unmount while unfinished) ─────────
  useEffect(() => {
    if (!matchMode || !matchId) return;
    return () => {
      // Only counts as abandoning if we actually made it into the room and
      // the match wasn't reported — this also keeps dev StrictMode's
      // mount/cleanup/mount cycle from deleting the match (join is async).
      if (inRoom.current && !reported.current) leaveMatch({ matchId }).catch(() => {});
    };
  }, [matchMode, matchId, leaveMatch]);

  const start = () => {
    if (isTouch) {
      lockedRef.current = true;
      setLocked(true);
      return;
    }
    const canvas = canvasWrap.current?.querySelector("canvas");
    canvas?.requestPointerLock();
  };

  const beginOnline = async () => {
    setPhase("joining");
    setJoinError("");
    try {
      const name = (nameRef.current?.value || "PLAYER").trim().slice(0, 14).toUpperCase() || "PLAYER";
      await joinRoom(skinId, name, myGun);
      simStore.set({ online: true, hp: 100, dead: false });
      setOnline(true);
      setPhase("play");
    } catch (err) {
      setJoinError(String(err).slice(0, 120) || "Could not reach the multiplayer service.");
      setPhase("pick");
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const inPlay = phase === "play";

  return (
    <div
      ref={canvasWrap}
      style={{ position: "relative", width: "100%", height: "100%" }}
      onClick={() => {
        if (inPlay && !lockedRef.current) start();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows={{ type: PCFSoftShadowMap }}
        dpr={isTouch ? [1, 1.5] : [1, 2]}
        gl={{ antialias: !isTouch, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 300, position: [0, 2.2, -4] }}
        style={{ background: "#0a1420" }}
      >
        <fog attach="fog" args={["#0a1420", 55, 110]} />
        <hemisphereLight args={["#bcd3ff", "#3a4a5a", 0.95]} />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[18, 26, 12]}
          intensity={1.6}
          color="#fff2df"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={35}
          shadow-camera-bottom={-35}
          shadow-bias={-0.0004}
        />

        <Suspense fallback={null}>
          <Arena />
          <Targets />
          {inPlay && (
            <Player
              locked={lockedRef}
              online={online}
              skinId={skinId}
              gunId={myGun}
              duelSpawn={matchMode ? (iAmHost ? 0 : 1) : undefined}
            />
          )}
          {inPlay && online && roster.map((p) => <RemotePlayer key={p.id} player={p} />)}
        </Suspense>
        <EffectsRunner />
      </Canvas>

      {/* ── HUD: title ─────────────────────────────────────────────────── */}
      <div className="hud-panel" style={{ position: "absolute", top: 16, left: 16, pointerEvents: "none" }}>
        <div style={{ fontFamily: "var(--font-hud)", fontSize: 13, fontWeight: 700, color: "var(--color-accent)", letterSpacing: "0.15em" }}>
          BLACK<span style={{ color: "var(--color-text)" }}>OUT</span>
        </div>
        <div style={{ fontFamily: "var(--font-game)", fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
          {online ? "ONLINE ARENA" : "TRAINING MODE"}
        </div>
      </div>

      {inPlay && !online && <ScoreCounter />}
      {inPlay && online && (
        <>
          <Scoreboard roster={roster} />
          <KillFeed />
        </>
      )}

      {/* room code chip (1v1 match) */}
      {inPlay && online && matchMode && (
        <div
          className="hud-panel"
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            padding: "8px 18px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-hud)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: "var(--color-accent)",
            }}
          >
            ROOM {roomCode} · BEST OF {bestOf} · FIRST TO {killTarget}
          </span>
        </div>
      )}

      {/* invite chip */}
      {inPlay && online && !matchMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyInvite();
          }}
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "var(--font-hud)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: copied ? "#22c55e" : "var(--color-accent)",
            background: "rgba(15, 22, 35, 0.8)",
            border: `1.5px solid ${copied ? "#22c55e" : "var(--color-accent)"}`,
            borderRadius: 999,
            padding: "8px 18px",
            cursor: "pointer",
          }}
        >
          {copied ? "LINK COPIED ✓" : "COPY INVITE LINK"}
        </button>
      )}

      {inPlay && locked && (
        <>
          {!isTouch && (
            <div className="hud-panel" style={{ position: "absolute", bottom: 16, left: 16, pointerEvents: "none" }}>
              <div style={{ fontFamily: "var(--font-hud)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em", lineHeight: 1.8 }}>
                WASD · MOVE&nbsp;&nbsp;LMB · FIRE&nbsp;&nbsp;RMB · AIM
                <br />
                R · RELOAD&nbsp;&nbsp;SPACE · JUMP&nbsp;&nbsp;SHIFT · SPRINT&nbsp;&nbsp;ESC · MOUSE
              </div>
            </div>
          )}
          <Crosshair />
          <AmmoCounter raised={isTouch} />
          {online && <HpBar />}
        </>
      )}
      {inPlay && locked && isTouch && <TouchControls />}

      {/* ── Click-to-enter (after menu, when pointer not captured) ──────── */}
      {inPlay && !locked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8, 12, 18, 0.5)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-game)",
              fontSize: 13,
              color: "var(--color-text)",
              letterSpacing: "0.2em",
              border: "1.5px solid var(--color-accent)",
              borderRadius: 8,
              padding: "12px 28px",
              background: "rgba(249,115,22,0.08)",
              boxShadow: "var(--glow-sm)",
            }}
          >
            {isTouch ? "TAP TO PLAY" : "CLICK TO PLAY"}
          </div>
        </div>
      )}

      {/* ── Main menu ───────────────────────────────────────────────────── */}
      {phase === "menu" && (
        <div style={overlayStyle}>
          <div style={titleStyle}>BLACKOUT</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={bigBtn(true)} onClick={() => { setOnline(false); simStore.set({ online: false }); setPhase("play"); }}>
              PLAY SOLO
            </button>
            <button style={bigBtn(false)} onClick={() => setPhase("pick")}>
              PLAY WITH FRIENDS
            </button>
          </div>
          <div style={hintStyle}>Solo: target practice · Friends: PvP arena via invite link</div>
        </div>
      )}

      {/* ── Match mode: connecting / error ──────────────────────────────── */}
      {matchMode && phase === "joining" && (
        <div style={overlayStyle} onClick={(e) => e.stopPropagation()}>
          <div style={titleStyle}>1V1 DUEL</div>
          {!joinError && !matchAuthError ? (
            <div style={hintStyle}>CONNECTING TO ROOM {roomCode}…</div>
          ) : (
            <>
              <div style={{ fontFamily: "var(--font-game)", fontSize: 12, color: "#ef4444", maxWidth: 340, textAlign: "center" }}>
                {matchAuthError
                  ? "You need to be signed in to play a 1v1 match."
                  : joinError}
              </div>
              <button
                style={bigBtn(true)}
                onClick={() => {
                  if (matchId) leaveMatch({ matchId }).catch(() => {});
                  router.push("/lobby");
                }}
              >
                BACK TO LOBBY
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Match mode: result overlay ──────────────────────────────────── */}
      {matchResult && (
        <div style={{ ...overlayStyle, background: "rgba(6, 18, 10, 0.88)" }} onClick={(e) => e.stopPropagation()}>
          <div
            style={{
              ...titleStyle,
              fontSize: "clamp(34px, 7vw, 60px)",
              color: matchResult.won ? "#22c55e" : "#ef4444",
              textShadow: matchResult.won
                ? "0 0 30px rgba(34,197,94,0.6)"
                : "0 0 30px rgba(239,68,68,0.6)",
            }}
          >
            {matchResult.won ? "VICTORY" : "DEFEAT"}
          </div>
          <div style={hintStyle}>
            {matchResult.forfeit
              ? "OPPONENT LEFT THE MATCH"
              : matchResult.won
                ? `FIRST TO ${killTarget} — ARENA CLEARED`
                : `YOUR OPPONENT REACHED ${killTarget} KILLS`}
          </div>
          <button style={bigBtn(true)} onClick={() => router.push("/lobby")}>
            BACK TO LOBBY
          </button>
        </div>
      )}

      {/* ── Skin picker + name ──────────────────────────────────────────── */}
      {!matchMode && (phase === "pick" || phase === "joining") && (
        <div style={overlayStyle} onClick={(e) => e.stopPropagation()}>
          <div style={titleStyle}>CHOOSE YOUR FIGHTER</div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {SKINS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSkinId(s.id)}
                style={{
                  width: 92,
                  padding: "14px 0 10px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  background: skinId === s.id ? "rgba(249,115,22,0.15)" : "rgba(15,22,35,0.75)",
                  border: `2px solid ${skinId === s.id ? "var(--color-accent)" : "var(--color-border)"}`,
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: s.swatch,
                    boxShadow: skinId === s.id ? "0 0 14px " + s.swatch : "none",
                  }}
                />
                <span style={{ fontFamily: "var(--font-hud)", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "var(--color-text)" }}>
                  {s.label}
                </span>
              </button>
            ))}
          </div>

          <input
            ref={nameRef}
            defaultValue={RANDOM_NAME}
            maxLength={14}
            style={{
              background: "rgba(15,22,35,0.85)",
              border: "1.5px solid var(--color-border)",
              borderRadius: 8,
              padding: "12px 16px",
              color: "var(--color-text)",
              fontFamily: "var(--font-hud)",
              fontSize: 14,
              letterSpacing: "0.15em",
              textAlign: "center",
              width: 240,
              outline: "none",
            }}
          />

          <button style={bigBtn(true)} onClick={beginOnline} disabled={phase === "joining"}>
            {phase === "joining" ? "CONNECTING…" : "ENTER ARENA"}
          </button>

          {joinError && (
            <div style={{ fontFamily: "var(--font-game)", fontSize: 12, color: "#ef4444", maxWidth: 340, textAlign: "center" }}>
              {joinError}
            </div>
          )}
          <div style={hintStyle}>After joining, use COPY INVITE LINK and send it to your friends.</div>
        </div>
      )}
    </div>
  );
}

// shared overlay styles
const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 22,
  background: "rgba(8, 12, 18, 0.72)",
  zIndex: 20,
};
const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-hud)",
  fontSize: "clamp(20px, 4vw, 32px)",
  fontWeight: 900,
  letterSpacing: "0.25em",
  color: "var(--color-accent)",
  textShadow: "0 0 24px rgba(249,115,22,0.6)",
  textAlign: "center",
};
const hintStyle: React.CSSProperties = {
  fontFamily: "var(--font-game)",
  fontSize: 11,
  color: "var(--color-text-muted)",
  letterSpacing: "0.12em",
  textAlign: "center",
  maxWidth: 340,
  lineHeight: 1.6,
};
const bigBtn = (primary: boolean): React.CSSProperties => ({
  fontFamily: "var(--font-hud)",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.2em",
  color: primary ? "#000" : "var(--color-accent)",
  background: primary ? "var(--color-accent)" : "rgba(249,115,22,0.08)",
  border: "1.5px solid var(--color-accent)",
  borderRadius: 8,
  padding: "14px 30px",
  cursor: "pointer",
  boxShadow: "var(--glow-sm)",
});

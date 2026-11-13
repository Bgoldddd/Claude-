import React, { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Btn, Panel, Tabs, Toggle, Slider, RankBadge, pct } from "./components";
import { ControlsGuide } from "./Menus";
import { engine, UiEvent } from "../game/engine";
import { audio } from "../game/audio";
import { api } from "../net/api";
import { Roster } from "../net/session";
import { MODE_INFO, Mode } from "../../shared/constants";
import { QUICK_MESSAGES } from "../../shared/cosmetics";
import { ARCHETYPES } from "../../shared/progression";
import { COURTS, availableCourts, CourtDef } from "../game/assets";

const TEAM_COLORS = ["#ff7a2f", "#00d0f0"];
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function GameScreen() {
  const { session, setSession, go, toast, refreshMe, me, social, refreshSocial, settings } = useStore();
  const [roster, setRoster] = useState<Roster | null>(session?.roster ?? null);
  const [results, setResults] = useState<any>(null);
  const [hud, setHud] = useState<ReturnType<typeof engine.hud>>(null);
  const [paused, setPaused] = useState(false);
  const [board, setBoard] = useState(false);
  const [center, setCenter] = useState<UiEvent & { id: number } | null>(null);
  const [timing, setTiming] = useState<UiEvent & { id: number } | null>(null);
  const [dunk, setDunk] = useState<UiEvent & { id: number } | null>(null);
  const [contest, setContest] = useState<UiEvent & { id: number } | null>(null);
  const [feed, setFeed] = useState<(UiEvent & { id: number })[]>([]);
  const [hint, setHint] = useState<string>("");
  const [locked, setLocked] = useState(false);
  const [rematch, setRematch] = useState<{ votes: number; need: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const meterRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const leave = () => {
    session?.leave();
    engine.detach(); engine.setMode("menu"); engine.setPaused(false);
    setSession(null);
    refreshMe().catch(() => {});
    go("menu");
  };

  useEffect(() => {
    if (!session) { go("menu"); return; }
    engine.attach(session);
    engine.setMode("play");
    engine.bindMeter(meterRef.current);
    const offs = [
      session.on("roster", (r: Roster) => { setRoster({ ...r }); engine.loadCourt(r.court || "the_block"); }),
      session.on("results", (r: any) => { setResults(r); engine.unlockPointer(); refreshMe().catch(() => {}); }),
      session.on("phase", (m: any) => { if (m.phase !== "results") { setResults(null); setRematch(null); } if (m.phase === "match") { audio.horn(); setCenter({ id: idRef.current++, kind: "center", text: "GAME ON", sub: MODE_INFO[(m.settings?.mode ?? session.roster?.settings.mode ?? "1v1") as Mode]?.label }); } }),
      session.on("toast", (m: any) => toast({ text: m.text })),
      session.on("rematch", (m: any) => setRematch(m)),
      session.on("left", (code: number) => { if (code !== 1000 && code !== 4000) { toast({ text: "Disconnected from the court", color: "#ff6b3d" }); leave(); } }),
    ];
    if (session.roster) { setRoster({ ...session.roster }); engine.loadCourt(session.roster.court || "the_block"); }
    engine.onUi = (e) => {
      const ev = { ...e, id: idRef.current++ };
      if (e.kind === "center") setCenter(ev);
      else if (e.kind === "timing") setTiming(ev);
      else if (e.kind === "dunk") setDunk(ev);
      else if (e.kind === "contest") setContest(ev);
      else if (e.kind === "hint") setHint(e.text);
      else setFeed((f) => [...f.slice(-4), ev]);
    };
    engine.onPauseRequest = () => { setPaused((p) => { const n = !p; engine.setPaused(n); if (!n) engine.lockPointer(); return n; }); };
    engine.onScoreboard = (d) => setBoard(d);
    const iv = setInterval(() => { setHud(engine.hud()); setLocked(document.pointerLockElement === engine.renderer.domElement); }, 100);
    const onLock = () => setLocked(document.pointerLockElement === engine.renderer.domElement);
    document.addEventListener("pointerlockchange", onLock);
    return () => { offs.forEach((f) => f()); clearInterval(iv); document.removeEventListener("pointerlockchange", onLock); engine.onUi = () => {}; engine.onPauseRequest = () => {}; };
  }, [session]);

  // timers for transient overlays
  useEffect(() => { if (!center) return; const t = setTimeout(() => setCenter(null), center.big ? 2400 : 1700); return () => clearTimeout(t); }, [center]);
  useEffect(() => { if (!timing) return; const t = setTimeout(() => setTiming(null), 1300); return () => clearTimeout(t); }, [timing]);
  useEffect(() => { if (!contest) return; const t = setTimeout(() => setContest(null), 1800); return () => clearTimeout(t); }, [contest]);
  useEffect(() => { if (!dunk) return; const t = setTimeout(() => setDunk(null), 2600); return () => clearTimeout(t); }, [dunk]);
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(""), 2600); return () => clearTimeout(t); }, [hint]);
  useEffect(() => { if (feed.length === 0) return; const t = setTimeout(() => setFeed((f) => f.slice(1)), 4000); return () => clearTimeout(t); }, [feed]);
  useEffect(() => { if (roster?.phase === "lobby" && roster.visibility === "private") refreshSocial(); }, [roster?.phase]);

  const inLobby = roster?.phase === "lobby";
  const mode = (hud?.mode ?? roster?.settings.mode ?? "1v1") as Mode;
  const teamGame = mode === "1v1" || mode === "2v2" || mode === "3v3";
  const names = (t: 0 | 1) => {
    const ps = hud?.players.filter((p) => p.team === t) ?? [];
    if (mode === "1v1") return ps[0]?.name ?? (t === 0 ? "HOME" : "AWAY");
    return t === 0 ? "HOME" : "AWAY";
  };

  return (
    <div className="game-ui">
      {/* shot meter (moved every frame by the engine) */}
      <div className="meter" ref={meterRef}><div className="meter-track"><div className="meter-zone" /><div className="meter-fill" /></div><div className="meter-label" /><div className="meter-contest" /></div>

      {!inLobby && hud && teamGame && (
        <div className="scorebug">
          <div className="sb-team" style={{ borderColor: TEAM_COLORS[0] }}>
            <span className="sb-name">{names(0)}</span>{hud.poss === 0 && hud.phase !== "gameover" && <span className="sb-poss">●</span>}<span className="sb-score">{hud.score[0]}</span>
          </div>
          <div className="sb-mid">
            <div className="sb-clock">{fmtClock(hud.time)}{hud.timeLimit ? <small> / {fmtClock(hud.timeLimit)}</small> : null}</div>
            <div className={hud.shotClock < 4 && hud.phase === "live" ? "sb-shot low" : "sb-shot"}>{hud.phase === "live" ? Math.ceil(hud.shotClock) : "—"}</div>
            <div className="sb-target">TO {roster?.settings.target ?? 11}</div>
          </div>
          <div className="sb-team right" style={{ borderColor: TEAM_COLORS[1] }}>
            <span className="sb-score">{hud.score[1]}</span>{hud.poss === 1 && hud.phase !== "gameover" && <span className="sb-poss">●</span>}<span className="sb-name">{names(1)}</span>
          </div>
          {hud.clear && hud.phase === "live" && <div className="sb-clear">CLEAR IT</div>}
        </div>
      )}
      {!inLobby && hud?.extra?.shootout && (
        <div className="scorebug solo">
          <div className="sb-big">{hud.extra.shootout.score}<small>PTS</small></div>
          <div className="racks">{[0, 1, 2, 3, 4].map((r) => <div key={r} className={r < hud.extra!.shootout!.rack ? "rack done" : r === hud.extra!.shootout!.rack ? "rack now" : "rack"}>{[0, 1, 2, 3, 4].map((b) => <i key={b} className={(r < hud.extra!.shootout!.rack || (r === hud.extra!.shootout!.rack && b < hud.extra!.shootout!.ball)) ? "used" : b === 4 ? "money" : ""} />)}</div>)}</div>
          <div className={hud.extra.shootout.left < 10 ? "sb-big low" : "sb-big"}>{Math.ceil(hud.extra.shootout.left)}<small>SEC</small></div>
        </div>
      )}
      {!inLobby && hud?.extra?.dunk && (
        <div className="scorebug solo">
          <div className="sb-big">{hud.extra.dunk.total.toFixed(1)}<small>TOTAL</small></div>
          <div className="sb-mid"><div className="sb-target">ATTEMPT {Math.min(5, hud.extra.dunk.attempt + 1)} / 5</div></div>
          <div className="sb-big">{Math.ceil(hud.extra.dunk.left)}<small>SEC</small></div>
        </div>
      )}

      {hud && !inLobby && (
        <div className="stamina"><span>STAMINA</span><div className="bar"><div style={{ width: `${hud.stamina * 100}%`, background: hud.stamina < 0.25 ? "#ff6b3d" : "#f2efe8" }} /></div>{hud.hasBall && <b className="ballflag">● BALL</b>}</div>
      )}

      <div className="feed">{feed.map((f) => <div key={f.id} className="feed-item" style={{ borderColor: f.color }}><b>{f.text}</b>{f.sub && <small>{f.sub}</small>}</div>)}</div>
      {center && <div key={center.id} className={center.big ? "center-text big" : "center-text"} style={{ color: center.color }}><div>{center.text}</div>{center.sub && <small>{center.sub}</small>}</div>}
      {timing && <div key={timing.id} className="timing-text" style={{ color: timing.color }}>{timing.text}{timing.tag && <span className="contest-tag" style={{ color: timing.tagColor, borderColor: timing.tagColor }}>{timing.tag}</span>}{timing.sub && <small>{timing.sub}</small>}</div>}
      {contest && <div key={contest.id} className="contest-text" style={{ color: contest.color }}>{contest.text}{contest.sub && <small>{contest.sub}</small>}</div>}
      {dunk && <div key={dunk.id} className="dunk-score" style={{ color: dunk.color }}><div className="ds-num">{dunk.text}</div><small>{dunk.sub}</small></div>}
      {hint && <div className="hint">{hint}</div>}
      {settings.showFps && <div className="fps">{hud?.fps ?? engine.fps} FPS</div>}

      {!locked && !paused && !results && (
        <div className="click-to-play" onClick={() => { audio.unlock(); engine.lockPointer(); }}>
          <b>CLICK TO PLAY</b><small>Mouse looks around · Esc to pause</small>
        </div>
      )}
      {!results && <div className="qm-bar">{QUICK_MESSAGES.map((m, i) => <span key={i}><kbd>{i + 1}</kbd>{m}</span>)}</div>}

      {inLobby && roster && session && <LobbyPanel roster={roster} open={panelOpen} setOpen={setPanelOpen} onLeave={leave} social={social} />}
      {board && hud && <BoxScore players={hud.players} mode={mode} />}
      {paused && <PauseMenu onResume={() => { setPaused(false); engine.setPaused(false); engine.lockPointer(); }} onLeave={leave} />}
      {results && <Results data={results} meId={session?.me ?? ""} onLeave={leave} rematch={rematch} roster={roster} />}
    </div>
  );
}

// ---------------------------------------------------------------- lobby
function LobbyPanel({ roster, open, setOpen, onLeave, social }: { roster: Roster; open: boolean; setOpen: (b: boolean) => void; onLeave: () => void; social: any }) {
  const { session, me, toast } = useStore();
  const [courts, setCourts] = useState<CourtDef[]>(COURTS.slice(0, 1));
  useEffect(() => { availableCourts().then(setCourts); }, []);
  const host = roster.host === session?.me;
  const mySeat = roster.seats.find((s) => s.id === session?.me);
  const size = MODE_INFO[roster.settings.mode].size;
  const send = (t: string, d?: any) => session?.send(t, d);
  const set = (d: any) => send("settings", d);
  const teamList = (t: 0 | 1) => {
    const seats = roster.seats.filter((s) => s.team === t);
    const empty = Math.max(0, size - seats.length);
    return (
      <div className="lobby-team" style={{ borderColor: TEAM_COLORS[t] }}>
        <div className="lt-head" style={{ color: TEAM_COLORS[t] }}>{t === 0 ? "HOME" : "AWAY"}</div>
        {seats.map((s) => (
          <div key={s.id} className="lt-seat">
            <span className={s.ready ? "ready on" : "ready"}>{s.ready ? "READY" : "—"}</span>
            <b>{s.name}</b>{roster.host === s.id && <span className="tag">HOST</span>}
            <RankBadge name={s.rank} color={s.rankColor} small />
            <span className="muted tiny">{ARCHETYPES[s.loadout.archetype]?.label}</span>
            {!s.connected && <span className="muted tiny">reconnecting…</span>}
          </div>
        ))}
        {Array.from({ length: empty }).map((_, i) => <div key={i} className="lt-seat empty">{roster.fillBots ? "CPU will fill" : "Open spot"}</div>)}
        {mySeat && mySeat.team !== t && <Btn small variant="ghost" onClick={() => send("team", { team: t })}>JOIN {t === 0 ? "HOME" : "AWAY"}</Btn>}
      </div>
    );
  };
  if (!open) return <button className="lobby-toggle" onClick={() => { engine.unlockPointer(); setOpen(true); }}>LOBBY ▸</button>;
  const onlineFriends = (social?.friends ?? []).filter((f: any) => f.status.online && !roster.seats.some((s) => s.id === f.id));
  return (
    <div className="lobby-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="lp-head">
        <div><h2>{roster.visibility === "public" ? "QUICK MATCH" : "PRIVATE COURT"}</h2>
          <p className="muted tiny">Shoot around while you wait. Click the court to play, Esc to get your mouse back.</p></div>
        <button className="x" onClick={() => setOpen(false)}>✕</button>
      </div>
      {roster.visibility === "private" && (
        <div className="room-code" onClick={() => { navigator.clipboard?.writeText(session!.roomId); toast({ text: "Court code copied" }); }}>
          <small>COURT CODE</small><b>{session?.roomId}</b><small>click to copy · friends join from PLAY → JOIN WITH CODE</small>
        </div>
      )}
      {roster.visibility === "public" && <p className="muted">Waiting for players… Match starts when everyone is ready, the court is full, or after 40 seconds (CPU fills empty spots).</p>}
      <div className="lobby-teams">{teamList(0)}{teamList(1)}</div>
      {host && roster.visibility === "private" && (
        <Panel title="MATCH SETTINGS">
          <div className="row"><span>Mode</span><Tabs value={roster.settings.mode as string} onChange={(m) => set({ mode: m })} options={[{ id: "1v1", label: "1V1" }, { id: "2v2", label: "2V2" }, { id: "3v3", label: "3V3" }]} /></div>
          <div className="row"><span>Play to</span><Tabs value={String(roster.settings.target)} onChange={(v) => set({ target: Number(v) })} options={["7", "11", "15", "21"].map((x) => ({ id: x, label: x }))} /></div>
          <div className="row"><span>After a score</span><Tabs value={roster.settings.rule} onChange={(v) => set({ rule: v })} options={[{ id: "losers", label: "LOSERS' BALL" }, { id: "winners", label: "MAKE IT, TAKE IT" }]} /></div>
          <div className="row"><span>Time limit</span><Tabs value={String(roster.settings.timeLimit)} onChange={(v) => set({ timeLimit: Number(v) })} options={[{ id: "0", label: "NONE" }, { id: "300", label: "5 MIN" }, { id: "600", label: "10 MIN" }, { id: "900", label: "15 MIN" }]} /></div>
          <Toggle label="Fill empty spots with CPU" value={roster.fillBots} onChange={(v) => set({ fillBots: v })} />
          {roster.fillBots && <div className="row"><span>CPU level</span><Tabs value={roster.settings.difficulty} onChange={(v) => set({ difficulty: v })} options={[{ id: "rookie", label: "ROOKIE" }, { id: "pro", label: "PRO" }, { id: "legend", label: "LEGEND" }]} /></div>}
          {courts.length > 1 && <div className="row"><span>Court</span><Tabs value={roster.court} onChange={(v) => set({ court: v })} options={courts.map((c) => ({ id: c.id, label: c.name }))} /></div>}
        </Panel>
      )}
      {!host && roster.visibility === "private" && <p className="muted tiny">{MODE_INFO[roster.settings.mode].label} · to {roster.settings.target} · {roster.settings.rule === "losers" ? "losers' ball" : "make it, take it"} · {courts.find((c) => c.id === roster.court)?.name ?? "THE BLOCK"}</p>}
      {roster.visibility === "private" && (
        <Panel title="INVITE FRIENDS">
          {onlineFriends.length === 0 ? <p className="muted tiny">No friends online right now. Share the court code instead.</p> :
            onlineFriends.map((f: any) => <div className="list-row" key={f.id}><span className="status on" /><b>{f.name}</b><div className="grow" /><Btn small variant="accent" onClick={async () => { try { await api.invite(f.id, session!.roomId, roster.settings.mode); toast({ text: `Invited ${f.name}` }); } catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); } }}>INVITE</Btn></div>)}
        </Panel>
      )}
      <div className="lp-foot">
        <Btn variant="ghost" onClick={onLeave}>LEAVE</Btn>
        <div className="grow" />
        <Btn variant={mySeat?.ready ? "default" : "primary"} onClick={() => send("ready", { ready: !mySeat?.ready })}>{mySeat?.ready ? "NOT READY" : "READY UP"}</Btn>
        {host && roster.visibility === "private" && <Btn variant="accent" onClick={() => send("start")}>START NOW</Btn>}
      </div>
      {me && <p className="muted tiny">Match starts when everyone is ready.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- box score (hold Tab)
function BoxScore({ players, mode }: { players: any[]; mode: Mode }) {
  const teams = mode === "shootout" || mode === "dunk" ? [0] : [0, 1];
  return (
    <div className="boxscore">
      {teams.map((t) => (
        <table key={t} className="table">
          <thead><tr><th style={{ color: TEAM_COLORS[t] }}>{t === 0 ? "HOME" : "AWAY"}</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>2PT</th><th>PERF</th></tr></thead>
          <tbody>{players.filter((p) => p.team === t).map((p) => (
            <tr key={p.id} className={p.me ? "me" : ""}><td>{p.name}{p.bot && <span className="tag">CPU</span>}</td><td><b>{p.ss[0]}</b></td><td>{p.ss[1]}</td><td>{p.ss[2]}</td><td>{p.ss[3]}</td><td>{p.ss[4]}</td><td>{p.ss[5]}/{p.ss[6]}</td><td>{p.ss[7]}/{p.ss[8]}</td><td>{p.ss[9]}</td></tr>
          ))}</tbody>
        </table>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pause
function PauseMenu({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const { settings, updateSettings } = useStore();
  const [tab, setTab] = useState<"menu" | "controls" | "options">("menu");
  return (
    <div className="overlay">
      <div className="pause">
        <h1>PAUSED</h1>
        <p className="muted tiny">Online matches keep running while you're paused.</p>
        {tab === "menu" && <div className="pause-list">
          <Btn variant="primary" wide onClick={onResume}>RESUME</Btn>
          <Btn wide onClick={() => setTab("controls")}>CONTROLS</Btn>
          <Btn wide onClick={() => setTab("options")}>QUICK SETTINGS</Btn>
          <Btn variant="danger" wide onClick={onLeave}>LEAVE COURT</Btn>
        </div>}
        {tab === "controls" && <><ControlsGuide /><Btn onClick={() => setTab("menu")}>BACK</Btn></>}
        {tab === "options" && <Panel>
          <Slider label="Mouse sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => updateSettings({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
          <Slider label="Camera distance" value={settings.camDist} min={3.5} max={8} step={0.1} onChange={(v) => updateSettings({ camDist: v })} fmt={(v) => v.toFixed(1)} />
          <Slider label="Master volume" value={settings.master} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ master: v })} fmt={(v) => `${Math.round(v * 100)}`} />
          <Toggle label="Camera follows hoop" value={settings.hoopCam} onChange={(v) => updateSettings({ hoopCam: v })} />
          <Toggle label="Invert Y" value={settings.invertY} onChange={(v) => updateSettings({ invertY: v })} />
          <div className="row"><span>Graphics</span><Tabs value={settings.quality} onChange={(q) => updateSettings({ quality: q })} options={[{ id: "low", label: "LOW" }, { id: "medium", label: "MED" }, { id: "high", label: "HIGH" }]} /></div>
          <Btn onClick={() => setTab("menu")}>BACK</Btn>
        </Panel>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results
function Results({ data, meId, onLeave, rematch, roster }: { data: any; meId: string; onLeave: () => void; rematch: { votes: number; need: number } | null; roster: Roster | null }) {
  const { session } = useStore();
  const r = data.result;
  const me = r.players.find((p: any) => p.id === meId);
  const rw = data.rewards?.[meId];
  const team = r.mode === "1v1" || r.mode === "2v2" || r.mode === "3v3";
  const won = team && r.winner === me?.team;
  const [voted, setVoted] = useState(false);
  const host = roster?.host === meId;
  return (
    <div className="overlay results">
      <div className="results-card">
        {team ? <h1 className={won ? "win" : "lose"}>{won ? "VICTORY" : "DEFEAT"}</h1> : <h1 className="win">{r.mode === "shootout" ? "SHOOTOUT" : "DUNK CONTEST"}</h1>}
        {team ? <div className="final"><span style={{ color: TEAM_COLORS[0] }}>{r.score[0]}</span> — <span style={{ color: TEAM_COLORS[1] }}>{r.score[1]}</span></div>
          : <div className="final">{r.mode === "shootout" ? `${r.shootoutScore} PTS` : `${(r.dunkScore ?? 0).toFixed(1)} PTS`}</div>}
        <p className="muted tiny">{MODE_INFO[r.mode as Mode].label} · {fmtClock(r.duration)}</p>
        {data.offline ? <p className="warn">Offline practice — nothing was saved.</p> : rw && (
          <div className="rewards">
            <div className="rw"><small>REP</small><b>+{rw.rep}</b></div>
            <div className="rw"><small>COINS</small><b>+{rw.coins}</b></div>
            <div className="rw"><small>RANK</small><RankBadge name={rw.rank.name} color={rw.rank.color} /></div>
            {rw.rankUp && <div className="rankup">RANK UP — {rw.rankUp.toUpperCase()}!</div>}
            <div className="muted tiny">{rw.reasons.join(" · ")}</div>
          </div>
        )}
        {rw?.rivalry && rw.rivalry.games > 0 && (
          <div className="rivalry-box">
            <small>RIVALRY vs {rw.rivalry.name}</small>
            <div><b className="w">{rw.rivalry.wins}W</b> – <b className="l">{rw.rivalry.losses}L</b> · {rw.rivalry.pct}% · {rw.rivalry.streak > 0 ? `on a W${rw.rivalry.streak} streak` : `L${-rw.rivalry.streak} streak`}</div>
          </div>
        )}
        {team && (
          <table className="table">
            <thead><tr><th>PLAYER</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>2PT</th></tr></thead>
            <tbody>{r.players.map((p: any) => (
              <tr key={p.id} className={p.id === meId ? "me" : ""}><td><i className="tdot" style={{ background: TEAM_COLORS[p.team] }} />{p.name}{p.bot && <span className="tag">CPU</span>}</td><td><b>{p.stats.pts}</b></td><td>{p.stats.reb}</td><td>{p.stats.ast}</td><td>{p.stats.stl}</td><td>{p.stats.blk}</td><td>{pct(p.stats.fgm, p.stats.fga)}</td><td>{p.stats.tpm}/{p.stats.tpa}</td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="results-actions">
          <Btn variant="primary" disabled={voted} onClick={() => { setVoted(true); session?.send("rematch"); }}>{voted ? `WAITING (${rematch?.votes ?? 1}/${rematch?.need ?? 1})` : team ? "RUN IT BACK" : "TRY AGAIN"}</Btn>
          {roster && roster.visibility === "private" && host && <Btn onClick={() => session?.send("lobby")}>BACK TO LOBBY</Btn>}
          <Btn variant="ghost" onClick={onLeave}>MAIN MENU</Btn>
        </div>
      </div>
    </div>
  );
}

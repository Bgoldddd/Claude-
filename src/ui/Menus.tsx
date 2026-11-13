import React, { useEffect, useState } from "react";
import { useStore } from "./store";
import { Btn, Panel, ScreenHeader, Slider, Tabs, Toggle, RankBadge, Bar, Loading } from "./components";
import { api, ApiError, auth } from "../net/api";
import { OnlineSession, LocalSession } from "../net/session";
import { engine } from "../game/engine";
import { audio } from "../game/audio";
import { availableCourts, CourtDef, COURTS } from "../game/assets";
import { BIND_LABELS, Bind, DEFAULT_BINDS, keyName } from "../game/input";
import { MODE_INFO, Mode } from "../../shared/constants";
import { ARCHETYPES } from "../../shared/progression";
import { QUICK_MESSAGES } from "../../shared/cosmetics";
import type { Archetype } from "../../shared/types";

// ---------------------------------------------------------------- create player (first launch)
export function CreatePlayer() {
  const { setMe, go, toast, online } = useStore();
  const [name, setName] = useState("");
  const [arch, setArch] = useState<Archetype>("allaround");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.guest(name);
      auth.set(r.token);
      const me = await api.saveLoadout({ ...r.profile.loadout, archetype: arch });
      setMe(me); engine.setMyLoadout(me.loadout);
      toast({ text: `Welcome to the court, ${me.name}`, sub: "Customize your look in MY PLAYER" });
      go("myplayer");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="screen center-screen">
      <div className="create-card">
        <div className="logo small">COURT<span>SIDE</span></div>
        <h2>CREATE YOUR PLAYER</h2>
        {!online && <p className="warn">Can't reach the game server. Start it with <code>npm run dev</code>, then reload.</p>}
        <label className="field"><span>Player name</span>
          <input autoFocus maxLength={16} value={name} onChange={(e) => setName(e.target.value)} placeholder="3-16 letters or numbers" onKeyDown={(e) => e.key === "Enter" && submit()} />
        </label>
        <div className="field"><span>Play style</span>
          <div className="arch-grid">
            {(Object.keys(ARCHETYPES) as Archetype[]).map((a) => (
              <button key={a} className={a === arch ? "arch active" : "arch"} onClick={() => { audio.click(); setArch(a); }}>
                <b>{ARCHETYPES[a].label}</b><small>{ARCHETYPES[a].desc}</small>
              </button>
            ))}
          </div>
        </div>
        {err && <p className="error">{err}</p>}
        <Btn variant="primary" wide disabled={busy || name.trim().length < 3 || !online} onClick={submit}>{busy ? "CREATING…" : "CREATE PLAYER"}</Btn>
        <p className="muted tiny">Your account is a private guest account saved on the game server. No email or personal info is collected.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- main menu
export function MainMenu() {
  const { go, me, online, social } = useStore();
  const items: { id: any; label: string; sub: string }[] = [
    { id: "play", label: "PLAY", sub: "1v1 · 2v2 · 3v3 · Shootout · Dunk Contest" },
    { id: "myplayer", label: "MY PLAYER", sub: "Look, style and play type" },
    { id: "courts", label: "COURTS", sub: "Pick where you run" },
    { id: "friends", label: "FRIENDS", sub: social ? `${social.friends.filter((f: any) => f.status.online).length} online · ${social.incoming.length} requests` : "Rivals and invites" },
    { id: "leaderboards", label: "LEADERBOARDS", sub: "Who runs the block" },
    { id: "profile", label: "PROFILE", sub: "Stats and match history" },
    { id: "settings", label: "SETTINGS", sub: "Graphics, audio, controls" },
  ];
  return (
    <div className="screen menu-screen">
      <div className="menu-left">
        <div className="logo">COURT<span>SIDE</span></div>
        <div className="tagline">STREET BASKETBALL · THE BLOCK IS OPEN</div>
        <nav className="menu-list">
          {items.map((it, i) => (
            <button key={it.id} className="menu-item" style={{ animationDelay: `${i * 40}ms` }} onMouseEnter={() => audio.hover()} onClick={() => { audio.unlock(); go(it.id); }} disabled={!online && ["friends", "leaderboards", "profile"].includes(it.id)}>
              <span className="mi-label">{it.label}</span><span className="mi-sub">{it.sub}</span>
            </button>
          ))}
        </nav>
        {!online && <p className="warn">Offline version: play vs CPU, Shootout and Dunk Contest. Multiplayer, friends and saving need the game server.</p>}
      </div>
      {me && <ProfileChip />}
    </div>
  );
}

export function ProfileChip() {
  const { me, go } = useStore();
  if (!me) return null;
  return (
    <div className="profile-chip" onClick={() => go("profile")}>
      <div className="pc-name">{me.name}</div>
      <div className="pc-row"><RankBadge name={me.rankInfo.name} color={me.rankInfo.color} small /><span className="coins">● {me.coins}</span></div>
      <Bar value={me.rankInfo.progress} color={me.rankInfo.color} />
      <div className="tiny muted">{me.rep} REP{me.rankInfo.next ? ` · ${me.rankInfo.next - me.rep} to ${me.rankInfo.nextName}` : " · MAX RANK"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- play
const MODES: Mode[] = ["1v1", "2v2", "3v3", "shootout", "dunk"];

export function Play() {
  const { go, online, setSession, toast, settings, me, loadout } = useStore();
  const [mode, setMode] = useState<Mode>("1v1");
  const [diff, setDiff] = useState<"rookie" | "pro" | "legend">("pro");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const team = mode === "1v1" || mode === "2v2" || mode === "3v3";

  const start = async (kind: "cpu" | "quick" | "private" | "join" | "offline") => {
    setBusy(kind);
    try {
      let s;
      if (kind === "offline") s = new LocalSession(mode, diff, loadout, me?.name ?? "You", settings.court);
      else if (kind === "cpu") s = await OnlineSession.create({ mode, solo: true, difficulty: diff, court: settings.court });
      else if (kind === "quick") s = await OnlineSession.create({ mode, public: true, court: settings.court });
      else if (kind === "private") s = await OnlineSession.create({ mode, difficulty: diff, court: settings.court });
      else s = await OnlineSession.join(code);
      setSession(s); go("game");
    } catch (e) {
      const msg = (e as Error).message || String(e);
      toast({ text: "Couldn't start", sub: /not found|locked|full/i.test(msg) ? "That court code is not open (wrong code, full, or match in progress)." : msg, color: "#ff6b3d" });
    }
    setBusy("");
  };

  return (
    <div className="screen">
      <ScreenHeader title="PLAY" sub="Pick a mode, then how you want to run it" onBack={() => go("menu")} />
      <div className="mode-cards">
        {MODES.map((m) => (
          <button key={m} className={m === mode ? "mode-card active" : "mode-card"} onClick={() => { audio.click(); setMode(m); }}>
            <div className="mc-size">{m === "shootout" ? "60s" : m === "dunk" ? "×5" : m.toUpperCase()}</div>
            <div className="mc-title">{MODE_INFO[m].label}</div>
            <div className="mc-desc">{MODE_INFO[m].desc}</div>
          </button>
        ))}
      </div>
      <div className="play-options">
        {team && (
          <Panel title="VS CPU">
            <p className="muted">Real match on the server vs computer players. Earn REP and coins.</p>
            <Tabs value={diff} onChange={setDiff} options={[{ id: "rookie", label: "ROOKIE" }, { id: "pro", label: "PRO" }, { id: "legend", label: "LEGEND" }]} />
            <Btn variant="primary" wide disabled={!!busy} onClick={() => start(online ? "cpu" : "offline")}>{busy ? "LOADING…" : "PLAY VS CPU"}</Btn>
            {!online && <p className="muted tiny">Offline: runs in your browser. Stats and rewards are not saved.</p>}
          </Panel>
        )}
        {!team && (
          <Panel title={MODE_INFO[mode].label}>
            <p className="muted">{mode === "shootout" ? "Five racks around the arc. Every 5th ball is the money ball (2 points). Score is saved to the leaderboard." : "Run in and press shoot near the rim. During the jump press C for a 360 and Space for a windmill. Release shoot at the top for a clean finish."}</p>
            <Btn variant="primary" wide disabled={!!busy} onClick={() => start(online ? "cpu" : "offline")}>{busy ? "LOADING…" : "START"}</Btn>
          </Panel>
        )}
        {team && (
          <Panel title="ONLINE">
            <p className="muted">Quick Match finds an open public court. If nobody joins in 40 seconds, CPU players fill the spots.</p>
            <Btn variant="accent" wide disabled={!online || !!busy} onClick={() => start("quick")}>{busy === "quick" ? "SEARCHING…" : "QUICK MATCH"}</Btn>
            <div className="sep" />
            <p className="muted">Private Court: you host. Invite friends or share the code.</p>
            <Btn wide disabled={!online || !!busy} onClick={() => start("private")}>{busy === "private" ? "OPENING…" : "OPEN PRIVATE COURT"}</Btn>
          </Panel>
        )}
        <Panel title="JOIN WITH CODE">
          <p className="muted">Got a court code from a friend?</p>
          <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="Court code" maxLength={20} />
          <Btn wide disabled={!online || code.length < 4 || !!busy} onClick={() => start("join")}>{busy === "join" ? "JOINING…" : "JOIN COURT"}</Btn>
          {(team || mode === "shootout" || mode === "dunk") && (
            <>
              <div className="sep" />
              <p className="muted">Offline practice runs in your browser. Nothing is saved.</p>
              <Btn variant="ghost" wide disabled={!!busy} onClick={() => start("offline")}>PRACTICE OFFLINE</Btn>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- courts
export function Courts() {
  const { go, settings, updateSettings } = useStore();
  const [avail, setAvail] = useState<CourtDef[] | null>(null);
  useEffect(() => { availableCourts().then(setAvail); }, []);
  return (
    <div className="screen">
      <ScreenHeader title="COURTS" sub="Your pick is used for CPU games and courts you host" onBack={() => go("menu")} />
      {!avail ? <Loading /> : (
        <div className="court-grid">
          {COURTS.filter((c) => avail.some((a) => a.id === c.id)).map((c) => (
            <button key={c.id} className={settings.court === c.id ? "court-card active" : "court-card"} onClick={() => { audio.click(); updateSettings({ court: c.id }); engine.loadCourt(c.id); }}>
              <div className={`court-art art-${c.id}`} />
              <div className="cc-name">{c.name}</div>
              <div className="cc-tag">{c.tagline}</div>
              {settings.court === c.id && <div className="cc-sel">SELECTED</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
export function SettingsScreen() {
  const { go, settings, updateSettings, me, setMe, toast } = useStore();
  const [tab, setTab] = useState<"graphics" | "audio" | "controls" | "account">("graphics");
  const [listening, setListening] = useState<Bind | null>(null);
  const [name, setName] = useState(me?.name ?? "");
  useEffect(() => {
    if (!listening) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== "Escape") updateSettings({ binds: { ...settings.binds, [listening]: e.code } });
      setListening(null);
    };
    window.addEventListener("keydown", h, { capture: true, once: true });
    return () => window.removeEventListener("keydown", h, { capture: true } as any);
  }, [listening]);
  return (
    <div className="screen">
      <ScreenHeader title="SETTINGS" onBack={() => go("menu")} />
      <Tabs value={tab} onChange={setTab} options={[{ id: "graphics", label: "GRAPHICS" }, { id: "audio", label: "AUDIO" }, { id: "controls", label: "CONTROLS" }, { id: "account", label: "ACCOUNT" }]} />
      <div className="settings-body">
        {tab === "graphics" && (
          <Panel>
            <div className="row"><span>Quality</span>
              <Tabs value={settings.quality} onChange={(q) => updateSettings({ quality: q })} options={[{ id: "low", label: "LOW" }, { id: "medium", label: "MEDIUM" }, { id: "high", label: "HIGH" }]} />
            </div>
            <p className="muted tiny">Low: no shadows, no glow, no crowd (fastest). Medium: shadows + glow. High: sharper shadows, full crowd, full resolution.</p>
            <Toggle label="Show FPS counter" value={settings.showFps} onChange={(v) => updateSettings({ showFps: v })} />
            <Toggle label="Show shot meter" value={settings.showMeter} onChange={(v) => updateSettings({ showMeter: v })} />
          </Panel>
        )}
        {tab === "audio" && (
          <Panel>
            <Slider label="Master" value={settings.master} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ master: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Slider label="Game sounds" value={settings.sfx} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ sfx: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Slider label="Crowd" value={settings.crowd} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ crowd: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Slider label="Menu sounds" value={settings.ui} min={0} max={1} step={0.05} onChange={(v) => updateSettings({ ui: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Btn small onClick={() => { audio.unlock(); audio.rim(4); setTimeout(() => audio.chain(true), 300); }}>TEST SOUND</Btn>
          </Panel>
        )}
        {tab === "controls" && (
          <div className="two-col">
            <Panel title="CAMERA">
              <Slider label="Mouse sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => updateSettings({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label="Camera distance" value={settings.camDist} min={3.5} max={8} step={0.1} onChange={(v) => updateSettings({ camDist: v })} fmt={(v) => `${v.toFixed(1)} m`} />
              <Toggle label="Invert Y" value={settings.invertY} onChange={(v) => updateSettings({ invertY: v })} />
              <Toggle label="Camera follows hoop (V)" value={settings.hoopCam} onChange={(v) => updateSettings({ hoopCam: v })} />
            </Panel>
            <Panel title="KEYS" right={<Btn small variant="ghost" onClick={() => updateSettings({ binds: { ...DEFAULT_BINDS } })}>RESET</Btn>}>
              {(Object.keys(BIND_LABELS) as Bind[]).map((b) => (
                <div className="row bind" key={b}>
                  <span>{BIND_LABELS[b]}</span>
                  <button className={listening === b ? "key listening" : "key"} onClick={() => setListening(b)}>{listening === b ? "Press a key…" : keyName(settings.binds[b])}</button>
                </div>
              ))}
              <div className="row bind"><span>Shoot (hold, release on time)</span><span className="key fixed">Left Mouse</span></div>
              <div className="row bind"><span>Defensive stance / contest</span><span className="key fixed">Right Mouse</span></div>
              <div className="row bind"><span>Quick messages</span><span className="key fixed">1 – 8</span></div>
              <div className="row bind"><span>Pause</span><span className="key fixed">Esc</span></div>
            </Panel>
          </div>
        )}
        {tab === "account" && me && (
          <Panel title="ACCOUNT">
            <label className="field"><span>Player name</span><input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} /></label>
            <Btn small disabled={name === me.name} onClick={async () => { try { const m = await api.rename(name); setMe(m); toast({ text: "Name saved" }); } catch (e) { toast({ text: (e as ApiError).message, color: "#ff6b3d" }); } }}>SAVE NAME</Btn>
            <div className="sep" />
            <p className="muted tiny">Friend code: <b>{me.friendCode}</b>. Your progress is saved on the game server under a private guest key stored in this browser. Clearing browser data will lose access to this player.</p>
          </Panel>
        )}
      </div>
      <ControlsGuide inline />
    </div>
  );
}

export function ControlsGuide({ inline, onClose }: { inline?: boolean; onClose?: () => void }) {
  const { settings } = useStore();
  const b = settings.binds;
  const rows: [string, string][] = [
    [`${keyName(b.forward)} ${keyName(b.left)} ${keyName(b.back)} ${keyName(b.right)}`, "Move (relative to camera)"],
    ["Mouse", "Look around (click the court to lock the mouse)"],
    [keyName(b.sprint), "Sprint (uses stamina)"],
    ["Hold Left Mouse", "Shoot — release when the meter hits the green line"],
    ["Right Mouse", "Defensive stance — quicker side steps, better contests"],
    [keyName(b.jump), "Jump: block shots, grab rebounds"],
    [keyName(b.pass), "Pass toward where you move or look"],
    [keyName(b.move), "Dribble move: + side = crossover, + forward = hesitation, + back = between the legs, still = behind the back"],
    [keyName(b.action), "Offense: step-back. Defense: steal (reaching too much leaves you off balance)"],
    [keyName(b.interact), "Check the ball / start the possession"],
    [keyName(b.scoreboard), "Box score"],
    [keyName(b.camera), "Switch camera: free mouse / follow hoop"],
    ["1 – 8", `Quick messages (${QUICK_MESSAGES.slice(0, 3).join(", ")}…)`],
    ["Esc", "Pause"],
  ];
  return (
    <Panel title="CONTROLS GUIDE" className={inline ? "guide inline" : "guide"} right={onClose && <Btn small variant="ghost" onClick={onClose}>CLOSE</Btn>}>
      <div className="guide-grid">
        {rows.map(([k, d]) => <React.Fragment key={k + d}><span className="key fixed">{k}</span><span>{d}</span></React.Fragment>)}
      </div>
      <p className="muted tiny">Tips: dunks need speed (sprint toward the rim). Inside the arc after a steal or defensive rebound you must clear it — take it behind the arc first. Shots are 1 point inside the arc, 2 beyond it. First to 11, win by 2.</p>
    </Panel>
  );
}

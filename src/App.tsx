import React, { useEffect, useRef, useState } from "react";
import { StoreProvider, useStore } from "./ui/store";
import { MainMenu, CreatePlayer, Play, Courts, SettingsScreen } from "./ui/Menus";
import { MyPlayer } from "./ui/MyPlayer";
import { Friends, Leaderboards, Profile } from "./ui/Social";
import { GameScreen } from "./ui/GameUI";
import { Btn } from "./ui/components";
import { engine } from "./game/engine";
import { audio } from "./game/audio";
import { api, ApiError, auth } from "./net/api";
import { OnlineSession } from "./net/session";
import { MODE_INFO } from "../shared/constants";

function Shell() {
  const st = useStore();
  const { screen, go, setMe, setOnline, toasts, dismiss, online, session, setSession, toast, refreshSocial, social, me, settings } = st;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState({ p: 0, label: "Starting" });
  const [bootErr, setBootErr] = useState("");
  const seenInvites = useRef(new Set<string>());

  // boot: 3D engine + server + profile
  useEffect(() => {
    (async () => {
      try {
        await engine.init(canvasRef.current!, (p, label) => setProgress({ p, label }));
      } catch (e) { setBootErr((e as Error).message); return; }
      let isOnline = false;
      try { await api.health(); isOnline = true; } catch { /* offline */ }
      setOnline(isOnline);
      engine.setMode("menu");
      if (isOnline && auth.token) {
        try { const m = await api.me(); setMe(m); engine.setMyLoadout(m.loadout); if (m.settings && Object.keys(m.settings).length) st.updateSettings(m.settings); go("menu"); return; }
        catch (e) { if (e instanceof ApiError && e.status === 401) auth.set(null); }
      }
      go(isOnline ? "create" : "menu");
    })();
  }, []);

  // engine mode follows the screen
  useEffect(() => {
    if (screen === "game") return;
    engine.setMode(screen === "myplayer" ? "locker" : "menu");
    if (screen === "menu" && !session) engine.loadCourt(settings.court).catch(() => engine.loadCourt("the_block"));
  }, [screen]);

  // social polling: friend presence, requests and invites
  useEffect(() => {
    if (!online || !me) return;
    refreshSocial();
    const iv = setInterval(refreshSocial, 6000);
    return () => clearInterval(iv);
  }, [online, me?.id]);
  useEffect(() => {
    if (!social) return;
    for (const inv of social.invites) {
      if (seenInvites.current.has(inv.id)) continue;
      seenInvites.current.add(inv.id);
      audio.perfect();
      toast({
        text: inv.kind === "challenge" ? `${inv.fromName} CHALLENGES YOU` : `${inv.fromName} invited you`,
        sub: `${MODE_INFO[inv.mode as keyof typeof MODE_INFO]?.label ?? inv.mode} on a private court`, color: "#00d0f0", ttl: 0,
        actions: [
          { label: "JOIN", run: async () => { try { session?.leave(); engine.detach(); const s = await OnlineSession.join(inv.roomId); setSession(s); go("game"); } catch { toast({ text: "That court is closed", color: "#ff6b3d" }); } api.dismissInvite(inv.id).catch(() => {}); } },
          { label: "LATER", run: () => { api.dismissInvite(inv.id).catch(() => {}); } },
        ],
      });
    }
  }, [social]);

  return (
    <>
      <div className="canvas-host" ref={canvasRef} />
      <div className={`ui-layer screen-${screen}`}>
        {screen === "boot" && (
          <div className="boot">
            <div className="logo">COURT<span>SIDE</span></div>
            {bootErr ? <p className="error">Couldn't start the 3D engine: {bootErr}. Your browser needs WebGL 2.</p> : <>
              <div className="bootbar"><div style={{ width: `${progress.p * 100}%` }} /></div>
              <p className="muted">{progress.label}…</p>
            </>}
          </div>
        )}
        {screen === "create" && <CreatePlayer />}
        {screen === "menu" && <MainMenu />}
        {screen === "play" && <Play />}
        {screen === "myplayer" && <MyPlayer />}
        {screen === "courts" && <Courts />}
        {screen === "friends" && <Friends />}
        {screen === "leaderboards" && <Leaderboards />}
        {screen === "profile" && <Profile />}
        {screen === "settings" && <SettingsScreen />}
        {screen === "game" && session && <GameScreen />}
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ borderColor: t.color ?? "var(--orange)" }}>
            <b>{t.text}</b>{t.sub && <small>{t.sub}</small>}
            {t.actions && <div className="toast-actions">{t.actions.map((a) => <Btn key={a.label} small variant={a.label === "JOIN" ? "primary" : "ghost"} onClick={() => { dismiss(t.id); a.run(); }}>{a.label}</Btn>)}</div>}
            {!t.actions && <button className="x" onClick={() => dismiss(t.id)}>✕</button>}
          </div>
        ))}
      </div>
    </>
  );
}

export default function App() {
  return <StoreProvider><Shell /></StoreProvider>;
}

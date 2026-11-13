// App-wide state: profile, settings, current session, toasts.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError, Me } from "../net/api";
import { Session } from "../net/session";
import { engine, EngineSettings } from "../game/engine";
import { audio } from "../game/audio";
import { DEFAULT_BINDS, Bind } from "../game/input";
import { defaultLoadout, Loadout } from "../../shared/cosmetics";

export type Screen = "boot" | "create" | "menu" | "play" | "myplayer" | "courts" | "friends" | "leaderboards" | "profile" | "settings" | "game";

export interface Settings extends EngineSettings {
  master: number; sfx: number; crowd: number; ui: number;
  binds: Record<Bind, string>;
  court: string;
}
export const defaultSettings = (): Settings => ({
  quality: "medium", sensitivity: 1, invertY: false, camDist: 5.2, showFps: false, hoopCam: false, showMeter: true,
  master: 0.8, sfx: 0.9, crowd: 0.5, ui: 0.7, binds: { ...DEFAULT_BINDS }, court: "the_block",
});

export interface Toast { id: number; text: string; sub?: string; color?: string; actions?: { label: string; run: () => void }[]; ttl: number }

interface Store {
  screen: Screen; go: (s: Screen) => void;
  me: Me | null; setMe: (m: Me | null) => void; refreshMe: () => Promise<void>;
  online: boolean; setOnline: (b: boolean) => void;
  settings: Settings; updateSettings: (s: Partial<Settings>) => void;
  session: Session | null; setSession: (s: Session | null) => void;
  toasts: Toast[]; toast: (t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => void; dismiss: (id: number) => void;
  social: any; refreshSocial: () => Promise<void>;
  loadout: Loadout; setLocalLoadout: (l: Loadout) => void;
  profileView: string | null; setProfileView: (id: string | null) => void;
}

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

function loadLocalSettings(): Settings {
  try { const s = JSON.parse(localStorage.getItem("courtside.settings") ?? "null"); if (s) return { ...defaultSettings(), ...s, binds: { ...DEFAULT_BINDS, ...(s.binds ?? {}) } }; } catch { /* ignore */ }
  return defaultSettings();
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>("boot");
  const [me, setMe] = useState<Me | null>(null);
  const [online, setOnline] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadLocalSettings);
  const [session, setSession] = useState<Session | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [social, setSocial] = useState<any>(null);
  const [profileView, setProfileView] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const tid = useRef(1);

  const go = useCallback((s: Screen) => { audio.click(); setScreen(s); }, []);
  const toast = useCallback((t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => {
    const id = tid.current++;
    setToasts((ts) => [...ts.slice(-4), { ...t, id, ttl: t.ttl ?? 4000 }]);
    if ((t.ttl ?? 4000) > 0) setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.ttl ?? 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      try { localStorage.setItem("courtside.settings", JSON.stringify(next)); } catch { /* ignore */ }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { api.saveSettings(next).catch(() => {}); }, 800);
      return next;
    });
  }, []);

  // push settings into the engine and audio
  useEffect(() => {
    engine.applySettings({ quality: settings.quality, sensitivity: settings.sensitivity, invertY: settings.invertY, camDist: settings.camDist, showFps: settings.showFps, hoopCam: settings.hoopCam, showMeter: settings.showMeter });
    engine.input.binds = { ...settings.binds };
    audio.setVolumes({ master: settings.master, sfx: settings.sfx, crowd: settings.crowd, ui: settings.ui });
  }, [settings]);

  const refreshMe = useCallback(async () => {
    try { const m = await api.me(); setMe(m); setOnline(true); engine.setMyLoadout(m.loadout); }
    catch (e) { if (e instanceof ApiError && e.status === 0) setOnline(false); throw e; }
  }, []);

  const refreshSocial = useCallback(async () => {
    try { setSocial(await api.social()); } catch { /* offline */ }
  }, []);

  const [localLoadout, setLocalLoadoutState] = useState<Loadout>(() => { try { return { ...defaultLoadout(), ...JSON.parse(localStorage.getItem("courtside.localLoadout") ?? "{}") }; } catch { return defaultLoadout(); } });
  const setLocalLoadout = useCallback((l: Loadout) => { setLocalLoadoutState(l); engine.setMyLoadout(l); try { localStorage.setItem("courtside.localLoadout", JSON.stringify(l)); } catch { /* ignore */ } }, []);
  useEffect(() => { if (!me) engine.setMyLoadout(localLoadout); }, []);
  const loadout = me?.loadout ?? localLoadout;
  return (
    <Ctx.Provider value={{ screen, go, me, setMe, refreshMe, online, setOnline, settings, updateSettings, session, setSession, toasts, toast, dismiss, social, refreshSocial, loadout, setLocalLoadout, profileView, setProfileView }}>
      {children}
    </Ctx.Provider>
  );
}

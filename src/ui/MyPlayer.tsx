import React, { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Btn, ScreenHeader, Tabs, Bar } from "./components";
import { api } from "../net/api";
import { engine } from "../game/engine";
import { audio } from "../game/audio";
import { ITEMS, JERSEY_COLORS, TRIM_COLORS, HAIR_COLORS, SKIN_TONES, Loadout, Item, isOwned, defaultLoadout } from "../../shared/cosmetics";
import { ARCHETYPES, RANKS } from "../../shared/progression";
import type { Archetype } from "../../shared/types";

type Tab = "body" | "hair" | "jersey" | "shorts" | "shoes" | "acc" | "celebrate" | "plate";

interface ItemCtx { can: (id: string) => boolean; rankIdx: number; coins: number; buy: (id: string) => void }
function ItemBtn({ it, active, onPick, ctx }: { it: Item | { id: string; name: string; rank: number; price: number }; active: boolean; onPick: () => void; ctx: ItemCtx }) {
  const unlocked = ctx.can(it.id);
  const rankOk = ctx.rankIdx >= it.rank;
  return (
    <div className={`item ${active ? "active" : ""} ${unlocked ? "" : "locked"}`}>
      <button onClick={() => unlocked ? onPick() : undefined} title={it.name}>{it.name}</button>
      {!unlocked && (rankOk
        ? <Btn small variant="accent" disabled={ctx.coins < it.price} onClick={() => ctx.buy(it.id)}>● {it.price}</Btn>
        : <span className="lock">🔒 {RANKS[it.rank].name}</span>)}
    </div>
  );
}
function Swatches({ colors, value, onPick, lockFn, onLocked }: { colors: string[]; value: string; onPick: (c: string) => void; lockFn?: (c: string) => boolean; onLocked?: (c: string) => void }) {
  return (
    <div className="swatches">{colors.map((c) => {
      const locked = lockFn ? !lockFn(c) : false;
      return <button key={c} className={`sw ${c === value ? "active" : ""} ${locked ? "locked" : ""}`} style={{ background: c }} onClick={() => (locked ? onLocked?.(c) : onPick(c))} title={locked ? "Locked" : c} />;
    })}</div>
  );
}

export function MyPlayer() {
  const { go, me, setMe, toast, online, loadout, setLocalLoadout } = useStore();
  const [draft, setDraft] = useState<Loadout>(me?.loadout ?? loadout);
  const [tab, setTab] = useState<Tab>("body");
  const [saving, setSaving] = useState(false);
  const drag = useRef<number | null>(null);
  const rankIdx = me?.rankInfo.index ?? 0;
  const owned = me?.owned ?? [];

  useEffect(() => { engine.setMyLoadout(draft); }, [draft]);
  const meRef = useRef(me); meRef.current = me;
  const llRef = useRef(loadout); llRef.current = loadout;
  useEffect(() => () => { engine.setMyLoadout(meRef.current ? meRef.current.loadout : llRef.current); }, []); // revert preview if leaving unsaved
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const set = (p: Partial<Loadout>) => { audio.click(); setDraft((d) => ({ ...d, ...p })); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(me?.loadout ?? loadout);

  const save = async () => {
    if (!online) { setLocalLoadout(draft); toast({ text: "Look saved on this browser" }); return; }
    setSaving(true);
    try { const m = await api.saveLoadout(draft); setMe(m); setDraft(m.loadout); toast({ text: "Look saved" }); }
    catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); }
    setSaving(false);
  };
  const buy = async (id: string) => {
    try { const m = await api.buy(id); setMe(m); toast({ text: "Unlocked!", sub: `${m.coins} coins left`, color: "#3dff8a" }); }
    catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); }
  };
  const can = (id: string) => isOwned(id, owned, rankIdx);
  const ctx: ItemCtx = { can, rankIdx, coins: me?.coins ?? 0, buy };

  return (
    <div className="screen myplayer"
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest(".mp-panel")) return; drag.current = e.clientX; }}
      onMouseMove={(e) => { if (drag.current !== null) { engine.lockerSpin = (e.clientX - drag.current) * 0.004; drag.current = e.clientX; } }}
      onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)}>
      <ScreenHeader title="MY PLAYER" sub="Drag to rotate. Cosmetics unlock with rank and coins you earn by playing." onBack={async () => { if (dirty) await save(); go("menu"); }}
        right={<div className="coins big">● {me?.coins ?? 0}</div>} />
      <div className="mp-panel">
        <Tabs value={tab} onChange={setTab} options={[{ id: "body", label: "BODY" }, { id: "hair", label: "HAIR" }, { id: "jersey", label: "JERSEY" }, { id: "shorts", label: "SHORTS" }, { id: "shoes", label: "SHOES" }, { id: "acc", label: "GEAR" }, { id: "celebrate", label: "CELEBRATE" }, { id: "plate", label: "NAMEPLATE" }]} />
        <div className="mp-body">
          {tab === "body" && <>
            <h4>SKIN TONE</h4>
            <Swatches colors={SKIN_TONES} value={SKIN_TONES[draft.skin]} onPick={(c) => set({ skin: SKIN_TONES.indexOf(c) })} />
            <h4>HEIGHT</h4>
            <input type="range" min={0.94} max={1.06} step={0.01} value={draft.height} onChange={(e) => set({ height: Number(e.target.value) })} />
            <div className="muted tiny">{Math.round(195 * draft.height)} cm — looks only, does not change gameplay</div>
            <h4>PLAY STYLE</h4>
            <div className="arch-grid">
              {(Object.keys(ARCHETYPES) as Archetype[]).map((a) => (
                <button key={a} className={a === draft.archetype ? "arch active" : "arch"} onClick={() => set({ archetype: a })}>
                  <b>{ARCHETYPES[a].label}</b><small>{ARCHETYPES[a].desc}</small>
                </button>
              ))}
            </div>
            <div className="attr-bars">
              {([["3PT", "three"], ["MID", "mid"], ["FINISH", "finish"], ["HANDLE", "dribble"], ["DEFENSE", "defense"], ["SPEED", "speed"]] as const).map(([l, k]) => (
                <div key={k} className="attr"><span>{l}</span><Bar value={(ARCHETYPES[draft.archetype].attrs as any)[k]} color="var(--orange)" /><b>{Math.round((ARCHETYPES[draft.archetype].attrs as any)[k] * 99)}</b></div>
              ))}
              <div className="muted tiny">{ARCHETYPES[draft.archetype].attrs.dunk ? "Can dunk in games." : "Lays it up instead of dunking."} Every style has the same total — no one can buy better stats.</div>
            </div>
          </>}
          {tab === "hair" && <>
            <h4>STYLE</h4>
            <div className="items">{ITEMS.filter((i) => i.kind === "hair").map((it) => <ItemBtn ctx={ctx} key={it.id} it={it} active={draft.hair === it.id} onPick={() => set({ hair: it.id })} />)}</div>
            <h4>COLOR</h4>
            <Swatches colors={HAIR_COLORS} value={draft.hairColor} onPick={(c) => set({ hairColor: c })} />
          </>}
          {tab === "jersey" && <>
            <h4>JERSEY COLOR</h4>
            <Swatches colors={JERSEY_COLORS.map((j) => j.color)} value={draft.jerseyColor} onPick={(c) => { setPendingColor(null); set({ jerseyColor: c }); }} lockFn={can} onLocked={(c) => setPendingColor(c)} />
            {pendingColor && (() => { const j = JERSEY_COLORS.find((x) => x.color === pendingColor)!; return (
              <div className="unlock-row"><span className="sw" style={{ background: j.color }} />
                {rankIdx >= j.rank ? <><span>Unlock this colorway</span><Btn small variant="accent" disabled={(me?.coins ?? 0) < j.price} onClick={async () => { await buy(j.id); set({ jerseyColor: j.color }); setPendingColor(null); }}>● {j.price}</Btn></>
                  : <span className="muted">🔒 Reach {RANKS[j.rank].name} to unlock</span>}
              </div>); })()}
            <div className="muted tiny">Faded colors are locked. Click one to see how to unlock it.</div>
            <h4>TRIM</h4>
            <Swatches colors={TRIM_COLORS} value={draft.jerseyTrim} onPick={(c) => set({ jerseyTrim: c })} />
            <h4>NUMBER</h4>
            <div className="row"><input type="number" min={0} max={99} value={draft.jerseyNumber} onChange={(e) => set({ jerseyNumber: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })} className="num-input" />
              <span className="muted tiny">In 2v2 and 3v3 everyone wears team colors so you can tell sides apart.</span></div>
          </>}
          {tab === "shorts" && <>
            <h4>SHORTS</h4>
            <Swatches colors={["#1e1f22", "#ecebe6", "#7d7b76", "#c2541c", "#1f4fa3", "#8b1e2b", "#1f6b46"]} value={draft.shortsColor} onPick={(c) => set({ shortsColor: c })} />
            <h4>TRIM</h4>
            <Swatches colors={TRIM_COLORS} value={draft.shortsTrim} onPick={(c) => set({ shortsTrim: c })} />
            <h4>SOCKS</h4>
            <Swatches colors={["#ecebe6", "#1e1f22", "#7d7b76", "#c2541c"]} value={draft.sockColor} onPick={(c) => set({ sockColor: c })} />
          </>}
          {tab === "shoes" && <div className="items">{ITEMS.filter((i) => i.kind === "shoe").map((it) => (
            <div key={it.id} className="shoe-row"><span className="shoe-dot" style={{ background: it.data.upper, borderColor: it.data.accent }} />
              <ItemBtn ctx={ctx} it={it} active={draft.shoe === it.id} onPick={() => set({ shoe: it.id })} /></div>
          ))}</div>}
          {tab === "acc" && <>
            <div className="items">{ITEMS.filter((i) => i.kind === "accessory").map((it) => (
              <ItemBtn ctx={ctx} key={it.id} it={it} active={draft.accessories.includes(it.id)} onPick={() => set({ accessories: draft.accessories.includes(it.id) ? draft.accessories.filter((a) => a !== it.id) : [...draft.accessories, it.id].slice(0, 4) })} />
            ))}</div>
            <h4>GEAR COLOR</h4>
            <Swatches colors={["#ecebe6", "#1e1f22", "#c2541c", "#00b8d4", "#d4ff3a", "#8b1e2b"]} value={draft.accessoryColor} onPick={(c) => set({ accessoryColor: c })} />
          </>}
          {tab === "celebrate" && <div className="items">{ITEMS.filter((i) => i.kind === "celebration").map((it) => (
            <div key={it.id} className="shoe-row">
              <ItemBtn ctx={ctx} it={it} active={draft.celebration === it.id} onPick={() => { set({ celebration: it.id }); engine.previewCelebration(it.id); }} />
              <Btn small variant="ghost" onClick={() => engine.previewCelebration(it.id)}>▶ PREVIEW</Btn>
            </div>
          ))}</div>}
          {tab === "plate" && <div className="items">{ITEMS.filter((i) => i.kind === "nameplate").map((it) => (
            <div key={it.id} className="shoe-row">
              <span className="plate-prev" style={{ background: it.data.bg, color: it.data.fg, borderColor: it.data.accent }}>{(me?.name ?? "PLAYER").toUpperCase()}</span>
              <ItemBtn ctx={ctx} it={it} active={draft.nameplate === it.id} onPick={() => set({ nameplate: it.id })} />
            </div>
          ))}</div>}
        </div>
        <div className="mp-foot">
          <Btn variant="ghost" disabled={!dirty} onClick={() => setDraft(me?.loadout ?? loadout)}>UNDO</Btn>
          <Btn variant="primary" disabled={!dirty || saving} onClick={save}>{saving ? "SAVING…" : "SAVE LOOK"}</Btn>
        </div>
      </div>
    </div>
  );
}

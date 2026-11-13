import React, { useEffect, useState } from "react";
import { useStore } from "./store";
import { Btn, Panel, ScreenHeader, Tabs, RankBadge, Bar, Loading, pct, timeAgo } from "./components";
import { api } from "../net/api";
import { OnlineSession } from "../net/session";
import { MODE_INFO } from "../../shared/constants";

function RivalLine({ r }: { r: any }) {
  if (!r || !r.games) return <span className="muted tiny">No games yet — challenge them</span>;
  return (
    <div className="rival-line">
      <b className="w">{r.wins}W</b><b className="l">{r.losses}L</b><span>{r.pct}%</span>
      <span className={r.streak > 0 ? "streak hot" : "streak"}>{r.streak > 0 ? `W${r.streak}` : `L${-r.streak}`} streak</span>
      <span className="muted">best W{r.best}</span>
      <span className="recent">{r.recent.slice(0, 5).map((m: any, i: number) => <i key={i} className={m.won ? "dot w" : "dot l"} title={`${m.score[0]}-${m.score[1]} ${m.mode}`} />)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- friends
export function Friends() {
  const { go, social, refreshSocial, me, toast, session, setSession, setProfileView } = useStore();
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"friends" | "rivals" | "recent" | "blocked">("friends");
  const [rivals, setRivals] = useState<any[] | null>(null);
  useEffect(() => { refreshSocial(); api.rivals().then(setRivals).catch(() => setRivals([])); }, []);
  const add = async () => {
    try { const r = await api.friendRequest(code); toast({ text: r.friends ? "You're now friends!" : `Request sent to ${r.name}` }); setCode(""); refreshSocial(); }
    catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); }
  };
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast({ text: msg }); refreshSocial(); } catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); } };
  const challenge = async (f: any) => {
    try {
      session?.leave();
      const s = await OnlineSession.create({ mode: "1v1" });
      await api.invite(f.id, s.roomId, "1v1", "challenge");
      setSession(s); go("game");
      toast({ text: `Challenge sent to ${f.name}`, sub: "Waiting on your private court" });
    } catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); }
  };
  const inviteToRoom = async (f: any) => {
    if (!session?.online || !session.roomId) return;
    try { await api.invite(f.id, session.roomId, session.roster?.settings.mode ?? "1v1"); toast({ text: `Invited ${f.name}` }); } catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); }
  };
  const report = async (id: string, name: string) => {
    const reason = prompt(`Report ${name}? Tell us what happened (optional):`, "");
    if (reason === null) return;
    act(() => api.report(id, reason), "Report sent. Thanks.");
  };
  if (!social) return <div className="screen"><ScreenHeader title="FRIENDS" onBack={() => go("menu")} /><Loading /></div>;
  return (
    <div className="screen">
      <ScreenHeader title="FRIENDS" sub="Add friends with their code. Track every rivalry." onBack={() => go("menu")} />
      <div className="two-col">
        <div>
          <Panel title="YOUR FRIEND CODE">
            <div className="friend-code" onClick={() => { navigator.clipboard?.writeText(me?.friendCode ?? ""); toast({ text: "Code copied" }); }}>{me?.friendCode}<small>click to copy</small></div>
            <div className="row"><input className="code-input" placeholder="Friend's code (CS-XXXXXX)" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              <Btn disabled={code.length < 4} onClick={add}>ADD</Btn></div>
          </Panel>
          {social.incoming.length > 0 && (
            <Panel title={`REQUESTS (${social.incoming.length})`}>
              {social.incoming.map((r: any) => (
                <div className="list-row" key={r.id}><b>{r.name}</b><span className="muted tiny">{timeAgo(r.at)}</span><div className="grow" />
                  <Btn small variant="primary" onClick={() => act(() => api.respond(r.id, true), `You and ${r.name} are friends`)}>ACCEPT</Btn>
                  <Btn small variant="ghost" onClick={() => act(() => api.respond(r.id, false), "Declined")}>DECLINE</Btn></div>
              ))}
            </Panel>
          )}
          {social.outgoing.length > 0 && <Panel title="SENT">{social.outgoing.map((r: any) => <div className="list-row" key={r.id}><span>{r.name}</span><span className="muted tiny">pending</span></div>)}</Panel>}
        </div>
        <div>
          <Tabs value={tab} onChange={setTab} options={[{ id: "friends", label: `FRIENDS (${social.friends.length})` }, { id: "rivals", label: "RIVALRIES" }, { id: "recent", label: "RECENT OPPONENTS" }, { id: "blocked", label: "BLOCKED" }]} />
          {tab === "friends" && (social.friends.length === 0 ? <p className="muted">No friends yet. Share your code!</p> : social.friends.map((f: any) => (
            <div className="friend-card" key={f.id}>
              <div className="fc-top">
                <span className={f.status.online ? "status on" : "status"} />
                <b className="link" onClick={() => { setProfileView(f.id); go("profile"); }}>{f.name}</b>
                <RankBadge name={f.rank} color={f.rankColor} small />
                <span className="muted tiny">{f.status.room ? `In ${MODE_INFO[f.status.room.mode as keyof typeof MODE_INFO]?.label ?? "a court"} (${f.status.room.phase})` : f.status.online ? "Online" : "Offline"}</span>
                <div className="grow" />
                {session?.online && session.roster?.visibility === "private" && <Btn small variant="accent" onClick={() => inviteToRoom(f)}>INVITE</Btn>}
                {f.status.room && f.status.room.phase !== "match" && <Btn small onClick={async () => { try { session?.leave(); const s = await OnlineSession.join(f.status.room.roomId); setSession(s); go("game"); } catch (e) { toast({ text: "That court is private or closed", color: "#ff6b3d" }); } }}>JOIN</Btn>}
                <Btn small variant="primary" onClick={() => challenge(f)}>CHALLENGE</Btn>
              </div>
              <RivalLine r={f.rivalry} />
              <div className="fc-actions">
                <button onClick={() => act(() => api.unfriend(f.id), "Removed")}>Remove</button>
                <button onClick={() => act(() => api.block(f.id), "Blocked")}>Block</button>
                <button onClick={() => report(f.id, f.name)}>Report</button>
              </div>
            </div>
          )))}
          {tab === "rivals" && (!rivals ? <Loading /> : rivals.length === 0 ? <p className="muted">Play 1v1 against real players to start a rivalry.</p> : rivals.map((r) => (
            <div className="friend-card" key={r.opponent}>
              <div className="fc-top"><b className="link" onClick={() => { setProfileView(r.opponent); go("profile"); }}>{me?.name} vs {r.name}</b><div className="grow" /><span className="muted tiny">{r.games} games · last {timeAgo(r.lastAt)}</span></div>
              <RivalLine r={r} />
            </div>
          )))}
          {tab === "recent" && (social.recent.length === 0 ? <p className="muted">No real opponents yet.</p> : social.recent.map((r: any) => (
            <div className="list-row" key={r.id}><b className="link" onClick={() => { setProfileView(r.id); go("profile"); }}>{r.name}</b><span className="muted tiny">{MODE_INFO[r.mode as keyof typeof MODE_INFO]?.label} · {timeAgo(r.at)}</span><div className="grow" />
              {!social.friends.some((f: any) => f.id === r.id) && <Btn small onClick={() => act(() => api.friendRequestById(r.id), "Request sent")}>ADD</Btn>}
              <Btn small variant="ghost" onClick={() => act(() => api.block(r.id), "Blocked")}>BLOCK</Btn>
              <Btn small variant="ghost" onClick={() => report(r.id, r.name)}>REPORT</Btn></div>
          )))}
          {tab === "blocked" && (social.blocked.length === 0 ? <p className="muted">Nobody blocked.</p> : social.blocked.map((b: any) => (
            <div className="list-row" key={b.id}><span>{b.name}</span><div className="grow" /><Btn small onClick={() => act(() => api.unblock(b.id), "Unblocked")}>UNBLOCK</Btn></div>
          )))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- leaderboards
export function Leaderboards() {
  const { go, setProfileView } = useStore();
  const [by, setBy] = useState("rep");
  const [scope, setScope] = useState<"all" | "friends">("all");
  const [data, setData] = useState<any>(null);
  useEffect(() => { setData(null); api.leaderboard(by).then(setData).catch(() => setData({ rows: [], friendsOnly: [], me: {} })); }, [by]);
  const label: Record<string, string> = { rep: "REP", wins: "WINS", pts: "POINTS", shootout: "SHOOTOUT BEST", dunk: "DUNK BEST" };
  const rows = data ? (scope === "all" ? data.rows : data.friendsOnly) : [];
  return (
    <div className="screen">
      <ScreenHeader title="LEADERBOARDS" sub="Everyone on this server" onBack={() => go("menu")} />
      <div className="row"><Tabs value={by} onChange={setBy} options={Object.entries(label).map(([id, l]) => ({ id, label: l }))} /><div className="grow" />
        <Tabs value={scope} onChange={setScope} options={[{ id: "all", label: "GLOBAL" }, { id: "friends", label: "FRIENDS" }]} /></div>
      {!data ? <Loading /> : (
        <Panel>
          <table className="table">
            <thead><tr><th>#</th><th>PLAYER</th>{scope === "all" && <th>RANK</th>}{scope === "all" && <th>W-L</th>}<th className="r">{label[by]}</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className={r.me ? "me" : ""}>
                  <td>{r.place}</td><td className="link" onClick={() => { setProfileView(r.id); go("profile"); }}>{r.name}{r.friend && <span className="tag">FRIEND</span>}</td>
                  {scope === "all" && <td><RankBadge name={r.rank} color={r.rankColor} small /></td>}
                  {scope === "all" && <td>{r.wins}-{r.losses}</td>}
                  <td className="r"><b>{typeof r.value === "number" ? (by === "dunk" ? r.value.toFixed(1) : r.value) : r.value}</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No entries yet.</td></tr>}
            </tbody>
          </table>
          {scope === "all" && data.me?.place > 50 && <p className="muted">You are #{data.me.place} with {data.me.value}.</p>}
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- profile
export function Profile() {
  const { go, me, profileView, setProfileView, toast, refreshSocial } = useStore();
  const id = profileView ?? me?.id;
  const [p, setP] = useState<any>(null);
  useEffect(() => { setP(null); if (id) api.profile(id).then(setP).catch((e) => toast({ text: e.message, color: "#ff6b3d" })); }, [id]);
  const mine = id === me?.id;
  const s = p?.stats;
  const g = s?.games || 0;
  return (
    <div className="screen">
      <ScreenHeader title={mine ? "PROFILE" : (p?.name ?? "PLAYER")} onBack={() => { setProfileView(null); go(mine ? "menu" : "friends"); }}
        right={!mine && p && !p.friend ? <Btn onClick={async () => { try { await api.friendRequestById(p.id); toast({ text: "Friend request sent" }); refreshSocial(); } catch (e) { toast({ text: (e as Error).message, color: "#ff6b3d" }); } }}>ADD FRIEND</Btn> : undefined} />
      {!p ? <Loading /> : (
        <div className="two-col">
          <div>
            <Panel title={p.name}>
              <div className="row"><RankBadge name={p.rank} color={p.rankColor} /><span className="muted">{p.rep} REP</span>{mine && <span className="coins">● {me!.coins}</span>}</div>
              {mine && <><Bar value={me!.rankInfo.progress} color={me!.rankInfo.color} /><p className="muted tiny">{me!.rankInfo.next ? `${me!.rankInfo.next - me!.rep} REP to ${me!.rankInfo.nextName}` : "Legend status"}</p></>}
              <p className="muted tiny">Friend code {p.friendCode} · playing since {new Date(p.createdAt).toLocaleDateString()}</p>
            </Panel>
            {!mine && p.rivalry && <Panel title="YOUR RIVALRY"><RivalLine r={p.rivalry} /></Panel>}
            <Panel title="CAREER">
              <div className="stat-grid">
                {[
                  ["RECORD", `${s.wins}-${s.losses}`], ["WIN %", pct(s.wins, g)], ["PPG", g ? (s.pts / g).toFixed(1) : "—"], ["FG%", pct(s.fgm, s.fga)],
                  ["2PT%", pct(s.tpm, s.tpa)], ["APG", g ? (s.ast / g).toFixed(1) : "—"], ["RPG", g ? (s.reb / g).toFixed(1) : "—"], ["SPG", g ? (s.stl / g).toFixed(1) : "—"],
                  ["BPG", g ? (s.blk / g).toFixed(1) : "—"], ["STREAK", s.streak > 0 ? `W${s.streak}` : s.streak < 0 ? `L${-s.streak}` : "—"], ["BEST STREAK", `W${s.bestStreak}`], ["PERFECTS", s.perfect],
                  ["SHOOTOUT", s.shootoutBest], ["DUNK BEST", (s.dunkBest ?? 0).toFixed(1)], ["POINTS", s.pts], ["GAMES", g],
                ].map(([l, v]) => <div key={l as string} className="stat"><small>{l}</small><b>{v}</b></div>)}
              </div>
              <p className="muted tiny">"2PT%" = shots from beyond the arc (street scoring: 1s and 2s).</p>
            </Panel>
          </div>
          <Panel title="MATCH HISTORY">
            {p.matches.length === 0 ? <p className="muted">No matches yet.</p> : p.matches.map((m: any) => {
              const pl = m.players.find((x: any) => x.id === p.id);
              const won = m.winner === pl?.team;
              const team = m.mode === "1v1" || m.mode === "2v2" || m.mode === "3v3";
              const opp = m.players.filter((x: any) => x.team !== pl?.team).map((x: any) => x.name + (x.bot ? " (CPU)" : "")).join(", ");
              return (
                <div className="match-row" key={m.id}>
                  <span className={team ? (won ? "res w" : "res l") : "res"}>{team ? (won ? "W" : "L") : "★"}</span>
                  <div><b>{MODE_INFO[m.mode as keyof typeof MODE_INFO]?.label ?? m.mode}</b> {team ? <span>{pl?.team === 0 ? m.score[0] : m.score[1]} – {pl?.team === 0 ? m.score[1] : m.score[0]}</span> : <span>Score {m.extraScore}</span>}
                    <div className="muted tiny">{team ? `vs ${opp} · ` : ""}{pl?.pts ?? 0} pts · {pl?.reb ?? 0} reb · {pl?.ast ?? 0} ast · {timeAgo(m.at)}</div></div>
                </div>
              );
            })}
          </Panel>
        </div>
      )}
    </div>
  );
}

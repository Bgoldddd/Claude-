import React from "react";
import { audio } from "../game/audio";

export function Btn({ children, onClick, variant = "default", disabled, small, title, wide }: { children: React.ReactNode; onClick?: () => void; variant?: "default" | "primary" | "ghost" | "danger" | "accent"; disabled?: boolean; small?: boolean; title?: string; wide?: boolean }) {
  return (
    <button
      className={`btn btn-${variant}${small ? " btn-sm" : ""}${wide ? " btn-wide" : ""}`}
      disabled={disabled}
      title={title}
      onMouseEnter={() => !disabled && audio.hover()}
      onClick={() => { if (disabled) return; audio.unlock(); audio.click(); onClick?.(); }}
    >
      <span>{children}</span>
    </button>
  );
}

export function Panel({ title, children, right, className = "" }: { title?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      {title && <div className="panel-head"><h3>{title}</h3>{right}</div>}
      <div className="panel-body">{children}</div>
    </div>
  );
}

export function ScreenHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="screen-header">
      {onBack && <button className="back" onClick={() => { audio.click(); onBack(); }}>‹ BACK</button>}
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="grow" />
      {right}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? "tab active" : "tab"} onClick={() => { audio.click(); onChange(o.id); }}>{o.label}</button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="row slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b>{fmt ? fmt(value) : value}</b>
    </label>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row toggle" onClick={() => { audio.click(); onChange(!value); }}>
      <span>{label}</span>
      <div className={value ? "switch on" : "switch"}><div /></div>
    </label>
  );
}

export function RankBadge({ name, color, small }: { name: string; color: string; small?: boolean }) {
  return <span className={small ? "rank rank-sm" : "rank"} style={{ borderColor: color, color }}>{name}</span>;
}

export function Bar({ value, color = "var(--orange)" }: { value: number; color?: string }) {
  return <div className="bar"><div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>;
}

export function Loading({ text = "Loading" }: { text?: string }) { return <div className="loading-inline"><div className="spinner" />{text}</div>; }

export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
export const timeAgo = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};

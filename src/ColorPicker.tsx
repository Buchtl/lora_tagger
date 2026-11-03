import { PointerEvent, useEffect, useState } from "react";

const SWATCHES = [
  "#000000", "#ffffff", "#ff0000", "#ff8000", "#ffff00", "#00ff00",
  "#00ffff", "#0080ff", "#0000ff", "#8000ff", "#ff00ff", "#808080",
];

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

const hexToHsv = (hex: string): Hsv => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
};

const hsvToHex = ({ h, s, v }: Hsv): string => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
};

interface Props {
  color: string;
  onChange: (hex: string) => void;
}

export default function ColorPicker({ color, onChange }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const [hexText, setHexText] = useState(color);

  // Sync external changes (swatches); keep the hue where it is undefined (grey/black/white)
  useEffect(() => {
    if (hsvToHex(hsv) === color) return;
    const next = hexToHsv(color);
    setHsv((prev) => (next.s === 0 || next.v === 0 ? { ...next, h: prev.h } : next));
    setHexText(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  const update = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const drag = (e: PointerEvent<HTMLDivElement>, apply: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    const move = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      apply(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
    };
    el.setPointerCapture(e.pointerId);
    move(e);
    const onMove = (ev: globalThis.PointerEvent) => move(ev);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  return (
    <div className="picker">
      <div
        className="picker-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={(e) => drag(e, (x, y) => update({ ...hsv, s: x, v: 1 - y }))}
      >
        <div className="picker-handle" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: color }} />
      </div>
      <div className="picker-hue" onPointerDown={(e) => drag(e, (x) => update({ ...hsv, h: x * 360 }))}>
        <div className="picker-hue-handle" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="picker-row">
        <div className="picker-preview" style={{ background: color }} />
        <input
          className="picker-hex"
          value={hexText}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
            setHexText(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              const lower = v.toLowerCase();
              setHsv(hexToHsv(lower));
              onChange(lower);
            }
          }}
        />
      </div>
      <div className="picker-swatches">
        {SWATCHES.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  );
}

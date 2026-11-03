import { PointerEvent, useEffect, useRef, useState } from "react";
import ColorPicker from "./ColorPicker";

const MAX_HISTORY = 30;

// Per image URL: stack of ImageData snapshots; the last entry is the current working state
export type Sessions = Map<string, ImageData[]>;

interface Props {
  url: string;
  alt: string;
  sessions: Sessions;
  onSave: (blob: Blob) => void;
}

export default function Editor({ url, alt, sessions, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [mode, setMode] = useState<"erase" | "paint">("erase");
  const [shape, setShape] = useState<"round" | "square">("round");
  const [color, setColor] = useState("#ff0000");
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const ctx = () => canvasRef.current!.getContext("2d", { willReadFrequently: true })!;

  const loadOriginal = (cancelled: () => boolean) => {
    const img = new Image();
    img.onload = () => {
      if (cancelled()) return;
      const canvas = canvasRef.current!;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const c = ctx();
      c.drawImage(img, 0, 0);
      const history = sessions.get(url);
      if (history) c.putImageData(history[history.length - 1], 0, 0);
      rerender();
    };
    img.src = url;
  };

  useEffect(() => {
    let done = false;
    loadOriginal(() => done);
    return () => {
      done = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const toImagePoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };

  const drawTo = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y, scale } = toImagePoint(e);
    const c = ctx();
    const from = lastPoint.current ?? { x, y };
    const size = brushSize * scale;
    const erase = mode === "erase";
    c.globalCompositeOperation = erase ? "destination-out" : "source-over";
    c.strokeStyle = c.fillStyle = color;
    if (shape === "round") {
      c.lineCap = "round";
      c.lineJoin = "round";
      c.lineWidth = size;
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(x, y);
      c.stroke();
    } else {
      // Square brush: stamp squares along the path so the shape stays axis-aligned
      const dist = Math.hypot(x - from.x, y - from.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, size / 4)));
      for (let i = 1; i <= steps; i++) {
        const px = from.x + ((x - from.x) * i) / steps - size / 2;
        const py = from.y + ((y - from.y) * i) / steps - size / 2;
        if (erase) c.clearRect(px, py, size, size);
        else c.fillRect(px, py, size, size);
      }
    }
    lastPoint.current = { x, y };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    let history = sessions.get(url);
    if (!history) {
      history = [ctx().getImageData(0, 0, canvas.width, canvas.height)];
      sessions.set(url, history);
    }
    lastPoint.current = null;
    drawTo(e);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const ring = ringRef.current;
    if (ring) {
      const parent = canvasRef.current!.parentElement!.getBoundingClientRect();
      ring.style.display = "block";
      ring.style.left = `${e.clientX - parent.left}px`;
      ring.style.top = `${e.clientY - parent.top}px`;
    }
    if (lastPoint.current) drawTo(e);
  };

  const endStroke = () => {
    if (!lastPoint.current) return;
    lastPoint.current = null;
    const canvas = canvasRef.current!;
    const history = sessions.get(url)!;
    history.push(ctx().getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > MAX_HISTORY) history.shift();
    rerender();
  };

  const history = sessions.get(url);
  const canUndo = !!history && history.length > 1;

  const undo = () => {
    const h = sessions.get(url);
    if (!h || h.length < 2) return;
    h.pop();
    ctx().putImageData(h[h.length - 1], 0, 0);
    rerender();
  };

  // Restores the last saved state, i.e. the image as currently stored
  const reset = () => {
    sessions.delete(url);
    loadOriginal(() => false);
  };

  const save = () => {
    canvasRef.current!.toBlob((blob) => blob && onSave(blob), "image/png");
  };

  return (
    <>
      <div className="viewer">
        <div className="canvas-wrap">
          <canvas
            ref={canvasRef}
            aria-label={alt}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={() => {
              if (ringRef.current) ringRef.current.style.display = "none";
            }}
          />
          <div ref={ringRef} className="brush-ring" style={{ width: brushSize, height: brushSize, borderRadius: shape === "round" ? "50%" : 0 }} />
        </div>
      </div>
      <aside className="tools">
        <section>
          <h4>Werkzeug</h4>
          <div className="icon-row">
            <button className={mode === "erase" ? "on" : ""} onClick={() => setMode("erase")} title="Transparent malen (Radierer)" aria-label="Radierer">
              <svg viewBox="0 0 24 24"><path d="M16.2 3.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L10 18.2H5.2L3.6 16.6a2 2 0 0 1 0-2.8zM9 18.2h11" /></svg>
            </button>
            <button className={mode === "paint" ? "on" : ""} onClick={() => setMode("paint")} title="Mit Farbe malen" aria-label="Pinsel">
              <svg viewBox="0 0 24 24"><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13zM8 14.2c-2.2 0-3.5 1.3-3.5 3.3 0 1.2-.7 2.2-1.9 2.9 3.6.6 8.4 0 8.4-4.3z" /></svg>
            </button>
          </div>
        </section>

        <section>
          <h4>Form</h4>
          <div className="icon-row">
            <button className={shape === "round" ? "on" : ""} onClick={() => setShape("round")} title="Runder Pinsel" aria-label="Runder Pinsel">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" /></svg>
            </button>
            <button className={shape === "square" ? "on" : ""} onClick={() => setShape("square")} title="Eckiger Pinsel" aria-label="Eckiger Pinsel">
              <svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="1" /></svg>
            </button>
          </div>
        </section>

        <section>
          <h4>Größe: {brushSize}px</h4>
          <input type="range" min={2} max={200} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
        </section>

        {mode === "paint" && (
          <section>
            <h4>Farbe</h4>
            <ColorPicker color={color} onChange={setColor} />
          </section>
        )}

        <section className="actions">
          <button onClick={undo} disabled={!canUndo}>Rückgängig</button>
          <button onClick={reset} disabled={!history}>Zurücksetzen</button>
          <button className="primary" onClick={save} disabled={!history}>Speichern</button>
        </section>
      </aside>
    </>
  );
}

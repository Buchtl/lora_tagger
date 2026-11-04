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

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

interface Floating {
  url: string;
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

type SelectionDrag =
  | { type: "create"; startX: number; startY: number }
  | { type: "move" | "resize"; startX: number; startY: number; original: Selection; edges?: SelectionEdges };

export default function Editor({ url, alt, sessions, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const selectionSvgRef = useRef<SVGSVGElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const selectionDrag = useRef<SelectionDrag | null>(null);
  const floatDrag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [mode, setMode] = useState<"erase" | "paint" | "select">("erase");
  const [shape, setShape] = useState<"round" | "square">("round");
  const [color, setColor] = useState("#ff0000");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [floating, setFloating] = useState<Floating | null>(null);
  const floatingRef = useRef<Floating | null>(null);
  floatingRef.current = floating;
  const commitFloatingRef = useRef<() => void>(() => {});
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const ctx = () => canvasRef.current!.getContext("2d", { willReadFrequently: true })!;

  const syncSelectionOverlay = () => {
    const canvas = canvasRef.current;
    const svg = selectionSvgRef.current;
    if (!canvas || !svg) return;
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement!.getBoundingClientRect();
    svg.style.left = `${canvasRect.left - parentRect.left}px`;
    svg.style.top = `${canvasRect.top - parentRect.top}px`;
    svg.style.width = `${canvasRect.width}px`;
    svg.style.height = `${canvasRect.height}px`;
  };

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
      setSelection(null);
      requestAnimationFrame(syncSelectionOverlay);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(syncSelectionOverlay);
    observer.observe(canvas);
    window.addEventListener("resize", syncSelectionOverlay);
    syncSelectionOverlay();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSelectionOverlay);
    };
  }, []);

  const toImagePoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };

  const toSelectionPoint = (e: PointerEvent<SVGSVGElement>) => {
    const canvas = canvasRef.current!;
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((e.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((e.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  const selectionEdgesAt = (x: number, y: number): SelectionEdges | null => {
    if (!selection || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const tolerance = 9 * (canvas.width / rect.width);
    const withinX = x >= selection.x - tolerance && x <= selection.x + selection.width + tolerance;
    const withinY = y >= selection.y - tolerance && y <= selection.y + selection.height + tolerance;
    if (!withinX || !withinY) return null;
    const edges = {
      left: Math.abs(x - selection.x) <= tolerance,
      right: Math.abs(x - selection.x - selection.width) <= tolerance,
      top: Math.abs(y - selection.y) <= tolerance,
      bottom: Math.abs(y - selection.y - selection.height) <= tolerance,
    };
    return edges.left || edges.right || edges.top || edges.bottom ? edges : null;
  };

  const onSelectionPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toSelectionPoint(e);
    if (floating) {
      if (x >= floating.x && x <= floating.x + floating.width && y >= floating.y && y <= floating.y + floating.height) {
        floatDrag.current = { startX: x, startY: y, origX: floating.x, origY: floating.y };
      }
      return;
    }
    const edges = selectionEdgesAt(x, y);
    if (selection && edges) {
      selectionDrag.current = { type: "resize", startX: x, startY: y, original: selection, edges };
    } else if (
      selection &&
      x >= selection.x &&
      x <= selection.x + selection.width &&
      y >= selection.y &&
      y <= selection.y + selection.height
    ) {
      selectionDrag.current = { type: "move", startX: x, startY: y, original: selection };
    } else {
      selectionDrag.current = { type: "create", startX: x, startY: y };
      setSelection({ x, y, width: 0, height: 0 });
    }
  };

  const onSelectionPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const { x, y } = toSelectionPoint(e);
    if (floating) {
      const fd = floatDrag.current;
      if (fd) {
        setFloating({ ...floating, x: fd.origX + x - fd.startX, y: fd.origY + y - fd.startY });
      } else {
        const inside = x >= floating.x && x <= floating.x + floating.width && y >= floating.y && y <= floating.y + floating.height;
        e.currentTarget.style.cursor = inside ? "move" : "default";
      }
      return;
    }
    const drag = selectionDrag.current;
    if (!drag) {
      const edges = selectionEdgesAt(x, y);
      const inside =
        selection &&
        x >= selection.x &&
        x <= selection.x + selection.width &&
        y >= selection.y &&
        y <= selection.y + selection.height;
      e.currentTarget.style.cursor = !selection
        ? "crosshair"
        : ((edges?.left && edges.top) || (edges?.right && edges.bottom))
          ? "nwse-resize"
          : ((edges?.right && edges.top) || (edges?.left && edges.bottom))
            ? "nesw-resize"
            : (edges?.left || edges?.right)
              ? "ew-resize"
              : (edges?.top || edges?.bottom)
                ? "ns-resize"
                : inside
                  ? "move"
                  : "crosshair";
      return;
    }

    const canvas = canvasRef.current!;
    if (drag.type === "create") {
      setSelection({
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        width: Math.abs(x - drag.startX),
        height: Math.abs(y - drag.startY),
      });
      return;
    }

    if (drag.type === "move") {
      setSelection({
        ...drag.original,
        x: Math.max(0, Math.min(canvas.width - drag.original.width, drag.original.x + x - drag.startX)),
        y: Math.max(0, Math.min(canvas.height - drag.original.height, drag.original.y + y - drag.startY)),
      });
      return;
    }

    const edges = drag.edges!;
    const left = edges.left
      ? Math.max(0, Math.min(drag.original.x + drag.original.width - 1, drag.original.x + x - drag.startX))
      : drag.original.x;
    const right = edges.right
      ? Math.min(canvas.width, Math.max(left + 1, drag.original.x + drag.original.width + x - drag.startX))
      : drag.original.x + drag.original.width;
    const top = edges.top
      ? Math.max(0, Math.min(drag.original.y + drag.original.height - 1, drag.original.y + y - drag.startY))
      : drag.original.y;
    const bottom = edges.bottom
      ? Math.min(canvas.height, Math.max(top + 1, drag.original.y + drag.original.height + y - drag.startY))
      : drag.original.y + drag.original.height;
    setSelection({ x: left, y: top, width: right - left, height: bottom - top });
  };

  const endSelectionDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (selectionDrag.current) onSelectionPointerMove(e);
    selectionDrag.current = null;
    floatDrag.current = null;
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
    if (e.button !== 0 || mode === "select") return;
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

  const selectionBounds = selection && canvasRef.current
    ? {
        x: Math.max(0, Math.floor(selection.x)),
        y: Math.max(0, Math.floor(selection.y)),
        right: Math.min(canvasRef.current.width, Math.ceil(selection.x + selection.width)),
        bottom: Math.min(canvasRef.current.height, Math.ceil(selection.y + selection.height)),
      }
    : null;
  const selectionWidth = selectionBounds ? selectionBounds.right - selectionBounds.x : 0;
  const selectionHeight = selectionBounds ? selectionBounds.bottom - selectionBounds.y : 0;
  const imageWidth = canvasRef.current?.width ?? 0;
  const imageHeight = canvasRef.current?.height ?? 0;

  const cropToSelection = () => {
    const canvas = canvasRef.current;
    const bounds = selectionBounds;
    if (!canvas || !bounds || bounds.right <= bounds.x || bounds.bottom <= bounds.y) return;

    let history = sessions.get(url);
    if (!history) {
      history = [ctx().getImageData(0, 0, canvas.width, canvas.height)];
      sessions.set(url, history);
    }

    const cropped = document.createElement("canvas");
    cropped.width = bounds.right - bounds.x;
    cropped.height = bounds.bottom - bounds.y;
    cropped.getContext("2d")!.drawImage(
      canvas,
      bounds.x,
      bounds.y,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height
    );

    canvas.width = cropped.width;
    canvas.height = cropped.height;
    ctx().drawImage(cropped, 0, 0);
    history.push(ctx().getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > MAX_HISTORY) history.shift();
    setSelection(null);
    requestAnimationFrame(syncSelectionOverlay);
    rerender();
  };

  const startFloating = async (blob: Blob) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      alert("Das Bild aus der Zwischenablage konnte nicht gelesen werden.");
      return;
    }
    // Oversized images are scaled down so the whole pasted image fits into the canvas
    const fit = Math.min(1, canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * fit));
    const height = Math.max(1, Math.round(img.naturalHeight * fit));
    if (floatingRef.current) URL.revokeObjectURL(floatingRef.current.url);
    setSelection(null);
    setFloating({ url, img, width, height, x: Math.round((canvas.width - width) / 2), y: Math.round((canvas.height - height) / 2) });
  };

  const pasteFromButton = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return startFloating(await item.getType(type));
      }
      alert("Die Zwischenablage enthält kein Bild.");
    } catch {
      alert("Kein Zugriff auf die Zwischenablage. Verwende Strg+V.");
    }
  };

  const discardFloating = () => {
    if (floatingRef.current) URL.revokeObjectURL(floatingRef.current.url);
    floatDrag.current = null;
    setFloating(null);
  };

  const commitFloating = () => {
    const canvas = canvasRef.current;
    if (!canvas || !floating) return;
    let history = sessions.get(url);
    if (!history) {
      history = [ctx().getImageData(0, 0, canvas.width, canvas.height)];
      sessions.set(url, history);
    }
    const c = ctx();
    c.globalCompositeOperation = "source-over";
    c.drawImage(floating.img, Math.round(floating.x), Math.round(floating.y), floating.width, floating.height);
    history.push(c.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > MAX_HISTORY) history.shift();
    discardFloating();
  };

  commitFloatingRef.current = commitFloating;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      startFloating(file);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!floatingRef.current) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commitFloatingRef.current();
      } else if (e.key === "Escape") {
        e.preventDefault();
        discardFloating();
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
      if (floatingRef.current) URL.revokeObjectURL(floatingRef.current.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const history = sessions.get(url);
  const canUndo = !!history && history.length > 1;

  const undo = () => {
    const h = sessions.get(url);
    if (!h || h.length < 2) return;
    h.pop();
    const snapshot = h[h.length - 1];
    const canvas = canvasRef.current!;
    if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
      requestAnimationFrame(syncSelectionOverlay);
    }
    ctx().putImageData(snapshot, 0, 0);
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
          <svg
            ref={selectionSvgRef}
            className={`selection-overlay ${mode === "select" || floating ? "interactive" : ""}`}
            viewBox={`0 0 ${canvasRef.current?.width || 1} ${canvasRef.current?.height || 1}`}
            preserveAspectRatio="none"
            onPointerDown={onSelectionPointerDown}
            onPointerMove={onSelectionPointerMove}
            onPointerUp={endSelectionDrag}
            onPointerCancel={endSelectionDrag}
          >
            {floating && (
              <>
                <image href={floating.url} x={floating.x} y={floating.y} width={floating.width} height={floating.height} preserveAspectRatio="none" />
                <rect x={floating.x} y={floating.y} width={floating.width} height={floating.height} className="selection-border" vectorEffect="non-scaling-stroke" />
              </>
            )}
            {selection && selection.width > 0 && selection.height > 0 && (
              <>
                <path
                  d={`M0 0H${canvasRef.current?.width ?? 0}V${canvasRef.current?.height ?? 0}H0Z M${selection.x} ${selection.y}H${selection.x + selection.width}V${selection.y + selection.height}H${selection.x}Z`}
                  fill="rgba(0,0,0,0.55)"
                  fillRule="evenodd"
                />
                <rect
                  x={selection.x}
                  y={selection.y}
                  width={selection.width}
                  height={selection.height}
                  className="selection-border"
                  vectorEffect="non-scaling-stroke"
                />
                {mode === "select" &&
                  [
                    [selection.x, selection.y],
                    [selection.x + selection.width / 2, selection.y],
                    [selection.x + selection.width, selection.y],
                    [selection.x, selection.y + selection.height / 2],
                    [selection.x + selection.width, selection.y + selection.height / 2],
                    [selection.x, selection.y + selection.height],
                    [selection.x + selection.width / 2, selection.y + selection.height],
                    [selection.x + selection.width, selection.y + selection.height],
                  ].map(([x, y], i) => {
                    const canvas = canvasRef.current;
                    const size = canvas ? (8 * canvas.width) / canvas.getBoundingClientRect().width : 8;
                    return (
                      <rect
                        key={i}
                        x={x - size / 2}
                        y={y - size / 2}
                        width={size}
                        height={size}
                        className="selection-handle"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
              </>
            )}
          </svg>
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
            <button className={mode === "select" ? "on" : ""} onClick={() => setMode("select")} title="Rechteck auswählen" aria-label="Rechteck auswählen">
              <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" strokeDasharray="3 2" /></svg>
            </button>
          </div>
        </section>

        <section className="actions selection-actions">
          <h4>Zwischenablage</h4>
          {floating ? (
            <>
              <div className="selection-size">{floating.width} × {floating.height} px</div>
              <button className="primary" onClick={commitFloating}>Übernehmen (Enter)</button>
              <button onClick={discardFloating}>Verwerfen (Esc)</button>
            </>
          ) : (
            <button onClick={pasteFromButton}>Bild einfügen (Strg+V)</button>
          )}
        </section>

        <section className="selection-actions">
          <h4>Bildgröße</h4>
          <div className="selection-size">{imageWidth} × {imageHeight} px</div>
        </section>

        {selection && (
          <section className="actions selection-actions">
            <h4>Auswahl</h4>
            <div className="selection-size">{selectionWidth} × {selectionHeight} px</div>
            <button className="primary" onClick={cropToSelection} disabled={selectionWidth < 1 || selectionHeight < 1}>
              Auf Auswahl zuschneiden
            </button>
          </section>
        )}

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

import JSZip from "jszip";
import { ChangeEvent, InputHTMLAttributes, useCallback, useEffect, useRef, useState } from "react";
import Editor, { Sessions } from "./Editor";

interface ImageItem {
  file: File;
  text: string;
  ext: string;
  url: string;
}

// Names are derived from the position, so deleting an image renumbers the followers automatically
const nameAt = (index: number, total: number, ext: string) =>
  String(index + 1).padStart(Math.max(3, String(total).length), "0") + ext;

const extOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
};

const stem = (path: string) => path.replace(/\.[^./]*$/, "");

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

// Images are shown as loaded and only encoded to PNG on export, which keeps loading fast
const toPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("PNG conversion failed");
  return png;
};

const makeItem = (blob: Blob, text: string): ImageItem => {
  const file = new File([blob], "image", { type: blob.type });
  return { file, ext: ".png", text, url: URL.createObjectURL(file) };
};

// webkitdirectory is not part of React's typings
const dirProps = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [exporting, setExporting] = useState(false);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  const sessions = useRef<Sessions>(new Map());

  // Release remaining object URLs on unmount
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const deleteSelected = useCallback(() => {
    const list = imagesRef.current;
    if (!list[selected]) return;
    URL.revokeObjectURL(list[selected].url);
    sessions.current.delete(list[selected].url);
    const next = list.filter((_, i) => i !== selected);
    setImages(next);
    setSelected(Math.min(selected, next.length - 1));
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const last = imagesRef.current.length - 1;
      if (e.key === "Delete") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(last, 0)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected]);

  // Keep the selected thumbnail visible in the strip and the cursor in the text field
  useEffect(() => {
    document.querySelector("footer img.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    textRef.current?.focus();
  }, [selected, images.length]);

  // New images are appended; the first appended image becomes the selected one
  const appendItems = (items: ImageItem[]) => {
    if (items.length === 0) return;
    setSelected(imagesRef.current.length);
    setImages((list) => [...list, ...items]);
  };

  const importZip = async (e: ChangeEvent<HTMLInputElement>) => {
    const zipFile = e.target.files?.[0];
    e.target.value = "";
    if (!zipFile) return;
    try {
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      const imageEntries = entries
        .filter((f) => IMAGE_MIME[extOf(f.name)])
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const texts = new Map<string, string>();
      for (const f of entries) {
        if (extOf(f.name) === ".txt") texts.set(stem(f.name), await f.async("string"));
      }
      const items: ImageItem[] = [];
      for (const f of imageEntries) {
        const blob = new Blob([await f.async("arraybuffer")], { type: IMAGE_MIME[extOf(f.name)] });
        items.push(makeItem(blob, texts.get(stem(f.name)) ?? ""));
      }
      appendItems(items);
    } catch {
      alert("Die ZIP-Datei konnte nicht gelesen werden.");
    }
  };

  const importFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const path = (f: File) => f.webkitRelativePath || f.name;
    const imageFiles = files
      .filter((f) => IMAGE_MIME[extOf(f.name)])
      .sort((a, b) => path(a).localeCompare(path(b), undefined, { numeric: true }));
    if (imageFiles.length === 0) return;
    const texts = new Map<string, string>();
    for (const f of files) {
      if (extOf(f.name) === ".txt") texts.set(stem(path(f)), await f.text());
    }
    const items = imageFiles.map((f) => makeItem(f, texts.get(stem(path(f))) ?? ""));
    appendItems(items);
  };

  const setText = (text: string) =>
    setImages((list) => list.map((img, i) => (i === selected ? { ...img, text } : img)));

  const exportZip = async () => {
    setExporting(true);
    const zip = new JSZip();
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const name = nameAt(i, images.length, img.ext);
        zip.file(name, await toPng(img.file));
        zip.file(name.slice(0, name.length - img.ext.length) + ".txt", img.text);
      }
    } catch {
      alert("Ein Bild konnte nicht in PNG umgewandelt werden.");
      setExporting(false);
      return;
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "images.zip";
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
  };

  const current = images[selected];
  const total = images.length;
  const currentName = current ? nameAt(selected, total, current.ext) : "";

  // Edited images contain transparency, so they are stored as PNG
  const saveEdited = (blob: Blob) => {
    const old = imagesRef.current[selected];
    if (!old) return;
    const file = new File([blob], "edited.png", { type: "image/png" });
    sessions.current.delete(old.url);
    URL.revokeObjectURL(old.url);
    setImages((list) =>
      list.map((img, i) => (i === selected ? { ...img, file, ext: ".png", url: URL.createObjectURL(file) } : img))
    );
  };

  return (
    <div className="app">
      <header>
        <button onClick={() => inputRef.current?.click()}>Bilder hinzufügen</button>
        <button onClick={() => zipInputRef.current?.click()}>Import ZIP</button>
        <button onClick={() => dirInputRef.current?.click()}>Import Ordner</button>
        <input ref={dirInputRef} type="file" multiple hidden onChange={importFiles} {...dirProps} />
        <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={importZip} />
        <button onClick={exportZip} disabled={images.length === 0 || exporting}>
          {exporting ? "Exportiere…" : "Export"}
        </button>
        <input ref={inputRef} type="file" multiple accept="image/*,.txt" hidden onChange={importFiles} />
        {current && (
          <span className="info">
            {currentName} ({selected + 1}/{total}) – Strg+Entf zum Löschen
          </span>
        )}
      </header>

      <main>
        {current ? (
          <>
            <Editor
              key={current.url}
              url={current.url}
              alt={currentName}
              sessions={sessions.current}
              onSave={saveEdited}
            />
            <textarea
              ref={textRef}
              value={current.text}
              placeholder={`Text für ${currentName}`}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : (
          <p>Keine Bilder geladen. Füge Bilder, einen Ordner oder eine ZIP-Datei hinzu.</p>
        )}
      </main>

      {total > 0 && (
        <footer>
          {images.map((img, i) => (
            <img
              key={img.url}
              src={img.url}
              alt={nameAt(i, total, img.ext)}
              title={nameAt(i, total, img.ext)}
              className={i === selected ? "active" : ""}
              onClick={() => setSelected(i)}
            />
          ))}
        </footer>
      )}
    </div>
  );
}

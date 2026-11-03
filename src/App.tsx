import JSZip from "jszip";
import { ChangeEvent, InputHTMLAttributes, useCallback, useEffect, useRef, useState } from "react";

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

// webkitdirectory is not part of React's typings
const dirProps = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selected, setSelected] = useState(0);

  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Release remaining object URLs on unmount
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const deleteSelected = useCallback(() => {
    const list = imagesRef.current;
    if (!list[selected]) return;
    URL.revokeObjectURL(list[selected].url);
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
        const ext = extOf(f.name);
        const blob = new Blob([await f.async("arraybuffer")], { type: IMAGE_MIME[ext] });
        const file = new File([blob], f.name.split("/").pop()!, { type: blob.type });
        items.push({ file, ext, text: texts.get(stem(f.name)) ?? "", url: URL.createObjectURL(file) });
      }
      imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url));
      setImages(items);
      setSelected(0);
    } catch {
      alert("Die ZIP-Datei konnte nicht gelesen werden.");
    }
  };

  const importDir = async (e: ChangeEvent<HTMLInputElement>) => {
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
    const items: ImageItem[] = imageFiles.map((f) => ({
      file: f,
      ext: extOf(f.name),
      text: texts.get(stem(path(f))) ?? "",
      url: URL.createObjectURL(f),
    }));
    imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setImages(items);
    setSelected(0);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
      .filter((f) => f.type.startsWith("image/"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setImages(files.map((f) => ({ file: f, ext: extOf(f.name), text: "", url: URL.createObjectURL(f) })));
    setSelected(0);
    e.target.value = "";
  };

  const setText = (text: string) =>
    setImages((list) => list.map((img, i) => (i === selected ? { ...img, text } : img)));

  const exportZip = async () => {
    const zip = new JSZip();
    images.forEach((img, i) => {
      const name = nameAt(i, images.length, img.ext);
      zip.file(name, img.file);
      zip.file(name.slice(0, name.length - img.ext.length) + ".txt", img.text);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "images.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const current = images[selected];
  const total = images.length;
  const currentName = current ? nameAt(selected, total, current.ext) : "";

  return (
    <div className="app">
      <header>
        <button onClick={() => inputRef.current?.click()}>Upload</button>
        <button onClick={() => zipInputRef.current?.click()}>Import ZIP</button>
        <button onClick={() => dirInputRef.current?.click()}>Import Ordner</button>
        <input ref={dirInputRef} type="file" multiple hidden onChange={importDir} {...dirProps} />
        <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={importZip} />
        <button onClick={exportZip} disabled={images.length === 0}>
          Export
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={onChange} {...dirProps} />
        {current && (
          <span className="info">
            {currentName} ({selected + 1}/{total}) – Strg+Entf zum Löschen
          </span>
        )}
      </header>

      <main>
        {current ? (
          <>
            <div className="viewer">
              <img src={current.url} alt={currentName} />
            </div>
            <textarea
              ref={textRef}
              value={current.text}
              placeholder={`Text für ${currentName}`}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : (
          <p>Keine Bilder geladen. Klicke auf „Upload“, um einen Ordner zu wählen.</p>
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

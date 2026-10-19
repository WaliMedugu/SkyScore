// Aspen's halftone look, made from real Sentinel-2 photos: each cell becomes a dot sized by how dark it is.
// With two images the dots morph between them (a field greening up).
import { useEffect, useRef } from "react";

interface Props {
  src: string | string[];
  /** Cell size in CSS pixels. */
  cell?: number;
  /** Dot colour; defaults to the theme's dot colour. */
  color?: string;
  /** Dots for bright areas instead of dark ones. */
  invert?: boolean;
  /** Seconds per image when cycling several. */
  interval?: number;
  /** Shape of the dots. */
  shape?: "circle" | "square";
  contrast?: number;
  className?: string;
  label?: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Luminance grid (0 = black … 1 = white) of an image cropped to cover cols × rows. */
function sample(img: HTMLImageElement, cols: number, rows: number, contrast: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const ar = cols / rows;
  const iar = img.width / img.height;
  let sw = img.width;
  let sh = img.height;
  if (iar > ar) sw = img.height * ar;
  else sh = img.width / ar;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < out.length; i++) {
    const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    out[i] = l;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  // Stretch to the full range, then apply contrast around the middle.
  const span = Math.max(0.05, hi - lo);
  for (let i = 0; i < out.length; i++) {
    const v = (out[i] - lo) / span;
    out[i] = Math.min(1, Math.max(0, 0.5 + (v - 0.5) * contrast));
  }
  return out;
}

export function Halftone({ src, cell = 7, color, invert = false, interval = 3.5, shape = "circle", contrast = 1.35, className, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = Array.isArray(src) ? src : [src];
  const key = urls.join("|");

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    let alive = true;
    let raf = 0;
    let images: HTMLImageElement[] = [];
    let grids: Float32Array[] = [];
    let cols = 0;
    let rows = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dotColor = () => color ?? getComputedStyle(el).getPropertyValue("--dot").trim() ?? "#023448";

    const layout = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      cols = Math.max(4, Math.floor(r.width / cell));
      rows = Math.max(4, Math.floor(r.height / cell));
      grids = images.map((img) => sample(img, cols, rows, contrast));
    };

    const draw = (a: Float32Array, b: Float32Array | null, t: number) => {
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = dotColor();
      const cw = cv.width / cols;
      const ch = cv.height / rows;
      const maxR = Math.min(cw, ch) * 0.62;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          let l = a[i];
          if (b) l = l + (b[i] - l) * t;
          const ink = invert ? l : 1 - l;
          const r = maxR * Math.sqrt(ink);
          if (r < 0.35) continue;
          const cx = (x + 0.5) * cw;
          const cy = (y + 0.5) * ch;
          if (shape === "square") ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
          else {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const start = performance.now();
    const loop = (now: number) => {
      if (!alive || !grids.length) return;
      if (grids.length === 1 || reduce) {
        draw(grids[0], null, 0);
        return;
      }
      const per = interval * 1000;
      const phase = ((now - start) / per) % grids.length;
      const i = Math.floor(phase);
      const f = phase - i;
      // Hold each image, then morph over the last 35% of its slot.
      const t = f < 0.65 ? 0 : (f - 0.65) / 0.35;
      const eased = t * t * (3 - 2 * t);
      draw(grids[i], grids[(i + 1) % grids.length], eased);
      raf = requestAnimationFrame(loop);
    };

    Promise.allSettled(urls.map(loadImage)).then((res) => {
      if (!alive) return;
      images = res.filter((r): r is PromiseFulfilledResult<HTMLImageElement> => r.status === "fulfilled").map((r) => r.value);
      if (!images.length) return;
      layout();
      raf = requestAnimationFrame(loop);
    });

    const ro = new ResizeObserver(() => {
      if (!images.length) return;
      layout();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    });
    ro.observe(el);
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cell, color, invert, interval, shape, contrast]);

  return (
    <div ref={wrap} className={`halftone ${className ?? ""}`} role="img" aria-label={label ?? "Satellite photo of farmland, drawn as dots"}>
      <canvas ref={canvas} />
    </div>
  );
}

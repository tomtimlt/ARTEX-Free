"use client";

// LagoonBackdrop paints an animated pixel-art beach behind the app: sea with
// waves and foam, swaying palms, a striped sunset sun (a moon and stars in dark
// mode), drifting clouds, seagulls and a crab. It sits behind every page (fixed,
// z-index -1, no pointer events), so cards, tables and the sidebar stay on top
// and the layout does not move. It only renders for the default theme preset,
// draws one frame when the user prefers reduced motion, and stops while the tab
// is hidden. The "panel" variant fills its parent and paints the sky too.

import * as React from "react";

const PIXEL = 4; // CSS pixels per art pixel
const FPS = 10;

interface Palette {
  sky: [string, string] | null;
  seaDeep: string;
  sea: string;
  seaLight: string;
  sparkle: string;
  foam: string;
  sand: string;
  sandDark: string;
  trunk: string;
  trunkDark: string;
  leaf: string;
  leafLight: string;
  coconut: string;
  sun: string;
  sunEdge: string;
  cloud: string;
  cloudShade: string;
  bird: string;
  crab: string;
  night: boolean;
}

const DAY: Palette = {
  sky: null,
  seaDeep: "#3f8f93",
  sea: "#5fb3b3",
  seaLight: "#8fd0c9",
  sparkle: "#e9f6f2",
  foam: "#fdfcf6",
  sand: "#f0d49b",
  sandDark: "#ddb978",
  trunk: "#9a6a43",
  trunkDark: "#73492c",
  leaf: "#2f7d4f",
  leafLight: "#58a86a",
  coconut: "#6b4226",
  sun: "#f2c14e",
  sunEdge: "#e8875a",
  cloud: "#ffffff",
  cloudShade: "#d8cdb0",
  bird: "#17332d",
  crab: "#d9573b",
  night: false,
};

const NIGHT: Palette = {
  sky: null,
  seaDeep: "#0d2b30",
  sea: "#16404a",
  seaLight: "#22596a",
  sparkle: "#f4f1de",
  foam: "#9fc7c4",
  sand: "#3a3324",
  sandDark: "#2b261b",
  trunk: "#2a2a20",
  trunkDark: "#1d1d16",
  leaf: "#12322a",
  leafLight: "#1c4a3c",
  coconut: "#1a140e",
  sun: "#f4f1de",
  sunEdge: "#c9c4ad",
  cloud: "#2a4a52",
  cloudShade: "#22404a",
  bird: "#9fb3aa",
  crab: "#8a3a2a",
  night: true,
};

const CLOUD = ["..XXX......", ".XXXXX.XX..", "XXXXXXXXXXX", ".SSSSSSSSS."];

function hash(n: number) {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  return ((x >>> 16) ^ x) >>> 0;
}

function useThemeState() {
  const [state, setState] = React.useState({ active: false, dark: false });
  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const preset = root.dataset.themePreset;
      setState({ active: !preset || preset === "default", dark: root.classList.contains("dark") });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["class", "data-theme-preset"] });
    return () => mo.disconnect();
  }, []);
  return state;
}

function lerpColor(a: string, b: string, k: number) {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, pal: Palette, panel: boolean) {
  const px = (x: number, y: number, c: string, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  ctx.clearRect(0, 0, W, H);

  const sandH = Math.max(6, Math.round(H * (panel ? 0.12 : 0.05)));
  const seaH = Math.max(8, Math.round(H * (panel ? 0.2 : 0.07)));
  const horizon = H - sandH - seaH;

  if (pal.sky) {
    for (let y = 0; y < horizon; y++) px(0, y, lerpColor(pal.sky[0], pal.sky[1], y / Math.max(1, horizon)), W, 1);
  }

  // stars (night)
  if (pal.night) {
    for (let i = 0; i < Math.round(W * 0.25); i++) {
      const sx = hash(i * 7) % W;
      const sy = hash(i * 13) % Math.max(1, horizon - 4);
      const on = hash(i * 31 + Math.floor(t * 2 + i)) % 5 !== 0;
      if (on) px(sx, sy, i % 4 === 0 ? "#f2c14e" : "#e9efe3");
    }
  }

  // sun / moon, striped like a retro sunset
  const sr = panel ? Math.round(Math.min(W, H) * 0.14) : 9;
  const scx = panel ? Math.round(W * 0.7) : W - 26;
  const scy = panel ? horizon - Math.round(sr * 0.35) : 20;
  for (let y = -sr; y <= sr; y++) {
    const span = Math.floor(Math.sqrt(sr * sr - y * y));
    if (!pal.night && y > 0 && (y + Math.floor(t * 2)) % 4 === 0) continue;
    const c = pal.night ? pal.sun : lerpColor(pal.sun, pal.sunEdge, (y + sr) / (2 * sr));
    px(scx - span, scy + y, c, span * 2 + 1, 1);
  }
  if (pal.night) {
    px(scx - 3, scy - 2, pal.sunEdge, 2, 2);
    px(scx + 2, scy + 2, pal.sunEdge, 2, 1);
  }

  // clouds
  for (let i = 0; i < 4; i++) {
    const speed = 1.2 + i * 0.5;
    const span = W + 30;
    const cx = (((hash(i * 97) % span) + t * speed) % span) - 15;
    const cy = 6 + (hash(i * 53) % Math.max(4, Math.round(horizon * 0.45)));
    CLOUD.forEach((row, j) => {
      for (let k = 0; k < row.length; k++) {
        if (row[k] === "X") px(cx + k, cy + j, pal.cloud);
        else if (row[k] === "S") px(cx + k, cy + j, pal.cloudShade);
      }
    });
  }

  // seagulls
  for (let i = 0; i < 3; i++) {
    const span = W + 20;
    const bx = (((hash(i * 41) % span) + t * (5 + i * 2)) % span) - 10;
    const by = 10 + (hash(i * 17) % Math.max(6, Math.round(horizon * 0.5))) + Math.round(Math.sin(t * 1.3 + i) * 2);
    const up = Math.floor(t * 4 + i) % 2 === 0;
    const pts = up
      ? [
          [-2, 0],
          [-1, -1],
          [0, 0],
          [1, -1],
          [2, 0],
        ]
      : [
          [-2, -1],
          [-1, 0],
          [0, 0],
          [1, 0],
          [2, -1],
        ];
    for (const [dx, dy] of pts) px(bx + dx, by + dy, pal.bird);
  }

  // sea with moving sparkles and a sun/moon reflection
  for (let y = 0; y < seaH; y++) {
    const yy = horizon + y;
    px(0, yy, y < 2 ? pal.seaDeep : y % 3 === 0 ? pal.sea : pal.seaLight, W, 1);
  }
  const drift = Math.floor(t * 6);
  for (let i = 0; i < Math.round(W * seaH * 0.03); i++) {
    const x = (hash(i * 11) + drift * (1 + (i % 3))) % W;
    const y = horizon + 1 + (hash(i * 23) % Math.max(1, seaH - 1));
    if ((hash(i + Math.floor(t * 3)) & 3) === 0) px(x, y, pal.sparkle, 2, 1);
  }
  for (let y = 1; y < seaH; y += 2) {
    const w = Math.max(1, Math.round(sr * 0.8 * (1 - y / seaH)) + (Math.floor(t * 3 + y) % 2));
    px(scx - w, horizon + y, pal.night ? pal.sparkle : pal.sun, w * 2, 1);
  }

  // shore: sand and foam that rolls in and out
  const shore = H - sandH;
  px(0, shore, pal.sand, W, sandH);
  for (let i = 0; i < Math.round(W * sandH * 0.08); i++) {
    px(hash(i * 5) % W, shore + 1 + (hash(i * 9) % Math.max(1, sandH - 1)), pal.sandDark);
  }
  for (let x = 0; x < W; x++) {
    const reach = Math.round(1 + Math.sin(x * 0.18 + t * 1.6) * 1.2 + Math.sin(t * 0.7) * 1.2);
    for (let r = 0; r < Math.max(0, reach); r++) px(x, shore + r, r === reach - 1 ? pal.foam : pal.seaLight);
  }

  // palms
  const palms = panel ? [0.12, 0.88, 0.95] : [0.06, 0.32, 0.86, 0.95];
  palms.forEach((fx, i) => {
    const baseX = Math.round(W * fx);
    const baseY = shore + Math.min(sandH - 1, 3 + (i % 2) * 2);
    const h = Math.round((panel ? H * 0.42 : Math.min(54, H * 0.2)) * (0.75 + (hash(i * 3) % 30) / 100));
    const lean = (i % 2 === 0 ? 1 : -1) * (4 + (hash(i) % 5));
    let tx = baseX;
    let ty = baseY;
    for (let s = 0; s <= h; s++) {
      const k = s / h;
      tx = baseX + Math.round(lean * k * k + Math.sin(t * 1.1 + i) * k * k * 1.2);
      ty = baseY - s;
      px(tx, ty, s % 3 === 0 ? pal.trunkDark : pal.trunk, 2, 1);
    }
    const sway = Math.sin(t * 1.4 + i * 1.7) * 0.12;
    const fronds = [-2.9, -2.4, -1.9, -1.25, -0.75, -0.25];
    const len = Math.max(8, Math.round(h * 0.42));
    for (const a0 of fronds) {
      for (let s = 1; s <= len; s++) {
        const a = a0 + sway + (Math.cos(a0) > 0 ? 1 : -1) * 0.02 * s;
        const fx2 = tx + 1 + Math.cos(a) * s;
        const fy2 = ty + Math.sin(a) * s + (s * s) / (len * 1.5);
        px(fx2, fy2, pal.leaf);
        if (s % 2 === 0 && s < len - 1) px(fx2, fy2 + 1, pal.leafLight);
      }
    }
    px(tx, ty + 1, pal.coconut, 2, 2);
    px(tx + 2, ty + 2, pal.coconut, 2, 2);
  });

  // a crab patrolling the sand
  const span = Math.max(10, W - 20);
  const cpos = (t * 6) % (span * 2);
  const cxp = 10 + (cpos < span ? cpos : span * 2 - cpos);
  const cyp = shore + Math.max(2, sandH - 3);
  const leg = Math.floor(t * 8) % 2;
  px(cxp, cyp, pal.crab, 4, 2);
  px(cxp - 1, cyp - 1 - leg, pal.crab);
  px(cxp + 4, cyp - 1 - leg, pal.crab);
  px(cxp, cyp + 2, pal.crab);
  px(cxp + 3, cyp + 2, pal.crab);
  px(cxp + 1, cyp - 1, "#17332d");
  px(cxp + 2, cyp - 1, "#17332d");
}

export function LagoonBackdrop({ variant = "page", className }: { variant?: "page" | "panel"; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const { active, dark } = useThemeState();
  const panel = variant === "panel";

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || (!active && !panel)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pal: Palette = panel
      ? { ...(dark ? NIGHT : DAY), sky: dark ? ["#0c1d1a", "#1d4a5a"] : ["#1b4a42", "#f2a66b"] }
      : dark
        ? NIGHT
        : DAY;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    const fit = () => {
      const box = panel ? canvas.parentElement?.getBoundingClientRect() : null;
      const cw = box ? box.width : window.innerWidth;
      const ch = box ? box.height : window.innerHeight;
      W = Math.max(40, Math.ceil(cw / PIXEL));
      H = Math.max(40, Math.ceil(ch / PIXEL));
      canvas.width = W;
      canvas.height = H;
    };
    fit();
    const start = performance.now();
    let timer = 0;
    const tick = () => {
      if (!document.hidden) drawScene(ctx, W, H, (performance.now() - start) / 1000, pal, panel);
      if (!reduced) timer = window.setTimeout(tick, 1000 / FPS);
    };
    tick();
    const onResize = () => {
      fit();
      drawScene(ctx, W, H, (performance.now() - start) / 1000, pal, panel);
    };
    const ro = panel && canvas.parentElement ? new ResizeObserver(onResize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    else window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [active, dark, panel]);

  if (!active && !panel) return null;
  return (
    <div aria-hidden="true" className="contents">
      <canvas
        ref={ref}
        className={
          className ??
          (panel
            ? "pointer-events-none absolute inset-0 size-full [image-rendering:pixelated]"
            : "pointer-events-none fixed inset-0 -z-10 h-dvh w-screen [image-rendering:pixelated]")
        }
      />
    </div>
  );
}

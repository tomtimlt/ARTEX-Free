// Canvas engine for the Agent Map: a small pixel-art building where each agent
// (planner, main agent, workers) walks between rooms and acts out what it is
// doing: plugging cables into racks for network scans, streaming packets to the
// internet for web work, throwing sparks at the vault for exploits, reading in
// the archive, and lifting trophies in the hall of fame for findings.
// Everything is drawn with integer rectangles on a 400×228 logical grid that is
// scaled by a whole number, so pixels stay crisp at any size.

import {
  type AgentLook,
  isMain,
  isPlanner,
  lookFor,
  type MapAction,
  SEVERITY_COLOR,
  type Severity,
  SPRITE_LEGS,
  SPRITE_TOP,
  spriteColor,
  tagFor,
  type Zone,
} from "./model";

export const LW = 400;
export const LH = 228;
const CORRIDOR_Y = 127;

export interface MapLabels {
  network: string;
  hq: string;
  web: string;
  archive: string;
  lounge: string;
  exploit: string;
  goal: string;
  levelUp: string;
  llmSwitch: string;
  approval: string;
  done: string;
  dispatch: string;
  finding: (severity: Severity) => string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type RoomId = Exclude<Zone, "gate">;

const ROOMS: Record<RoomId, Rect & { accent: string }> = {
  network: { x: 6, y: 14, w: 126, h: 104, accent: "#7cc6fe" },
  hq: { x: 148, y: 14, w: 104, h: 104, accent: "#ffd166" },
  web: { x: 268, y: 14, w: 126, h: 104, accent: "#ff7a59" },
  archive: { x: 6, y: 136, w: 126, h: 86, accent: "#e9c48a" },
  lounge: { x: 148, y: 136, w: 104, h: 86, accent: "#ffd166" },
  exploit: { x: 268, y: 136, w: 126, h: 86, accent: "#ff4d5e" },
};

const RACKS = [14, 44, 74, 104];
const DESKS = [276, 314, 352];
const CONSOLE = { x: 276, y: 152, w: 72, h: 18 };
const VAULT = { x: 358, y: 150, w: 30, h: 46 };
const GLOBE = { x: 378, y: 20 };
const SHELF = { x: 172, y: 152, w: 66 };
const FLAGPOLE = { x: 244, y: 150 };

interface Station {
  x: number;
  y: number;
  port?: { x: number; y: number };
  monitor?: { x: number; y: number };
}

const STATIONS: Record<Zone, Station[]> = {
  network: RACKS.map((x) => ({ x: x + 10, y: 94, port: { x: x + 10, y: 56 } })),
  hq: [
    { x: 200, y: 86 },
    { x: 168, y: 100 },
    { x: 232, y: 100 },
  ],
  web: DESKS.map((x) => ({ x: x + 16, y: 92, monitor: { x: x + 16, y: 44 } })),
  archive: [
    { x: 24, y: 206 },
    { x: 52, y: 212 },
    { x: 84, y: 212 },
    { x: 114, y: 206 },
  ],
  lounge: [
    { x: 164, y: 192 },
    { x: 182, y: 200 },
    { x: 200, y: 206 },
    { x: 218, y: 200 },
    { x: 234, y: 192 },
  ],
  exploit: [
    { x: 288, y: 196 },
    { x: 314, y: 204 },
    { x: 340, y: 196 },
  ],
  gate: [
    { x: 192, y: 130 },
    { x: 208, y: 130 },
  ],
};
const TROPHY_SPOT = { x: 205, y: 184 };

const C = {
  void: "#0b0f19",
  corridor: "#121827",
  corridorLine: "#1f2840",
  wall: "#232c44",
  wallTop: "#3a4668",
  outline: "#2f3a58",
  ink: "#141a2b",
  metal: "#2a3350",
  metalHi: "#3d4a70",
  screen: "#0e1a2e",
  text: "#f4f1de",
  dim: "#8a94b3",
  yellow: "#ffd166",
  coral: "#ff7a59",
  ice: "#7cc6fe",
  red: "#ff4d5e",
  wood: "#7a5232",
  woodHi: "#9c6b42",
};

const FLOORS: Record<RoomId, [string, string]> = {
  network: ["#16203a", "#182440"],
  hq: ["#1d1f33", "#20233a"],
  web: ["#221a2a", "#261d2f"],
  archive: ["#1f1b1f", "#231e22"],
  lounge: ["#1c2030", "#1f2436"],
  exploit: ["#24161d", "#291920"],
};

interface Bubble {
  text: string;
  color: string;
  until: number;
}

interface Agent {
  id: string;
  look: AgentLook;
  tag: string;
  x: number;
  y: number;
  path: { x: number; y: number }[];
  zone: Zone;
  slot: number;
  action: "work" | "ask" | null;
  actionUntil: number;
  arrivedAt: number;
  bubble: Bubble | null;
  jumpUntil: number;
  shakeUntil: number;
  spawnAt: number;
  lastEmit: number;
  lastEvent: number;
}

type Fx =
  | { k: "packet"; x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; color: string }
  | { k: "ring"; x: number; y: number; t0: number; dur: number; color: string }
  | { k: "particle"; x: number; y: number; vx: number; vy: number; g: number; t0: number; dur: number; color: string }
  | { k: "float"; x: number; y: number; text: string; t0: number; dur: number; color: string }
  | { k: "envelope"; x0: number; y0: number; x1: number; y1: number; t0: number; dur: number };

interface Banner {
  text: string;
  color: string;
  t0: number;
  dur: number;
}

const FLOOR_TILE = 8;

function hash(n: number) {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  return ((x >>> 16) ^ x) >>> 0;
}

function roomAt(x: number, y: number): RoomId | null {
  for (const [id, r] of Object.entries(ROOMS) as [RoomId, Rect][]) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id;
  }
  return null;
}

function doorX(room: RoomId) {
  const r = ROOMS[room];
  return r.x + Math.round(r.w / 2);
}

export class AgentMapEngine {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private scale = 2;
  private agents = new Map<string, Agent>();
  private occupancy = new Map<Zone, (string | null)[]>();
  private fx: Fx[] = [];
  private banner: Banner | null = null;
  private trophies: Severity[] = [];
  private flags = 0;
  private breached = false;
  private raf = 0;
  private last = 0;
  private speed = 1;
  private focusId: string | null = null;
  private font = "monospace";

  constructor(
    private canvas: HTMLCanvasElement,
    private labels: MapLabels,
    private reducedMotion: boolean,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");
    this.ctx = ctx;
    this.reset();
    this.raf = requestAnimationFrame(this.frame);
  }

  setFont(family: string) {
    this.font = family || "monospace";
    this.bg = null;
  }

  setLabels(labels: MapLabels) {
    this.labels = labels;
    this.bg = null;
  }

  setSpeed(speed: number) {
    this.speed = Math.max(0.5, speed);
  }

  focus(id: string | null) {
    this.focusId = id;
  }

  /**
   * Size the backing store for a canvas shown `cssWidth` CSS pixels wide (the
   * page stretches it with CSS). The store is a whole-number multiple (at
   * least 2×) of the logical grid, rounded up, so the browser only ever scales
   * it down a little with nearest-neighbour sampling and no logical pixel
   * disappears.
   */
  resize(cssWidth: number, dpr: number) {
    const s = Math.max(2, Math.ceil((Math.max(1, cssWidth) * dpr) / LW));
    if (s === this.scale && this.canvas.width === LW * s) return;
    this.scale = s;
    this.canvas.width = LW * s;
    this.canvas.height = LH * s;
    this.bg = null;
  }

  reset() {
    this.agents.clear();
    this.occupancy.clear();
    this.fx = [];
    this.banner = null;
    this.trophies = [];
    this.flags = 0;
    this.breached = false;
    this.ensureAgent("planner", true);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private now() {
    return performance.now();
  }

  // ---------------------------------------------------------------- agents

  private homeZone(id: string): Zone {
    return isPlanner(id) || isMain(id) ? "hq" : "lounge";
  }

  private claimSlot(zone: Zone, id: string): number {
    const slots = STATIONS[zone];
    let occ = this.occupancy.get(zone);
    if (!occ) {
      occ = slots.map(() => null);
      this.occupancy.set(zone, occ);
    }
    const mine = occ.indexOf(id);
    if (mine >= 0) return mine;
    if (zone === "hq") {
      const fixed = isPlanner(id) ? 0 : isMain(id) ? 1 : 2;
      occ[fixed] = id;
      return fixed;
    }
    const free = occ.indexOf(null);
    const slot = free >= 0 ? free : hash(id.length * 7 + id.charCodeAt(id.length - 1)) % slots.length;
    occ[slot] = id;
    return slot;
  }

  private releaseSlot(agent: Agent) {
    const occ = this.occupancy.get(agent.zone);
    if (occ && occ[agent.slot] === agent.id) occ[agent.slot] = null;
  }

  private ensureAgent(id: string, instant: boolean): Agent {
    const found = this.agents.get(id);
    if (found) return found;
    const zone = this.homeZone(id);
    const slot = this.claimSlot(zone, id);
    const st = STATIONS[zone][slot];
    const agent: Agent = {
      id,
      look: lookFor(id),
      tag: tagFor(id),
      x: st.x,
      y: st.y,
      path: [],
      zone,
      slot,
      action: null,
      actionUntil: 0,
      arrivedAt: 0,
      bubble: null,
      jumpUntil: 0,
      shakeUntil: 0,
      spawnAt: instant ? 0 : this.now(),
      lastEmit: 0,
      lastEvent: this.now(),
    };
    this.agents.set(id, agent);
    if (!instant) this.burst(st.x, st.y - 6, agent.look.color, 14);
    return agent;
  }

  private station(agent: Agent): Station {
    return STATIONS[agent.zone][agent.slot];
  }

  private moveTo(agent: Agent, zone: Zone, instant: boolean, spot?: { x: number; y: number }) {
    if (agent.zone !== zone || spot) {
      this.releaseSlot(agent);
      agent.zone = zone;
      agent.slot = this.claimSlot(zone, agent.id);
    }
    const target = spot ?? this.station(agent);
    if (instant || this.reducedMotion) {
      agent.x = target.x;
      agent.y = target.y;
      agent.path = [];
      agent.arrivedAt = this.now();
      return;
    }
    const from = roomAt(agent.x, agent.y);
    const to = zone === "gate" ? null : (zone as RoomId);
    const pts: { x: number; y: number }[] = [];
    if (from !== to || from === null) {
      if (from) {
        pts.push({ x: doorX(from), y: agent.y });
        pts.push({ x: doorX(from), y: CORRIDOR_Y });
      } else {
        pts.push({ x: agent.x, y: CORRIDOR_Y });
      }
      if (to) {
        pts.push({ x: doorX(to), y: CORRIDOR_Y });
        pts.push({ x: doorX(to), y: target.y });
      } else {
        pts.push({ x: target.x, y: CORRIDOR_Y });
      }
    }
    pts.push({ x: target.x, y: target.y });
    agent.path = pts;
    agent.arrivedAt = 0;
  }

  private say(agent: Agent, text: string, color: string, ms = 2600) {
    agent.bubble = { text, color, until: this.now() + ms / this.speed };
  }

  // ---------------------------------------------------------------- actions

  apply(a: MapAction, instant = false) {
    const agent = this.ensureAgent(a.worker, instant);
    const now = this.now();
    agent.lastEvent = now;
    const L = this.labels;
    switch (a.tone) {
      case "work": {
        this.moveTo(agent, a.zone, instant);
        agent.action = "work";
        agent.actionUntil = now + 7000 / this.speed;
        if (!instant) this.say(agent, a.label, C.text);
        break;
      }
      case "result": {
        if (agent.zone !== a.zone && !isPlanner(agent.id) && !isMain(agent.id)) this.moveTo(agent, a.zone, instant);
        agent.action = "work";
        agent.actionUntil = now + 1800 / this.speed;
        if (!instant) {
          if (a.isError) {
            this.say(agent, `ERR ${a.label}`, C.red);
            agent.shakeUntil = now + 500;
          } else {
            this.say(agent, `OK ${a.label}`, "#9be7ff", 1800);
          }
        }
        break;
      }
      case "think": {
        if (!isPlanner(agent.id) && !isMain(agent.id) && agent.zone === "lounge")
          this.moveTo(agent, "archive", instant);
        if (!instant) this.say(agent, `... ${a.label}`, C.dim, 2000);
        break;
      }
      case "dispatch": {
        if (instant) break;
        this.say(agent, `${L.dispatch} x${a.dispatchCount ?? 1}`, C.yellow, 2200);
        agent.jumpUntil = now + 300;
        const crew = [...this.agents.values()].filter((g) => !isPlanner(g.id) && !isMain(g.id));
        const n = a.dispatchCount ?? 1;
        for (let i = 0; i < n; i++) {
          const target = crew.length ? crew[i % crew.length] : null;
          const spot = target ?? STATIONS.lounge[i % STATIONS.lounge.length];
          this.fx.push({
            k: "envelope",
            x0: agent.x,
            y0: agent.y - 14,
            x1: spot.x,
            y1: spot.y - 14,
            t0: now + i * 140,
            dur: 900,
          });
        }
        break;
      }
      case "finding": {
        const sev = a.severity ?? "info";
        this.trophies.push(sev);
        if (sev === "critical" || sev === "high") this.breached = true;
        if (isPlanner(agent.id) || isMain(agent.id)) {
          if (!instant) this.say(agent, L.finding(sev), SEVERITY_COLOR[sev]);
        } else {
          this.moveTo(agent, "lounge", instant, TROPHY_SPOT);
          agent.action = null;
        }
        if (instant) break;
        this.say(agent, L.finding(sev), SEVERITY_COLOR[sev], 3000);
        agent.jumpUntil = now + 400;
        const tx = SHELF.x + ((this.trophies.length - 1) % 8) * 8 + 3;
        const ty = SHELF.y + (Math.floor((this.trophies.length - 1) / 8) % 2) * 11;
        this.burst(tx, ty, SEVERITY_COLOR[sev], 22);
        if (sev === "critical" || sev === "high" || sev === "medium") {
          this.showBanner(L.finding(sev), SEVERITY_COLOR[sev]);
        }
        break;
      }
      case "goal": {
        this.flags++;
        if (instant) break;
        this.showBanner(L.goal, C.yellow, 2400);
        this.burst(FLAGPOLE.x, FLAGPOLE.y + 4, C.yellow, 30);
        this.burst(200, 60, C.coral, 24);
        agent.jumpUntil = now + 500;
        break;
      }
      case "round": {
        if (instant) break;
        this.showBanner(a.label.toUpperCase(), C.ice, 1500);
        break;
      }
      case "ask": {
        this.moveTo(agent, "gate", instant);
        agent.action = "ask";
        agent.actionUntil = now + 60000;
        if (!instant) this.say(agent, `? ${L.approval}`, C.yellow, 5000);
        break;
      }
      case "switch": {
        if (instant) break;
        this.showBanner(L.llmSwitch, C.ice, 1600);
        break;
      }
      case "done": {
        this.moveTo(agent, "lounge", instant);
        agent.action = null;
        if (!instant) this.say(agent, L.done, "#9be7ff", 1800);
        break;
      }
      case "operator": {
        if (!instant) this.say(agent, `> ${a.label}`, "#e9c48a", 2600);
        break;
      }
    }
    if (!instant && a.xp > 0) {
      this.fx.push({
        k: "float",
        x: agent.x,
        y: agent.y - 20,
        text: `+${a.xp} XP`,
        t0: now + 150,
        dur: 1100,
        color: C.yellow,
      });
    }
  }

  levelUp(id: string, level: number) {
    const agent = this.agents.get(id);
    if (!agent) return;
    const now = this.now();
    this.fx.push({
      k: "float",
      x: agent.x,
      y: agent.y - 26,
      text: `${this.labels.levelUp} ${level}`,
      t0: now + 300,
      dur: 1600,
      color: "#ffffff",
    });
    for (let i = 0; i < 3; i++)
      this.fx.push({ k: "ring", x: agent.x, y: agent.y - 6, t0: now + i * 120, dur: 600, color: C.yellow });
  }

  private showBanner(text: string, color: string, dur = 1800) {
    this.banner = { text, color, t0: this.now(), dur };
  }

  private burst(x: number, y: number, color: string, n: number) {
    if (this.reducedMotion) return;
    const now = this.now();
    const palette = [color, C.yellow, "#ffffff"];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 45;
      this.fx.push({
        k: "particle",
        x,
        y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 30,
        g: 90,
        t0: now,
        dur: 700 + Math.random() * 500,
        color: palette[i % palette.length],
      });
    }
  }

  // ---------------------------------------------------------------- loop

  private frame = (t: number) => {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    this.update(t, dt);
    this.draw(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(now: number, dt: number) {
    const step = 46 * this.speed * dt;
    for (const agent of this.agents.values()) {
      if (agent.path.length) {
        let budget = step;
        while (budget > 0 && agent.path.length) {
          const p = agent.path[0];
          const dx = p.x - agent.x;
          const dy = p.y - agent.y;
          const d = Math.hypot(dx, dy);
          if (d <= budget) {
            agent.x = p.x;
            agent.y = p.y;
            agent.path.shift();
            budget -= d;
          } else {
            agent.x += (dx / d) * budget;
            agent.y += (dy / d) * budget;
            budget = 0;
          }
        }
        if (!agent.path.length) agent.arrivedAt = now;
      }
      if (agent.action && now > agent.actionUntil) agent.action = null;
      if (agent.bubble && now > agent.bubble.until) agent.bubble = null;

      // Long idle: wander back to the lounge.
      if (
        !agent.action &&
        !agent.path.length &&
        !isPlanner(agent.id) &&
        !isMain(agent.id) &&
        agent.zone !== "lounge" &&
        now - agent.lastEvent > 14000 / this.speed
      ) {
        this.moveTo(agent, "lounge", false);
      }

      if (agent.action === "work" && !agent.path.length && !this.reducedMotion) this.emit(agent, now);
    }

    this.fx = this.fx.filter((f) => now < f.t0 + f.dur);
    if (this.banner && now > this.banner.t0 + this.banner.dur) this.banner = null;
  }

  private emit(agent: Agent, now: number) {
    const st = this.station(agent);
    const since = now - agent.lastEmit;
    switch (agent.zone) {
      case "web":
        if (since > 240 && st.monitor) {
          agent.lastEmit = now;
          this.fx.push({
            k: "packet",
            x0: st.monitor.x,
            y0: st.monitor.y - 6,
            x1: GLOBE.x,
            y1: GLOBE.y,
            t0: now,
            dur: 650,
            color: agent.look.color,
          });
        }
        break;
      case "network":
        if (since > 850 && st.port && now - agent.arrivedAt > 350) {
          agent.lastEmit = now;
          this.fx.push({ k: "ring", x: st.port.x, y: st.port.y, t0: now, dur: 700, color: agent.look.color });
        }
        break;
      case "exploit":
        if (since > 70) {
          agent.lastEmit = now;
          this.fx.push({
            k: "particle",
            x: agent.x + (Math.random() * 6 - 3),
            y: agent.y - 14,
            vx: Math.random() * 60 - 30,
            vy: -40 - Math.random() * 30,
            g: 140,
            t0: now,
            dur: 420,
            color: Math.random() > 0.5 ? C.yellow : C.coral,
          });
        }
        break;
      case "archive":
        if (since > 600) {
          agent.lastEmit = now;
          this.fx.push({
            k: "particle",
            x: agent.x + 2,
            y: agent.y - 12,
            vx: Math.random() * 8 - 4,
            vy: -14,
            g: 0,
            t0: now,
            dur: 900,
            color: "#f4f1de",
          });
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- drawing

  private rect(x: number, y: number, w: number, h: number, color: string, ctx = this.ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private text(
    str: string,
    x: number,
    y: number,
    color: string,
    size = 7,
    align: CanvasTextAlign = "left",
    ctx = this.ctx,
  ) {
    ctx.font = `${size}px ${this.font}`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#05070d";
    ctx.fillText(str, Math.round(x) + 1, Math.round(y) + 1);
    ctx.fillStyle = color;
    ctx.fillText(str, Math.round(x), Math.round(y));
  }

  private buildBackground() {
    const s = this.scale;
    const bg = document.createElement("canvas");
    bg.width = LW * s;
    bg.height = LH * s;
    const ctx = bg.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const r = (x: number, y: number, w: number, h: number, c: string) => this.rect(x, y, w, h, c, ctx);

    r(0, 0, LW, LH, C.void);
    // corridor
    r(0, 118, LW, 18, C.corridor);
    for (let x = 4; x < LW; x += 10) r(x, CORRIDOR_Y, 5, 1, C.corridorLine);
    r(132, 14, 16, 208, C.corridor);
    r(252, 14, 16, 208, C.corridor);

    for (const [id, room] of Object.entries(ROOMS) as [RoomId, (typeof ROOMS)[RoomId]][]) {
      const [a, b] = FLOORS[id];
      for (let y = room.y; y < room.y + room.h; y += FLOOR_TILE) {
        for (let x = room.x; x < room.x + room.w; x += FLOOR_TILE) {
          const odd = ((x - room.x) / FLOOR_TILE + (y - room.y) / FLOOR_TILE) % 2 === 1;
          r(x, y, Math.min(FLOOR_TILE, room.x + room.w - x), Math.min(FLOOR_TILE, room.y + room.h - y), odd ? b : a);
        }
      }
      // back wall
      r(room.x, room.y, room.w, 12, C.wall);
      r(room.x, room.y, room.w, 1, C.wallTop);
      r(room.x, room.y + 12, room.w, 1, "#0d1220");
      // outline with a door gap on the corridor side
      const dx = doorX(id);
      const top = room.y < CORRIDOR_Y;
      r(room.x - 1, room.y - 1, room.w + 2, 1, C.outline);
      r(room.x - 1, room.y - 1, 1, room.h + 2, C.outline);
      r(room.x + room.w, room.y - 1, 1, room.h + 2, C.outline);
      const edgeY = top ? room.y + room.h : room.y - 1;
      r(room.x - 1, edgeY, dx - 9 - room.x + 1, 1, C.outline);
      r(dx + 9, edgeY, room.x + room.w - dx - 8, 1, C.outline);
      if (!top) {
        r(room.x - 1, room.y + room.h, room.w + 2, 1, C.outline);
      }
      // room sign
      const label = this.labels[id].toUpperCase();
      ctx.font = `7px ${this.font}`;
      const tw = Math.ceil(ctx.measureText(label).width);
      r(room.x + 4, room.y + 2, tw + 6, 9, "#0d1220");
      r(room.x + 4, room.y + 2, 2, 9, room.accent);
      this.text(label, room.x + 8, room.y + 3, room.accent, 7, "left", ctx);
    }

    // network: racks
    for (const x of RACKS) {
      r(x, 26, 20, 46, C.metal);
      r(x, 26, 20, 1, C.metalHi);
      r(x + 1, 27, 1, 44, "#202842");
      for (let y = 30; y < 70; y += 6) r(x + 3, y, 14, 4, "#1a2034");
      r(x + 4, 54, 12, 4, "#11151f");
      for (let p = 0; p < 4; p++) r(x + 5 + p * 3, 55, 2, 2, "#3b4660");
      r(x, 72, 20, 2, "#0d1220");
    }
    // floor cable tray
    r(10, 80, 118, 2, "#1c2640");

    // hq: wall screen, desk
    r(158, 24, 84, 34, C.metal);
    r(160, 26, 80, 30, C.screen);
    r(186, 66, 28, 10, C.wood);
    r(186, 66, 28, 2, C.woodHi);
    r(188, 76, 2, 4, C.wood);
    r(210, 76, 2, 4, C.wood);
    r(192, 62, 16, 5, "#11151f");
    r(193, 63, 14, 3, "#24304d");
    // plant
    r(240, 96, 6, 8, "#5a3a22");
    r(238, 88, 10, 8, "#3f7a8c");

    // web: desks and monitors
    for (const x of DESKS) {
      r(x, 62, 32, 8, C.wood);
      r(x, 62, 32, 2, C.woodHi);
      r(x + 2, 70, 2, 8, C.wood);
      r(x + 28, 70, 2, 8, C.wood);
      r(x + 4, 34, 24, 20, "#11151f");
      r(x + 14, 54, 4, 8, "#2a3350");
      r(x + 10, 60, 12, 2, "#2a3350");
    }
    // internet portal on the wall
    r(GLOBE.x - 10, GLOBE.y - 4, 20, 10, "#0d1220");
    r(GLOBE.x - 6, GLOBE.y - 6, 12, 2, "#3b4a6e");
    r(GLOBE.x - 8, GLOBE.y - 2, 16, 6, "#2b5d8a");
    r(GLOBE.x - 4, GLOBE.y - 3, 8, 8, "#7cc6fe");

    // archive: shelves + table
    const spines = ["#ff7a59", "#7cc6fe", "#ffd166", "#e9c48a", "#ff8fab", "#a3b1ff", "#c9d1e6"];
    for (let row = 0; row < 3; row++) {
      const y = 150 + row * 12;
      r(12, y + 9, 114, 2, C.wood);
      for (let x = 14, i = row * 5; x < 124; i++) {
        const w = 3 + (hash(i * 13) % 3);
        const h = 6 + (hash(i * 7) % 3);
        r(x, y + 9 - h, w, h, spines[hash(i) % spines.length]);
        x += w + 1;
      }
    }
    r(34, 188, 70, 10, C.wood);
    r(34, 188, 70, 2, C.woodHi);
    r(48, 186, 10, 3, "#f4f1de");
    r(74, 186, 8, 3, "#c9d1e6");

    // lounge: trophy shelf, flag pole, couch, coffee machine
    r(SHELF.x - 2, SHELF.y + 8, SHELF.w + 4, 2, C.wood);
    r(SHELF.x - 2, SHELF.y + 19, SHELF.w + 4, 2, C.wood);
    r(FLAGPOLE.x, FLAGPOLE.y, 1, 50, "#c9d1e6");
    r(FLAGPOLE.x - 2, FLAGPOLE.y + 50, 5, 2, "#8a94b3");
    r(152, 204, 26, 10, "#a34f3c");
    r(152, 200, 26, 5, "#c4513a");
    r(152, 150, 12, 18, C.metal);
    r(154, 153, 8, 5, "#11151f");
    r(156, 163, 4, 3, "#f4f1de");

    // exploit: console, vault
    r(CONSOLE.x, CONSOLE.y, CONSOLE.w, CONSOLE.h, "#11151f");
    r(CONSOLE.x, CONSOLE.y + CONSOLE.h, CONSOLE.w, 6, C.metal);
    r(VAULT.x, VAULT.y, VAULT.w, VAULT.h, "#3b4660");
    r(VAULT.x + 2, VAULT.y + 2, VAULT.w - 4, VAULT.h - 4, "#2a3350");
    for (let y = VAULT.y + 6; y < VAULT.y + VAULT.h - 4; y += 8) r(VAULT.x + 4, y, VAULT.w - 8, 1, "#3b4660");

    this.bg = bg;
  }

  private drawDynamic(now: number) {
    const r = (x: number, y: number, w: number, h: number, c: string) => this.rect(x, y, w, h, c);
    const busy = (zone: Zone, slot: number) => {
      const id = this.occupancy.get(zone)?.[slot];
      const a = id ? this.agents.get(id) : undefined;
      return a && a.action === "work" && !a.path.length ? a : undefined;
    };

    // rack LEDs
    RACKS.forEach((x, i) => {
      const worker = busy("network", i);
      const rate = worker ? 90 : 420;
      for (let row = 0; row < 6; row++) {
        for (let k = 0; k < 3; k++) {
          const on = hash(Math.floor(now / rate) * 97 + i * 31 + row * 7 + k) % 3 !== 0;
          const color = worker && k === 0 ? worker.look.color : k === 2 ? C.coral : C.ice;
          r(x + 4 + k * 4, 31 + row * 6, 2, 1, on ? color : "#1f2740");
        }
      }
    });

    // hq screen: radar sweep + counters
    const sx = 160;
    const sy = 26;
    for (let gx = 0; gx < 80; gx += 8) for (let gy = 0; gy < 30; gy += 6) r(sx + gx, sy + gy, 1, 1, "#1d3352");
    const sweep = Math.floor(((now / 18) % 80) + sx);
    r(sweep, sy, 1, 30, "#2e6fa6");
    r(sweep - 1, sy, 1, 30, "#1f4a72");
    this.text(`FIND ${this.trophies.length}`, sx + 4, sy + 4, C.coral, 7);
    this.text(`GOAL ${this.flags}`, sx + 4, sy + 15, C.yellow, 7);
    const working = [...this.agents.values()].filter((a) => a.action === "work").length;
    this.text(`RUN ${working}`, sx + 46, sy + 4, C.ice, 7);

    // monitors
    DESKS.forEach((x, i) => {
      const worker = busy("web", i);
      r(x + 5, 35, 22, 3, worker ? worker.look.color : "#2a3350");
      r(x + 5, 38, 22, 15, worker ? "#0f2236" : "#0c1220");
      if (worker) {
        for (let l = 0; l < 4; l++) {
          const w = 4 + (hash(Math.floor(now / 160) + l * 11 + i) % 14);
          r(x + 7, 40 + l * 3, w, 1, l === 0 ? C.yellow : "#7cc6fe");
        }
        const scan = 38 + (Math.floor(now / 60) % 15);
        r(x + 5, scan, 22, 1, "rgba(255,255,255,0.15)");
      } else {
        r(x + 7, 40, 10, 1, "#1d2a40");
      }
    });

    // exploit console + vault light
    const exploiting = [0, 1, 2].some((i) => busy("exploit", i));
    for (let l = 0; l < 4; l++) {
      const w = exploiting ? 8 + (hash(Math.floor(now / 90) + l * 5) % 50) : 12;
      r(CONSOLE.x + 3, CONSOLE.y + 3 + l * 4, w, 2, exploiting ? (l % 2 ? C.red : C.coral) : "#2a1a22");
    }
    const lockOn = exploiting ? Math.floor(now / 150) % 2 === 0 : true;
    if (this.breached) {
      r(VAULT.x + 6, VAULT.y + 6, VAULT.w - 12, VAULT.h - 12, "#05070d");
      r(VAULT.x + 8, VAULT.y + VAULT.h - 14, 6, 4, C.yellow);
      r(VAULT.x + 16, VAULT.y + VAULT.h - 12, 4, 2, C.yellow);
    }
    r(VAULT.x + VAULT.w / 2 - 3, VAULT.y + 18, 6, 6, lockOn ? (this.breached ? "#9be7ff" : C.red) : "#3b1a22");

    // coffee steam
    if (!this.reducedMotion) {
      for (let k = 0; k < 3; k++) {
        const p = ((now / 700 + k / 3) % 1) * 8;
        r(157 + (k % 2), 148 - p, 1, 1, `rgba(244,241,222,${0.6 - p / 14})`);
      }
    }

    // trophies
    this.trophies.slice(-16).forEach((sev, i) => {
      const tx = SHELF.x + (i % 8) * 8;
      const ty = SHELF.y + Math.floor(i / 8) * 11 - 2;
      this.drawTrophy(tx, ty, SEVERITY_COLOR[sev]);
    });
    // flags
    for (let f = 0; f < Math.min(this.flags, 5); f++) {
      const fy = FLAGPOLE.y + f * 7;
      const wave = Math.floor(now / 250 + f) % 2;
      r(FLAGPOLE.x + 1, fy, 7, 5, f % 2 ? C.coral : C.yellow);
      r(FLAGPOLE.x + 8, fy + wave, 1, 4, f % 2 ? C.coral : C.yellow);
    }
  }

  private drawTrophy(x: number, y: number, color: string) {
    const rows = ["Y.YYY.Y", "YYYYYYY", ".YYYYY.", "..YYY..", "...Y...", "..YYY..", ".BBBBB."];
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === "Y") this.rect(x + i, y + j, 1, 1, color);
        else if (c === "B") this.rect(x + i, y + j, 1, 1, "#3b4660");
      }
    });
  }

  private drawCable(agent: Agent, now: number) {
    const st = this.station(agent);
    if (!st.port || agent.zone !== "network" || agent.action !== "work" || agent.path.length) return;
    const k = Math.min(1, (now - agent.arrivedAt) / 380);
    const hx = agent.x + 3;
    const hy = agent.y - 5;
    const segs = 18;
    for (let i = 0; i <= segs * k; i++) {
      const t = i / segs;
      const x = hx + (st.port.x - hx) * t;
      const sag = Math.sin(t * Math.PI) * 6;
      const y = hy + (st.port.y + 1 - hy) * t + sag;
      this.rect(x, y, 1, 1, agent.look.color);
    }
    if (k >= 1) this.rect(st.port.x - 1, st.port.y, 3, 2, agent.look.color);
  }

  private drawAgent(agent: Agent, now: number) {
    const walking = agent.path.length > 0;
    const frame = walking ? Math.floor(now / 140) % 2 : 0;
    let ox = Math.round(agent.x) - 4;
    let oy = Math.round(agent.y) - 12;
    if (now < agent.jumpUntil) oy -= Math.round(Math.sin(((agent.jumpUntil - now) / 400) * Math.PI) * 4);
    if (now < agent.shakeUntil) ox += Math.floor(now / 40) % 2 ? 1 : -1;
    if (!walking && !agent.action) oy += Math.floor(now / 600 + agent.tag.length) % 2;
    if (agent.spawnAt && now - agent.spawnAt < 450) {
      const k = (now - agent.spawnAt) / 450;
      if (Math.floor(now / 40) % 2 && k < 0.8) return;
    }

    // shadow
    this.rect(ox + 1, Math.round(agent.y), 6, 1, "rgba(0,0,0,0.45)");

    // planner antenna / main agent crown
    if (isPlanner(agent.id)) {
      this.rect(ox + 6, oy - 3, 1, 3, "#c9d1e6");
      this.rect(ox + 5, oy - 4, 3, 1, Math.floor(now / 400) % 2 ? C.coral : C.yellow);
    } else if (isMain(agent.id)) {
      this.rect(ox + 2, oy - 2, 4, 1, C.yellow);
      this.rect(ox + 2, oy - 3, 1, 1, C.yellow);
      this.rect(ox + 5, oy - 3, 1, 1, C.yellow);
    }

    const typing = agent.action === "work" && !walking;
    SPRITE_TOP.forEach((row, j) => {
      for (let i = 0; i < 8; i++) {
        let cell = row[i];
        if (typing && cell === "A" && j === 7 && Math.floor(now / 120) % 2) cell = ".";
        const color = spriteColor(cell, agent.look);
        if (color) this.rect(ox + i, oy + j, 1, 1, color);
      }
    });
    const legs = SPRITE_LEGS[frame];
    legs.forEach((row, j) => {
      for (let i = 0; i < 8; i++) {
        const color = spriteColor(row[i], agent.look);
        if (color) this.rect(ox + i, oy + 10 + j, 1, 1, color);
      }
    });
    // visor glint
    if (Math.floor(now / 900 + agent.tag.length) % 5 === 0) this.rect(ox + 5, oy + 3, 1, 1, "#ffffff");
    // prop in hands
    if (typing && agent.zone === "archive") {
      this.rect(ox + 2, oy + 7, 4, 3, "#f4f1de");
      this.rect(ox + 4, oy + 7, 1, 3, "#c9d1e6");
    } else if (typing && (agent.zone === "web" || agent.zone === "exploit")) {
      this.rect(ox + 1, oy + 8, 6, 2, "#2a3350");
      this.rect(ox + 2, oy + 8, 4, 1, agent.zone === "exploit" ? C.red : C.ice);
    }

    // focus marker
    if (this.focusId === agent.id) {
      const by = oy - 12 + (Math.floor(now / 300) % 2);
      this.rect(ox + 2, by, 5, 1, C.yellow);
      this.rect(ox + 3, by + 1, 3, 1, C.yellow);
      this.rect(ox + 4, by + 2, 1, 1, C.yellow);
    }

    // name tag
    this.text(agent.tag, ox + 4, oy - 9, agent.look.color, 6, "center");

    if (agent.action === "ask" && Math.floor(now / 300) % 2) {
      this.rect(ox + 9, oy - 2, 2, 5, C.yellow);
      this.rect(ox + 9, oy + 4, 2, 1, C.yellow);
    }
  }

  private drawBubble(agent: Agent, now: number) {
    const b = agent.bubble;
    if (!b) return;
    const ctx = this.ctx;
    ctx.font = `7px ${this.font}`;
    const w = Math.ceil(ctx.measureText(b.text).width) + 6;
    let x = Math.round(agent.x - w / 2);
    x = Math.max(2, Math.min(LW - w - 2, x));
    const y = Math.round(agent.y) - 34;
    const fade = b.until - now < 250 ? Math.floor(now / 60) % 2 : 1;
    if (!fade) return;
    this.rect(x - 1, y - 1, w + 2, 12, "#05070d");
    this.rect(x, y, w, 10, "#1a2236");
    this.rect(x, y, w, 1, b.color);
    const tail = Math.round(agent.x);
    this.rect(tail - 1, y + 10, 3, 1, "#1a2236");
    this.rect(tail, y + 11, 1, 1, "#1a2236");
    this.text(b.text, x + 3, y + 2, b.color, 7);
  }

  private drawFx(now: number) {
    for (const f of this.fx) {
      if (now < f.t0) continue;
      const k = (now - f.t0) / f.dur;
      switch (f.k) {
        case "packet": {
          const x = f.x0 + (f.x1 - f.x0) * k;
          const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 10;
          this.rect(x, y, 2, 2, f.color);
          this.rect(x - (f.x1 - f.x0) * 0.03, y + 1, 1, 1, "rgba(255,255,255,0.4)");
          break;
        }
        case "ring": {
          const rad = Math.round(2 + k * 12);
          const c = f.color;
          const a = 1 - k;
          this.ctx.globalAlpha = a;
          this.rect(f.x - rad, f.y - rad, rad * 2, 1, c);
          this.rect(f.x - rad, f.y + rad, rad * 2, 1, c);
          this.rect(f.x - rad, f.y - rad, 1, rad * 2, c);
          this.rect(f.x + rad, f.y - rad, 1, rad * 2 + 1, c);
          this.ctx.globalAlpha = 1;
          break;
        }
        case "particle": {
          const t = (now - f.t0) / 1000;
          const x = f.x + f.vx * t;
          const y = f.y + f.vy * t + 0.5 * f.g * t * t;
          if (k > 0.75 && Math.floor(now / 50) % 2) break;
          this.rect(x, y, 1, 1, f.color);
          break;
        }
        case "float": {
          const y = f.y - k * 14;
          if (k > 0.8 && Math.floor(now / 60) % 2) break;
          this.text(f.text, f.x, y, f.color, 7, "center");
          break;
        }
        case "envelope": {
          const x = f.x0 + (f.x1 - f.x0) * k;
          const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 18;
          this.rect(x - 2, y - 1, 5, 4, "#f4f1de");
          this.rect(x - 2, y - 1, 5, 1, C.yellow);
          this.rect(x, y, 1, 1, C.coral);
          break;
        }
      }
    }
  }

  private drawBanner(now: number) {
    const b = this.banner;
    if (!b) return;
    const k = (now - b.t0) / b.dur;
    if (k < 0.5 && Math.floor(now / 120) % 4 === 3) return;
    const ctx = this.ctx;
    ctx.font = `14px ${this.font}`;
    const w = Math.ceil(ctx.measureText(b.text).width) + 20;
    const x = Math.round(LW / 2 - w / 2);
    const slide = k < 0.12 ? Math.round((1 - k / 0.12) * 20) : 0;
    const y = 104 - slide;
    this.rect(x - 2, y - 2, w + 4, 24, "#05070d");
    this.rect(x, y, w, 20, "#141a2b");
    this.rect(x, y, w, 2, b.color);
    this.rect(x, y + 18, w, 2, b.color);
    this.text(b.text, LW / 2, y + 4, b.color, 14, "center");
  }

  private draw(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!this.bg) this.buildBackground();
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    this.drawDynamic(now);
    const agents = [...this.agents.values()].sort((a, b) => a.y - b.y);
    for (const a of agents) this.drawCable(a, now);
    for (const a of agents) this.drawAgent(a, now);
    this.drawFx(now);
    for (const a of agents) this.drawBubble(a, now);
    this.drawBanner(now);

    // CRT scanlines
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < LH; y += 2) ctx.fillRect(0, y + 1, LW, 0.5);
  }
}

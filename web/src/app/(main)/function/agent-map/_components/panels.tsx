"use client";

import type { ComponentType } from "react";

import {
  BookOpenIcon,
  CheckIcon,
  CrosshairIcon,
  FlagIcon,
  GlobeIcon,
  type LucideProps,
  NetworkIcon,
  SwordsIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  isMain,
  isPlanner,
  levelFor,
  lookFor,
  type MapAction,
  SEVERITY_COLOR,
  type Severity,
  SPRITE_LEGS,
  SPRITE_TOP,
  spriteColor,
  tagFor,
  xpForLevel,
  type Zone,
} from "./model";

// ---------------------------------------------------------------- stats

export interface AgentStats {
  id: string;
  xp: number;
  actions: number;
  last?: MapAction;
  zone: Zone;
}

export interface MapStats {
  agents: AgentStats[];
  tools: number;
  findings: Record<Severity, number>;
  findingTotal: number;
  goals: number;
  zoneCounts: Record<Zone, number>;
  peakWorking: number;
}

const ZONES: Zone[] = ["hq", "network", "web", "exploit", "archive", "lounge", "gate"];

export function computeStats(played: MapAction[]): MapStats {
  const byId = new Map<string, AgentStats>();
  const findings: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const zoneCounts = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<Zone, number>;
  const busy = new Map<string, boolean>();
  let tools = 0;
  let goals = 0;
  let peakWorking = 0;
  for (const a of played) {
    let s = byId.get(a.worker);
    if (!s) {
      s = { id: a.worker, xp: 0, actions: 0, zone: isPlanner(a.worker) || isMain(a.worker) ? "hq" : "lounge" };
      byId.set(a.worker, s);
    }
    s.xp += a.xp;
    s.last = a;
    if (a.tone === "work") {
      s.actions++;
      tools++;
      zoneCounts[a.zone]++;
      s.zone = a.zone;
      if (!isPlanner(a.worker) && !isMain(a.worker)) busy.set(a.worker, true);
    } else if (a.tone === "done" || a.tone === "finding") {
      s.zone = "lounge";
      busy.set(a.worker, false);
    } else if (a.tone === "ask") {
      s.zone = "gate";
    }
    if (a.tone === "finding" && a.severity) findings[a.severity]++;
    if (a.tone === "goal") goals++;
    let working = 0;
    for (const v of busy.values()) if (v) working++;
    peakWorking = Math.max(peakWorking, working);
  }
  const order = (id: string) => (isPlanner(id) ? -2 : isMain(id) ? -1 : Number(/(\d+)/.exec(id)?.[1] ?? 999));
  const agents = [...byId.values()].sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
  const findingTotal = Object.values(findings).reduce((n, v) => n + v, 0);
  return { agents, tools, findings, findingTotal, goals, zoneCounts, peakWorking };
}

export function agentName(id: string): string {
  if (isPlanner(id)) return t("Planner");
  if (isMain(id)) return t("Main agent");
  const m = /(\d+)/.exec(id);
  return m ? t("Worker {n}", { n: m[1] }) : id;
}

export function zoneName(zone: Zone): string {
  switch (zone) {
    case "hq":
      return t("HQ");
    case "network":
      return t("Network");
    case "web":
      return t("Web lab");
    case "exploit":
      return t("Exploit");
    case "archive":
      return t("Archive");
    case "lounge":
      return t("Hall of fame");
    case "gate":
      return t("Awaiting approval");
  }
}

// ---------------------------------------------------------------- avatar

export function PixelAvatar({ id, size = 32, className }: { id: string; size?: number; className?: string }) {
  const look = lookFor(id);
  const cells: { x: number; y: number; c: string }[] = [];
  SPRITE_TOP.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      const c = spriteColor(row[x], look);
      if (c) cells.push({ x: x + 2, y: y + 2, c });
    }
  });
  SPRITE_LEGS[0].forEach((row, j) => {
    for (let x = 0; x < 8; x++) {
      const c = spriteColor(row[x], look);
      if (c) cells.push({ x: x + 2, y: 12 + j, c });
    }
  });
  if (isPlanner(id)) {
    cells.push({ x: 8, y: 0, c: "#c9d1e6" }, { x: 8, y: 1, c: "#c9d1e6" }, { x: 7, y: 0, c: "#ff7a59" });
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 15"
      width={size}
      height={(size * 15) / 12}
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
    >
      {cells.map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.c} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- XP bar

export function XpBar({ xp }: { xp: number }) {
  const level = levelFor(xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const filled = Math.round(((xp - lo) / (hi - lo)) * 10);
  return (
    <div className="flex items-center gap-0.5" title={`${xp} XP`}>
      {Array.from({ length: 10 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length segment bar
        <span key={i} className={cn("h-1.5 w-2", i < filled ? "bg-(--px-yellow)" : "bg-muted")} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- roster

export function Roster({
  stats,
  focus,
  onFocus,
}: {
  stats: MapStats;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  if (!stats.agents.length) {
    return <p className="text-muted-foreground text-xs">{t("No agent has acted yet.")}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {stats.agents.map((a) => {
        const level = levelFor(a.xp);
        const active = focus === a.id;
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onFocus(active ? null : a.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md border border-transparent p-1.5 text-left transition-colors hover:bg-accent/60",
                active && "border-primary/60 bg-accent/60",
              )}
            >
              <PixelAvatar id={a.id} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-sm">{agentName(a.id)}</span>
                  <span className="bg-[#17332d] px-1 font-(family-name:--font-pixel) text-[#ffd166] text-[10px]">
                    {t("LV {n}", { n: level })}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <XpBar xp={a.xp} />
                  <span className="truncate text-[10px] text-muted-foreground">{zoneName(a.zone)}</span>
                </div>
                {a.last?.label && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{a.last.label}</p>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- badges

interface BadgeDef {
  id: string;
  name: string;
  hint: string;
  icon: ComponentType<LucideProps>;
  unlocked: (s: MapStats) => boolean;
}

function badgeDefs(): BadgeDef[] {
  return [
    {
      id: "first-blood",
      name: t("First blood"),
      hint: t("Report a first finding"),
      icon: CrosshairIcon,
      unlocked: (s) => s.findingTotal > 0,
    },
    {
      id: "critical",
      name: t("Critical hit"),
      hint: t("Report a critical finding"),
      icon: SwordsIcon,
      unlocked: (s) => s.findings.critical > 0,
    },
    {
      id: "net",
      name: t("Network mapper"),
      hint: t("10 network actions"),
      icon: NetworkIcon,
      unlocked: (s) => s.zoneCounts.network >= 10,
    },
    {
      id: "web",
      name: t("Web crawler"),
      hint: t("10 web actions"),
      icon: GlobeIcon,
      unlocked: (s) => s.zoneCounts.web >= 10,
    },
    {
      id: "breach",
      name: t("Breacher"),
      hint: t("Launch an exploit tool"),
      icon: TrophyIcon,
      unlocked: (s) => s.zoneCounts.exploit > 0,
    },
    {
      id: "books",
      name: t("Bookworm"),
      hint: t("10 archive lookups"),
      icon: BookOpenIcon,
      unlocked: (s) => s.zoneCounts.archive >= 10,
    },
    {
      id: "squad",
      name: t("Squad up"),
      hint: t("3 workers busy at once"),
      icon: UsersIcon,
      unlocked: (s) => s.peakWorking >= 3,
    },
    {
      id: "mission",
      name: t("Mission accomplished"),
      hint: t("Prove a goal"),
      icon: FlagIcon,
      unlocked: (s) => s.goals > 0,
    },
  ];
}

export function Badges({ stats }: { stats: MapStats }) {
  const defs = badgeDefs();
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {defs.map((b) => {
        const on = b.unlocked(stats);
        const Icon = b.icon;
        return (
          <div
            key={b.id}
            title={`${b.name} · ${b.hint}`}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border p-1.5 text-center transition-all",
              on ? "border-(--px-yellow)/60 bg-(--px-yellow)/10" : "border-dashed opacity-45 grayscale",
            )}
          >
            <span
              className={cn(
                "flex size-7 items-center justify-center",
                on ? "bg-(--px-yellow) text-[#17332d] shadow-[2px_2px_0_var(--px-shadow-color)]" : "bg-muted",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="font-(family-name:--font-pixel) line-clamp-2 text-[9px] leading-tight">{b.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- quest log

const TONE_COLOR: Partial<Record<MapAction["tone"], string>> = {
  finding: "#ff9f43",
  goal: "#ffd166",
  round: "#7cc6fe",
  dispatch: "#ffd166",
  ask: "#ffd166",
  done: "#9be7ff",
};

export function QuestLog({ played }: { played: MapAction[] }) {
  const rows = played
    .filter((a) => a.tone !== "result" && a.tone !== "think")
    .slice(-60)
    .reverse();
  if (!rows.length) return <p className="text-muted-foreground text-xs">{t("Nothing happened yet.")}</p>;
  return (
    <ol className="space-y-0.5 font-mono text-[11px]">
      {rows.map((a) => {
        const look = lookFor(a.worker);
        const color = a.tone === "finding" && a.severity ? SEVERITY_COLOR[a.severity] : TONE_COLOR[a.tone];
        const time = new Date(a.ts);
        return (
          <li
            key={a.seq}
            className="flex items-baseline gap-2 border-border/50 border-b border-dashed py-1 last:border-0"
          >
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {Number.isNaN(time.getTime()) ? "--:--:--" : time.toLocaleTimeString([], { hour12: false })}
            </span>
            <span
              className="w-10 shrink-0 bg-[#17332d] px-1 text-center font-(family-name:--font-pixel) text-[10px]"
              style={{ color: look.color }}
            >
              {tagFor(a.worker)}
            </span>
            <span className="w-16 shrink-0 truncate text-muted-foreground uppercase">{zoneName(a.zone)}</span>
            <span className="min-w-0 flex-1 truncate" style={color ? { color } : undefined}>
              {a.tone === "goal" && <CheckIcon className="mr-1 inline size-3" />}
              {a.label}
            </span>
            {a.xp > 0 && <span className="shrink-0 text-(--px-yellow)">+{a.xp}</span>}
          </li>
        );
      })}
    </ol>
  );
}

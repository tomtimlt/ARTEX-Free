"use client";

import * as React from "react";

import Link from "next/link";

import { GaugeIcon, PauseIcon, PlayIcon, RotateCcwIcon, SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AgentMapEngine, LH, LW, type MapLabels } from "./_components/engine";
import { classify, levelFor, type MapAction, SEVERITY_COLOR, type Severity } from "./_components/model";
import { Badges, computeStats, QuestLog, Roster } from "./_components/panels";

const PAGE = 500;
const MAX_PAGES = 20;
const KEEP = 1500;
const REPLAY_TAIL = 80;
const POLL_MS = 3000;

function mapLabels(): MapLabels {
  return {
    network: t("Network"),
    hq: t("HQ"),
    web: t("Web lab"),
    archive: t("Archive"),
    lounge: t("Hall of fame"),
    exploit: t("Exploit"),
    goal: t("Goal proven!").toUpperCase(),
    levelUp: t("Level up!").toUpperCase(),
    llmSwitch: t("LLM switch").toUpperCase(),
    approval: t("Approval?"),
    done: t("Done"),
    dispatch: t("Dispatch"),
    finding: (s: Severity) =>
      (s === "critical" ? t("Critical finding!") : s === "high" ? t("High finding!") : t("Finding!")).toUpperCase(),
  };
}

function pixelFontFamily(): string {
  if (typeof document === "undefined") return "monospace";
  const v = getComputedStyle(document.body).getPropertyValue("--font-geist-pixel-square").trim();
  return v ? `${v}, monospace` : "monospace";
}

function statusRank(task: Task) {
  if (task.status === "running") return 0;
  if (task.status === "paused" || task.status === "queued") return 1;
  return 2;
}

export default function AgentMapPage() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<AgentMapEngine | null>(null);

  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [taskId, setTaskId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [played, setPlayed] = React.useState<MapAction[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [speed, setSpeed] = React.useState(2);
  const [live, setLive] = React.useState(false);
  const [runId, setRunId] = React.useState(0);
  const [focus, setFocus] = React.useState<string | null>(null);

  const actionsRef = React.useRef<MapAction[]>([]);
  const cursorRef = React.useRef(0);
  const indexRef = React.useRef(0);
  const levelsRef = React.useRef(new Map<string, number>());
  const xpRef = React.useRef(new Map<string, number>());

  // ---- engine lifecycle
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const engine = new AgentMapEngine(canvas, mapLabels(), reduced);
    engineRef.current = engine;
    const family = pixelFontFamily();
    engine.setFont(family);
    document.fonts
      ?.load(`8px ${family}`)
      .then(() => engine.setFont(family))
      .catch(() => undefined);
    const fit = () => engine.resize(wrap.clientWidth, window.devicePixelRatio || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  React.useEffect(() => {
    engineRef.current?.focus(focus);
  }, [focus]);

  // ---- tasks
  React.useEffect(() => {
    api
      .tasks()
      .then(({ tasks: list }) => {
        const sorted = [...list].sort(
          (a, b) => statusRank(a) - statusRank(b) || (b.last_activity_unix ?? 0) - (a.last_activity_unix ?? 0),
        );
        setTasks(sorted);
        setTaskId((cur) => cur || sorted[0]?.id || "");
        if (!sorted.length) setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const credit = React.useCallback((a: MapAction, instant: boolean) => {
    const xp = (xpRef.current.get(a.worker) ?? 0) + a.xp;
    xpRef.current.set(a.worker, xp);
    const level = levelFor(xp);
    const prev = levelsRef.current.get(a.worker) ?? 1;
    levelsRef.current.set(a.worker, level);
    if (!instant && level > prev) engineRef.current?.levelUp(a.worker, level);
  }, []);

  // ---- load history for the selected task, apply all but the tail instantly
  React.useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setLoading(true);
    setLive(false);
    setPlayed([]);
    setFocus(null);
    engineRef.current?.reset();
    actionsRef.current = [];
    cursorRef.current = 0;
    indexRef.current = 0;
    xpRef.current = new Map();
    levelsRef.current = new Map();

    (async () => {
      const all: MapAction[] = [];
      let cursor = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { items, cursor: next } = await api.activity(taskId, { since: cursor, limit: PAGE });
        for (const item of items) {
          const a = classify(item);
          if (a) all.push(a);
        }
        if (next <= cursor || items.length < PAGE) {
          cursor = Math.max(cursor, next);
          break;
        }
        cursor = next;
      }
      if (cancelled) return;
      const kept = all.slice(-KEEP);
      const start = Math.max(0, kept.length - REPLAY_TAIL);
      const engine = engineRef.current;
      for (let i = 0; i < start; i++) {
        engine?.apply(kept[i], true);
        credit(kept[i], true);
      }
      actionsRef.current = kept;
      cursorRef.current = cursor;
      indexRef.current = start;
      setPlayed(kept.slice(0, start));
      setLoading(false);
      setRunId((n) => n + 1);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, credit]);

  // ---- playback loop
  React.useEffect(() => {
    if (paused || loading || runId === 0) return;
    let timer = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const list = actionsRef.current;
      const i = indexRef.current;
      if (i >= list.length) {
        setLive(true);
        timer = window.setTimeout(loop, 400);
        return;
      }
      const a = list[i];
      indexRef.current = i + 1;
      engineRef.current?.apply(a);
      credit(a, false);
      setPlayed((p) => [...p, a]);
      const backlog = list.length - indexRef.current;
      if (backlog > 3) setLive(false);
      const next = list[indexRef.current];
      const gap = next ? Date.parse(next.ts) - Date.parse(a.ts) : 400;
      const base = Number.isFinite(gap) ? Math.min(1800, Math.max(320, gap)) : 600;
      const accel = backlog > 40 ? 4 : backlog > 15 ? 2 : 1;
      timer = window.setTimeout(loop, base / speed / accel);
    };
    loop();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [paused, loading, speed, runId, credit]);

  // ---- live polling
  React.useEffect(() => {
    if (!taskId || loading) return;
    const id = window.setInterval(() => {
      api
        .activity(taskId, { since: cursorRef.current, limit: PAGE })
        .then(({ items, cursor }) => {
          if (cursor > cursorRef.current) cursorRef.current = cursor;
          for (const item of items) {
            const a = classify(item);
            if (a) actionsRef.current.push(a);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [taskId, loading]);

  const replay = () => {
    engineRef.current?.reset();
    xpRef.current = new Map();
    levelsRef.current = new Map();
    indexRef.current = 0;
    setPlayed([]);
    setLive(false);
    setPaused(false);
    setRunId((n) => n + 1);
  };

  const stats = React.useMemo(() => computeStats(played), [played]);
  const task = tasks.find((x) => x.id === taskId);
  const empty = !loading && actionsRef.current.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl">{t("Agent Map")}</h1>
          <p className="text-muted-foreground text-sm">{t("Watch your agents work the target, live or in replay")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={taskId} onValueChange={setTaskId} disabled={!tasks.length}>
            <SelectTrigger className="w-64" aria-label={t("Task")}>
              <SelectValue placeholder={t("Select a task")} />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  <span
                    aria-hidden
                    className={cn(
                      "mr-1.5 inline-block size-1.5",
                      x.status === "running" ? "animate-pulse bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                  {x.name || x.description || x.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={replay} disabled={loading || empty}>
            <RotateCcwIcon /> {t("Replay")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} disabled={loading || empty}>
            {paused ? <PlayIcon /> : <PauseIcon />} {paused ? t("Play") : t("Pause")}
          </Button>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(speed)}
            onValueChange={(v) => v && setSpeed(Number(v))}
            aria-label={t("Speed")}
          >
            {[1, 2, 4].map((s) => (
              <ToggleGroupItem key={s} value={String(s)} className="font-(family-name:--font-pixel) text-xs">
                {s}x
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span
            className={cn(
              "font-(family-name:--font-pixel) flex h-7 items-center gap-1.5 border px-2 text-xs",
              live && !paused ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5", live && !paused ? "animate-pulse bg-primary" : "bg-muted-foreground/50")} />
            {live ? t("Live") : t("Catching up")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HudTile label={t("Tool calls")} value={stats.tools} />
        <HudTile label={t("Findings")} value={stats.findingTotal}>
          <div className="flex gap-0.5">
            {(["critical", "high", "medium", "low"] as Severity[]).map((s) =>
              Array.from({ length: Math.min(8, stats.findings[s]) }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: one square per finding
                  key={`${s}-${i}`}
                  className="size-1.5"
                  style={{ background: SEVERITY_COLOR[s] }}
                />
              )),
            )}
          </div>
        </HudTile>
        <HudTile label={t("Goals proven")} value={stats.goals} />
        <HudTile label={t("Agents")} value={stats.agents.length} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="gap-0 overflow-hidden py-0">
            <div ref={wrapRef} className="relative w-full bg-[#0b0f19]" style={{ aspectRatio: `${LW} / ${LH}` }}>
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={t("Pixel map of the agents' activity")}
                className="absolute inset-0 block size-full [image-rendering:pixelated]"
              />
              {(loading || empty || !tasks.length) && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0b0f19]/70 p-6 text-center">
                  <p className="font-(family-name:--font-pixel) max-w-sm text-[#f4f1de] text-sm">
                    {loading
                      ? t("Loading the map...")
                      : !tasks.length
                        ? t("No task yet. Create one in Tasks and come back to watch it run.")
                        : t("No activity yet for this task.")}
                  </p>
                </div>
              )}
            </div>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("Quest log")}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-72 overflow-y-auto">
              <QuestLog played={played} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("Party")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Roster stats={stats} focus={focus} onFocus={setFocus} />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("Badges")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badges stats={stats} />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GaugeIcon className="size-4 text-primary" /> {t("Sub-agents")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-muted-foreground text-xs leading-relaxed">
              <p>
                {t(
                  "Each task runs one planner and a pool of workers. Describe parallel tracks in the task goal (for example a web track and a network track): the planner turns each track into intents, and idle workers pick them up at the same time.",
                )}
              </p>
              <p>{t("The number of workers per task is set in System settings.")}</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/system/settings">
                  <SettingsIcon /> {t("Open settings")}
                </Link>
              </Button>
              {task && (
                <p className="truncate font-mono text-[10px]" title={task.goal}>
                  {t("Goal")}: {task.goal}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HudTile({ label, value, children }: { label: string; value: number; children?: React.ReactNode }) {
  return (
    <Card size="sm" className="gap-1">
      <CardContent className="space-y-1">
        <p className="font-(family-name:--font-pixel) text-[10px] text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <p className="font-(family-name:--font-pixel) text-2xl tabular-nums">{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}

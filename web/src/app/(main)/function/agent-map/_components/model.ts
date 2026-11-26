// Agent Map model: turns raw activity rows into game actions (which room an
// agent walks to, what it says, how much XP it earns). Pure functions only, so
// the canvas engine and the React side read the same interpretation.

import type { Activity } from "@/lib/types";

export type Zone = "hq" | "network" | "web" | "exploit" | "archive" | "lounge" | "gate";

export type Tone =
  | "work" // a tool call starts: walk to the room and work there
  | "result" // a tool call returned
  | "think" // planning / reasoning text
  | "dispatch" // the planner hands out new intents
  | "finding" // a vulnerability was reported
  | "goal" // a goal was proven
  | "round" // a planner round starts
  | "ask" // waiting for a human approval
  | "switch" // LLM switch / failover
  | "done" // a worker session finished
  | "operator"; // a message from the human operator

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface MapAction {
  seq: number;
  ts: string;
  worker: string;
  zone: Zone;
  tone: Tone;
  label: string;
  isError: boolean;
  severity?: Severity;
  dispatchCount?: number;
  xp: number;
}

const NETWORK =
  /\b(nmap|masscan|naabu|rustscan|f?ping|arp-scan|netdiscover|traceroute|ncat|netcat|nc|smbclient|smbmap|enum4linux(?:-ng)?|rpcclient|snmpwalk|nbtscan|netexec|nxc|crackmapexec|ldapsearch|dig|nslookup|whois|dnsx|subfinder|amass|bbot|assetfinder|ssh|ftp|telnet|tcpdump|responder|showmount|ike-scan)\b/i;
const EXPLOIT =
  /\b(sqlmap|hydra|medusa|msfconsole|msfvenom|metasploit|searchsploit|exploit\w*|impacket\S*|secretsdump\S*|psexec\S*|wmiexec\S*|evil-winrm|mimikatz|john|hashcat|kerbrute|getuserspns\S*|getnpusers\S*|bloodhound\S*|certipy|chisel|ligolo\S*|payload|reverse.?shell|xsstrike|commix|tplmap|ysoserial)\b/i;
const WEB =
  /\b(curl|wget|httpx|ffuf|gobuster|feroxbuster|dirsearch|dirb|nuclei|nikto|wpscan|whatweb|katana|gau|waybackurls|arjun|jwt_tool|wafw00f|testssl\S*|sslscan|playwright\S*|chromium)\b|https?:\/\//i;
const READ = /^\s*(cat|ls|head|tail|grep|rg|jq|find|less|wc|sort|uniq|file|strings|tree|stat)\b/i;

const TOOL_ARCHIVE =
  /^(read|grep|glob|ls|node_detail|list_\w+|query_\w+|search_\w+|get_\w+|record_fact|upsert_asset|insert_assets|add_company_scope|skill|todo\w*|graph_\w+)$/i;
const TOOL_WEB = /^(webfetch|websearch|web_\w+|http_\w+|browser\w*|playwright\w*|replay\w*)$/i;
const TOOL_DISPATCH = /^(add_intent|set_goals|set_constraints|steer\w*|kill_intent|cancel_intent|pause_intent)$/i;
const TOOL_FINDING = /^(report_finding|add_finding)$/i;
const TOOL_GOAL = /^(prove_goal|goal_met)$/i;
const TOOL_SHELL = /^(bash|shell|run_command|exec\w*|pty\w*|interactive\w*|terminal\w*)$/i;

/** Room for a shell command, read from the command text itself. */
export function zoneForCommand(command: string): Zone {
  if (EXPLOIT.test(command)) return "exploit";
  if (NETWORK.test(command)) return "network";
  if (WEB.test(command)) return "web";
  if (READ.test(command)) return "archive";
  return "web";
}

export function zoneForTool(tool: string, summary: string): Zone {
  if (TOOL_FINDING.test(tool) || TOOL_GOAL.test(tool)) return "lounge";
  if (TOOL_DISPATCH.test(tool)) return "hq";
  if (TOOL_SHELL.test(tool)) return zoneForCommand(summary);
  if (TOOL_WEB.test(tool)) return "web";
  if (TOOL_ARCHIVE.test(tool)) return "archive";
  if (/scan|ingest/i.test(tool)) return "network";
  return "archive";
}

function severityOf(text: string): Severity {
  const s = text.toLowerCase();
  if (/\bcritical\b/.test(s)) return "critical";
  if (/\bhigh\b/.test(s)) return "high";
  if (/\bmedium\b/.test(s)) return "medium";
  if (/\blow\b/.test(s)) return "low";
  return "info";
}

const FINDING_XP: Record<Severity, number> = { critical: 150, high: 100, medium: 60, low: 30, info: 15 };

/** First line, squeezed, cut to `max` characters. */
export function shorten(text: string, max = 28): string {
  const line = (text || "").split("\n")[0].replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

export function isPlanner(worker: string) {
  return worker === "planner";
}

export function isMain(worker: string) {
  return worker === "mainagent";
}

/** Interpret one activity row; null when it does not move anything on the map. */
export function classify(a: Activity): MapAction | null {
  const worker = a.worker || "planner";
  const base = { seq: a.seq, ts: a.ts, worker, isError: !!a.is_error };
  const tool = a.tool ?? "";
  const summary = a.summary ?? "";

  switch (a.kind) {
    case "user":
      return { ...base, worker: "planner", zone: "hq", tone: "operator", label: shorten(summary), xp: 0 };
    case "round":
      return { ...base, zone: "hq", tone: "round", label: shorten(summary.split("·")[0] || summary, 18), xp: 0 };
    case "thinking":
    case "text":
      return {
        ...base,
        zone: isPlanner(worker) || isMain(worker) ? "hq" : "archive",
        tone: "think",
        label: shorten(summary),
        xp: 0,
      };
    case "intercept_request":
      return { ...base, zone: "gate", tone: "ask", label: shorten(summary), xp: 0 };
    case "llm_switch":
    case "llm_failover":
      return { ...base, zone: "hq", tone: "switch", label: shorten(summary), xp: 0 };
    case "result":
      if (isPlanner(worker) || isMain(worker)) return null;
      return { ...base, zone: "lounge", tone: "done", label: shorten(summary), xp: 25 };
    case "tool_use": {
      if (TOOL_FINDING.test(tool)) {
        const severity = severityOf(`${summary} ${a.detail ?? ""}`);
        return {
          ...base,
          zone: "lounge",
          tone: "finding",
          label: shorten(summary),
          severity,
          xp: FINDING_XP[severity],
        };
      }
      if (TOOL_GOAL.test(tool)) {
        return { ...base, zone: "lounge", tone: "goal", label: shorten(summary), xp: 200 };
      }
      if (TOOL_DISPATCH.test(tool)) {
        const m = /×\s*(\d+)|x\s*(\d+)/i.exec(summary);
        const dispatchCount = Math.min(6, Math.max(1, Number(m?.[1] ?? m?.[2] ?? 1)));
        return { ...base, zone: "hq", tone: "dispatch", label: shorten(summary), dispatchCount, xp: 10 };
      }
      const label = TOOL_SHELL.test(tool) ? shorten(summary) : shorten(`${tool} ${summary}`);
      return { ...base, zone: zoneForTool(tool, summary), tone: "work", label, xp: 10 };
    }
    case "tool_result":
      return { ...base, zone: zoneForTool(tool, summary), tone: "result", label: shorten(summary, 24), xp: 0 };
    default:
      return null;
  }
}

// ---- display ----

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#ff4d5e",
  high: "#ff9f43",
  medium: "#ffd166",
  low: "#7cc6fe",
  info: "#c9d1e6",
};

const WORKER_COLORS = ["#ff7a59", "#7cc6fe", "#ff8fab", "#4fd1e6", "#a3b1ff", "#e9c48a", "#ff9f43", "#f4f1de"];
const SKINS = ["#f2c9a0", "#d9a27a", "#a86f4c", "#f6d5b8", "#7a4a2e"];

export interface AgentLook {
  color: string;
  dark: string;
  skin: string;
  visor: string;
}

function darken(hex: string, f = 0.62) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function workerIndex(worker: string): number {
  const m = /(\d+)/.exec(worker);
  if (m) return Number(m[1]) - 1;
  let h = 0;
  for (const c of worker) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function lookFor(worker: string): AgentLook {
  if (isPlanner(worker)) return { color: "#ffd166", dark: darken("#ffd166"), skin: SKINS[0], visor: "#141a2b" };
  if (isMain(worker)) return { color: "#e9c48a", dark: darken("#e9c48a"), skin: SKINS[1], visor: "#141a2b" };
  const i = workerIndex(worker);
  const color = WORKER_COLORS[i % WORKER_COLORS.length];
  return { color, dark: darken(color), skin: SKINS[i % SKINS.length], visor: "#ffd166" };
}

/** Short tag drawn over an agent's head. */
export function tagFor(worker: string): string {
  if (isPlanner(worker)) return "PLN";
  if (isMain(worker)) return "MAIN";
  const m = /(\d+)/.exec(worker);
  return m ? `W${m[1]}` : worker.slice(0, 4).toUpperCase();
}

/**
 * 8×12 sprite. Letters: H hood, S skin, V visor, B body, A arm, L legs, F shoes, . empty.
 * Two leg frames for the walk cycle.
 */
export const SPRITE_TOP = [
  "..HHHH..",
  ".HHHHHH.",
  ".HSSSSH.",
  ".HVVVVH.",
  ".HSSSSH.",
  "..BBBB..",
  ".BBBBBB.",
  "ABBBBBBA",
  "ABBBBBBA",
  "..BBBB..",
];
export const SPRITE_LEGS = [
  [".LL..LL.", ".FF..FF."],
  ["..LLLL..", "..FFFF.."],
];

export function spriteColor(cell: string, look: AgentLook): string | null {
  switch (cell) {
    case "H":
      return look.dark;
    case "S":
      return look.skin;
    case "V":
      return look.visor;
    case "B":
      return look.color;
    case "A":
      return look.dark;
    case "L":
      return "#2a3047";
    case "F":
      return "#0d111c";
    default:
      return null;
  }
}

// ---- progression ----

export function levelFor(xp: number): number {
  return 1 + Math.floor(Math.sqrt(xp / 40));
}

export function xpForLevel(level: number): number {
  return (level - 1) ** 2 * 40;
}

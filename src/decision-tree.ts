import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { BiometricMode } from "./types.js";

export type RequestType =
  | "coding"
  | "analysis"
  | "creative"
  | "chitchat"
  | "unknown";
export type RecoveryTier = "red" | "yellow" | "green" | "peak";

export interface DecisionFacts {
  recovery_tier: RecoveryTier;
  recovery_score: number;
  request_type: RequestType;
  intent: string;
  hour: number;
  message_count: number;
  total_chars: number;
}

interface Predicate {
  key: keyof DecisionFacts;
  op: "eq" | "ne" | "in" | "gte" | "lte" | "between" | "contains";
  value: unknown;
}

interface SplitNode {
  split: string;
  cases: { when: Predicate[]; next: string }[];
  default: string;
}

interface LeafNode {
  mode: BiometricMode;
}

type Node = SplitNode | LeafNode;

interface Tree {
  root: string;
  nodes: Record<string, Node>;
}

let cachedTree: Tree | null = null;
let cachedTreePath: string | null = null;

function defaultTreePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "config", "decision-tree.json");
}

export function loadTree(path?: string): Tree {
  const p = path ?? process.env.DECISION_TREE_PATH ?? defaultTreePath();
  if (cachedTree && cachedTreePath === p) return cachedTree;
  const raw = readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as Tree;
  cachedTree = parsed;
  cachedTreePath = p;
  return parsed;
}

export function clearTreeCache(): void {
  cachedTree = null;
  cachedTreePath = null;
}

function evalPredicate(pred: Predicate, facts: DecisionFacts): boolean {
  const actual = facts[pred.key];
  switch (pred.op) {
    case "eq":
      return actual === pred.value;
    case "ne":
      return actual !== pred.value;
    case "in":
      return (
        Array.isArray(pred.value) && (pred.value as unknown[]).includes(actual)
      );
    case "gte":
      return typeof actual === "number" && actual >= (pred.value as number);
    case "lte":
      return typeof actual === "number" && actual <= (pred.value as number);
    case "between": {
      if (typeof actual !== "number" || !Array.isArray(pred.value))
        return false;
      const [lo, hi] = pred.value as [number, number];
      if (lo <= hi) return actual >= lo && actual <= hi;
      // wrap-around range (e.g. hour 22..28 meaning 22-23 and 0-4)
      const hiWrapped = hi % 24;
      return actual >= lo || actual <= hiWrapped;
    }
    case "contains":
      return (
        typeof actual === "string" &&
        actual.toLowerCase().includes(String(pred.value).toLowerCase())
      );
    default:
      return false;
  }
}

function isLeaf(n: Node): n is LeafNode {
  return (n as LeafNode).mode !== undefined;
}

export interface DecisionResult {
  mode: BiometricMode;
  path: string[];
  facts: DecisionFacts;
}

export function walk(facts: DecisionFacts, tree?: Tree): DecisionResult {
  const t = tree ?? loadTree();
  const path: string[] = [];
  let id = t.root;
  const seen = new Set<string>();
  // hard cap at tree size to prevent cycles
  const maxHops = Object.keys(t.nodes).length + 2;
  for (let i = 0; i < maxHops; i++) {
    if (seen.has(id)) break;
    seen.add(id);
    path.push(id);
    const node = t.nodes[id];
    if (!node) throw new Error(`decision tree: missing node ${id}`);
    if (isLeaf(node)) {
      return { mode: node.mode, path, facts };
    }
    const matched = node.cases.find((c) =>
      c.when.every((p) => evalPredicate(p, facts)),
    );
    id = matched ? matched.next : node.default;
  }
  throw new Error("decision tree: traversal exceeded maxHops (cycle?)");
}

export function classifyRequestType(firstUserText: string): RequestType {
  const t = firstUserText.toLowerCase().slice(0, 200);
  if (!t.trim()) return "unknown";
  const codingHints = [
    "code",
    "function",
    "bug",
    "error",
    "stack trace",
    "refactor",
    "typescript",
    "python",
    "rust",
    "regex",
    "compile",
    "```",
  ];
  if (codingHints.some((h) => t.includes(h))) return "coding";
  const analysisHints = [
    "analyze",
    "compare",
    "why does",
    "explain",
    "trade-off",
    "pros and cons",
    "summarize",
    "metric",
  ];
  if (analysisHints.some((h) => t.includes(h))) return "analysis";
  const creativeHints = [
    "write a",
    "poem",
    "story",
    "essay",
    "draft",
    "headline",
    "tagline",
    "brainstorm",
  ];
  if (creativeHints.some((h) => t.includes(h))) return "creative";
  const chitchatHints = [
    "hey",
    "hi ",
    "hello",
    "thanks",
    "lol",
    "how are",
    "what's up",
  ];
  if (chitchatHints.some((h) => t.includes(h))) return "chitchat";
  return "unknown";
}

export function inferIntent(firstUserText: string): string {
  const t = firstUserText.toLowerCase().slice(0, 200);
  if (/\b(urgent|asap|quickly|fast)\b/.test(t)) return "urgent";
  if (/\b(imagine|invent|brainstorm|what if)\b/.test(t)) return "creative";
  if (/\b(fix|debug|broken|fails?)\b/.test(t)) return "debug";
  if (/\?$/.test(firstUserText.trim())) return "question";
  return "general";
}

export function recoveryTier(score: number): RecoveryTier {
  if (score < 33) return "red";
  if (score < 66) return "yellow";
  if (score < 85) return "green";
  return "peak";
}

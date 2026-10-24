// visual_observer_types.ts
// Defines the version-one report and reviewed observation contracts.
// Connects the Playwright collector with the Node reporter and JSON artifacts.
// Mirrors plan_codex §2; V-2 history-only allowlist states are deliberately absent.
export type Scalar = string | number | boolean | null;
export type Check = 'image-box' | 'image-load' | 'image-distortion' | 'text-clip' | 'page-x-scroll'
  | 'touch-size' | 'overlap' | 'offscreen' | 'notice-cover' | 'console' | 'request' | 'contrast';
export type Rect = { x: number; y: number; width: number; height: number };
export type Theme = 'light' | 'dark' | 'unknown';
export type Coverage = { check: Check; status: 'complete' | 'partial' | 'skipped'; examined: number;
  excluded: number; reason: string | null; durationMs: number };
export type Shot = { id: string; test: string; project: string; retry: number; pageId: string;
  navigation: number; file: string; pagePath: string; target: string | null; clip: Rect | null;
  fullPage: boolean; viewport: { width: number; height: number; dpr: number }; theme: Theme;
  osTheme: Theme; language: string; scrolls: { selector: string; x: number; y: number }[];
  capturedAt: string; status: 'complete' | 'partial'; coverage: Coverage[] };
export type Finding = { id: string; shotId: string; check: Check; severity: 'high' | 'medium' | 'low';
  selector: string | null; relatedSelector: string | null; rect: Rect | null; relatedRect: Rect | null;
  rule: string; measured: Record<string, Scalar>; expected: Record<string, Scalar>;
  intentSource: string | null; suppressedBy: string | null; eventIds: string[] };
export type Event = { id: string; pageId: string; navigation: number; at: string;
  kind: 'console-error' | 'pageerror' | 'requestfailed' | 'http'; method: string | null;
  path: string | null; status: number | null; detail: string; fingerprint: string };
export type AllowState = { id: string; reason: string;
  state: 'matched' | 'expired' | 'missing-selector' | 'untested'; matchCount: number; shotIds: string[] };
export type Report = { schemaVersion: 1; runId: string; startedAt: string; revision: string | null;
  dirty: boolean | null; status: 'complete' | 'partial'; shots: Shot[]; findings: Finding[];
  events: Event[]; allowlist: AllowState[]; errors: string[] };
export type Expectation = { id: string; kind: 'image-box' | 'truncation' | 'expanded-target';
  selector: string; shot: string; viewport: { minWidth: number; maxWidth: number }; reason: string;
  source: string; width?: number; height?: number; box?: 'border' | 'content'; lines?: number; via?: '::after' };
export type Expectations = { schemaVersion: 1; entries: Expectation[] };
export type AllowEntry = { id: string; check: Check; selector: string; shot: string;
  viewport: 'any' | { width: number; height: number }; theme: Theme | 'any'; language: string;
  reason: string; owner: string; expires: string; maxMatches: number; eventFingerprint: string | null };

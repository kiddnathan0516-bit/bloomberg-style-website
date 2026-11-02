// The shared "agent loop" used by all three agents.
//
// How an agent works, in plain words:
//   1. We give Claude a task plus a set of tools (functions it may call).
//   2. Claude decides which tool to call next. Our code runs that tool and hands back the result.
//   3. Repeat until Claude calls the agent's "finish" tool with its final decision.
// Claude chooses the steps; our code only executes them and enforces the rules.
import Anthropic from "@anthropic-ai/sdk";
import { maskNumbers } from "./guardrails.js";
import type { TraceStep } from "./types.js";

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type CreateFn = (params: CreateParams) => Promise<Anthropic.Beta.BetaMessage>;

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.AGENT_EFFORT || "low") as "low" | "medium" | "high";
// Server-side refusal fallback is supported on these models only.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

let client: Anthropic | null = null;
let createOverride: CreateFn | null = null;

/** Tests swap in a fake model so the plumbing can be checked without an API key. */
export function setCreateOverride(fn: CreateFn | null) {
  createOverride = fn;
}

/** False when no API key is configured (and no test model is installed). */
export const llmReady = () => !!createOverride || !!process.env.ANTHROPIC_API_KEY;

export async function callClaude(params: Omit<CreateParams, "model">): Promise<Anthropic.Beta.BetaMessage> {
  const full: CreateParams = { model: MODEL, ...params };
  if (FALLBACK_MODELS.has(MODEL)) {
    full.betas = ["server-side-fallback-2026-07-01"];
    full.fallbacks = "default";
  }
  if (createOverride) return createOverride(full);
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it in Netlify > Site configuration > Environment variables.");
  }
  client ??= new Anthropic({ maxRetries: 2, timeout: 55_000 });
  return client.beta.messages.create(full);
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  /** Return a string/object for Claude to read. Throw ToolError to tell Claude it made a mistake. */
  run: (input: any) => Promise<unknown> | unknown;
  /** If true, a successful call ends the agent run. */
  finishes?: boolean;
}

export class ToolError extends Error {}

export interface AgentRun {
  finishTool: string | null;
  finishInput: any;
  finishResult: any;
  trace: TraceStep[];
}

const short = (v: unknown, n = 600) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return maskNumbers(s.length > n ? s.slice(0, n) + " ..." : s);
};

export async function runAgent(opts: {
  agent: string;
  system: string;
  task: Anthropic.Beta.BetaContentBlockParam[] | string;
  tools: AgentTool[];
  maxTurns?: number;
}): Promise<AgentRun> {
  const { agent, system, tools } = opts;
  const trace: TraceStep[] = [];
  const log = (kind: TraceStep["kind"], text: string) => trace.push({ agent, kind, text, at: new Date().toISOString() });
  const toolDefs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    strict: true,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.task }];
  let nudged = false;

  for (let turn = 0; turn < (opts.maxTurns ?? 8); turn++) {
    const res = await callClaude({
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: toolDefs,
      tool_choice: { type: "auto" },
      output_config: { effort: EFFORT },
      messages,
    });
    if (res.stop_reason === "refusal") throw new Error(`${agent}: the model declined this request`);
    messages.push({ role: "assistant", content: res.content });

    for (const b of res.content) if (b.type === "text" && b.text.trim()) log("thought", short(b.text, 400));
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (calls.length === 0) {
      if (nudged) throw new Error(`${agent}: finished without calling a finish tool`);
      nudged = true;
      messages.push({ role: "user", content: "Please finish by calling the appropriate tool with your decision." });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finished: AgentRun | null = null;
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      log("tool", `${call.name}(${short(call.input, 300)})`);
      try {
        if (!tool) throw new ToolError(`Unknown tool ${call.name}`);
        if (finished) throw new ToolError("A finish tool was already called this turn; ignored.");
        const out = await tool.run(call.input);
        const text = typeof out === "string" ? out : JSON.stringify(out);
        log("result", short(text));
        results.push({ type: "tool_result", tool_use_id: call.id, content: text });
        if (tool.finishes) finished = { finishTool: tool.name, finishInput: call.input, finishResult: out, trace };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("error", short(msg));
        results.push({ type: "tool_result", tool_use_id: call.id, content: msg, is_error: true });
        if (!(err instanceof ToolError)) throw err;
      }
    }
    if (finished) return finished;
    messages.push({ role: "user", content: results });
  }
  throw new Error(`${agent}: ran out of steps without a decision`);
}

// Anthropic client + the OpenAI<->Anthropic translation used by the custom-LLM
// proxy (/api/llm). Vapi speaks the OpenAI chat-completions wire format; Claude
// speaks the Anthropic Messages format. This module bridges the two and streams
// Claude's output back as OpenAI-format SSE chunks.

import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import type { ToolDef } from "./tools";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return client;
}

// ── OpenAI request shapes (subset Vapi sends) ──
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

function textOf(content: OpenAIMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((p) => p.text ?? "").join("");
}

// Translate the OpenAI message history into Anthropic messages. We drop incoming
// system messages — our own Scarlett system prompt is injected separately so the
// cached prefix stays byte-stable.
export function toAnthropicMessages(
  messages: OpenAIMessage[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      out.push({ role: "user", content: textOf(m.content) || " " });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      const text = textOf(m.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: input as Record<string, unknown>,
        });
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: " " });
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    if (m.role === "tool") {
      // Attach tool_result to a user message. Merge into the previous user
      // message if it already holds tool_results (consecutive tool messages).
      const block: Anthropic.ContentBlockParam = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: textOf(m.content),
      };
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.role === "user" &&
        Array.isArray(prev.content) &&
        prev.content.every((b) => (b as { type: string }).type === "tool_result")
      ) {
        (prev.content as Anthropic.ContentBlockParam[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }

  // Anthropic requires the first message to be a user turn.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({ role: "user", content: " " });
  }
  return out;
}

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

// ── OpenAI SSE chunk helpers ──
function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const enc = new TextEncoder();

// Stream a Claude response back as OpenAI chat.completion.chunk SSE events.
export function streamClaudeAsOpenAI(opts: {
  model: string;
  systemStable: string; // cached prefix (Scarlett persona + knowledge)
  systemVolatile: string; // not cached (current time, caller id)
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}): ReadableStream<Uint8Array> {
  const id = `chatcmpl-${Math.round(Date.now() / 1000)}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  const created = Math.round(Date.now() / 1000);

  const base = (delta: unknown, finish: string | null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: opts.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let toolIndex = -1;
      let sawToolUse = false;
      try {
        const stream = anthropic().messages.stream({
          model: opts.model,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: opts.systemStable,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: opts.systemVolatile },
          ],
          messages: opts.messages,
          tools: opts.tools,
        });

        // First chunk: announce the assistant role.
        controller.enqueue(enc.encode(sseChunk(base({ role: "assistant" }, null))));

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              sawToolUse = true;
              toolIndex += 1;
              controller.enqueue(
                enc.encode(
                  sseChunk(
                    base(
                      {
                        tool_calls: [
                          {
                            index: toolIndex,
                            id: event.content_block.id,
                            type: "function",
                            function: {
                              name: event.content_block.name,
                              arguments: "",
                            },
                          },
                        ],
                      },
                      null,
                    ),
                  ),
                ),
              );
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              controller.enqueue(
                enc.encode(sseChunk(base({ content: event.delta.text }, null))),
              );
            } else if (event.delta.type === "input_json_delta") {
              controller.enqueue(
                enc.encode(
                  sseChunk(
                    base(
                      {
                        tool_calls: [
                          {
                            index: toolIndex,
                            function: { arguments: event.delta.partial_json },
                          },
                        ],
                      },
                      null,
                    ),
                  ),
                ),
              );
            }
          }
        }

        controller.enqueue(
          enc.encode(
            sseChunk(base({}, sawToolUse ? "tool_calls" : "stop")),
          ),
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("streamClaudeAsOpenAI error", e);
        // Emit a graceful spoken fallback rather than dropping the call.
        controller.enqueue(
          enc.encode(
            sseChunk(
              base(
                {
                  content:
                    "I'm sorry, I'm having a little trouble on my end. Could you say that again?",
                },
                null,
              ),
            ),
          ),
        );
        controller.enqueue(enc.encode(sseChunk(base({}, "stop"))));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

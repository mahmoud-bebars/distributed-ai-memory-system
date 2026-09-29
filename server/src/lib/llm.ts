import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Bindings } from "./bindings";
import { Budget } from "./budget";

export const LLM_MODEL = "claude-sonnet-5";

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** One structured LLM call: the model is forced to answer by calling a single
 *  tool whose input schema is derived from `schema`, the result is validated
 *  with Zod, and an invalid result gets exactly ONE corrective retry (the
 *  validation error is shown to the model) before a hard failure. This is how
 *  the assistant's model gets no side-effect powers: it can only ever emit a
 *  typed value that code then validates and decides what to do with.
 *
 *  `schema` must be an object schema (Anthropic tool inputs are objects).
 *  Every call checks the daily and per-task token caps first and records its
 *  usage afterwards (lib/budget.ts). `taskTokens` is what the task has spent
 *  so far; the returned `tokens` is what THIS call (both attempts) spent. */
export async function callStructured<S extends z.ZodTypeAny>(
  env: Bindings,
  opts: {
    system: string;
    messages: MessageParam[];
    schema: S;
    toolName: string;
    toolDescription: string;
    taskTokens: number;
    maxTokens?: number;
  },
): Promise<{ value: z.infer<S>; tokens: number }> {
  const budget = new Budget(env);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const jsonSchema = zodToJsonSchema(opts.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const messages: MessageParam[] = [...opts.messages];
  let spent = 0;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    await budget.assertLlmRoom(opts.taskTokens + spent);

    const response = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages,
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: jsonSchema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
    });

    const used = response.usage.input_tokens + response.usage.output_tokens;
    spent += used;
    await budget.record("llm_tokens", used);

    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const parsed = opts.schema.safeParse(block?.input);
    if (parsed.success) return { value: parsed.data as z.infer<S>, tokens: spent };

    lastError = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    if (block) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Your output was invalid: ${lastError}. Call the tool again with a valid value.`,
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: "You must answer by calling the tool. Try again." });
    }
  }

  throw new StructuredOutputError(`Model output failed validation twice: ${lastError}`);
}

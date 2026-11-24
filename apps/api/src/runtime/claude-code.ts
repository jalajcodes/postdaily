// Node-only: "Claude (my Claude login)" provider via the Claude Agent SDK, which runs your
// locally installed, signed-in Claude Code. Not available on Cloudflare.
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIError, registerProvider } from "../ai/providers";

export function registerClaudeCodeProvider() {
  registerProvider(
    "claude-code",
    async ({ system, prompt, model }) => {
      // Drop API-key env vars so the SDK uses your Claude login rather than a key.
      const { ANTHROPIC_API_KEY: _k, ANTHROPIC_AUTH_TOKEN: _t, ...env } = process.env;
      let text = "";
      for await (const msg of query({
        prompt,
        options: {
          systemPrompt: system,
          model,
          maxTurns: 1,
          tools: [],
          settingSources: [],
          persistSession: false,
          env,
        },
      })) {
        if (msg.type === "result") {
          if (msg.subtype === "success") text = msg.result;
          else throw new AIError(`Claude login provider failed (${msg.subtype}). Run \`claude\` and sign in, then retry.`);
        }
      }
      if (!text) throw new AIError("Claude returned an empty response.");
      return text;
    },
    async () => {
      const signedIn =
        fs.existsSync(path.join(os.homedir(), ".claude.json")) || fs.existsSync(path.join(os.homedir(), ".claude"));
      return signedIn
        ? { available: true, note: "Uses your local Claude Code sign-in" }
        : { available: false, note: "Run `claude` in a terminal and sign in first" };
    },
  );
}

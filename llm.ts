// ============================================================================
// LLM Client
// ============================================================================

import { complete, type UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OneshotResult } from "./types";

/**
 * Make a oneshot LLM call with system prompt + user message.
 */
export async function oneshotLLM(
	ctx: ExtensionCommandContext,
	systemPrompt: string,
	userMessage: string,
	signal?: AbortSignal,
): Promise<OneshotResult> {
	if (!ctx.model) {
		return { text: "", error: "No model selected" };
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) {
		return { text: "", error: auth.ok ? `No API key for ${ctx.model.provider}` : auth.error };
	}

	const messages: UserMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: userMessage }],
			timestamp: Date.now(),
		},
	];

	try {
		const response = await complete(
			ctx.model,
			{ systemPrompt, messages },
			{ apiKey: auth.apiKey, headers: auth.headers, signal },
		);

		if (response.stopReason === "aborted") {
			return { text: "", error: "Aborted" };
		}

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		return { text };
	} catch (err: any) {
		return { text: "", error: err.message || String(err) };
	}
}

// ============================================================================
// JSON Response Parsing
// ============================================================================

/**
 * Parse JSON from LLM response. Handles plain JSON, JSON in code blocks,
 * or JSON extracted via regex from mixed content.
 */
export function parseJsonResponse<T = Record<string, unknown>>(text: string): T | null {
	try {
		return JSON.parse(text.trim());
	} catch {}

	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]);
		} catch {}
	}

	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1]);
		} catch {}
	}

	return null;
}
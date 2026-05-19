/**
 * Ralph Loop Extension
 *
 * Each step sends a message to the chat as it completes — tail -f style.
 * No widgets, no status lines. Just messages appearing as work happens.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { parseArgs } from "./argParser";
import { truncate } from "./helpers";
import { oneshotLLM, parseJsonResponse } from "./llm";
import {
	FEASIBILITY_PROMPT,
	PROMPT_GENERATOR_PROMPT,
	FALLBACK_GENERATOR_PROMPT,
	FALLBACK_CRITIQUE_PROMPT,
	FALLBACK_JUDGE_PROMPT,
} from "./prompts";
import { renderRalphLoopMessage } from "./renderer";
import type { AgentPrompts, RalphLoopResult, LoopIteration } from "./types";

export default function (pi: ExtensionAPI) {

	pi.registerCommand("ralph-loop-anything", {
		description: "Run a dynamic Ralph loop (Generator->Critique->Judge) to achieve a goal",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: '--goal "', label: '--goal "specify your goal"' },
				{ value: "--loop ", label: "--loop N (default 3)" },
			];
			const filtered = items.filter((i) =>
				i.value.startsWith(prefix) || i.label.startsWith(prefix)
			);
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			let parsed: ReturnType<typeof parseArgs>;
			try {
				parsed = parseArgs(args);
			} catch (err: any) {
				ctx.ui.notify(`Failed: ${err.message}`, "error");
				return;
			}

			const { goal, loop: maxLoops } = parsed;

			if (!ctx.model) {
				ctx.ui.notify("No model selected. Use /model to select one.", "error");
				return;
			}

			ctx.ui.notify(`Ralph Loop: "${goal}" (max ${maxLoops} iterations)`, "info");

			const abortController = new AbortController();
			const signal = abortController.signal;

			// ── Step 1: Feasibility ──────────────────────────────────────────
			pi.sendMessage({
				customType: "ralph-loop",
				content: `## Checking feasibility\n\n> ${goal}\n\nEvaluating whether this goal is achievable with an LLM...`,
				display: true,
			});

			const feasibilityPrompt = `Evaluate whether this goal is achievable using an LLM: "${goal}"`;
			const feasibility = await oneshotLLM(ctx, FEASIBILITY_PROMPT, feasibilityPrompt, signal);

			if (feasibility.error) {
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Feasibility check failed\n\n${feasibility.error}`,
					display: true,
				});
				return;
			}

			const feasibilityJson = parseJsonResponse<{ achievable?: boolean; reason?: string }>(feasibility.text);
			let feasible = true;
			let feasibilityReason = "";

			if (feasibilityJson) {
				feasible = feasibilityJson.achievable !== false;
				feasibilityReason = feasibilityJson.reason || "";
			} else {
				feasibilityReason = "Could not parse feasibility response; proceeding anyway";
			}

			if (!feasible) {
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Goal not achievable\n\n${feasibilityReason || feasibility.text.slice(0, 500)}`,
					display: true,
				});
				return;
			}

			pi.sendMessage({
				customType: "ralph-loop",
				content: `## Feasibility: Yes\n\n${feasibilityReason}\n\nGenerating agent prompts...`,
				display: true,
			});

			// ── Step 2: Generate agent prompts ───────────────────────────────
			const promptGenUserMsg = `Design system prompts for three agents that will work together to achieve this goal:

"${goal}"

Each prompt must be specifically tailored to this goal's domain. Output the JSON with keys: domain, generator_prompt, critique_prompt, judge_prompt. The "domain" field should identify the subject area (e.g., "Literary Fiction", "Systems Programming", "Business Strategy").`;

			const promptGenResult = await oneshotLLM(ctx, PROMPT_GENERATOR_PROMPT, promptGenUserMsg, signal);

			let agentPrompts: AgentPrompts;
			let domain = "General";

			if (promptGenResult.error) {
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Prompt generation failed\n\nUsing fallback prompts. Error: ${promptGenResult.error}`,
					display: true,
				});
				agentPrompts = {
					generator_prompt: FALLBACK_GENERATOR_PROMPT,
					critique_prompt: FALLBACK_CRITIQUE_PROMPT,
					judge_prompt: FALLBACK_JUDGE_PROMPT,
				};
			} else {
				const promptGenJson = parseJsonResponse<{ domain?: string; generator_prompt?: string; critique_prompt?: string; judge_prompt?: string }>(promptGenResult.text);
				if (
					promptGenJson &&
					typeof promptGenJson.generator_prompt === "string" &&
					typeof promptGenJson.critique_prompt === "string" &&
					typeof promptGenJson.judge_prompt === "string"
				) {
					agentPrompts = {
						generator_prompt: promptGenJson.generator_prompt,
						critique_prompt: promptGenJson.critique_prompt,
						judge_prompt: promptGenJson.judge_prompt,
					};
					domain = promptGenJson.domain || "General";

					pi.sendMessage({
						customType: "ralph-loop",
						content: buildPromptsMessage(domain, agentPrompts),
						display: true,
					});
				} else {
					pi.sendMessage({
						customType: "ralph-loop",
						content: `## Prompt generation: could not parse\n\nUsing fallback prompts.`,
						display: true,
					});
					agentPrompts = {
						generator_prompt: FALLBACK_GENERATOR_PROMPT,
						critique_prompt: FALLBACK_CRITIQUE_PROMPT,
						judge_prompt: FALLBACK_JUDGE_PROMPT,
					};
				}
			}

			// ── Step 3: Ralph Loop ───────────────────────────────────────────
			const iterations: LoopIteration[] = [];
			let currentResult = "";
			let currentCriticism = "";

			for (let i = 1; i <= maxLoops; i++) {
				const loopIteration: LoopIteration = {
					loop: i,
					steps: [],
					achieved: false,
					finalResult: "",
					finalCriticism: "",
					finalJudgeReason: "",
				};

				// ── Generate ──
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Generating...`,
					display: true,
				});

				let generatorUserMsg: string;
				if (i === 1) {
					generatorUserMsg = `Goal: ${goal}\n\nProduce your best result to achieve this goal.`;
				} else {
					generatorUserMsg = [
						`Goal: ${goal}`,
						``,
						`Previous result:`,
						`${currentResult}`,
						``,
						`Criticism of the previous result:`,
						`${currentCriticism}`,
						``,
						`Improve upon the previous result, carefully addressing all the criticisms. Produce a better version.`,
					].join("\n");
				}

				const genResult = await oneshotLLM(ctx, agentPrompts.generator_prompt, generatorUserMsg, signal);
				if (genResult.error) {
					pi.sendMessage({
						customType: "ralph-loop",
						content: `## Loop ${i}/${maxLoops} — Generator failed\n\n${genResult.error}`,
						display: true,
					});
					return;
				}

				currentResult = genResult.text;
				loopIteration.steps.push({
					type: "generate",
					preview: truncate(currentResult, 100),
					full: currentResult,
				});

				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Generated\n\n${currentResult}`,
					display: true,
				});

				// ── Critique ──
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Critiquing...`,
					display: true,
				});

				const critiqueUserMsg = [
					`Goal: ${goal}`,
					``,
					`Result to evaluate:`,
					`${currentResult}`,
					``,
					`Critically evaluate this result against the goal. Identify problems and suggest improvements.`,
				].join("\n");

				const critResult = await oneshotLLM(ctx, agentPrompts.critique_prompt, critiqueUserMsg, signal);
				if (critResult.error) {
					pi.sendMessage({
						customType: "ralph-loop",
						content: `## Loop ${i}/${maxLoops} — Critique failed\n\n${critResult.error}`,
						display: true,
					});
					return;
				}

				currentCriticism = critResult.text;
				loopIteration.steps.push({
					type: "critique",
					preview: truncate(currentCriticism, 100),
					full: currentCriticism,
				});

				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Critique\n\n${currentCriticism}`,
					display: true,
				});

				// ── Judge ──
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Judging...`,
					display: true,
				});

				const judgeUserMsg = [
					`Goal: ${goal}`,
					``,
					`Result:`,
					`${currentResult}`,
					``,
					`Criticism:`,
					`${currentCriticism}`,
					``,
					`Determine if the goal has been adequately achieved. Respond with JSON.`,
				].join("\n");

				const judgeResult = await oneshotLLM(ctx, agentPrompts.judge_prompt, judgeUserMsg, signal);
				if (judgeResult.error) {
					pi.sendMessage({
						customType: "ralph-loop",
						content: `## Loop ${i}/${maxLoops} — Judge failed\n\n${judgeResult.error}`,
						display: true,
					});
					return;
				}

				const judgeJson = parseJsonResponse<{ done?: boolean; reason?: string }>(judgeResult.text);
				let done = false;
				let judgeReason = "";

				if (judgeJson) {
					done = judgeJson.done === true;
					judgeReason = judgeJson.reason || "";
				} else {
					judgeReason = `(could not parse judge response) ${judgeResult.text.slice(0, 200)}`;
				}

				loopIteration.steps.push({
					type: "judge",
					verdict: done,
					reason: judgeReason,
					raw: judgeResult.text,
				});

				loopIteration.achieved = done;
				loopIteration.finalResult = currentResult;
				loopIteration.finalCriticism = currentCriticism;
				loopIteration.finalJudgeReason = judgeReason;

				iterations.push(loopIteration);

				const verdict = done ? "DONE ✓" : "CONTINUE ✗";
				pi.sendMessage({
					customType: "ralph-loop",
					content: `## Loop ${i}/${maxLoops} — Judge: ${verdict}\n\n${judgeReason}`,
					display: true,
				});

				if (done) break;
			}

			// ── Step 4: Final verdict ─────────────────────────────────────────
			const lastIteration = iterations[iterations.length - 1];
			const achieved = lastIteration?.achieved ?? false;
			const verdictReason = lastIteration?.finalJudgeReason || "no judgment rendered";
			const finalLabel = achieved ? "GOAL ACHIEVED ✓" : "GOAL NOT FULLY ACHIEVED ✗";

			const lines: string[] = [];
			lines.push(`## Result: ${finalLabel}`);
			lines.push(``);
			lines.push(`> ${verdictReason}`);
			lines.push(``);
			lines.push(`---`);
			lines.push(``);
			lines.push(`**Final output:**`);
			lines.push(``);
			lines.push(lastIteration?.finalResult || "(no result)");

			if (lastIteration?.finalCriticism && lastIteration.finalCriticism.trim()) {
				lines.push(``);
				lines.push(`**Final criticism:**`);
				lines.push(``);
				lines.push(lastIteration.finalCriticism);
			}

			lines.push(``);
			lines.push(`---`);
			lines.push(``);
			lines.push(`*${iterations.length}/${maxLoops} iterations, domain: ${domain}*`);

			pi.sendMessage({
				customType: "ralph-loop",
				content: lines.join("\n"),
				display: true,
				details: {
					goal,
					domain,
					maxLoops,
					loopCount: iterations.length,
					achieved,
					feasibilityReason,
					feasibilityRaw: feasibility.text,
					agentPrompts,
					result: lastIteration?.finalResult || "",
					criticism: lastIteration?.finalCriticism || "",
					judgeReason: lastIteration?.finalJudgeReason || "",
					iterations,
				} as RalphLoopResult,
			});
		},
	});

	pi.registerMessageRenderer("ralph-loop", (message, theme) => {
		return renderRalphLoopMessage(message, theme);
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPromptsMessage(domain: string, prompts: AgentPrompts): string {
	return [
		`## Agent Prompts — Domain: ${domain}`,
		``,
		`### Generator`,
		``,
		prompts.generator_prompt,
		``,
		`### Critique`,
		``,
		prompts.critique_prompt,
		``,
		`### Judge`,
		``,
		prompts.judge_prompt,
	].join("\n");
}
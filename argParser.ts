// ============================================================================
// Argument Parsing
// ============================================================================

import type { ParsedArgs } from "./types";

/**
 * Parse command arguments: --goal "..." [--loop N]
 * Returns { goal: string, loop: number }
 * Throws if --goal is missing.
 */
export function parseArgs(raw: string): ParsedArgs {
	let loop = 3;

	const loopMatch = raw.match(/--loop\s+(\d+)/);
	if (loopMatch) {
		loop = parseInt(loopMatch[1], 10);
	}

	let remaining = raw.replace(/--loop\s+\d+/, "").trim();

	if (remaining.startsWith("--goal")) {
		remaining = remaining.slice(6).trim();
	}

	let goal = "";

	if (remaining.startsWith('"')) {
		const endQuote = remaining.indexOf('"', 1);
		if (endQuote !== -1) {
			goal = remaining.slice(1, endQuote);
		} else {
			goal = remaining.slice(1);
		}
	} else if (remaining.startsWith("'")) {
		const endQuote = remaining.indexOf("'", 1);
		if (endQuote !== -1) {
			goal = remaining.slice(1, endQuote);
		} else {
			goal = remaining.slice(1);
		}
	} else {
		goal = remaining;
	}

	if (!goal.trim()) {
		throw new Error('--goal is required. Usage: /ralph-loop-anything --goal "Your goal" [--loop N]');
	}

	return { goal: goal.trim(), loop };
}
// ============================================================================
// Text Helpers
// ============================================================================

/**
 * Truncate text to maxLen characters, appending "…" if truncated
 */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + "…";
}

/**
 * Return only the first n lines of text
 */
export function firstNLines(text: string, n: number): string {
	const lines = text.split("\n");
	return lines.slice(0, n).join("\n");
}
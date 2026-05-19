// ============================================================================
// Message Renderer
//
// Each message is self-contained markdown — the renderer just passes it
// through as a Markdown component. No layout, no boxes, no truncation.
// ============================================================================

import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-tui";
import type { Message } from "@earendil-works/pi-coding-agent";

export function renderRalphLoopMessage(
	message: Message,
	_theme: Theme,
): Markdown {
	const content = typeof message.content === "string" ? message.content : "";
	return new Markdown(content, 0, 0, getMarkdownTheme());
}
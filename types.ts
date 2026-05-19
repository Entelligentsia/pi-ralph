// ============================================================================
// Types
// ============================================================================

export interface ParsedArgs {
	goal: string;
	loop: number;
}

export interface OneshotResult {
	text: string;
	error?: string;
}

export interface AgentPrompts {
	generator_prompt: string;
	critique_prompt: string;
	judge_prompt: string;
}

/**
 * A single step within a loop iteration.
 * Each iteration has 4 steps: Generate → Critique → Judge → (implied: Revise)
 */
export type LoopStep =
	| { type: "generate"; preview: string; full: string }
	| { type: "critique"; preview: string; full: string }
	| { type: "judge"; verdict: boolean; reason: string; raw: string }
	| { type: "revision"; reason: string }; // Why we're revising (based on judge verdict)

export interface LoopIteration {
	loop: number;
	steps: LoopStep[];
	achieved: boolean; // did judge say done: true
	finalResult: string;
	finalCriticism: string;
	finalJudgeReason: string;
}

export interface RalphLoopResult {
	goal: string;
	domain: string; // identified domain for the goal
	maxLoops: number;
	loopCount: number;
	achieved: boolean;
	feasibilityReason: string;
	feasibilityRaw: string;
	agentPrompts: AgentPrompts;
	result: string;
	criticism: string;
	judgeReason: string;
	iterations: LoopIteration[];
}
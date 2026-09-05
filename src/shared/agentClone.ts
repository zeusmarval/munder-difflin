/**
 * Clone an agent onto another repo.
 *
 * "The same Jim, but for the other project" — identity, engine and briefing
 * copied, workspace chosen fresh. The template is what Add Agent seeds its form
 * from, so the clone goes through the exact same spawn path as a hand-made
 * hire (and a hire manifest): nothing is spawned until the human presses spawn.
 *
 * Deliberately NOT a HireManifest: that type only carries the four providers a
 * manifest is allowed to name, and a clone must keep whatever engine the
 * source runs on (grok, gemini, opencode, crush, a custom command…).
 */
export interface AgentCloneTemplate {
  /** Where it came from — for the banner and to keep the source's repo out of
   *  the default workspace pick (the point is a DIFFERENT repo). */
  sourceId: string;
  sourceName: string;
  sourceCwd: string;
  name: string;
  character: string;
  accent: string;
  provider: string;
  model?: string;
  /** The source's exact spawn command. Reused verbatim only for a 'custom'
   *  provider; every preset provider rebuilds from provider + model so the
   *  clone picks up the current global flags (auto mode, etc.). */
  command?: string;
  description: string;
  goal?: string;
  /** Git isolation is a property of the source's SPAWN, not of the agent
   *  record — a worktree path means it was spawned isolated. */
  isolate: boolean;
  /** Per-agent token ceiling, copied so the clone is budgeted like the source. */
  tokenCap?: number;
}

export interface CloneableAgent {
  id: string;
  name: string;
  character: string;
  accent: string;
  provider?: string;
  model?: string;
  command?: string;
  description: string;
  goal?: string;
  cwd: string;
  worktreePath?: string;
}

export function cloneTemplateFromAgent(agent: CloneableAgent, tokenCap?: number): AgentCloneTemplate {
  return {
    sourceId: agent.id,
    sourceName: agent.name,
    sourceCwd: agent.cwd,
    name: agent.name,
    character: agent.character,
    accent: agent.accent,
    provider: agent.provider ?? 'claude',
    model: agent.model,
    command: agent.command,
    description: agent.description,
    goal: agent.goal || undefined,
    isolate: !!agent.worktreePath,
    tokenCap: tokenCap && tokenCap > 0 ? tokenCap : undefined
  };
}

/** The workspace a clone should start on: the first registered project that is
 *  not the source's own, or empty so the form forces a pick. */
export function defaultCloneWorkspace(template: AgentCloneTemplate, registeredRepos: readonly string[]): string {
  return registeredRepos.find((r) => r !== template.sourceCwd) ?? '';
}

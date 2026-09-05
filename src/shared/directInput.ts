/**
 * Direct-input policy — who the human may TYPE to.
 *
 * The office is meant to be driven through the orchestrator: the human briefs
 * Michael, Michael hands work to the floor. Typing straight into a worker's
 * terminal (or its composer, or a steer note) bypasses that and desyncs the
 * orchestrator's picture of who is doing what. So every worker starts LOCKED and
 * the operator opens one on purpose, per agent, from the control strip.
 *
 * Kept as a shared pure helper so the renderer gates (terminal keystrokes,
 * file drops, composer, steer) and any future main-side check all answer the
 * same question the same way.
 */
export interface DirectInputSubject {
  /** The orchestrator — always open; it IS the channel. */
  isGod?: boolean;
  /** Michael's prep assistant — send-only relay to the orchestrator, so typing
   *  to it is typing to Michael. */
  isAssistant?: boolean;
  /** Operator override: this worker takes direct input until locked again.
   *  Undefined/false = locked (the default for every worker). */
  directInput?: boolean;
}

/** True when the human may write straight to this agent. */
export function directInputAllowed(agent: DirectInputSubject | null | undefined): boolean {
  if (!agent) return true; // nothing to protect — an unknown pty stays usable
  return !!agent.isGod || !!agent.isAssistant || !!agent.directInput;
}

/** Whether the lock control is meaningful for this agent at all. The
 *  orchestrator and its assistant never show one. */
export function directInputLockable(agent: DirectInputSubject | null | undefined): boolean {
  return !!agent && !agent.isGod && !agent.isAssistant;
}

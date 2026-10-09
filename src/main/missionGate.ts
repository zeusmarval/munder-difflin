/**
 * Should a scheduled dispatch mission be skipped because the floor has not
 * changed since it last fired?
 *
 * "Changed" is measured on the WORKERS, never on god: the standup itself makes
 * god read, think and write the board, so counting god's own activity would
 * make every standup the reason for the next one. Worker activity (coordination
 * files, terminal output) or real mail waiting in god's inbox is what makes a
 * review worth a turn. A skipped fire does not stamp lastFiredAt, so the next
 * check still compares against the last review that actually ran.
 */

export const OPS_STANDUP_ID = 'ops-standup';

export interface MissionGateInput {
  /** The mission as persisted. */
  mission: { id: string; skipWhenIdle?: boolean; lastFiredAt?: number };
  /** Newest worker activity timestamp (ms), 0 when there are no workers. */
  lastWorkerActivityAt: number;
  /** Unread worker/human mail in god's inbox (scheduler noise excluded). */
  godActionableInbox: number;
}

export function skipWhenIdleEnabled(mission: { id: string; skipWhenIdle?: boolean }): boolean {
  return mission.skipWhenIdle ?? mission.id === OPS_STANDUP_ID;
}

export function shouldSkipIdleMission({ mission, lastWorkerActivityAt, godActionableInbox }: MissionGateInput): boolean {
  if (!skipWhenIdleEnabled(mission)) return false;
  const last = mission.lastFiredAt ?? 0;
  if (last <= 0) return false; // never ran: nothing to compare against
  if (godActionableInbox > 0) return false;
  return lastWorkerActivityAt <= last;
}

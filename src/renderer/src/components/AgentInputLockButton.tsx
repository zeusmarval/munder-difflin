import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import { useStore } from '@/store/store';
import { directInputAllowed, directInputLockable } from '@shared/directInput';

/**
 * Direct-input lock — "the human talks to Michael, not to this worker."
 *
 * Every worker starts LOCKED: its terminal swallows keystrokes, paste, IME and
 * file drops, its composer and steer box are disabled. Work still reaches it
 * the normal way (Michael's work orders, queue drains, hive nudges), because
 * those are typed by the app, not by a person. The lock only exists so a
 * stray "just this once" message into a worker does not fork the orchestrator's
 * picture of the floor.
 *
 * Flipping it open is a per-agent, deliberate act, and it stays open until
 * locked again (the flag rides the roster, so it survives a reload). It lives
 * in `AgentControlStrip` next to the 1:1 hold, which is the same kind of
 * control — it restrains the HUMAN's channel, not the agent.
 *
 * Never rendered for Michael or his assistant: they are the channel.
 */
export function AgentInputLockButton({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));
  const godName = useStore((s) => s.agents.find((a) => a.isGod)?.name) ?? 'the orchestrator';

  if (!directInputLockable(agent)) return null;
  const open = directInputAllowed(agent);

  return (
    <PixelButton
      variant={open ? 'primary' : 'secondary'}
      size="sm"
      onClick={() => useStore.getState().updateAgent(agentId, { directInput: !open })}
    >
      <span
        className="cth-tip cth-tip-wrap"
        data-tip={open
          ? t('inputLock.lockTip', { name: agent!.name, godName })
          : t('inputLock.unlockTip', { name: agent!.name, godName })}
        aria-label={open ? t('inputLock.lockAria') : t('inputLock.unlockAria')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Icon name={open ? 'unlock' : 'lock'} /> {open ? t('inputLock.open') : t('inputLock.locked')}
      </span>
    </PixelButton>
  );
}

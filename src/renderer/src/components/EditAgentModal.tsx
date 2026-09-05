import { useEffect, useState, type CSSProperties } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { ProviderLogo } from './ProviderLogo';
import { useStore, type Agent } from '@/store/store';
import { OFFICE_CAST, type OfficeCharacterName } from '@/scene/office/cast';
import { Icon } from './Icon';
import { cloneTemplateFromAgent } from '@shared/agentClone';
import { type AccentColorName } from '@/design/tokens';
import {
  type AgentProvider,
  type HarnessConfig,
  AGENT_PROVIDER_PRESETS,
  buildSpawnCommand,
  modelsForProvider,
  inferAgentProvider,
  providerPreset,
  isClaudeProvider
} from '@/store/config';

const ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];

export interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

/**
 * Compact post-hire editor for Identity / Engine / Briefing. Mirrors the Add
 * Agent fields that matter after spawn; save only patches the durable roster
 * via updateAgent (engine changes apply on the next restart).
 */
export function EditAgentModal({ agent, onClose }: EditAgentModalProps) {
  const updateAgent = useStore((s) => s.updateAgent);
  const setAddAgentOpen = useStore((s) => s.setAddAgentOpen);
  const [config, setConfig] = useState<HarnessConfig | null>(null);

  const [name, setName] = useState(agent.name);
  const [character, setCharacter] = useState<OfficeCharacterName>(agent.character);
  const [accent, setAccent] = useState<AccentColorName>(agent.accent);
  const [provider, setProvider] = useState<AgentProvider>(
    inferAgentProvider(agent.command, agent.provider)
  );
  const [model, setModel] = useState<string | undefined>(agent.model);
  const [description, setDescription] = useState(agent.description);
  const [goal, setGoal] = useState(agent.goal ?? '');
  // Workspace — the repo this agent (re)spawns into. Every restart path
  // (Command Center restart, restore on launch, auto-revive) reads `agent.cwd`,
  // so patching it here is enough for the next restart to land in the new repo.
  const [cwd, setCwd] = useState(agent.cwd);
  const [repos, setRepos] = useState<string[]>([]);
  const [cwdError, setCwdError] = useState<string | null>(null);
  // Michael runs in the hive home and his assistant follows him; neither takes
  // a project of its own, so the picker is hidden for them.
  const canPickWorkspace = !agent.isGod && !agent.isAssistant;

  useEffect(() => {
    void window.cth.getConfig().then((c) => {
      setConfig(c);
      setRepos(c?.registeredRepos ?? []);
    }).catch(() => setConfig(null));
  }, []);

  // Keep form in sync when the selected agent changes while the modal is open.
  useEffect(() => {
    setName(agent.name);
    setCharacter(agent.character);
    setAccent(agent.accent);
    setProvider(inferAgentProvider(agent.command, agent.provider));
    setModel(agent.model);
    setDescription(agent.description);
    setGoal(agent.goal ?? '');
    setCwd(agent.cwd);
    setCwdError(null);
  }, [agent.id]);

  const pickFolder = async () => {
    const res = await window.cth.chooseFolder();
    if (res.ok) { setCwd(res.path); setCwdError(null); }
  };

  /** Add a path to the registered-projects quick picks (same list Add Agent
   *  uses), so the next hire can pick it in one click. */
  const registerProject = async (path: string) => {
    const p = path.trim();
    if (!p || repos.includes(p)) return;
    const next = [p, ...repos.filter((r) => r !== p)];
    setRepos(next);
    try {
      const updated = await window.cth.updateConfig({ registeredRepos: next });
      setRepos(updated.registeredRepos ?? next);
    } catch { /* quick picks are a convenience; the cwd itself still saves */ }
  };

  const pickProvider = (id: AgentProvider) => {
    setProvider(id);
    if (!config) {
      setModel(undefined);
      return;
    }
    const nextModel = isClaudeProvider(id) ? config.defaultModel : config.providerDefaultModels?.[id];
    setModel(nextModel);
  };

  const preset = providerPreset(provider);

  /** "Same agent, other repo": hand the CURRENT form values (not the saved
   *  record — what you see is what gets cloned) to Add Agent as a template and
   *  swap dialogs. Nothing is saved here; nothing spawns until the human picks
   *  a workspace and presses spawn there. */
  const cloneToAnotherRepo = () => {
    const template = cloneTemplateFromAgent(
      {
        ...agent,
        name: name.trim() || agent.name,
        character,
        accent,
        provider,
        model,
        command: config ? buildSpawnCommand(config, model, provider) : agent.command,
        description: description.trim() || agent.description,
        goal: goal.trim() || undefined
      },
      config?.agentTokenCaps?.[agent.id]
    );
    onClose();
    setAddAgentOpen(true, template);
  };

  const save = () => {
    const trimmedName = name.trim() || agent.name;
    const trimmedDescription = description.trim() || 'a fresh harness';
    const trimmedGoal = goal.trim();
    const command = config
      ? buildSpawnCommand(config, model, provider)
      : agent.command;

    const nextCwd = cwd.trim();
    const cwdChanged = canPickWorkspace && nextCwd !== agent.cwd;
    if (cwdChanged && !nextCwd) { setCwdError('Pick a project folder or leave the current one.'); return; }

    updateAgent(agent.id, {
      name: trimmedName,
      character,
      accent,
      provider,
      model,
      command,
      description: trimmedDescription,
      goal: trimmedGoal || undefined,
      // A new repo means a new project label and NO inherited worktree: the old
      // `agent/<id>` worktree belongs to the previous repo, and the restore /
      // revive paths would otherwise cd back into it and ignore the change.
      ...(cwdChanged ? { cwd: nextCwd, project: basename(nextCwd), worktreePath: undefined } : {})
    });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 19, 32, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 500
      }}
    >
      {/* Same box as Add Agent (940 / 95vw / 86vh). They are the two halves of
          one job — describe an agent — and a tall narrow dialog next to a wide
          one reads as two unrelated screens. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: 940, maxWidth: '95vw' }}>
        <PixelPanel variant="dialog" title="EDIT AGENT" style={{ padding: 16 }} noPadding>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 14,
            padding: 16, maxHeight: '86vh', overflowY: 'auto'
          }}>
            {/* Two columns so the extra width is used rather than padded.
                Identity and Engine are short field lists; Briefing is free
                text and takes the taller side. minHeight keeps the dialog from
                collapsing into a wide thin strip on a small form. */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 16, alignItems: 'start', minHeight: 260
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Section label="Identity" hint="name · character · color">
              <Row label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Stanley"
                  style={inputStyle}
                  autoFocus
                />
              </Row>

              <Row label="Character">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {OFFICE_CAST.map((c) => {
                    const active = character === c.name;
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => { setCharacter(c.name); setName(c.displayName); }}
                        title={c.blurb}
                        style={{
                          padding: 4,
                          background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                          boxShadow: active
                            ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                            : 'inset 0 0 0 1px var(--cth-ink-100)',
                          cursor: 'pointer', border: 'none', width: 52,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                        }}
                      >
                        <div style={{
                          width: 40, height: 48,
                          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                          overflow: 'hidden'
                        }}>
                          <SpritePortrait character={c.name} scale={1.5} />
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--cth-ink-700)' }}>{c.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </Row>

              <Row label="Color">
                <div style={{ display: 'flex', gap: 6 }}>
                  {ACCENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAccent(a)}
                      title={a}
                      style={{
                        width: 28, height: 28,
                        background: `var(--cth-${a})`,
                        boxShadow: accent === a
                          ? 'inset 0 0 0 1.5px var(--cth-ink-500), 0 0 0 2px var(--cth-ink-900)'
                          : 'inset 0 0 0 1px var(--cth-ink-300)',
                        cursor: 'pointer', border: 'none'
                      }}
                    />
                  ))}
                </div>
              </Row>
            </Section>

            <Section label="Engine" hint="provider · model · next restart">
              <Row label="Provider">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {AGENT_PROVIDER_PRESETS.map((p) => {
                    const active = provider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProvider(p.id)}
                        title={p.label}
                        style={{
                          padding: '3px 8px 1px',
                          background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                          boxShadow: active
                            ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                            : 'inset 0 0 0 1px var(--cth-ink-100)',
                          fontFamily: 'var(--cth-font-ui)', fontSize: 12,
                          color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none',
                          display: 'inline-flex', alignItems: 'center', gap: 6
                        }}
                      >
                        <ProviderLogo provider={p.id} size={14} />
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Row>

              {preset.supportsModel && (
                <Row label="Model">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(() => {
                      const known = modelsForProvider(provider);
                      return model && !known.some((m) => m.id === model)
                        ? [...known, { id: model, label: `${model} (current)` }]
                        : known;
                    })().map((m) => {
                      const active = (model ?? '') === (m.id ?? '');
                      return (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() => setModel(m.id)}
                          title={m.id ?? 'CLI default model'}
                          style={{
                            padding: '3px 8px 1px',
                            background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                            boxShadow: active
                              ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                              : 'inset 0 0 0 1px var(--cth-ink-100)',
                            fontFamily: 'var(--cth-font-ui)', fontSize: 12,
                            color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none'
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </Row>
              )}

              <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>
                Engine changes are saved for the next restart. Use Command Center → Floor to restart a live session onto a new provider/model now.
              </span>
            </Section>

              </div>
              <div style={{ minWidth: 0 }}>
            <Section label="Briefing" hint="description · goal">
              <Row label="Description">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="what is this agent for"
                  style={inputStyle}
                />
              </Row>

              <Row label="Goal (optional)">
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="long-running directive injected on every prompt"
                  rows={4}
                  style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'vertical', minHeight: canPickWorkspace ? 120 : 200 }}
                />
              </Row>
            </Section>

            {canPickWorkspace && (
              <div style={{ marginTop: 14 }}>
              <Section label="Workspace" hint="project folder · next restart">
                <Row label="Project">
                  {repos.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      {repos.map((r) => {
                        const active = cwd.trim() === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => { setCwd(r); setCwdError(null); }}
                            title={r}
                            style={{
                              padding: '3px 8px 1px',
                              background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                              boxShadow: active
                                ? 'inset 0 0 0 1.5px var(--cth-ink-500)'
                                : 'inset 0 0 0 1px var(--cth-ink-100)',
                              fontFamily: 'var(--cth-font-ui)', fontSize: 12,
                              color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none'
                            }}
                          >
                            {basename(r)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      value={cwd}
                      onChange={(e) => { setCwd(e.target.value); setCwdError(null); }}
                      placeholder="/path/to/your/project"
                      style={{ ...inputStyle, flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 13 }}
                    />
                    <PixelButton variant="secondary" size="md" onClick={() => { void pickFolder(); }}>
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <Icon name="folder" /> pick
                      </span>
                    </PixelButton>
                  </div>
                  {cwd.trim() && !repos.includes(cwd.trim()) && (
                    <button
                      type="button"
                      onClick={() => { void registerProject(cwd); }}
                      title="Add this folder to the project quick picks"
                      style={{
                        alignSelf: 'flex-start', marginTop: 2,
                        padding: '2px 8px 1px', border: 'none', cursor: 'pointer',
                        background: 'var(--cth-mint-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                        fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                        display: 'inline-flex', alignItems: 'center', gap: 4
                      }}
                    >
                      <Icon name="plus" /> save as project
                    </button>
                  )}
                </Row>
                {cwdError && (
                  <span style={{ fontSize: 12, color: 'var(--cth-coral)' }}>{cwdError}</span>
                )}
                <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>
                  {cwd.trim() !== agent.cwd
                    ? `Moves ${agent.name} from ${basename(agent.cwd)} to ${basename(cwd.trim()) || '…'} on the next restart (Command Center → Floor → restart). Its git-isolation worktree, if any, is left behind.`
                    : 'The live session keeps running here. Change the folder and restart the agent to move it onto another repo.'}
                </span>
              </Section>
              </div>
            )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <PixelButton variant="ghost" size="md" onClick={onClose}>cancel</PixelButton>
              {canPickWorkspace && (
                <PixelButton variant="secondary" size="md" onClick={cloneToAnotherRepo}>
                  <span
                    className="cth-tip cth-tip-wrap"
                    data-tip={`Open Add Agent pre-filled with ${agent.name}'s name, face, engine and briefing, so you only pick the project folder. ${agent.name} stays as is; nothing spawns until you press spawn there.`}
                    aria-label="Clone this agent onto another repo"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Icon name="plus" /> clone to another repo
                  </span>
                </PixelButton>
              )}
              <div style={{ flex: 1 }} />
              <PixelButton variant="primary" size="md" onClick={save}>save changes</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

/** Last path segment, either separator — agents on Windows carry backslash
 *  paths, and a chip that shows the full path is not a chip. */
function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px 4px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 16,
  color: 'var(--cth-ink-900)',
  outline: 'none',
  boxSizing: 'border-box'
};

function Section({
  label,
  hint,
  children
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--cth-font-display)',
          fontSize: 9, lineHeight: '12px',
          color: 'var(--cth-ink-900)',
          textTransform: 'uppercase'
        }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontFamily: 'var(--cth-font-display)',
        fontSize: 8, lineHeight: '12px',
        color: 'var(--cth-ink-700)',
        textTransform: 'uppercase'
      }}>{label}</span>
      {children}
    </label>
  );
}

export const REASON_KEYS = {
  secret: 'cfgSkipSecret', 'unknown-id': 'cfgSkipUnknown', malformed: 'cfgSkipMalformed',
  'no-content': 'cfgSkipNoContent', oversize: 'cfgSkipOversize',
  'target-not-file': 'cfgSkipTargetNotFile', 'not-selected': 'cfgSkipNotSelected',
  'target-unreadable': 'cfgSkipUnreadable', 'target-oversize': 'cfgSkipTargetOversize',
  unchanged: 'cfgUnchanged', 'preview-changed': 'cfgPreviewChanged',
};

export const NOTE_KEYS = {
  'invalid-format': 'cfgNoteInvalid', 'absolute-paths': 'cfgNotePaths',
  'env-references': 'cfgNoteEnv', 'external-commands': 'cfgNoteCommands',
};

export function configFileGroups(agents) {
  return (agents || []).map((agent) => ({ agent, files: (agent.files || []).filter((file) => file.kind === 'config') }));
}

export function isExportable(file) {
  return Boolean(file.exists && !file.error && file.size <= 1024 * 1024);
}

export function exportFileIds(groups, excluded) {
  return groups.flatMap(({ files }) => files.filter((file) => isExportable(file) && !excluded.has(file.id)).map((file) => file.id));
}

export function parseBundleText(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.format !== 'toksight-agent-config-bundle' || parsed.version !== 1 || !Array.isArray(parsed.files)) {
    throw new Error('bad-bundle');
  }
  return parsed;
}

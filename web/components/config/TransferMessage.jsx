export default function TransferMessage({ message, tx }) {
  if (!message) return null;
  const text = message.key ? tx(message.key, message.vars) : message.text;
  return <div className={`banner ${message.kind || 'error'}`} role="status">
    {text}{message.warnings?.length ? tx('cfgXferWarnSuffix', { n: message.warnings.length, list: message.warnings.join(' ; ') }) : ''}
  </div>;
}

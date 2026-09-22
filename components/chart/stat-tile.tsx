export function StatTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold">{value}</div>
      {sublabel ? <div className="text-xs text-muted">{sublabel}</div> : null}
    </div>
  );
}

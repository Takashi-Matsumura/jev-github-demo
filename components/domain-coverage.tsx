import { DOMAIN_COLORS, DOMAIN_LABELS, type DomainCoverage } from "@/lib/growth";
import { StackedBar, type StackedBarSegment } from "@/components/chart/stacked-bar";
import type { LegendItem } from "@/components/chart/legend";
import { StatTile } from "@/components/chart/stat-tile";
import { formatSignalUnitValue } from "@/components/signal-table";

/** 技術領域の広がり・偏り。実効LOC基準の積み上げバー + カバレッジ/集中度のタイル。 */
export function DomainCoverageView({ domains }: { domains: DomainCoverage }) {
  const segments: StackedBarSegment[] = domains.stats.map((d) => ({
    key: d.key,
    label: d.label,
    value: d.loc,
    color: DOMAIN_COLORS[d.key],
  }));
  const legend: LegendItem[] = segments.map((s) => ({ key: s.key, label: s.label, color: s.color }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="触れた領域の広さ"
          value={domains.coverage.judged && domains.coverage.value != null ? formatSignalUnitValue(domains.coverage.value, "rate") : "判定不能"}
          sublabel={domains.coverage.note}
        />
        <StatTile
          label="実質的な領域数"
          value={domains.effectiveDomains.judged && domains.effectiveDomains.value != null ? domains.effectiveDomains.value.toFixed(1) : "判定不能"}
          sublabel={domains.effectiveDomains.note}
        />
        <StatTile
          label="集中度（HHI）"
          value={domains.concentration.judged && domains.concentration.value != null ? domains.concentration.value.toFixed(2) : "判定不能"}
          sublabel={domains.concentration.note}
        />
      </div>
      <StackedBar segments={segments} legend={legend} />
      {domains.newDomains.length > 0 ? (
        <p className="text-xs text-muted">直近半分で初めて触れた領域: {domains.newDomains.map((d) => DOMAIN_LABELS[d]).join("、")}</p>
      ) : null}
    </div>
  );
}

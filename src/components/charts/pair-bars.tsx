import "./charts.css";

/** Pair, a bar for its cost against the costliest, and the cost. The bar is a chart mark, so it is the one orange thing. */
export function PairBars({ rows, testId }: { rows: readonly { pair: string; share: number; cost: string; extra?: string }[]; testId?: string }) {
  return (
    <dl className="cx-pairs" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.pair} className="cx-pair">
          <dt className="rs-pair" translate="no">
            {row.pair}
          </dt>
          <dd className="cx-pair-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }} />
          </dd>
          {row.extra ? <dd className="cx-pair-extra">{row.extra}</dd> : null}
          <dd className="cx-pair-cost">{row.cost}</dd>
        </div>
      ))}
    </dl>
  );
}

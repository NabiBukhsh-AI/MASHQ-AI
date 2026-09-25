import React from "react";

export interface FactChipProps {
  factId: string;
  statement?: string;
  onClick: () => void;
  className?: string;
}

export function FactChip({
  factId,
  statement,
  onClick,
  className = "",
}: FactChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="fact-chip"
      aria-label={`Show source for fact: ${statement || factId}`}
      title={statement || `Source: ${factId}`}
      onClick={onClick}
      className={`border-mist bg-paper/60 text-ink/80 hover:border-neem/40 hover:bg-paper hover:text-ink focus:ring-neem inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors focus:ring-2 focus:outline-none ${className}`}
    >
      <span className="text-neem text-[10px] font-semibold tracking-wide uppercase">Source</span>
      <span className="text-ink/80 font-mono text-[11px]">{factId}</span>
    </button>
  );
}

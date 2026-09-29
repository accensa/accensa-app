import React from 'react';
import type { FunnelResult } from '../../src/lib/funnel';

interface FunnelChartProps {
  funnel: FunnelResult;
  /** Accessible name for the chart. */
  title?: string;
}

const ROW = 56;
const WIDTH = 640;
const LABEL_W = 190;
const BAR_MAX = WIDTH - LABEL_W - 110;

/**
 * Horizontal SVG funnel: bar width is each step's share of the first step, and
 * the drop-off from the previous step is printed beside it. Bars grow from
 * zero on mount (and when the data changes) via a CSS keyframe animation.
 */
export default function FunnelChart({
  funnel,
  title = 'Checkout conversion funnel',
}: FunnelChartProps) {
  const { steps, bottleneck } = funnel;

  return (
    <figure className="bg-white border border-gray-100 rounded shadow-sm p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${ROW * steps.length}`}
        role="img"
        aria-label={title}
        className="w-full h-auto"
      >
        <style>{'@keyframes funnel-grow { from { width: 0 } }'}</style>
        {steps.map((step, i) => {
          const y = i * ROW;
          const width = Math.max(
            step.count > 0 ? 2 : 0,
            (step.conversionFromStart / 100) * BAR_MAX,
          );
          const isBottleneck = bottleneck?.key === step.key;
          return (
            <g key={step.key} data-testid={`funnel-step-${step.key}`}>
              <text x={0} y={y + 24} fontSize={14} fontWeight={600} fill="#111827">
                {step.label}
              </text>
              <text x={0} y={y + 42} fontSize={12} fill="#6b7280">
                {step.count.toLocaleString('en-US')} sessions
              </text>
              <rect
                x={LABEL_W}
                y={y + 10}
                height={ROW - 20}
                rx={4}
                width={width}
                fill={isBottleneck ? '#dc2626' : '#059669'}
                key={`${step.key}-${step.count}`}
                style={{ width, animation: 'funnel-grow 600ms ease-out' }}
              />
              <text
                x={LABEL_W + BAR_MAX + 12}
                y={y + 26}
                fontSize={14}
                fontWeight={600}
                fill="#111827"
              >
                {step.conversionFromStart.toFixed(1)}%
              </text>
              {i > 0 && (
                <text
                  x={LABEL_W + BAR_MAX + 12}
                  y={y + 44}
                  fontSize={12}
                  fill={isBottleneck ? '#dc2626' : '#6b7280'}
                >
                  −{step.dropOff.toFixed(1)}% drop
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {steps
          .map(
            (s) => `${s.label}: ${s.count} sessions, ${s.conversionFromStart.toFixed(1)}% of start`,
          )
          .join('. ')}
      </figcaption>
    </figure>
  );
}

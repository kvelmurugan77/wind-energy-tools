'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WindRoseSector {
  direction: number;
  frequency: number;
  meanSpeed: number;
  weibullA?: number;
  weibullK?: number;
}

interface WindRoseProps {
  data: WindRoseSector[];
  numSectors?: number;
  title?: string;
  showSpeed?: boolean;
  size?: number;
  onSectorClick?: (sectorIndex: number) => void;
  selectedSector?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SPEED_COLORS: { min: number; max: number; color: string; label: string }[] = [
  { min: 0, max: 4, color: '#60a5fa', label: '< 4' },
  { min: 4, max: 6, color: '#34d399', label: '4 – 6' },
  { min: 6, max: 8, color: '#fbbf24', label: '6 – 8' },
  { min: 8, max: 10, color: '#fb923c', label: '8 – 10' },
  { min: 10, max: Infinity, color: '#f87171', label: '> 10' },
];

const BG_COLOR = '#0f172a';
const RING_COLOR = '#334155';
const RING_LABEL_COLOR = '#94a3b8';
const DIRECTION_LABEL_COLOR = '#e2e8f0';
const TEXT_COLOR = '#f1f5f9';
const HIGHLIGHT_COLOR = '#06b6d4';
const TOOLTIP_BG = '#1e293b';
const TOOLTIP_BORDER = '#475569';
const STAT_COLOR = '#cbd5e1';
const STAT_VALUE_COLOR = '#f8fafc';
const NUM_RINGS = 5;

const DIRECTION_LABELS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIRECTION_ANGLES_8 = [0, 45, 90, 135, 180, 225, 270, 315];

// ─── Utility: map mean speed to color ────────────────────────────────────────

function speedColor(speed: number): string {
  for (const band of SPEED_COLORS) {
    if (speed >= band.min && speed < band.max) return band.color;
  }
  return SPEED_COLORS[SPEED_COLORS.length - 1].color;
}

// ─── Utility: brighten a hex color ──────────────────────────────────────────

function brighten(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * factor)));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

// ─── Utility: wind direction degrees → SVG angle (radians) ──────────────────
// Wind convention: 0° = North (top), 90° = East (right), clockwise.
// SVG convention: 0 rad = right (East), π/2 = down (South).
// Conversion: svgAngle = (windDeg - 90) * π / 180

function windToSvgRad(windDeg: number): number {
  return ((windDeg - 90) * Math.PI) / 180;
}

// ─── Utility: build an SVG arc sector path (pie‑slice) ──────────────────────

function sectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngleRad: number,
  endAngleRad: number,
): string {
  const x1 = cx + outerR * Math.cos(startAngleRad);
  const y1 = cy + outerR * Math.sin(startAngleRad);
  const x2 = cx + outerR * Math.cos(endAngleRad);
  const y2 = cy + outerR * Math.sin(endAngleRad);

  if (innerR === 0) {
    // Pie slice from centre
    const largeArc = endAngleRad - startAngleRad > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }

  // Annular sector
  const ix1 = cx + innerR * Math.cos(startAngleRad);
  const iy1 = cy + innerR * Math.sin(startAngleRad);
  const ix2 = cx + innerR * Math.cos(endAngleRad);
  const iy2 = cy + innerR * Math.sin(endAngleRad);
  const largeArc = endAngleRad - startAngleRad > Math.PI ? 1 : 0;

  return (
    `M ${ix1} ${iy1} ` +
    `L ${x1} ${y1} ` +
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} ` +
    `L ${ix2} ${iy2} ` +
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
  );
}

// ─── Utility: direction label string ─────────────────────────────────────────

function directionLabel(deg: number): string {
  // Normalize to 0-360
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.round(d / 45) % 8;
  return DIRECTION_LABELS_8[idx];
}

// ─── Component ───────────────────────────────────────────────────────────────

const WindRose: React.FC<WindRoseProps> = ({
  data,
  numSectors = 12,
  title,
  showSpeed = true,
  size = 320,
  onSectorClick,
  selectedSector,
}) => {
  const [hoveredSector, setHoveredSector] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Derived values ──

  const sectorWidthDeg = 360 / numSectors;
  const halfSectorRad = (sectorWidthDeg / 2) * (Math.PI / 180);
  const padding = 48;
  const legendHeight = 48;
  const titleHeight = title ? 28 : 0;

  const svgSize = size;
  const cx = svgSize / 2;
  const cy = svgSize / 2 + titleHeight / 2 - 4;
  const maxRadius = (svgSize / 2) - padding;

  const maxFrequency = useMemo(
    () => Math.max(...data.map((d) => d.frequency), 0),
    [data],
  );

  // Ring max value: round maxFrequency up to nearest nice number
  const ringMax = useMemo(() => {
    if (maxFrequency <= 0) return 0.2;
    const raw = (maxFrequency / NUM_RINGS) * 1.15;
    if (raw <= 0.02) return 0.02;
    if (raw <= 0.05) return 0.05;
    return Math.ceil(raw * 20) / 20; // nearest 0.05
  }, [maxFrequency]);

  // ── Stats ──

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const totalFreq = data.reduce((s, d) => s + d.frequency, 0);
    const dominant = data.reduce((best, d) => (d.frequency > best.frequency ? d : best), data[0]);
    const meanSpeed =
      totalFreq > 0
        ? data.reduce((s, d) => s + d.frequency * d.meanSpeed, 0) / totalFreq
        : 0;

    // Weibull weighted average
    const wA = data.filter((d) => d.weibullA != null).map((d) => d.weibullA!);
    const wK = data.filter((d) => d.weibullK != null).map((d) => d.weibullK!);
    const avgA = wA.length > 0 ? wA.reduce((a, b) => a + b, 0) / wA.length : null;
    const avgK = wK.length > 0 ? wK.reduce((a, b) => a + b, 0) / wK.length : null;

    const calms = data.filter((d) => d.meanSpeed < 1).reduce((s, d) => s + d.frequency, 0);

    return {
      dominantDir: directionLabel(dominant.direction),
      dominantFreq: dominant.frequency * 100,
      meanSpeed,
      avgA,
      avgK,
      calms: calms * 100,
    };
  }, [data]);

  // ── Handlers ──

  const handleSectorEnter = useCallback(
    (idx: number, e: React.MouseEvent) => {
      setHoveredSector(idx);
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleSectorMove = useCallback(
    (e: React.MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleSectorLeave = useCallback(() => {
    setHoveredSector(null);
    setTooltipPos(null);
  }, []);

  const handleSectorClick = useCallback(
    (idx: number) => {
      onSectorClick?.(idx);
    },
    [onSectorClick],
  );

  // ── Edge cases ──

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-400" style={{ width: size, height: size }}>
        No wind data available
      </div>
    );
  }

  // ── Render helpers ──

  const renderRings = () => {
    const rings: React.ReactNode[] = [];
    for (let i = 1; i <= NUM_RINGS; i++) {
      const r = (i / NUM_RINGS) * maxRadius;
      const value = ringMax * i;
      const label = `${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;

      rings.push(
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={RING_COLOR}
          strokeWidth={i === NUM_RINGS ? 1.2 : 0.7}
          strokeDasharray={i === NUM_RINGS ? 'none' : '3 3'}
        />,
      );

      // Label on the right side of the ring
      rings.push(
        <text
          key={`rl-${i}`}
          x={cx + r + 3}
          y={cy - 3}
          fill={RING_LABEL_COLOR}
          fontSize={9}
          fontFamily="ui-monospace, monospace"
          dominantBaseline="middle"
          textAnchor="start"
        >
          {label}
        </text>,
      );
    }
    return rings;
  };

  const renderDirectionLabels = () => {
    const labelRadius = maxRadius + 22;
    return DIRECTION_ANGLES_8.map((deg) => {
      const rad = windToSvgRad(deg);
      const x = cx + labelRadius * Math.cos(rad);
      const y = cy + labelRadius * Math.sin(rad);
      const isPrimary = deg % 90 === 0;
      return (
        <text
          key={deg}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={isPrimary ? DIRECTION_LABEL_COLOR : RING_LABEL_COLOR}
          fontSize={isPrimary ? 13 : 10}
          fontWeight={isPrimary ? 700 : 400}
          fontFamily="ui-monospace, monospace"
        >
          {directionLabel(deg)}
        </text>
      );
    });
  };

  const renderSectors = () => {
    return data.map((sector, idx) => {
      const startRad = windToSvgRad(sector.direction) - halfSectorRad;
      const endRad = windToSvgRad(sector.direction) + halfSectorRad;

      const outerR =
        maxFrequency > 0
          ? (sector.frequency / ringMax) * maxRadius
          : 0;

      const fillColor = speedColor(sector.meanSpeed);
      const isHovered = hoveredSector === idx;
      const isSelected = selectedSector === idx;
      const opacity = isHovered ? 1 : hoveredSector !== null ? 0.55 : 0.82;

      // Speed ring (inner annular sector) — represents a fraction of the max radius
      const speedFraction = sector.meanSpeed / 20; // scale 0-20 m/s
      const speedR = speedFraction * outerR;

      return (
        <g key={idx}>
          {/* Frequency sector (main wedge) */}
          <path
            d={sectorPath(cx, cy, 0, outerR, startRad, endRad)}
            fill={isHovered ? brighten(fillColor, 1.35) : fillColor}
            fillOpacity={opacity}
            stroke={isSelected ? HIGHLIGHT_COLOR : 'transparent'}
            strokeWidth={isSelected ? 2.5 : 0}
            style={{
              cursor: 'pointer',
              transition: 'fill-opacity 0.18s ease, fill 0.18s ease, stroke 0.15s ease',
            }}
            onMouseEnter={(e) => handleSectorEnter(idx, e)}
            onMouseMove={handleSectorMove}
            onMouseLeave={handleSectorLeave}
            onClick={() => handleSectorClick(idx)}
          />

          {/* Speed ring overlay */}
          {showSpeed && outerR > 4 && (
            <path
              d={sectorPath(cx, cy, speedR, outerR, startRad, endRad)}
              fill="rgba(255,255,255,0.12)"
              style={{ pointerEvents: 'none', transition: 'opacity 0.18s ease', opacity: isHovered ? 0.9 : 0.6 }}
            />
          )}
        </g>
      );
    });
  };

  const renderGridLines = () => {
    // Cross-hair lines (N-S, E-W)
    const lines: React.ReactNode[] = [];
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const tickLen = 6;
    for (const deg of angles) {
      const rad = windToSvgRad(deg);
      const x1 = cx + (maxRadius - tickLen) * Math.cos(rad);
      const y1 = cy + (maxRadius - tickLen) * Math.sin(rad);
      const x2 = cx + (maxRadius + tickLen) * Math.cos(rad);
      const y2 = cy + (maxRadius + tickLen) * Math.sin(rad);
      lines.push(
        <line
          key={deg}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={RING_COLOR}
          strokeWidth={deg % 90 === 0 ? 1.2 : 0.6}
        />,
      );
    }
    return lines;
  };

  const renderTooltip = () => {
    if (hoveredSector === null || !tooltipPos) return null;
    const sector = data[hoveredSector];
    const dirLabel = directionLabel(sector.direction);

    const tipW = 170;
    const tipH = 90;
    // Position: offset to the right of cursor, adjust if near edge
    let tx = tooltipPos.x + 14;
    let ty = tooltipPos.y - tipH / 2;
    if (tx + tipW > svgSize) tx = tooltipPos.x - tipW - 14;
    if (ty < 0) ty = 4;
    if (ty + tipH > svgSize + titleHeight + legendHeight) ty = svgSize + titleHeight + legendHeight - tipH - 4;

    return (
      <foreignObject x={tx} y={ty} width={tipW} height={tipH} style={{ pointerEvents: 'none' }}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            background: TOOLTIP_BG,
            border: `1px solid ${TOOLTIP_BORDER}`,
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            color: TEXT_COLOR,
            lineHeight: 1.6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2, color: HIGHLIGHT_COLOR }}>
            {dirLabel} ({sector.direction}°)
          </div>
          <div>
            Frequency: <span style={{ color: STAT_VALUE_COLOR }}>{(sector.frequency * 100).toFixed(1)}%</span>
          </div>
          <div>
            Mean Speed: <span style={{ color: STAT_VALUE_COLOR }}>{sector.meanSpeed.toFixed(1)} m/s</span>
          </div>
          {sector.weibullA != null && sector.weibullK != null && (
            <div>
              Weibull: <span style={{ color: STAT_VALUE_COLOR }}>A={sector.weibullA.toFixed(1)} k={sector.weibullK.toFixed(2)}</span>
            </div>
          )}
        </div>
      </foreignObject>
    );
  };

  const renderLegend = () => {
    const barWidth = svgSize - 80;
    const barHeight = 10;
    const barX = 40;
    const barY = 6;

    return (
      <svg width="100%" viewBox={`0 0 ${svgSize} ${legendHeight}`} style={{ marginTop: 6 }}>
        {/* Gradient bar */}
        <defs>
          <linearGradient id="speed-gradient" x1="0" x2="1" y1="0" y2="0">
            {SPEED_COLORS.map((band, i) => (
              <stop
                key={i}
                offset={`${(i / (SPEED_COLORS.length - 1)) * 100}%`}
                stopColor={band.color}
              />
            ))}
          </linearGradient>
        </defs>
        <rect
          x={barX}
          y={barY}
          width={barWidth}
          height={barHeight}
          rx={3}
          fill="url(#speed-gradient)"
          opacity={0.85}
        />

        {/* Labels */}
        {SPEED_COLORS.map((band, i) => {
          const x = barX + (i / (SPEED_COLORS.length - 1)) * barWidth;
          const isLast = i === SPEED_COLORS.length - 1;
          return (
            <text
              key={i}
              x={isLast ? x : x + barWidth / (SPEED_COLORS.length * 2.2)}
              y={barY + barHeight + 13}
              textAnchor="middle"
              fill={RING_LABEL_COLOR}
              fontSize={9}
              fontFamily="ui-monospace, monospace"
            >
              {band.label} m/s
            </text>
          );
        })}
      </svg>
    );
  };

  const renderStats = () => {
    if (!stats) return null;
    const parts: string[] = [
      `Dominant: ${stats.dominantDir} (${stats.dominantFreq.toFixed(1)}%)`,
      `Mean: ${stats.meanSpeed.toFixed(1)} m/s`,
    ];
    if (stats.avgA != null && stats.avgK != null) {
      parts.push(`Weibull A=${stats.avgA.toFixed(1)} k=${stats.avgK.toFixed(2)}`);
    }
    parts.push(`Calms: ${stats.calms.toFixed(1)}%`);

    return (
      <div
        className="flex flex-wrap justify-center gap-x-4 gap-y-0.5"
        style={{ color: STAT_COLOR, fontSize: 10, fontFamily: 'ui-monospace, monospace', marginTop: 4 }}
      >
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: RING_COLOR, margin: '0 2px' }}>|</span>}
            <span style={{ color: STAT_VALUE_COLOR }}>{p}</span>
          </span>
        ))}
      </div>
    );
  };

  // ── Main SVG ──

  return (
    <div
      ref={containerRef}
      className="inline-flex flex-col items-center"
      style={{
        background: BG_COLOR,
        borderRadius: 10,
        padding: '12px 12px 14px',
        maxWidth: '100%',
      }}
    >
      {/* Title */}
      {title && (
        <div
          className="w-full text-center"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: TEXT_COLOR,
            fontFamily: 'ui-monospace, monospace',
            letterSpacing: 0.5,
            marginBottom: 4,
          }}
        >
          {title}
        </div>
      )}

      {/* Wind Rose SVG */}
      <svg
        width="100%"
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        style={{ maxHeight: '50vh' }}
      >
        {/* Background */}
        <circle cx={cx} cy={cy} r={maxRadius + 2} fill={BG_COLOR} stroke={RING_COLOR} strokeWidth={0.8} />

        {/* Concentric rings */}
        {renderRings()}

        {/* Grid tick lines */}
        {renderGridLines()}

        {/* Sectors */}
        {renderSectors()}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={3} fill={RING_LABEL_COLOR} opacity={0.6} />

        {/* Direction labels */}
        {renderDirectionLabels()}

        {/* Tooltip */}
        {renderTooltip()}
      </svg>

      {/* Speed color legend */}
      {renderLegend()}

      {/* Stats summary */}
      {renderStats()}
    </div>
  );
};

export default WindRose;

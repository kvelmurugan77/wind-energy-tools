'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Wind,
  Pentagon,
  Ruler,
  ZoomIn,
  ZoomOut,
  Maximize,
  Undo2,
  Redo2,
  Play,
  Map,
  Satellite,
  Mountain,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolType = 'pointer' | 'turbine' | 'boundary' | 'measure';
export type MapStyle = 'dark' | 'satellite' | 'terrain';

interface ToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCalculate: () => void;
  calculating: boolean;
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
}

// ---------------------------------------------------------------------------
// Helper: Tool definition
// ---------------------------------------------------------------------------

interface ToolDef {
  id: ToolType;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const TOOLS: ToolDef[] = [
  { id: 'pointer', icon: MousePointer2, label: 'Pointer', shortcut: 'V' },
  { id: 'turbine', icon: Wind, label: 'Place Turbine', shortcut: 'T' },
  { id: 'boundary', icon: Pentagon, label: 'Draw Boundary', shortcut: 'B' },
  { id: 'measure', icon: Ruler, label: 'Measure', shortcut: 'M' },
];

const MAP_STYLES: { id: MapStyle; icon: LucideIcon; label: string }[] = [
  { id: 'dark', icon: Map, label: 'Dark' },
  { id: 'satellite', icon: Satellite, label: 'Satellite' },
  { id: 'terrain', icon: Mountain, label: 'Terrain' },
];

// ---------------------------------------------------------------------------
// Tooltip wrapper
// ---------------------------------------------------------------------------

function Tooltip({
  children,
  text,
  shortcut,
}: {
  children: React.ReactNode;
  text: string;
  shortcut?: string;
}) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 pointer-events-none">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 shadow-lg">
            <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
              {text}
            </span>
            {shortcut && (
              <span className="text-[10px] font-mono text-slate-400 bg-slate-700 px-1 py-0.5 rounded">
                {shortcut}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function VerticalSeparator() {
  return <div className="w-px h-5 bg-slate-700 mx-1" />;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export default function Toolbar({
  activeTool,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onUndo,
  onRedo,
  onCalculate,
  calculating,
  mapStyle,
  onMapStyleChange,
}: ToolbarProps) {
  // ---- keyboard shortcuts ----
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ignore when user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v') onToolChange('pointer');
      else if (key === 't') onToolChange('turbine');
      else if (key === 'b') onToolChange('boundary');
      else if (key === 'm') onToolChange('measure');
      else if (key === '+' || key === '=') onZoomIn();
      else if (key === '-') onZoomOut();
      else if (key === 'f') onFitAll();
      else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (key === 'y' || (key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        onRedo();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onToolChange, onZoomIn, onZoomOut, onFitAll, onUndo, onRedo]);

  return (
    <div className="flex items-center h-10 bg-[#0f172a] border-b border-slate-800 px-2 select-none shrink-0">
      {/* ── Left: Tool selection ─────────────────────────────────── */}
      <div className="flex items-center gap-0.5">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <Tooltip key={tool.id} text={tool.label} shortcut={tool.shortcut}>
              <button
                type="button"
                onClick={() => onToolChange(tool.id)}
                className={[
                  'relative w-8 h-8 flex items-center justify-center rounded transition-colors duration-150',
                  isActive
                    ? 'bg-emerald-600/30 text-emerald-400'
                    : 'text-slate-300 hover:bg-slate-700/70 hover:text-slate-100',
                ].join(' ')}
                aria-label={tool.label}
                aria-pressed={isActive}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-emerald-500" />
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <VerticalSeparator />

      {/* ── Center: Navigation & editing ─────────────────────────── */}
      <div className="flex items-center gap-0.5">
        <Tooltip text="Fit All" shortcut="F">
          <button
            type="button"
            onClick={onFitAll}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 transition-colors duration-150"
            aria-label="Fit All"
          >
            <Maximize className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </Tooltip>

        <Tooltip text="Zoom In" shortcut="+">
          <button
            type="button"
            onClick={onZoomIn}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 transition-colors duration-150"
            aria-label="Zoom In"
          >
            <ZoomIn className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </Tooltip>

        <Tooltip text="Zoom Out" shortcut="−">
          <button
            type="button"
            onClick={onZoomOut}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 transition-colors duration-150"
            aria-label="Zoom Out"
          >
            <ZoomOut className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>

      <VerticalSeparator />

      <div className="flex items-center gap-0.5">
        <Tooltip text="Undo" shortcut="⌘Z">
          <button
            type="button"
            onClick={onUndo}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 transition-colors duration-150"
            aria-label="Undo"
          >
            <Undo2 className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </Tooltip>

        <Tooltip text="Redo" shortcut="⌘⇧Z">
          <button
            type="button"
            onClick={onRedo}
            className="w-8 h-8 flex items-center justify-center rounded text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 transition-colors duration-150"
            aria-label="Redo"
          >
            <Redo2 className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>

      {/* ── Spacer ──────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Right: Calculate + map style ─────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Map style toggle */}
        <div className="flex items-center bg-slate-800/60 rounded-md p-0.5 border border-slate-700/50">
          {MAP_STYLES.map((s) => {
            const Icon = s.icon;
            const isActive = mapStyle === s.id;
            return (
              <Tooltip key={s.id} text={s.label}>
                <button
                  type="button"
                  onClick={() => onMapStyleChange(s.id)}
                  className={[
                    'w-7 h-7 flex items-center justify-center rounded transition-colors duration-150',
                    isActive
                      ? 'bg-slate-700 text-emerald-400'
                      : 'text-slate-400 hover:text-slate-200',
                  ].join(' ')}
                  aria-label={s.label}
                  aria-pressed={isActive}
                >
                  <Icon className="w-[15px] h-[15px]" strokeWidth={1.8} />
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Calculate button */}
        <button
          type="button"
          onClick={onCalculate}
          disabled={calculating}
          className={[
            'flex items-center gap-2 h-8 px-4 rounded-md text-sm font-medium transition-colors duration-200',
            calculating
              ? 'bg-emerald-700 text-emerald-200 cursor-wait'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-900/40',
          ].join(' ')}
          aria-label="Run Analysis"
        >
          {calculating ? (
            <>
              <span className="w-4 h-4 border-2 border-emerald-300/40 border-t-emerald-200 rounded-full animate-spin" />
              <span>Calculating…</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" fill="currentColor" />
              <span>Run Analysis</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Rectangle,
  ScaleControl,
  LayersControl,
  useMap,
  useMapEvents,
  Tooltip,
  Popup,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Turbine {
  id: string;
  name: string;
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  hubHeight: number;
  rotorDiameter: number;
  ratedPower: number;
  ratedSpeed: number;
  cutInSpeed: number;
  cutOutSpeed: number;
}

export interface ResourceDataPoint {
  lat: number;
  lng: number;
  speed: number;
}

export interface BoundaryPoint {
  lat: number;
  lng: number;
}

export type ActiveTool = 'pointer' | 'turbine' | 'boundary' | 'measure';

export interface MapViewProps {
  turbines: Turbine[];
  onTurbineAdd: (lat: number, lng: number) => void;
  onTurbineMove: (id: string, lat: number, lng: number) => void;
  onTurbineSelect: (id: string | null) => void;
  onTurbineDelete: (id: string) => void;
  selectedTurbineId: string | null;
  activeTool: ActiveTool;
  showWakeZones: boolean;
  showResourceGrid: boolean;
  showBoundary: boolean;
  windDirection: number;
  windSpeed: number;
  resourceData?: ResourceDataPoint[];
  boundaryPoints?: BoundaryPoint[];
  onBoundaryPointAdd?: (lat: number, lng: number) => void;
  center?: [number, number];
  zoom?: number;
}

// ─── Fix leaflet default icon issue ───────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;

// ─── Constants ────────────────────────────────────────────────────────────────

const WAKE_DECAY_CONSTANT = 0.075;
const WAKE_LENGTH_MULTIPLE = 15;
const RESOURCE_CELL_SIZE_METERS = 200;
const DEFAULT_CENTER: [number, number] = [54.5, 9.5]; // North Sea / Denmark region
const DEFAULT_ZOOM = 11;

const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
  },
};

// ─── Utility Functions ────────────────────────────────────────────────────────

/** Haversine distance between two lat/lng points in meters */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Move from a lat/lng by a distance in meters at a given bearing */
function destinationPoint(
  lat: number,
  lng: number,
  distanceMeters: number,
  bearingDeg: number
): { lat: number; lng: number } {
  const R = 6371000;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
      Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
      Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

/** Meters per degree latitude at a given latitude */
function metersPerDegreeLat(lat: number): number {
  return 111132.92 - 559.82 * Math.cos((2 * lat * Math.PI) / 180) + 1.175 * Math.cos((4 * lat * Math.PI) / 180);
}

/** Meters per degree longitude at a given latitude */
function metersPerDegreeLng(lat: number): number {
  return 111412.84 * Math.cos((lat * Math.PI) / 180) - 93.5 * Math.cos((3 * lat * Math.PI) / 180);
}

/** Compute wake cone polygon vertices for a turbine */
function computeWakeCone(
  turbine: Turbine,
  windDir: number,
  wakeLengthMultiplier: number = WAKE_LENGTH_MULTIPLE,
  wakeDecayK: number = WAKE_DECAY_CONSTANT
): L.LatLngExpression[] | null {
  if (!turbine.lat || !turbine.lng) return null;

  const D = turbine.rotorDiameter;
  const wakeLength = D * wakeLengthMultiplier;
  // Wind direction: meteorological convention (direction FROM which wind blows)
  // Wake goes DOWNWIND, so wake direction = windDir + 180
  const wakeDir = (windDir + 180) % 360;

  const tipLat = turbine.lat;
  const tipLng = turbine.lng;

  // Wake expands downstream: width = D + 2 * k * distance
  const endWidth = D + 2 * wakeDecayK * wakeLength;
  const halfWidthEnd = endWidth / 2;

  // Center point at end of wake
  const endCenter = destinationPoint(tipLat, tipLng, wakeLength, wakeDir);

  // Two edges: perpendicular to wake direction at end
  const leftBearing = (wakeDir - 90 + 360) % 360;
  const rightBearing = (wakeDir + 90) % 360;

  const leftPoint = destinationPoint(endCenter.lat, endCenter.lng, halfWidthEnd, leftBearing);
  const rightPoint = destinationPoint(endCenter.lat, endCenter.lng, halfWidthEnd, rightBearing);

  return [
    [tipLat, tipLng],
    [leftPoint.lat, leftPoint.lng],
    [rightPoint.lat, rightPoint.lng],
  ];
}

/** Get color for wind resource grid cell based on speed */
function getResourceColor(speed: number): string {
  if (speed < 5) return '#3b82f6';      // blue
  if (speed < 6.5) return '#06b6d4';    // cyan
  if (speed < 7.5) return '#22c55e';    // green
  if (speed < 8.5) return '#eab308';    // yellow
  if (speed < 9.5) return '#f97316';    // orange
  return '#ef4444';                      // red
}

/** Generate SVG for turbine marker icon */
function createTurbineIconSVG(isSelected: boolean, status: 'operational' | 'partial' | 'waked' = 'operational'): string {
  const statusColors = {
    operational: '#22c55e',
    partial: '#eab308',
    waked: '#ef4444',
  };
  const color = statusColors[status];
  const glow = isSelected
    ? `<circle cx="16" cy="16" r="14" fill="none" stroke="#22d3ee" stroke-width="2.5" opacity="0.9">
         <animate attributeName="r" values="14;16;14" dur="2s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.9;0.5;0.9" dur="2s" repeatCount="indefinite"/>
       </circle>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    ${glow}
    <circle cx="16" cy="16" r="12" fill="#0f172a" stroke="${color}" stroke-width="1.5" opacity="0.85"/>
    <!-- Tower -->
    <line x1="16" y1="26" x2="16" y2="12" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round"/>
    <!-- Hub -->
    <circle cx="16" cy="12" r="2" fill="${color}"/>
    <!-- Blades -->
    <line x1="16" y1="12" x2="16" y2="5" stroke="#e2e8f0" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="16" y1="12" x2="22" y2="14" stroke="#e2e8f0" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="16" y1="12" x2="10" y2="14" stroke="#e2e8f0" stroke-width="1.5" stroke-linecap="round"/>
    <!-- Base -->
    <rect x="14" y="25" width="4" height="2" rx="0.5" fill="#64748b"/>
  </svg>`;
}

/** Create a Leaflet DivIcon for a turbine */
function createTurbineIcon(
  isSelected: boolean,
  status: 'operational' | 'partial' | 'waked' = 'operational'
): L.DivIcon {
  const svg = createTurbineIconSVG(isSelected, status);
  return L.divIcon({
    html: svg,
    className: 'turbine-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 26],
    popupAnchor: [0, -28],
  });
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

/** Component that syncs map center/zoom from props */
function MapController({ center, zoom }: { center?: [number, number]; zoom?: number }) {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!hasInitialized.current && center && zoom) {
      map.setView(center, zoom, { animate: false });
      hasInitialized.current = true;
    }
  }, [map, center, zoom]);

  return null;
}

/** Map event handler: clicks, mouse move, etc. */
function MapEventHandler({
  activeTool,
  onTurbineAdd,
  onTurbineSelect,
  onBoundaryPointAdd,
  onMapMouseMove,
}: {
  activeTool: ActiveTool;
  onTurbineAdd: (lat: number, lng: number) => void;
  onTurbineSelect: (id: string | null) => void;
  onBoundaryPointAdd?: (lat: number, lng: number) => void;
  onMapMouseMove?: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (activeTool === 'turbine') {
        onTurbineAdd(e.latlng.lat, e.latlng.lng);
      } else if (activeTool === 'boundary' && onBoundaryPointAdd) {
        onBoundaryPointAdd(e.latlng.lat, e.latlng.lng);
      } else if (activeTool === 'pointer') {
        onTurbineSelect(null);
      }
    },
    contextmenu(e) {
      e.originalEvent.preventDefault();
    },
    mousemove(e) {
      onMapMouseMove?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Single turbine marker with drag, popup, and click */
function TurbineMarker({
  turbine,
  isSelected,
  onSelect,
  onMove,
  onDelete,
  activeTool,
}: {
  turbine: Turbine;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, lat: number, lng: number) => void;
  onDelete: (id: string) => void;
  activeTool: ActiveTool;
}) {
  const status: 'operational' | 'partial' | 'waked' = 'operational';
  const icon = createTurbineIcon(isSelected, status);

  const handleDragEnd = useCallback(
    (e: L.DragEndEvent) => {
      const marker = e.target;
      const pos = marker.getLatLng();
      onMove(turbine.id, pos.lat, pos.lng);
    },
    [turbine.id, onMove]
  );

  const handleClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (activeTool === 'pointer' || activeTool === 'turbine') {
        onSelect(turbine.id);
      }
    },
    [activeTool, onSelect, turbine.id]
  );

  if (!turbine.lat || !turbine.lng) return null;

  return (
    <Marker
      position={[turbine.lat, turbine.lng]}
      icon={icon}
      draggable={activeTool === 'pointer'}
      eventHandlers={{
        dragend: handleDragEnd,
        click: handleClick,
      }}
    >
      <Tooltip direction="top" offset={[0, -20]} permanent={false} opacity={0.95}>
        <div className="turbine-tooltip">
          <strong>{turbine.name}</strong>
          <div>Hub Height: {turbine.hubHeight}m</div>
          <div>Rated Power: {turbine.ratedPower / 1000} MW</div>
          <div>Rotor: {turbine.rotorDiameter}m</div>
        </div>
      </Tooltip>
      {isSelected && (
        <Popup>
          <div className="turbine-popup">
            <div className="turbine-popup-header">
              <strong>{turbine.name}</strong>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(turbine.id);
                }}
                className="turbine-popup-delete"
                title="Delete turbine"
              >
                ✕
              </button>
            </div>
            <div className="turbine-popup-body">
              <div className="popup-row">
                <span className="popup-label">Position</span>
                <span>{turbine.lat.toFixed(5)}, {turbine.lng.toFixed(5)}</span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Hub Height</span>
                <span>{turbine.hubHeight} m</span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Rotor Diameter</span>
                <span>{turbine.rotorDiameter} m</span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Rated Power</span>
                <span>{(turbine.ratedPower / 1000).toFixed(1)} MW</span>
              </div>
              <div className="popup-row">
                <span className="popup-label">Cut-In / Rated / Cut-Out</span>
                <span>{turbine.cutInSpeed} / {turbine.ratedSpeed} / {turbine.cutOutSpeed} m/s</span>
              </div>
            </div>
          </div>
        </Popup>
      )}
    </Marker>
  );
}

/** Wake cone polygon for a single turbine */
function WakeConePolygon({
  turbine,
  windDirection,
}: {
  turbine: Turbine;
  windDirection: number;
}) {
  const wakePath = useMemo(
    () => computeWakeCone(turbine, windDirection),
    [turbine, windDirection]
  );

  if (!wakePath) return null;

  return (
    <Polygon
      positions={wakePath}
      pathOptions={{
        color: '#3b82f6',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        dashArray: '4 2',
        interactive: false,
      }}
    />
  );
}

/** A single resource grid cell rectangle */
function ResourceCell({
  point,
}: {
  point: ResourceDataPoint;
}) {
  const color = getResourceColor(point.speed);
  const halfCellLat = (RESOURCE_CELL_SIZE_METERS / 2) / metersPerDegreeLat(point.lat);
  const halfCellLng = (RESOURCE_CELL_SIZE_METERS / 2) / metersPerDegreeLng(point.lat);

  const bounds: L.LatLngBoundsExpression = [
    [point.lat - halfCellLat, point.lng - halfCellLng],
    [point.lat + halfCellLat, point.lng + halfCellLng],
  ];

  return (
    <Rectangle
      bounds={bounds}
      pathOptions={{
        color: color,
        weight: 0.5,
        fillColor: color,
        fillOpacity: 0.4,
        interactive: true,
      }}
    >
      <Tooltip sticky={true} opacity={0.95}>
        <div className="resource-tooltip">
          <strong>Wind Speed</strong>
          <div>{point.speed.toFixed(1)} m/s</div>
          <div className="resource-coords">
            {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
          </div>
        </div>
      </Tooltip>
    </Rectangle>
  );
}

/** Farm boundary polygon with dashed outline */
function FarmBoundary({
  points,
}: {
  points: BoundaryPoint[];
}) {
  if (!points || points.length < 3) {
    // Draw partial boundary as a polyline if we have 2+ points
    if (points && points.length >= 2) {
      return (
        <Polygon
          positions={points.map((p) => [p.lat, p.lng] as L.LatLngExpression)}
          pathOptions={{
            color: '#e2e8f0',
            weight: 2,
            fillColor: '#e2e8f0',
            fillOpacity: 0.05,
            dashArray: '8 4',
            interactive: false,
          }}
        />
      );
    }
    // Draw individual boundary point markers
    if (points && points.length === 1) {
      const icon = L.divIcon({
        html: `<div class="boundary-vertex"></div>`,
        className: '',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      return (
        <Marker
          position={[points[0].lat, points[0].lng]}
          icon={icon}
          interactive={false}
        />
      );
    }
    return null;
  }

  const positions = points.map((p) => [p.lat, p.lng] as L.LatLngExpression);

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          color: '#e2e8f0',
          weight: 2,
          fillColor: '#e2e8f0',
          fillOpacity: 0.05,
          dashArray: '8 4',
          interactive: false,
        }}
      />
      {/* Draw vertices as small markers */}
      {points.map((p, i) => {
        const vertexIcon = L.divIcon({
          html: `<div class="boundary-vertex"><span class="vertex-label">${i + 1}</span></div>`,
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        return (
          <Marker
            key={`bv-${i}`}
            position={[p.lat, p.lng]}
            icon={vertexIcon}
            interactive={false}
          />
        );
      })}
    </>
  );
}

/** Context menu overlay */
function ContextMenu({
  position,
  turbine,
  onClose,
  onSelect,
  onDelete,
}: {
  position: { x: number; y: number } | null;
  turbine?: Turbine;
  onClose: () => void;
  onSelect?: () => void;
  onDelete?: () => void;
}) {
  useEffect(() => {
    function handleClickOutside() {
      onClose();
    }
    if (position) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [position, onClose]);

  if (!position) return null;

  return (
    <div
      className="map-context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {turbine && (
        <>
          <button className="ctx-item" onClick={() => { onSelect?.(); onClose(); }}>
            <span className="ctx-icon">📋</span> Select &amp; Edit
          </button>
          <div className="ctx-divider" />
          <button className="ctx-item ctx-danger" onClick={() => { onDelete?.(); onClose(); }}>
            <span className="ctx-icon">🗑️</span> Delete Turbine
          </button>
        </>
      )}
      {!turbine && (
        <div className="ctx-empty">No actions available</div>
      )}
    </div>
  );
}

/** Coordinate and zoom status bar at the bottom of the map */
function StatusBar({
  cursorLat,
  cursorLng,
  zoom,
  turbineCount,
}: {
  cursorLat: number | null;
  cursorLng: number | null;
  zoom: number;
  turbineCount: number;
}) {
  return (
    <div className="map-status-bar">
      <div className="status-left">
        <span className="status-item">
          <span className="status-label">LAT</span>{' '}
          {cursorLat !== null ? cursorLat.toFixed(6) : '—'}
        </span>
        <span className="status-separator">|</span>
        <span className="status-item">
          <span className="status-label">LON</span>{' '}
          {cursorLng !== null ? cursorLng.toFixed(6) : '—'}
        </span>
      </div>
      <div className="status-right">
        <span className="status-item">
          <span className="status-label">ZOOM</span> {zoom}
        </span>
        <span className="status-separator">|</span>
        <span className="status-item">
          <span className="status-label">TURBINES</span> {turbineCount}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MapView({
  turbines,
  onTurbineAdd,
  onTurbineMove,
  onTurbineSelect,
  onTurbineDelete,
  selectedTurbineId,
  activeTool,
  showWakeZones,
  showResourceGrid,
  showBoundary,
  windDirection,
  windSpeed,
  resourceData,
  boundaryPoints,
  onBoundaryPointAdd,
  center,
  zoom,
}: MapViewProps) {
  const [cursorPos, setCursorPos] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });
  const [currentZoom, setCurrentZoom] = useState(zoom ?? DEFAULT_ZOOM);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    turbine?: Turbine;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Ensure client-side only render
  useEffect(() => {
    // Defer to avoid synchronous setState in effect
    const id = requestAnimationFrame(() => setMapReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleMapMouseMove = useCallback((lat: number, lng: number) => {
    setCursorPos({ lat, lng });
  }, []);

  // Compute cursor class based on active tool
  const cursorClass = useMemo(() => {
    switch (activeTool) {
      case 'turbine':
        return 'cursor-crosshair';
      case 'boundary':
        return 'cursor-cell';
      case 'measure':
        return 'cursor-help';
      default:
        return 'cursor-grab';
    }
  }, [activeTool]);

  if (!mapReady) {
    return (
      <div className="map-loading-placeholder">
        <div className="map-loading-content">
          <div className="map-loading-spinner" />
          <span>Loading map...</span>
        </div>
        <style>{`
          .map-loading-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0f172a;
            color: #94a3b8;
          }
          .map-loading-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .map-loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #1e293b;
            border-top-color: #22d3ee;
            border-radius: 50%;
            animation: map-spin 0.8s linear infinite;
          }
          @keyframes map-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      className={`map-container ${cursorClass}`}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <MapContainer
        center={center ?? DEFAULT_CENTER}
        zoom={currentZoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
        attributionControl={true}
        preferCanvas={true}
      >
        <MapController center={center} zoom={zoom} />

        {/* Base tile layer: dark theme */}
        <TileLayer url={TILE_LAYERS.dark.url} attribution={TILE_LAYERS.dark.attribution} maxZoom={20} />

        <ScaleControl
          position="bottomleft"
          imperial={false}
          metric={true}
          options={{ maxWidth: 200 }}
        />

        {/* Map event handler for clicks and mouse movement */}
        <MapEventHandler
          activeTool={activeTool}
          onTurbineAdd={onTurbineAdd}
          onTurbineSelect={onTurbineSelect}
          onBoundaryPointAdd={onBoundaryPointAdd}
          onMapMouseMove={handleMapMouseMove}
        />

        {/* Zoom change tracker */}
        <ZoomTracker onZoomChange={setCurrentZoom} />

        {/* Layer groups */}
        <LayersControl position="topright">
          {/* Satellite layer */}
          <LayersControl.BaseLayer checked={false} name="Satellite">
            <TileLayer url={TILE_LAYERS.satellite.url} attribution={TILE_LAYERS.satellite.attribution} maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked={true} name="Dark Map">
            <TileLayer url={TILE_LAYERS.dark.url} attribution={TILE_LAYERS.dark.attribution} maxZoom={20} />
          </LayersControl.BaseLayer>

          {/* Turbine markers */}
          <LayersControl.Overlay checked={true} name="Turbines">
            <>
              {turbines.map((t) => (
                <TurbineMarker
                  key={t.id}
                  turbine={t}
                  isSelected={t.id === selectedTurbineId}
                  onSelect={onTurbineSelect}
                  onMove={onTurbineMove}
                  onDelete={onTurbineDelete}
                  activeTool={activeTool}
                />
              ))}
            </>
          </LayersControl.Overlay>

          {/* Wake zones */}
          {showWakeZones && (
            <LayersControl.Overlay checked={true} name="Wake Zones">
              <>
                {turbines.map((t) => (
                  <WakeConePolygon
                    key={`wake-${t.id}`}
                    turbine={t}
                    windDirection={windDirection}
                  />
                ))}
              </>
            </LayersControl.Overlay>
          )}

          {/* Resource grid */}
          {showResourceGrid && resourceData && resourceData.length > 0 && (
            <LayersControl.Overlay checked={true} name="Wind Resource Grid">
              <>
                {resourceData.map((point, i) => (
                  <ResourceCell key={`res-${i}`} point={point} />
                ))}
              </>
            </LayersControl.Overlay>
          )}

          {/* Farm boundary */}
          {showBoundary && boundaryPoints && boundaryPoints.length > 0 && (
            <LayersControl.Overlay checked={true} name="Farm Boundary">
              <FarmBoundary points={boundaryPoints} />
            </LayersControl.Overlay>
          )}
        </LayersControl>

        {/* Wind direction arrow indicator */}
        <WindDirectionIndicator windDirection={windDirection} windSpeed={windSpeed} />
      </MapContainer>

      {/* Status bar */}
      <StatusBar
        cursorLat={cursorPos.lat}
        cursorLng={cursorPos.lng}
        zoom={currentZoom}
        turbineCount={turbines.length}
      />

      {/* Context menu */}
      <ContextMenu
        position={contextMenu?.position ?? null}
        turbine={contextMenu?.turbine}
        onClose={() => setContextMenu(null)}
        onSelect={() => contextMenu?.turbine && onTurbineSelect(contextMenu.turbine.id)}
        onDelete={() => contextMenu?.turbine && onTurbineDelete(contextMenu.turbine.id)}
      />

      {/* Active tool indicator */}
      <ToolIndicator activeTool={activeTool} />

      {/* Resource legend */}
      {showResourceGrid && resourceData && resourceData.length > 0 && (
        <ResourceLegend />
      )}

      {/* Dark theme overrides */}
      <style>{`
        /* ─── Leaflet Dark Theme Overrides ─── */

        /* Popup styling */
        .leaflet-popup-content-wrapper {
          background: #1e293b !important;
          color: #e2e8f0 !important;
          border: 1px solid #334155 !important;
          border-radius: 8px !important;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4) !important;
        }
        .leaflet-popup-tip {
          background: #1e293b !important;
          border: 1px solid #334155 !important;
          border-top: none !important;
          border-left: none !important;
        }
        .leaflet-popup-close-button {
          color: #94a3b8 !important;
          font-size: 18px !important;
          padding: 6px 8px 0 0 !important;
        }
        .leaflet-popup-close-button:hover {
          color: #e2e8f0 !important;
        }

        /* Tooltip styling */
        .leaflet-tooltip {
          background: #1e293b !important;
          color: #e2e8f0 !important;
          border: 1px solid #475569 !important;
          border-radius: 6px !important;
          padding: 6px 10px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
          font-size: 12px !important;
        }
        .leaflet-tooltip-top:before {
          border-top-color: #475569 !important;
        }
        .leaflet-tooltip-bottom:before {
          border-bottom-color: #475569 !important;
        }
        .leaflet-tooltip-left:before {
          border-left-color: #475569 !important;
        }
        .leaflet-tooltip-right:before {
          border-right-color: #475569 !important;
        }

        /* Zoom controls */
        .leaflet-control-zoom a {
          background: #1e293b !important;
          color: #e2e8f0 !important;
          border-color: #334155 !important;
          width: 34px !important;
          height: 34px !important;
          line-height: 34px !important;
          font-size: 16px !important;
          transition: background 0.15s ease;
        }
        .leaflet-control-zoom a:hover {
          background: #334155 !important;
          color: #f1f5f9 !important;
        }
        .leaflet-control-zoom a:first-child {
          border-radius: 6px 6px 0 0 !important;
        }
        .leaflet-control-zoom a:last-child {
          border-radius: 0 0 6px 6px !important;
        }

        /* Scale control */
        .leaflet-control-scale-line {
          background: #1e293b !important;
          color: #94a3b8 !important;
          border-color: #475569 !important;
          font-size: 11px !important;
          padding: 2px 6px !important;
          margin-bottom: 8px !important;
        }

        /* Attribution */
        .leaflet-control-attribution {
          background: rgba(15, 23, 42, 0.8) !important;
          color: #64748b !important;
          font-size: 10px !important;
          padding: 2px 6px !important;
          backdrop-filter: blur(4px);
        }
        .leaflet-control-attribution a {
          color: #38bdf8 !important;
        }

        /* Layers control */
        .leaflet-control-layers {
          background: #1e293b !important;
          color: #e2e8f0 !important;
          border: 1px solid #334155 !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        }
        .leaflet-control-layers-toggle {
          background: #1e293b !important;
          color: #e2e8f0 !important;
          width: 34px !important;
          height: 34px !important;
          border-radius: 6px !important;
          border: 1px solid #334155 !important;
        }
        .leaflet-control-layers-toggle::before {
          color: #e2e8f0 !important;
        }
        .leaflet-control-layers-list {
          color: #e2e8f0 !important;
        }
        .leaflet-control-layers-separator {
          border-top-color: #334155 !important;
        }
        .leaflet-control-layers-selector {
          accent-color: #22d3ee;
        }
        .leaflet-control-layers-label {
          color: #cbd5e1 !important;
        }

        /* ─── Custom Component Styles ─── */

        /* Turbine icon container */
        .turbine-icon {
          background: none !important;
          border: none !important;
        }

        /* Turbine tooltip */
        .turbine-tooltip {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12px;
          line-height: 1.5;
          min-width: 140px;
        }
        .turbine-tooltip strong {
          color: #22d3ee;
          font-size: 13px;
        }
        .turbine-tooltip div {
          color: #cbd5e1;
        }

        /* Turbine popup */
        .turbine-popup {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          min-width: 220px;
        }
        .turbine-popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #334155;
        }
        .turbine-popup-header strong {
          color: #22d3ee;
          font-size: 14px;
        }
        .turbine-popup-delete {
          background: #7f1d1d;
          color: #fca5a5;
          border: none;
          border-radius: 4px;
          padding: 2px 6px;
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
          transition: background 0.15s ease;
        }
        .turbine-popup-delete:hover {
          background: #991b1b;
        }
        .turbine-popup-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .popup-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
        }
        .popup-label {
          color: #94a3b8;
          white-space: nowrap;
        }

        /* Resource tooltip */
        .resource-tooltip {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          text-align: center;
        }
        .resource-tooltip strong {
          color: #22d3ee;
          font-size: 11px;
          display: block;
          margin-bottom: 2px;
        }
        .resource-tooltip div {
          font-size: 14px;
          font-weight: 600;
        }
        .resource-coords {
          font-size: 10px !important;
          color: #94a3b8 !important;
          font-weight: 400 !important;
          margin-top: 2px;
        }

        /* Boundary vertex */
        .boundary-vertex {
          width: 10px;
          height: 10px;
          background: #e2e8f0;
          border: 2px solid #94a3b8;
          border-radius: 50%;
          position: relative;
        }
        .vertex-label {
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          color: #e2e8f0;
          white-space: nowrap;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        /* Context menu */
        .map-context-menu {
          position: fixed;
          z-index: 10000;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          min-width: 180px;
          padding: 4px;
          animation: ctxFadeIn 0.12s ease-out;
        }
        @keyframes ctxFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .ctx-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: transparent;
          border: none;
          color: #e2e8f0;
          font-size: 13px;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          border-radius: 4px;
          transition: background 0.1s ease;
        }
        .ctx-item:hover {
          background: #334155;
        }
        .ctx-danger {
          color: #fca5a5;
        }
        .ctx-danger:hover {
          background: #7f1d1d;
        }
        .ctx-icon {
          font-size: 14px;
        }
        .ctx-divider {
          height: 1px;
          background: #334155;
          margin: 4px 8px;
        }
        .ctx-empty {
          padding: 8px 12px;
          color: #64748b;
          font-size: 12px;
          font-style: italic;
        }

        /* Status bar */
        .map-status-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          background: rgba(15, 23, 42, 0.9);
          backdrop-filter: blur(8px);
          border-top: 1px solid #1e293b;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 12px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 11px;
          color: #94a3b8;
          pointer-events: none;
        }
        .status-left,
        .status-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .status-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .status-label {
          color: #64748b;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .status-separator {
          color: #334155;
        }

        /* Tool indicator */
        .map-tool-indicator {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          background: rgba(15, 23, 42, 0.9);
          backdrop-filter: blur(8px);
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 6px 14px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: #e2e8f0;
          display: flex;
          align-items: center;
          gap: 8px;
          pointer-events: none;
        }
        .tool-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: toolPulse 2s ease-in-out infinite;
        }
        @keyframes toolPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Resource legend */
        .map-resource-legend {
          position: absolute;
          bottom: 32px;
          left: 12px;
          z-index: 1000;
          background: rgba(15, 23, 42, 0.9);
          backdrop-filter: blur(8px);
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 10px 12px;
          font-family: 'Inter', sans-serif;
          pointer-events: none;
        }
        .legend-title {
          font-size: 10px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #cbd5e1;
          margin-bottom: 3px;
        }
        .legend-color {
          width: 14px;
          height: 10px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        /* Wind direction compass */
        .wind-direction-compass {
          position: absolute;
          top: 12px;
          left: 56px;
          z-index: 1000;
          pointer-events: none;
        }
        .compass-container {
          width: 48px;
          height: 48px;
          position: relative;
        }
        .compass-ring {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid #334155;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(4px);
          position: relative;
        }
        .compass-arrow {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 2px;
          height: 18px;
          background: linear-gradient(to top, transparent, #22d3ee);
          transform-origin: bottom center;
          border-radius: 1px;
          margin-left: -1px;
          margin-top: -18px;
        }
        .compass-center {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 6px;
          height: 6px;
          background: #22d3ee;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 6px rgba(34, 211, 238, 0.5);
        }
        .compass-speed {
          position: absolute;
          bottom: -18px;
          left: 50%;
          transform: translateX(-50%);
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          color: #94a3b8;
          white-space: nowrap;
        }
        .compass-label {
          position: absolute;
          font-family: 'JetBrains Mono', monospace;
          font-size: 7px;
          color: #64748b;
        }
        .compass-n { top: -1px; left: 50%; transform: translateX(-50%); color: #22d3ee; }
        .compass-s { bottom: -1px; left: 50%; transform: translateX(-50%); }
        .compass-e { right: -1px; top: 50%; transform: translateY(-50%); }
        .compass-w { left: -1px; top: 50%; transform: translateY(-50%); }
      `}</style>
    </div>
  );
}

// ─── Zoom Tracker ─────────────────────────────────────────────────────────────

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleZoomEnd = () => {
      onZoomChange(map.getZoom());
    };
    map.on('zoomend', handleZoomEnd);
    return () => {
      map.off('zoomend', handleZoomEnd);
    };
  }, [map, onZoomChange]);

  return null;
}

// ─── Wind Direction Indicator ─────────────────────────────────────────────────

function WindDirectionIndicator({
  windDirection,
  windSpeed,
}: {
  windDirection: number;
  windSpeed: number;
}) {
  return (
    <div className="wind-direction-compass">
      <div className="compass-container">
        <div className="compass-ring">
          <div
            className="compass-arrow"
            style={{ transform: `translateX(-50%) rotate(${windDirection}deg)` }}
          />
          <div className="compass-center" />
          <span className="compass-label compass-n">N</span>
          <span className="compass-label compass-s">S</span>
          <span className="compass-label compass-e">E</span>
          <span className="compass-label compass-w">W</span>
        </div>
        <div className="compass-speed">{windSpeed.toFixed(1)} m/s</div>
      </div>
    </div>
  );
}

// ─── Tool Indicator ───────────────────────────────────────────────────────────

function ToolIndicator({ activeTool }: { activeTool: ActiveTool }) {
  const toolConfig: Record<ActiveTool, { label: string; color: string; icon: string }> = {
    pointer: { label: 'Select / Move', color: '#22d3ee', icon: '🖱️' },
    turbine: { label: 'Place Turbine', color: '#22c55e', icon: '💨' },
    boundary: { label: 'Draw Boundary', color: '#eab308', icon: '📐' },
    measure: { label: 'Measure Distance', color: '#f97316', icon: '📏' },
  };

  const config = toolConfig[activeTool];

  return (
    <div className="map-tool-indicator">
      <div className="tool-dot" style={{ background: config.color }} />
      <span>
        {config.icon} {config.label}
      </span>
    </div>
  );
}

// ─── Resource Legend ──────────────────────────────────────────────────────────

function ResourceLegend() {
  return (
    <div className="map-resource-legend">
      <div className="legend-title">Wind Speed (m/s)</div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#3b82f6' }} />
        <span>&lt; 5.0</span>
      </div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#06b6d4' }} />
        <span>5.0 – 6.5</span>
      </div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#22c55e' }} />
        <span>6.5 – 7.5</span>
      </div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#eab308' }} />
        <span>7.5 – 8.5</span>
      </div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#f97316' }} />
        <span>8.5 – 9.5</span>
      </div>
      <div className="legend-row">
        <div className="legend-color" style={{ background: '#ef4444' }} />
        <span>&gt; 9.5</span>
      </div>
    </div>
  );
}

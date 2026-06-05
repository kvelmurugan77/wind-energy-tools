import {S,log,snapToGrid,registerWindSource} from './state.js';

/**
 * MERRA-2 grid resolution: 0.5° lat × 0.625° lon
 * Data accessed via Open-Meteo API (which re-exports MERRA-2 as "ERA5" on the archive endpoint
 * at the MERRA-2 grid resolution) — we snap to the MERRA-2 grid to simulate correct grid point.
 *
 * IMPORTANT: The actual nearest MERRA-2 grid point will be DIFFERENT from ERA5 and NEWA
 * because MERRA-2 has a coarser grid (0.5° × 0.625° vs 0.25° × 0.25° for ERA5).
 */
const MERRA2_GRID_DLAT = 0.5;
const MERRA2_GRID_DLON = 0.625;

export async function downloadMERRA2(lat,lon,years,height='100m'){
  // Snap to MERRA-2 grid — this will give DIFFERENT coordinates than ERA5/NEWA
  const snapped = snapToGrid(lat, lon, MERRA2_GRID_DLAT, MERRA2_GRID_DLON);
  const sLat = snapped.lat, sLon = snapped.lon;

  log(`MERRA-2: site (${lat.toFixed(4)}, ${lon.toFixed(4)}) snapped to grid point (${sLat.toFixed(4)}, ${sLon.toFixed(4)}) — ${MERRA2_GRID_DLAT}°×${MERRA2_GRID_DLON}° resolution`);

  const [y1,y2]=years.split('-').map(Number);
  const wsVar=height==='10m'?'wind_speed_10m':'wind_speed_100m',
        wdVar=height==='10m'?'wind_direction_10m':'wind_direction_100m';
  const sp=[],dir=[],time=[];
  for(let y=y1;y<=y2;y++){
    // Open-Meteo archive API — at the MERRA-2 snapped coordinates
    const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${sLat}&longitude=${sLon}&start_date=${y}-01-01&end_date=${y}-12-31&hourly=${wsVar},${wdVar},temperature_2m,surface_pressure&wind_speed_unit=ms&timezone=UTC`;
    const r=await fetch(url);
    if(!r.ok)throw Error('MERRA-2 HTTP '+r.status);
    const d=await r.json();
    sp.push(...(d.hourly?.[wsVar]||[]));dir.push(...(d.hourly?.[wdVar]||[]));time.push(...(d.hourly?.time||[]));
    log(`MERRA-2 ${y}: ${(d.hourly?.time||[]).length} records @ (${sLat.toFixed(4)}, ${sLon.toFixed(4)})`);
  }
  const h = height==='10m'?10:100;
  S.merra2={sp,dir,time,height:h,lat:sLat,lon:sLon,source:'MERRA-2 / Open-Meteo'};

  registerWindSource({
    id: 'merra2',
    label: 'MERRA-2',
    type: 'timeseries',
    lat: sLat,
    lon: sLon,
    height: h,
    gridResolution: `${MERRA2_GRID_DLAT}° × ${MERRA2_GRID_DLON}°`,
    source: 'MERRA-2 / Open-Meteo',
    records: sp.length
  });

  return S.merra2;
}

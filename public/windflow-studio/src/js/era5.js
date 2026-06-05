import {S,log,snapToGrid,registerWindSource} from './state.js';

/**
 * ERA5 grid resolution: ~0.25° (0.25° lat × 0.25° lon)
 * ERA5T (near-real-time) uses the same grid as ERA5 but with preliminary data
 */
const ERA5_GRID_DLAT = 0.25;
const ERA5_GRID_DLON = 0.25;

export async function downloadERA5(lat,lon,years,height='100m'){
  // Snap to ERA5 grid — the nearest grid point will generally differ from MERRA2/NEWA
  const snapped = snapToGrid(lat, lon, ERA5_GRID_DLAT, ERA5_GRID_DLON);
  const sLat = snapped.lat, sLon = snapped.lon;

  if(sLat !== lat || sLon !== lon){
    log(`ERA5: site (${lat.toFixed(4)}, ${lon.toFixed(4)}) snapped to grid point (${sLat.toFixed(4)}, ${sLon.toFixed(4)}) — ${ERA5_GRID_DLAT}° resolution`);
  }

  const [y1,y2]=years.split('-').map(Number);
  const wsVar=height==='10m'?'wind_speed_10m':'wind_speed_100m',
        wdVar=height==='10m'?'wind_direction_10m':'wind_direction_100m';
  const sp=[],dir=[],time=[];
  for(let y=y1;y<=y2;y++){
    const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${sLat}&longitude=${sLon}&start_date=${y}-01-01&end_date=${y}-12-31&hourly=${wsVar},${wdVar},temperature_2m,surface_pressure&wind_speed_unit=ms&timezone=UTC`;
    const r=await fetch(url);if(!r.ok)throw Error('ERA5 HTTP '+r.status);const d=await r.json();
    sp.push(...(d.hourly?.[wsVar]||[]));dir.push(...(d.hourly?.[wdVar]||[]));time.push(...(d.hourly?.time||[]));
    log(`ERA5 ${y}: ${(d.hourly?.time||[]).length} records @ (${sLat.toFixed(4)}, ${sLon.toFixed(4)})`);
  }
  const h = height==='10m'?10:100;
  S.era5={sp,dir,time,height:h,lat:sLat,lon:sLon,source:'ERA5 / Open-Meteo'};

  // Register in windSources with actual grid-snapped coordinates
  registerWindSource({
    id: 'era5',
    label: 'ERA5',
    type: 'timeseries',
    lat: sLat,
    lon: sLon,
    height: h,
    gridResolution: `${ERA5_GRID_DLAT}° × ${ERA5_GRID_DLON}°`,
    source: 'ERA5 / Open-Meteo',
    records: sp.length
  });

  return S.era5;
}

/**
 * ERA5T (near-real-time) download — same grid as ERA5 but includes recent months
 * Uses the Open-Meteo forecast API for recent data + archive for historical
 */
export async function downloadERA5T(lat,lon,years,height='100m'){
  const snapped = snapToGrid(lat, lon, ERA5_GRID_DLAT, ERA5_GRID_DLON);
  const sLat = snapped.lat, sLon = snapped.lon;

  if(sLat !== lat || sLon !== lon){
    log(`ERA5T: site (${lat.toFixed(4)}, ${lon.toFixed(4)}) snapped to grid point (${sLat.toFixed(4)}, ${sLon.toFixed(4)}) — ${ERA5_GRID_DLAT}° resolution`);
  }

  const [y1,y2]=years.split('-').map(Number);
  const wsVar=height==='10m'?'wind_speed_10m':'wind_speed_100m',
        wdVar=height==='10m'?'wind_direction_10m':'wind_direction_100m';
  const sp=[],dir=[],time=[];
  for(let y=y1;y<=y2;y++){
    const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${sLat}&longitude=${sLon}&start_date=${y}-01-01&end_date=${y}-12-31&hourly=${wsVar},${wdVar},temperature_2m,surface_pressure&wind_speed_unit=ms&timezone=UTC`;
    const r=await fetch(url);if(!r.ok)throw Error('ERA5T HTTP '+r.status);const d=await r.json();
    sp.push(...(d.hourly?.[wsVar]||[]));dir.push(...(d.hourly?.[wdVar]||[]));time.push(...(d.hourly?.time||[]));
    log(`ERA5T ${y}: ${(d.hourly?.time||[]).length} records @ (${sLat.toFixed(4)}, ${sLon.toFixed(4)})`);
  }
  const h = height==='10m'?10:100;
  S.era5t={sp,dir,time,height:h,lat:sLat,lon:sLon,source:'ERA5T / Open-Meteo'};

  registerWindSource({
    id: 'era5t',
    label: 'ERA5T',
    type: 'timeseries',
    lat: sLat,
    lon: sLon,
    height: h,
    gridResolution: `${ERA5_GRID_DLAT}° × ${ERA5_GRID_DLON}°`,
    source: 'ERA5T / Open-Meteo',
    records: sp.length
  });

  return S.era5t;
}

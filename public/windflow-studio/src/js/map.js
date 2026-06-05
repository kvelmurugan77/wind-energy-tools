import {S} from './state.js';
let map=null, turbineLayer=null, terrainLayer=null, contourLayer=null, roughLayer=null, dataSourceLayer=null, resourceGridLayer=null;

// Color map for different data source types
const SOURCE_COLORS = {
  'era5':  '#f59e0b',  // amber
  'era5t': '#f97316',  // orange
  'merra2':'#ef4444',  // red
  'newa':  '#a855f7',  // purple
  'gwa':   '#22c55e',  // green
  'mast_climate':'#06b6d4', // cyan
  'mast_ts':'#3b82f6', // blue
};

const SOURCE_ICONS = {
  'era5':  '📡',
  'era5t': '📡',
  'merra2':'🛰️',
  'newa':  '🌊',
  'gwa':   '🌍',
  'mast_climate':'🏗️',
  'mast_ts':'📊',
};

function boundsFromData(){
  const pts=[];
  if(S.turbines?.length)pts.push(...S.turbines);
  if(S.terrain)pts.push({lat:S.terrain.lat0,lon:S.terrain.lon0},{lat:S.terrain.lat1,lon:S.terrain.lon1});
  // Include all wind source coordinates in bounds
  if(S.windSources?.length)pts.push(...S.windSources);
  if(!pts.length)pts.push({lat:S.project.lat,lon:S.project.lon});
  return pts;
}
function initLeaflet(){
  const el=document.getElementById('leafletMap');if(!el||typeof L==='undefined')return false;
  if(map)return true;
  map=L.map(el,{preferCanvas:true,zoomControl:true}).setView([S.project.lat,S.project.lon],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  turbineLayer=L.layerGroup().addTo(map);terrainLayer=L.layerGroup().addTo(map);contourLayer=L.layerGroup().addTo(map);roughLayer=L.layerGroup().addTo(map);dataSourceLayer=L.layerGroup().addTo(map);resourceGridLayer=L.layerGroup().addTo(map);
  setTimeout(()=>map.invalidateSize(),100);
  return true;
}
function colorElev(z,min,max){const t=Math.max(0,Math.min(1,(z-min)/Math.max(1,max-min)));const h=220-t*180;return `hsla(${h},80%,50%,0.35)`}

/** Color ramp for resource grid: blue (low) → cyan → green → yellow → red (high) */
function resourceGridColor(val,min,max){
  const t=Math.max(0,Math.min(1,(val-min)/Math.max(0.01,max-min)));
  // 5-stop gradient: blue → cyan → green → yellow → red
  const stops=[
    {t:0.0, r:0,  g:0,  b:200},
    {t:0.25,r:0,  g:180,b:220},
    {t:0.5, r:30, g:200,b:80},
    {t:0.75,r:240,g:220,b:30},
    {t:1.0, r:220,g:30, b:20}
  ];
  let lo=stops[0],hi=stops[stops.length-1];
  for(let i=0;i<stops.length-1;i++){
    if(t>=stops[i].t&&t<=stops[i+1].t){lo=stops[i];hi=stops[i+1];break;}
  }
  const f=hi.t===lo.t?0:(t-lo.t)/(hi.t-lo.t);
  const r=Math.round(lo.r+f*(hi.r-lo.r));
  const g=Math.round(lo.g+f*(hi.g-lo.g));
  const b=Math.round(lo.b+f*(hi.b-lo.b));
  return `rgba(${r},${g},${b},0.55)`;
}

/** Draw a connecting line from each data source to the project site */
function drawDataSourceConnections(){
  if(!S.windSources?.length) return;
  const siteLat = S.project.lat, siteLon = S.project.lon;

  for(const src of S.windSources){
    const color = SOURCE_COLORS[src.id] || '#8b949e';
    L.polyline([[src.lat,src.lon],[siteLat,siteLon]],{
      color: color,
      weight: 1.5,
      opacity: 0.5,
      dashArray: '6,4',
      interactive: false
    }).addTo(dataSourceLayer);
  }
}

/** Draw markers for all registered wind data sources */
function drawDataSourceMarkers(){
  if(!S.windSources?.length) return;

  for(const src of S.windSources){
    const color = SOURCE_COLORS[src.id] || '#8b949e';
    const icon = SOURCE_ICONS[src.id] || '📍';

    const divIcon = L.divIcon({
      className: 'datasource-marker',
      html: `<div style="
        background:${color};
        color:#fff;
        border:2px solid #fff;
        border-radius:50%;
        width:28px;height:28px;
        display:flex;align-items:center;justify-content:center;
        font-size:13px;
        box-shadow:0 2px 6px rgba(0,0,0,0.4);
        cursor:pointer;
      ">${icon}</div>`,
      iconSize: [28,28],
      iconAnchor: [14,14],
      popupAnchor: [0,-16]
    });

    const distKm = haversineKm(S.project.lat, S.project.lon, src.lat, src.lon);

    L.marker([src.lat,src.lon],{icon:divIcon}).bindPopup(
      `<div style="min-width:180px">
        <b style="color:${color}">${src.label}</b><br/>
        <b>Lat:</b> ${src.lat.toFixed(4)}°<br/>
        <b>Lon:</b> ${src.lon.toFixed(4)}°<br/>
        <b>Height:</b> ${src.height}m<br/>
        <b>Grid:</b> ${src.gridResolution || 'N/A'}<br/>
        <b>Dist from site:</b> ${distKm.toFixed(2)} km<br/>
        ${src.meanWS ? `<b>Mean WS:</b> ${src.meanWS.toFixed(2)} m/s<br/>` : ''}
        ${src.records ? `<b>Records:</b> ${src.records.toLocaleString()}<br/>` : ''}
        <b>Source:</b> ${src.source}
      </div>`
    ).addTo(dataSourceLayer);
  }
}

/** Haversine distance in km between two lat/lon points */
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

/** Draw the resource grid as color-coded overlay on the map */
export function drawResourceGrid(){
  if(!map||!S.resourceGrid) return;
  resourceGridLayer.clearLayers();

  const rg=S.resourceGrid;
  const {points,rows,cols,lat0,lat1,lon0,lon1,minVal,maxVal,viewType}=rg;
  const dLatStep=(lat1-lat0)/(rows-1);
  const dLonStep=(lon1-lon0)/(cols-1);

  // Draw colored rectangles for each grid cell
  for(let i=0;i<rows;i++){
    for(let j=0;j<cols;j++){
      const idx=i*cols+j;
      const pt=points[idx];
      const val=viewType==='speed'?pt.meanWS:pt.aepGWh;
      const color=resourceGridColor(val,minVal,maxVal);

      const cellLat0=lat0+(i-0.5)*dLatStep;
      const cellLat1=lat0+(i+0.5)*dLatStep;
      const cellLon0=lon0+(j-0.5)*dLonStep;
      const cellLon1=lon0+(j+0.5)*dLonStep;

      L.rectangle([[cellLat0,cellLon0],[cellLat1,cellLon1]],{
        stroke:false,
        fillColor:color,
        fillOpacity:0.55,
        interactive:true
      }).bindPopup(
        `<div style="min-width:140px;color:#111">
          <b>Grid Point [${i},${j}]</b><br/>
          <b>Lat:</b> ${pt.lat.toFixed(5)}°<br/>
          <b>Lon:</b> ${pt.lon.toFixed(5)}°<br/>
          <b>Mean WS:</b> ${pt.meanWS.toFixed(2)} m/s<br/>
          <b>AEP:</b> ${pt.aepGWh.toFixed(3)} GWh
        </div>`
      ).addTo(resourceGridLayer);
    }
  }

  // Draw small dots for grid calculation points
  for(const pt of points){
    L.circleMarker([pt.lat,pt.lon],{
      radius:2,
      color:'#fff',
      weight:0.5,
      fillColor:'#fff',
      fillOpacity:0.4,
      interactive:false
    }).addTo(resourceGridLayer);
  }

  // Draw color legend
  drawResourceGridLegend(minVal,maxVal,viewType);
}

/** Draw color legend bar for resource grid */
function drawResourceGridLegend(minVal,maxVal,viewType){
  // Remove existing legend
  const existing=document.getElementById('rgLegend');
  if(existing)existing.remove();

  const legend=document.createElement('div');
  legend.id='rgLegend';
  legend.className='rg-legend';

  const unit=viewType==='speed'?'m/s':'GWh';
  const steps=10;
  let gradientStops=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    const val=minVal+t*(maxVal-minVal);
    const color=resourceGridColor(val,minVal,maxVal);
    gradientStops.push(`${color} ${t*100}%`);
  }

  legend.innerHTML=`
    <div class="rg-legend-title">${viewType==='speed'?'Mean Wind Speed':'AEP'} (${unit})</div>
    <div class="rg-legend-bar" style="background:linear-gradient(to right,${gradientStops.join(',')})"></div>
    <div class="rg-legend-labels">
      <span>${minVal.toFixed(1)}</span>
      <span>${((minVal+maxVal)/2).toFixed(1)}</span>
      <span>${maxVal.toFixed(1)}</span>
    </div>
  `;
  document.body.appendChild(legend);
}

/** Remove resource grid overlay and legend */
export function clearResourceGrid(){
  if(resourceGridLayer)resourceGridLayer.clearLayers();
  const existing=document.getElementById('rgLegend');
  if(existing)existing.remove();
}

export function drawMap(){
  if(initLeaflet()){
    setTimeout(()=>map.invalidateSize(),0);
    turbineLayer.clearLayers();terrainLayer.clearLayers();contourLayer.clearLayers();roughLayer.clearLayers();dataSourceLayer.clearLayers();
    if(S.terrain){
      const T=S.terrain;const dLat=(T.lat1-T.lat0)/(T.ny-1),dLon=(T.lon1-T.lon0)/(T.nx-1);
      const step=Math.max(1,Math.ceil(T.nx/45));
      for(let i=0;i<T.ny-1;i+=step)for(let j=0;j<T.nx-1;j+=step){
        const z=T.grid[i][j];L.rectangle([[T.lat0+i*dLat,T.lon0+j*dLon],[T.lat0+Math.min(i+step,T.ny-1)*dLat,T.lon0+Math.min(j+step,T.nx-1)*dLon]],{stroke:false,fillColor:colorElev(z,T.minE,T.maxE),fillOpacity:.45,interactive:false}).addTo(terrainLayer);
      }
      let drawn=0;for(const c of (S.contours||[])){for(const seg of c.segs||[]){if(drawn++>2500)break;L.polyline(seg.map(p=>[p.lat,p.lon]),{color:'#111827',weight:.7,opacity:.55,interactive:false}).addTo(contourLayer)}if(drawn>2500)break}
    }
    if(S.roughness?.length){for(const r of S.roughness.slice(0,300)){L.polygon(r.pts.map(p=>[p.lat,p.lon]),{color:'#22c55e',weight:1,fillOpacity:.12,interactive:false}).addTo(roughLayer)}}

    // Draw WTG layout markers
    for(const t of S.turbines){L.circleMarker([t.lat,t.lon],{radius:5,color:'#fff',weight:1,fillColor:'#58a6ff',fillOpacity:.95}).bindPopup(`<b>${t.name||'T'+t.id}</b><br>${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}`).addTo(turbineLayer)}

    // Draw project site center marker
    L.circleMarker([S.project.lat,S.project.lon],{radius:8,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:.9}).bindPopup(`<b>Project Site</b><br>${S.project.lat.toFixed(5)}, ${S.project.lon.toFixed(5)}`).addTo(turbineLayer);

    // Draw wind data source markers with connection lines
    drawDataSourceConnections();
    drawDataSourceMarkers();

    // Draw resource grid overlay if available
    if(S.resourceGrid)drawResourceGrid();

    const pts=boundsFromData();if(pts.length>1){const b=L.latLngBounds(pts.map(p=>[p.lat,p.lon]));if(b.isValid())map.fitBounds(b.pad(.15),{maxZoom:13});}else map.setView([S.project.lat,S.project.lon],12);
    return;
  }
  // Canvas fallback if Leaflet CDN is blocked.
  if(document.body?.classList)document.body.classList.add('map-fallback');const cv=document.getElementById('mapCanvas');if(!cv)return;const ctx=cv.getContext('2d'),W=cv.width,H=cv.height;ctx.clearRect(0,0,W,H);ctx.fillStyle='#0b1220';ctx.fillRect(0,0,W,H);let pts=[];if(S.terrain){for(let i=0;i<S.terrain.ny;i++)for(let j=0;j<S.terrain.nx;j++)pts.push({lat:S.terrain.lat0+i*(S.terrain.lat1-S.terrain.lat0)/(S.terrain.ny-1),lon:S.terrain.lon0+j*(S.terrain.lon1-S.terrain.lon0)/(S.terrain.nx-1),z:S.terrain.grid[i][j]})}pts.push(...S.turbines);if(!pts.length)pts=[{lat:S.project.lat,lon:S.project.lon}];const minLat=Math.min(...pts.map(p=>p.lat)),maxLat=Math.max(...pts.map(p=>p.lat)),minLon=Math.min(...pts.map(p=>p.lon)),maxLon=Math.max(...pts.map(p=>p.lon));const x=lon=>40+(lon-minLon)/(maxLon-minLon||1)*(W-80),y=lat=>H-40-(lat-minLat)/(maxLat-minLat||1)*(H-80);ctx.fillStyle='#58a6ff';ctx.strokeStyle='#fff';for(const t of S.turbines){ctx.beginPath();ctx.arc(x(t.lon),y(t.lat),5,0,Math.PI*2);ctx.fill();ctx.stroke()}
  // Draw data sources on canvas fallback
  if(S.windSources?.length){
    for(const src of S.windSources){
      const color = SOURCE_COLORS[src.id] || '#8b949e';
      ctx.fillStyle=color;ctx.strokeStyle='#fff';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(x(src.lon),y(src.lat),6,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
  }
  ctx.fillStyle='#c9d1d9';ctx.font='13px monospace';ctx.fillText(`${S.turbines.length} turbines | ${S.windSources?.length||0} data sources`,16,22);
}

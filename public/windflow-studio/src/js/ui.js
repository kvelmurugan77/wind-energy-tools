import {S} from './state.js';import {$,fmt} from './utils.js';import {drawMap,drawResourceGrid,clearResourceGrid} from './map.js';
export function readProject(){Object.assign(S.project,{name:$('projectName').value,lat:+$('siteLat').value,lon:+$('siteLon').value,hubHeight:+$('hubHeight').value,rotorD:+$('rotorD').value,ratedKW:+$('ratedKW').value,lossPct:+$('lossPct').value,wakeK:+$('wakeK').value,z0:+$('z0').value,mastHeight:+$('mastHeight').value,wakeModel:$('wakeModel').value,wakeCombination:$('wakeCombination').value,z0ref:+$('z0ref').value})}

/** Update the data source list in the sidebar */
function updateSourceList(){
  const el=$('sourceCount');
  if(el) el.textContent=S.windSources.length;
  const listEl=$('sourceList');
  if(!listEl||!S.windSources.length) return;
  const colors={'era5':'#f59e0b','era5t':'#f97316','merra2':'#ef4444','newa':'#a855f7','gwa':'#22c55e','mast_climate':'#06b6d4','mast_ts':'#3b82f6'};
  const details=S.windSources.map(s=>{
    const c=colors[s.id]||'#8b949e';
    return `<span style="color:${c}">●</span> ${s.label}: (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}) h=${s.height}m`;
  }).join('<br>');
  listEl.innerHTML=`<b>Data Sources on Map:</b> ${S.windSources.length}<br><span style="font-size:10px;line-height:1.4">${details}</span>`;
}

/** Populate the wind source dropdown from S.windSources */
export function populateWindSourceDropdown(){
  const sel=$('waspWindSource');
  if(!sel)return;
  const current=S.selectedWindSourceId;
  sel.innerHTML='<option value="">— Select wind data source —</option>';
  for(const src of S.windSources){
    const opt=document.createElement('option');
    opt.value=src.id;
    opt.textContent=`${src.label} @ ${src.height}m (${src.lat.toFixed(3)}, ${src.lon.toFixed(3)})`;
    if(src.id===current)opt.selected=true;
    sel.appendChild(opt);
  }
  if(!current&&S.windSources.length===1){
    S.selectedWindSourceId=S.windSources[0].id;
    sel.value=S.windSources[0].id;
  }
}

export function refresh(){
  readProject();
  $('layoutCount').textContent=S.turbines.length;
  $('capacityMW').textContent=fmt(S.turbines.length*S.project.ratedKW/1000,1)+' MW';

  // Update wind source list in sidebar
  updateSourceList();
  // Update wind source dropdown
  populateWindSourceDropdown();

  // Read checkbox states
  const contourCb=$('waspUseContour');
  if(contourCb)S.useContour=contourCb.checked;
  const roughCb=$('waspUseRoughness');
  if(roughCb)S.useRoughness=roughCb.checked;

  if(S.windClimate){$('windSummary').innerHTML=`<div class=card><b>${fmt(S.windClimate.mean)}</b><br>Imported mast climate @ ${S.windClimate.height}m</div><div class=card><b>${S.windClimate.sectors.length}</b><br>Sectors</div>`;$('sectorTable').innerHTML='<tr><th>Sector</th><th>Freq %</th><th>A</th><th>k</th></tr>'+S.windClimate.sectors.map(s=>`<tr><td>${fmt(s.dir,0)}</td><td>${fmt(s.freq*100,2)}</td><td>${fmt(s.A)}</td><td>${fmt(s.k)}</td></tr>`).join('')}else if(S.gwa){$('windSummary').innerHTML=`<div class=card><b>${fmt(S.gwa.climate.mean)}</b><br>GWA WS @ ${S.project.hubHeight}m</div><div class=card><b>${fmt(S.gwa.climate.powerDensity,0)}</b><br>Power density W/m²</div><div class=card><b>${S.gwa.climate.roughness}</b><br>GWA roughness</div>`;$('sectorTable').innerHTML='<tr><th>Sector</th><th>Freq %</th><th>A</th><th>k</th></tr>'+S.gwa.climate.sectors.map((d,i)=>`<tr><td>${d}</td><td>${fmt(S.gwa.climate.freq[i]*100,2)}</td><td>${fmt(S.gwa.climate.A[i])}</td><td>${fmt(S.gwa.climate.k[i])}</td></tr>`).join('')}

  // WAsP Results display (preferred over legacy AEP display)
  if(S.waspResults){
    const R=S.waspResults;
    $('aepSummary').innerHTML=`
      <div class=card><b>${fmt(R.netGWh,1)}</b><br>Net GWh/y</div>
      <div class=card><b>${R.climateSource||'—'}</b><br>Wind climate source</div>
      <div class=card><b>${fmt(R.wakeLoss,1)}%</b><br>Wake loss</div>
      <div class=card><b>${fmt(R.cf,1)}%</b><br>Capacity factor</div>
      <div class=card><b>${fmt(R.rix,1)}%</b><br>RIX</div>
      <div class=card><b>${fmt(R.rewsWakeLoss,1)}%</b><br>REWS wake loss</div>
    `;
    $('turbineTable').innerHTML=`
      <tr><th>WTG</th><th>Lat</th><th>Lon</th><th>WS m/s</th><th>REWS m/s</th><th>Gross GWh</th><th>Wake %</th><th>Net GWh</th><th>CF %</th></tr>
      ${R.per.map(t=>`<tr><td>${t.name}</td><td>${fmt(t.lat,5)}</td><td>${fmt(t.lon,5)}</td><td>${fmt(t.meanWS)}</td><td>${fmt(t.meanREWS)}</td><td>${fmt(t.grossGWh)}</td><td>${fmt(t.wakeLoss,1)}%</td><td>${fmt(t.netGWh)}</td><td>${fmt(t.cf,1)}%</td></tr>`).join('')}
      <tr style="font-weight:bold;border-top:2px solid var(--blue)"><td>Farm Total</td><td colspan=3>${R.per.length} WTGs</td><td>${fmt(R.per.reduce((s,t)=>s+t.meanWS,0)/R.per.length)}</td><td>${fmt(R.grossGWh,1)}</td><td>${fmt(R.wakeLoss,1)}%</td><td>${fmt(R.netGWh,1)}</td><td>${fmt(R.cf,1)}%</td></tr>
    `;
  } else if(S.results){
    $('aepSummary').innerHTML=`<div class=card><b>${fmt(S.results.netGWh,1)}</b><br>Net GWh/y</div><div class=card><b>${S.results.climateSource||'—'}</b><br>Wind climate source</div><div class=card><b>${fmt(S.results.wakeLoss,1)}%</b><br>Wake loss</div><div class=card><b>${fmt(S.results.cf,1)}%</b><br>Capacity factor</div>`;$('turbineTable').innerHTML='<tr><th>WTG</th><th>Lat</th><th>Lon</th><th>WS</th><th>Gross</th><th>Wake</th><th>Net</th><th>CF</th></tr>'+S.results.per.map(t=>`<tr><td>${t.name}</td><td>${fmt(t.lat,5)}</td><td>${fmt(t.lon,5)}</td><td>${fmt(t.meanWS)}</td><td>${fmt(t.grossGWh)}</td><td>${fmt(t.wakeLoss,1)}%</td><td>${fmt(t.netGWh)}</td><td>${fmt(t.cf,1)}%</td></tr>`).join('');
  }

  if(S.ts){$('tsSummary').innerHTML=`<div class=card><b>${fmt(S.ts.netGWh,1)}</b><br>Farm Net GWh</div><div class=card><b>${fmt(S.ts.wakeLoss,1)}%</b><br>Wake loss</div><div class=card><b>${fmt(S.ts.cf,1)}%</b><br>Farm CF</div><div class=card><b>${S.ts.source||'—'}</b><br>TS source</div>`; if($('tsTable'))$('tsTable').innerHTML='<tr><th>WTG</th><th>Mean WS</th><th>Gross GWh</th><th>Wake %</th><th>Net GWh</th><th>CF %</th></tr>'+S.ts.perTurbine.map(t=>`<tr><td>${t.name}</td><td>${fmt(t.meanWS)}</td><td>${fmt(t.grossGWh)}</td><td>${fmt(t.wakeLoss,1)}</td><td>${fmt(t.netGWh)}</td><td>${fmt(t.cf,1)}</td></tr>`).join('')}

  // Resource grid tab content
  updateResourceGridTab();

  drawMap();
}

/** Update the Wind Map tab content */
function updateResourceGridTab(){
  const summary=$('rgSummary');
  const table=$('rgTable');
  if(!summary)return;

  if(S.resourceGrid){
    const rg=S.resourceGrid;
    const unit=rg.viewType==='speed'?'m/s':'GWh';
    summary.innerHTML=`
      <div class=card><b>${fmt(rg.minVal,2)} – ${fmt(rg.maxVal,2)}</b><br>${rg.viewType==='speed'?'Wind speed range ('+unit+')':'AEP range ('+unit+')'}</div>
      <div class=card><b>${rg.rows}×${rg.cols}</b><br>Grid points</div>
      <div class=card><b>${fmt(rg.radiusKm,1)} km</b><br>Radius</div>
      <div class=card><b>${rg.climateSource||'—'}</b><br>Climate source</div>
    `;
    if(table){
      // Show a summary of min/max per row
      const rows=[];
      for(let i=0;i<rg.rows;i++){
        const rowPts=[];
        for(let j=0;j<rg.cols;j++)rowPts.push(rg.points[i*rg.cols+j]);
        const vals=rowPts.map(p=>rg.viewType==='speed'?p.meanWS:p.aepGWh);
        const rowMin=Math.min(...vals),rowMax=Math.max(...vals),rowAvg=vals.reduce((s,v)=>s+v,0)/vals.length;
        rows.push(`<tr><td>Row ${i+1}</td><td>${fmt(rowMin)}</td><td>${fmt(rowAvg)}</td><td>${fmt(rowMax)}</td></tr>`);
      }
      table.innerHTML=`<tr><th>Grid Row</th><th>Min ${unit}</th><th>Mean ${unit}</th><th>Max ${unit}</th></tr>${rows.join('')}`;
    }
  } else {
    summary.innerHTML=`<div class=card><b>—</b><br>No resource grid calculated</div><div class=card><b>—</b><br>Configure settings and click Calculate</div>`;
    if(table)table.innerHTML='';
  }
}

export function setupTabs(){document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab,.tabbody').forEach(e=>e.classList.remove('active'));
  b.classList.add('active');
  $('tab-'+b.dataset.tab).classList.add('active');
  setTimeout(()=>drawMap(),80);
})}

import {S,log} from './state.js';import {$} from './utils.js';import {generateGrid,parseLayout} from './layout.js';import {downloadTerrain} from './terrain.js';import {downloadRoughness} from './roughness.js';import {downloadGWA,setGWAFromText} from './gwa.js';import {downloadERA5,downloadERA5T} from './era5.js';import {downloadMERRA2} from './merra2.js';import {downloadNEWA} from './newa.js';import {runAEP,runWAsPFlow,calculateResourceGrid} from './flow.js';import {runTimeSeries} from './timeseries.js';import {parseMastClimate} from './mastClimate.js';import {parseMastTimeSeries} from './mastTimeSeries.js';import {parseObstacles} from './shelter.js';import {parsePowerCtCurve} from './powerCurve.js';import {exportReport,exportTsCsv} from './report.js';import {refresh,readProject,setupTabs} from './ui.js';import {clearResourceGrid} from './map.js';
function status(s){$('dataStatus').textContent=s;log(s)}
window.addEventListener('load',()=>{setupTabs();generateGrid(3,4,7);refresh();
['projectName','siteLat','siteLon','hubHeight','mastHeight','rotorD','ratedKW','lossPct','wakeK','wakeModel','wakeCombination','z0','z0ref'].forEach(id=>$(id).addEventListener('change',refresh));
$('btnDemo').onclick=()=>{Object.assign(S.project,{name:'Al Dawadmi Screening',lat:24.3125,lon:44.375,hubHeight:144,rotorD:210,ratedKW:11000,z0:.03,lossPct:5,wakeK:.04});for(const [k,v] of Object.entries({projectName:S.project.name,siteLat:S.project.lat,siteLon:S.project.lon,hubHeight:S.project.hubHeight,rotorD:S.project.rotorD,ratedKW:S.project.ratedKW,z0:S.project.z0,lossPct:S.project.lossPct,wakeK:S.project.wakeK,mastHeight:S.project.mastHeight,wakeModel:S.project.wakeModel,wakeCombination:S.project.wakeCombination,z0ref:S.project.z0ref}))$(k).value=v;generateGrid(3,4,7);refresh()};
$('btnGrid').onclick=()=>{readProject();generateGrid(+$('gridRows').value,+$('gridCols').value,+$('gridSpacingD').value);refresh()};
$('btnLoadLayout').onclick=async()=>{const f=$('layoutFile').files[0];if(!f)return alert('Choose CSV/TXT/KML');parseLayout(await f.text());refresh()};
$('btnTerrain').onclick=async()=>{try{readProject();await downloadTerrain(S.project.lat,S.project.lon,+$('terrainRadius').value,+$('terrainGrid').value,$('contourInt').value,(p,m)=>status(`${p.toFixed(0)}% ${m}`));status('Terrain complete');refresh()}catch(e){status('Terrain failed: '+e.message)}};
$('btnRoughness').onclick=async()=>{try{await downloadRoughness();refresh()}catch(e){status('Roughness failed: '+e.message)}};

// Wind data download — each snaps to its own grid, producing DIFFERENT coordinates
$('btnERA5').onclick=async()=>{try{readProject();const h=$('downloadHeight').value;await downloadERA5(S.project.lat,S.project.lon,$('eraYears').value,h);status(`ERA5 complete: ${S.era5.sp.length} records @ (${S.era5.lat.toFixed(4)}, ${S.era5.lon.toFixed(4)})`);refresh()}catch(e){status('ERA5 failed: '+e.message)}};

$('btnERA5T').onclick=async()=>{try{readProject();const h=$('downloadHeight').value;await downloadERA5T(S.project.lat,S.project.lon,$('eraYears').value,h);status(`ERA5T complete: ${S.era5t.sp.length} records @ (${S.era5t.lat.toFixed(4)}, ${S.era5t.lon.toFixed(4)})`);refresh()}catch(e){status('ERA5T failed: '+e.message)}};

$('btnMERRA2').onclick=async()=>{try{readProject();const h=$('downloadHeight').value;await downloadMERRA2(S.project.lat,S.project.lon,$('eraYears').value,h);status(`MERRA-2 complete: ${S.merra2.sp.length} records @ (${S.merra2.lat.toFixed(4)}, ${S.merra2.lon.toFixed(4)})`);refresh()}catch(e){status('MERRA-2 failed: '+e.message)}};

$('btnNEWA').onclick=async()=>{try{readProject();const h=$('downloadHeight').value;await downloadNEWA(S.project.lat,S.project.lon,$('eraYears').value,h);status(`NEWA complete: ${S.newa.sp.length} records @ (${S.newa.lat.toFixed(4)}, ${S.newa.lon.toFixed(4)})`);refresh()}catch(e){status('NEWA failed: '+e.message)}};

$('btnGWA').onclick=async()=>{try{readProject();await downloadGWA(S.project.lat,S.project.lon,S.project.hubHeight,S.project.z0);refresh()}catch(e){status('GWA failed: '+e.message)}};
$('btnGWAFile').onclick=async()=>{try{readProject();const f=$('gwaFile').files[0];if(!f)return alert('Choose GWA .lib/.gwc file');setGWAFromText(await f.text(),S.project.lat,S.project.lon,S.project.hubHeight,S.project.z0);refresh()}catch(e){alert('GWA import failed: '+e.message)}};

$('btnMastClimate').onclick=async()=>{try{readProject();const f=$('mastClimateFile').files[0];if(!f)return alert('Choose LT mast climate CSV');parseMastClimate(await f.text(),{height:S.project.mastHeight,z0:S.project.z0});refresh()}catch(e){alert('Mast climate import failed: '+e.message)}};
$('btnMastTS').onclick=async()=>{try{readProject();const f=$('mastTsFile').files[0];if(!f)return alert('Choose mast/Windographer time-series CSV');parseMastTimeSeries(await f.text(),{height:S.project.mastHeight,source:f.name});refresh()}catch(e){alert('Mast time-series import failed: '+e.message)}};

$('btnObstacles').onclick=async()=>{try{const f=$('obstacleFile').files[0];if(!f)return alert('Choose obstacle CSV');parseObstacles(await f.text());refresh()}catch(e){alert('Obstacles import failed: '+e.message)}};
$('btnPowerCurve').onclick=async()=>{try{const f=$('pcFile').files[0];if(!f)return alert('Choose power/CT curve CSV');parsePowerCtCurve(await f.text());$('ratedKW').value=S.project.ratedKW;refresh()}catch(e){alert('Power curve import failed: '+e.message)}};

// Legacy Run Flow + AEP button
$('btnRun').onclick=()=>{try{readProject();runAEP();refresh()}catch(e){alert(e.message)}};

// WAsP Flow Analysis button
$('btnWAsPFlow').onclick=()=>{
  try{
    readProject();
    // Read selected wind source
    const sel=$('waspWindSource');
    if(sel)S.selectedWindSourceId=sel.value;
    // Read checkboxes
    const contourCb=$('waspUseContour');
    if(contourCb)S.useContour=contourCb.checked;
    const roughCb=$('waspUseRoughness');
    if(roughCb)S.useRoughness=roughCb.checked;
    runWAsPFlow();
    refresh();
  }catch(e){alert('WAsP Flow Error: '+e.message)}
};

// Wind source dropdown change handler
const wsSel=$('waspWindSource');
if(wsSel)wsSel.onchange=()=>{S.selectedWindSourceId=wsSel.value};

// Contour/Roughness checkbox change handlers
const contourCb=$('waspUseContour');
if(contourCb)contourCb.onchange=()=>{S.useContour=contourCb.checked};
const roughCb=$('waspUseRoughness');
if(roughCb)roughCb.onchange=()=>{S.useRoughness=roughCb.checked};

// Resource Grid Calculate button
$('btnCalcResourceGrid').onclick=()=>{
  try{
    readProject();
    const nPoints=+$('rgResolution')?.value||20;
    const radiusKm=+$('rgRadius')?.value||5;
    const viewType=$('rgViewType')?.value||'speed';
    const sectorFilter=$('rgSectorFilter')?.value||'all';
    // Make sure wind source is selected
    const sel=$('waspWindSource');
    if(sel)S.selectedWindSourceId=sel.value;
    status('Calculating resource grid...');
    setTimeout(()=>{
      try{
        calculateResourceGrid(nPoints,radiusKm,viewType,sectorFilter==='all'?'all':+sectorFilter);
        refresh();
        status('Resource grid complete');
      }catch(e){status('Resource grid failed: '+e.message);alert(e.message)}
    },50);
  }catch(e){alert(e.message)}
};

// Resource grid view type / sector filter change → recalculate with new view
const rgViewType=$('rgViewType');
if(rgViewType)rgViewType.onchange=()=>{
  if(!S.resourceGrid)return;
  // Re-calculate with new view type but same grid
  S.resourceGrid.viewType=rgViewType.value;
  const pts=S.resourceGrid.points;
  const vals=pts.map(p=>rgViewType.value==='speed'?p.meanWS:p.aepGWh);
  S.resourceGrid.minVal=Math.min(...vals);
  S.resourceGrid.maxVal=Math.max(...vals);
  refresh();
};

// Clear resource grid button
$('btnClearResourceGrid').onclick=()=>{
  S.resourceGrid=null;
  clearResourceGrid();
  refresh();
};

// Show on Map button — switch to Map tab
$('btnShowOnMap').onclick=()=>{
  const mapTab=document.querySelector('.tab[data-tab="map"]');
  if(mapTab)mapTab.click();
};

// Resource grid sector filter change → recalculate
const rgSectorFilter=$('rgSectorFilter');
if(rgSectorFilter)rgSectorFilter.onchange=()=>{
  if(!S.resourceGrid)return;
  // Re-derive from current sector filter (requires full recalc)
  const nPoints=S.resourceGrid.rows;
  const radiusKm=S.resourceGrid.radiusKm;
  const viewType=$('rgViewType')?.value||S.resourceGrid.viewType;
  const sectorFilter=rgSectorFilter.value;
  try{
    calculateResourceGrid(nPoints,radiusKm,viewType,sectorFilter==='all'?'all':+sectorFilter);
    refresh();
  }catch(e){alert(e.message)}
};

$('btnTS').onclick=()=>{try{readProject();runTimeSeries(1);refresh()}catch(e){alert(e.message)}};
$('btnCSV').onclick=()=>{try{exportTsCsv()}catch(e){alert(e.message)}};
$('btnReport').onclick=()=>{try{exportReport()}catch(e){alert(e.message)}};
});

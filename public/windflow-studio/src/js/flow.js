import {S,log} from './state.js';
import {weibullPdf,rad,gamma,meanWeibull,logLaw} from './utils.js';
import {activeClimateAtHub} from './mastClimate.js';
import {terrainAt} from './terrain.js';
import {effectiveZ0Fetch,roughnessChangeRatio} from './roughness.js';
import {wakeRun,power} from './wake.js';
import {shelterFactor} from './shelter.js';

export function terrainSpeedup(lat,lon,dir,z0){
  if(!S.terrain)return 1;const z=terrainAt(lat,lon);if(z==null)return 1;
  const scales=[250,500,1000,2000,4000,8000],weights=[.10,.18,.25,.23,.16,.08];
  const th=rad(dir),mx=111320*Math.cos(rad(lat))||1,my=111320;let resp=0,wsum=0;
  for(let i=0;i<scales.length;i++){
    const d=scales[i],dLat=Math.cos(th)*d/my,dLon=Math.sin(th)*d/mx;
    const zu=terrainAt(lat+dLat,lon+dLon),zd=terrainAt(lat-dLat,lon-dLon);
    const zl=terrainAt(lat-dLon*my/mx,lon+dLat*mx/my),zr=terrainAt(lat+dLon*my/mx,lon-dLat*mx/my);
    if(zu==null||zd==null)continue;
    const slope=(z-zu)/d*0.60 + (zd-zu)/(2*d)*0.25;
    const curvAlong=(zd-2*z+zu)/(d*d);
    const curvCross=(zl!=null&&zr!=null)?(zl-2*z+zr)/(d*d):0;
    const ridge= -0.35*d*(curvAlong+0.5*curvCross);
    resp+=weights[i]*(slope+ridge);wsum+=weights[i];
  }
  if(!wsum)return 1;
  const amp=1.70;return Math.max(.70,Math.min(1.42,Math.exp(Math.max(-.28,Math.min(.28,amp*resp/wsum)))));
}
export function siteRatio(t,dir){
  const p=S.project;
  const z0eff=effectiveZ0Fetch(t.lat,t.lon,dir,p.z0);
  const rough=roughnessChangeRatio(t.lat,t.lon,dir,p.hubHeight,p.z0,p.z0);
  const oro=terrainSpeedup(t.lat,t.lon,dir,z0eff);
  const sec=Math.round((((dir%360)+360)%360)/30)%12;
  const cal=S.calibration?.sectorSR?.[sec]??1;
  return Math.max(.50,Math.min(1.70,rough*oro*shelterFactor(t,dir)*cal));
}
export function estimateRIX(){if(!S.terrain)return 0;const T=S.terrain,{grid,ny,nx}=T;const dx=((T.lon1-T.lon0)/(nx-1))*111320*Math.cos(rad((T.lat0+T.lat1)/2))||1,dy=((T.lat1-T.lat0)/(ny-1))*111320||1;let steep=0,total=0;for(let i=1;i<ny-1;i++)for(let j=1;j<nx-1;j++){const dzdx=(grid[i][j+1]-grid[i][j-1])/(2*dx),dzdy=(grid[i+1][j]-grid[i-1][j])/(2*dy),s=Math.sqrt(dzdx*dzdx+dzdy*dzdy);if(s>0.30)steep++;total++}return total?100*steep/total:0}

export function buildGwcReport(climate){
  const p=S.project,zref=p.z0ref||0.05,zmast=p.z0||0.03;
  return climate.sectors.map(sec=>{
    const toRef=Math.log(p.hubHeight/zref)/Math.log(p.hubHeight/zmast);
    return{dir:sec.dir,freq:sec.freq,A_OWC:sec.A,k:sec.k,A_GWC:sec.A*toRef,z0ref:zref};
  });
}

/** Derive sector-wise Weibull climate from time series wind data */
function deriveClimateFromTS(tsData){
  const nSectors=12,sectorWidth=360/nSectors;
  const buckets=Array.from({length:nSectors},()=>[]);
  const ws=tsData.sp||tsData.records?.map(r=>r.ws)||[];
  const wd=tsData.dir||tsData.records?.map(r=>r.wd)||[];
  for(let i=0;i<ws.length;i++){
    const s=ws[i],d=wd[i];
    if(s==null||d==null||s<0.1)continue;
    const sec=Math.floor((((d%360)+360)%360)/sectorWidth)%nSectors;
    buckets[sec].push(s);
  }
  const sectors=[];
  let total=0;
  for(let i=0;i<nSectors;i++)total+=buckets[i].length;
  for(let i=0;i<nSectors;i++){
    const b=buckets[i];const freq=b.length/(total||1);
    const mean=b.length?b.reduce((s,v)=>s+v,0)/b.length:0;
    const stdev=b.length>1?Math.sqrt(b.reduce((s,v)=>s+(v-mean)**2,0)/(b.length-1)):mean*0.5;
    const k=mean>0&&stdev>0?Math.max(0.8,Math.min(3.5,(stdev/mean)**(-1.086))):1.8;
    const A=mean>0?mean/gamma(1+1/k):0;
    sectors.push({dir:i*30+15,freq,A:Math.max(0.1,A),k:Math.max(0.5,k)});
  }
  const fs=sectors.reduce((s,x)=>s+x.freq,0)||1;
  sectors.forEach(s=>s.freq/=fs);
  const meanWS=sectors.reduce((a,s)=>a+s.freq*meanWeibull(s.A,s.k),0);
  return{sectors,mean:meanWS,source:tsData.source||'Time series derived',height:tsData.height||100,z0:S.project.z0||0.03,lat:tsData.lat||S.project.lat,lon:tsData.lon||S.project.lon};
}

/** Get climate from the selected wind source */
function getClimateFromSource(sourceId){
  // Direct climate sources
  if(sourceId==='mast_climate'&&S.windClimate){
    return activeClimateAtHub();
  }
  if(sourceId==='gwa'&&S.gwa?.climate){
    const c=S.gwa.climate;
    return{source:'GWA point climate',height:c.height,sectors:c.sectors.map((d,i)=>({dir:d,freq:c.freq[i],A:c.A[i],k:c.k[i]})),mean:c.mean,z0:c.roughness||S.project.z0,lat:S.gwa.lat,lon:S.gwa.lon};
  }
  // Time series sources — derive sector-wise climate
  if(sourceId==='era5'&&S.era5) return deriveClimateFromTS(S.era5);
  if(sourceId==='era5t'&&S.era5t) return deriveClimateFromTS(S.era5t);
  if(sourceId==='merra2'&&S.merra2) return deriveClimateFromTS(S.merra2);
  if(sourceId==='newa'&&S.newa) return deriveClimateFromTS(S.newa);
  if(sourceId==='mast_ts'&&S.mastTS) return deriveClimateFromTS(S.mastTS);
  // Fallback
  return activeClimateAtHub();
}

/** Compute REWS (Rotor Equivalent Wind Speed) for a turbine at given free-stream conditions */
function computeREWS(t,dir,freeWS){
  const p=S.project;
  const hubH=p.hubHeight, R=p.rotorD/2;
  const nLevels=7; // discretize rotor into 7 levels
  const z0=Math.max(0.0002,p.z0||0.03);
  let wsSum=0, weightSum=0;
  for(let i=0;i<nLevels;i++){
    const frac=(i/(nLevels-1))*2-1; // -1 to +1
    const h=hubH+frac*R;
    if(h<=z0)continue;
    const ratio=Math.log(h/z0)/Math.log(hubH/z0);
    // Account for terrain speedup at this height (approximate: same ratio applied)
    const ws=freeWS*ratio;
    // Weight: annular area weighting (simplified — equal weight is also acceptable per IEC 61400-12-1)
    const r=Math.abs(frac);
    const weight=r<0.99?1:0.5; // simple uniform weighting
    wsSum+=ws*weight;
    weightSum+=weight;
  }
  return weightSum>0?wsSum/weightSum:freeWS;
}

/**
 * Run full WAsP-like flow analysis
 * Steps: vertical extrapolation → generalize OWC→GWC → downscale GWC→SWC → REWS → wake → AEP
 */
export function runWAsPFlow(){
  const sourceId=S.selectedWindSourceId;
  if(!sourceId)throw Error('Select a wind data source first');
  if(!S.turbines.length)throw Error('Load/generate layout first');

  const src=S.windSources.find(s=>s.id===sourceId);
  if(!src)throw Error('Selected wind source not found');

  log(`WAsP Flow: starting with source ${src.label} @ ${src.height}m`);

  // Step 1: Get climate (OWC) from selected source
  const owc=getClimateFromSource(sourceId);
  if(!owc||!owc.sectors?.length)throw Error('Could not get wind climate from selected source');
  log(`WAsP Flow: OWC loaded — ${owc.sectors.length} sectors, mean=${owc.mean.toFixed(2)} m/s @ ${owc.height}m`);

  // Step 2: Vertical extrapolation to hub height (if source height != hub height)
  const p=S.project;
  let climateAtHub=owc;
  if(Math.abs(owc.height-p.hubHeight)>0.5){
    const z0=Math.max(0.0002,owc.z0||p.z0||0.03);
    const logRatio=Math.log(p.hubHeight/z0)/Math.log(Math.max(owc.height,z0*1.1)/z0);
    climateAtHub={
      ...owc,
      height:p.hubHeight,
      sectors:owc.sectors.map(s=>({...s,A:s.A*logRatio})),
      mean:0
    };
    climateAtHub.mean=climateAtHub.sectors.reduce((a,s)=>a+s.freq*meanWeibull(s.A,s.k),0);
    log(`WAsP Flow: Vertical extrapolation ${owc.height}m → ${p.hubHeight}m (ratio=${logRatio.toFixed(4)})`);
  }

  // Step 3: Generalize OWC → GWC
  const gwc=buildGwcReport(climateAtHub);
  log(`WAsP Flow: OWC → GWC generalized (z0ref=${p.z0ref||0.05}m)`);

  // Step 4: Downscale GWC → SWC at each turbine, then REWS, wake, AEP
  const N=S.turbines.length;
  const gross=new Array(N).fill(0),wakeArr=new Array(N).fill(0);
  const meanFree=new Array(N).fill(0),meanREWS=new Array(N).fill(0);
  const probSum=new Array(N).fill(0);
  const rewsGross=new Array(N).fill(0);

  for(const secObj of climateAtHub.sectors){
    const dir=secObj.dir,A=secObj.A,k=secObj.k,freq=secObj.freq;
    for(let v=.5;v<=32;v+=.5){
      const prob=freq*weibullPdf(v,A,k)*.5;if(prob<1e-9)continue;
      // Free-stream wind speed at each turbine (SWC = GWC × site ratio)
      const free=S.turbines.map(t=>v*siteRatio(t,dir));
      // REWS at each turbine
      const rews=S.turbines.map((t,i)=>computeREWS(t,dir,free[i]));
      // Wake calculation on REWS values
      const wsp=wakeRun(rews,dir);
      for(let i=0;i<N;i++){
        gross[i]+=power(free[i])*prob*8760;       // gross based on free-stream hub-height WS
        rewsGross[i]+=power(rews[i])*prob*8760;   // gross based on REWS
        wakeArr[i]+=power(wsp[i])*prob*8760;       // net after wake on REWS
        meanFree[i]+=free[i]*prob;
        meanREWS[i]+=rews[i]*prob;
        probSum[i]+=prob;
      }
    }
  }

  const loss=1-p.lossPct/100;
  const per=S.turbines.map((t,i)=>({
    id:t.id,name:t.name,lat:t.lat,lon:t.lon,
    meanWS:meanFree[i]/(probSum[i]||1),
    meanREWS:meanREWS[i]/(probSum[i]||1),
    grossGWh:gross[i]/1e6,
    rewsGrossGWh:rewsGross[i]/1e6,
    wakeLoss:gross[i]?(gross[i]-wakeArr[i])/gross[i]*100:0,
    rewsWakeLoss:rewsGross[i]?(rewsGross[i]-wakeArr[i])/rewsGross[i]*100:0,
    netGWh:wakeArr[i]*loss/1e6,
    cf:wakeArr[i]*loss/(p.ratedKW*8760)*100
  }));

  const grossGWh=per.reduce((s,t)=>s+t.grossGWh,0);
  const rewsGrossGWh=per.reduce((s,t)=>s+t.rewsGrossGWh,0);
  const netGWh=per.reduce((s,t)=>s+t.netGWh,0);
  const wakeLoss=grossGWh?(grossGWh-netGWh/loss)/grossGWh*100:0;
  const rewsWakeLoss=rewsGrossGWh?(rewsGrossGWh-netGWh/loss)/rewsGrossGWh*100:0;
  const rix=estimateRIX();

  S.waspResults={
    per,grossGWh,rewsGrossGWh,netGWh,wakeLoss,rewsWakeLoss,
    cf:netGWh*1000/(N*p.ratedKW/1000*8760)*100,
    capacityMW:N*p.ratedKW/1000,rix,
    climateSource:src.label,
    climateSourceId:sourceId,
    climateHeight:owc.height,
    hubHeight:p.hubHeight,
    owcMean:owc.mean,
    hubMean:climateAtHub.mean,
    gwc,
    useContour:S.useContour,
    useRoughness:S.useRoughness,
    verticalExtrapolation:Math.abs(owc.height-p.hubHeight)>0.5,
    extrapolationFrom:owc.height,
    extrapolationTo:p.hubHeight
  };

  if(rix>5)log(`WAsP Flow: RIX ${rix.toFixed(1)}% — complex terrain; validate against mast/LiDAR or CFD/WAsP.`,'w');
  log(`WAsP Flow complete (${src.label}): Net ${netGWh.toFixed(1)} GWh, wake ${wakeLoss.toFixed(1)}%, REX ${rix.toFixed(1)}%, CF ${(S.waspResults.cf).toFixed(1)}%`);

  // Also store in S.results for backwards compatibility
  S.results={per,grossGWh,netGWh,wakeLoss,cf:S.waspResults.cf,capacityMW:N*p.ratedKW/1000,rix,climateSource:src.label,climateMean:climateAtHub.mean,gwc};

  return S.waspResults;
}

/**
 * Calculate resource grid — wind speed and AEP at a grid of points over the project area
 */
export function calculateResourceGrid(nPoints=20,radiusKm=5,viewType='speed',sectorFilter='all'){
  const sourceId=S.selectedWindSourceId;
  if(!sourceId)throw Error('Select a wind data source first');

  const owc=getClimateFromSource(sourceId);
  if(!owc||!owc.sectors?.length)throw Error('Could not get wind climate from selected source');

  const p=S.project;

  // Vertical extrapolation if needed
  let climateAtHub=owc;
  if(Math.abs(owc.height-p.hubHeight)>0.5){
    const z0=Math.max(0.0002,owc.z0||p.z0||0.03);
    const logRatio=Math.log(p.hubHeight/z0)/Math.log(Math.max(owc.height,z0*1.1)/z0);
    climateAtHub={...owc,height:p.hubHeight,sectors:owc.sectors.map(s=>({...s,A:s.A*logRatio})),mean:0};
    climateAtHub.mean=climateAtHub.sectors.reduce((a,s)=>a+s.freq*meanWeibull(s.A,s.k),0);
  }

  // Determine bounds from turbines + project center
  const centerLat=p.lat, centerLon=p.lon;
  const dLat=radiusKm/111.32;
  const dLon=radiusKm/(111.32*Math.cos(rad(centerLat)));
  const lat0=centerLat-dLat, lat1=centerLat+dLat;
  const lon0=centerLon-dLon, lon1=centerLon+dLon;

  const rows=nPoints, cols=nPoints;
  const dLatStep=(lat1-lat0)/(rows-1);
  const dLonStep=(lon1-lon0)/(cols-1);

  log(`Resource Grid: calculating ${rows}×${cols}=${rows*cols} points over ${radiusKm}km radius`);

  const gridPoints=[];
  const sectors=sectorFilter==='all'?climateAtHub.sectors:climateAtHub.sectors.filter(s=>{const diff=Math.abs(s.dir-(sectorFilter%360));return Math.min(diff,360-diff)<=16;});

  for(let i=0;i<rows;i++){
    for(let j=0;j<cols;j++){
      const lat=lat0+i*dLatStep;
      const lon=lon0+j*dLonStep;
      const t={lat,lon,hh:p.hubHeight};

      let meanWS=0, aepGWh=0, probSum=0;
      for(const sec of sectors){
        const dir=sec.dir, A=sec.A, k=sec.k, freq=sec.freq;
        for(let v=.5;v<=32;v+=1){
          const prob=freq*weibullPdf(v,A,k)*1;if(prob<1e-9)continue;
          const free=v*siteRatio(t,dir);
          meanWS+=free*prob;
          aepGWh+=power(free)*prob*8760/1e6;
          probSum+=prob;
        }
      }
      meanWS=probSum>0?meanWS/probSum:0;

      gridPoints.push({lat,lon,meanWS,aepGWh});
    }
  }

  const values=gridPoints.map(p=>viewType==='speed'?p.meanWS:p.aepGWh);
  const minVal=Math.min(...values), maxVal=Math.max(...values);

  S.resourceGrid={
    points:gridPoints,
    rows,cols,
    lat0,lat1,lon0,lon1,
    radiusKm,
    viewType,
    sectorFilter,
    minVal,maxVal,
    climateSource:owc.source,
    climateHeight:climateAtHub.height
  };

  log(`Resource Grid complete: ${viewType==='speed'?'wind speed':'AEP'} range ${minVal.toFixed(2)}–${maxVal.toFixed(2)} ${viewType==='speed'?'m/s':'GWh'}`);
  return S.resourceGrid;
}

export function runAEP(){
  const climate=activeClimateAtHub();
  if(!climate)throw Error('Import LT mast climate or download GWA first');
  if(!S.turbines.length)throw Error('Load/generate layout first');
  const p=S.project,N=S.turbines.length;
  const gross=new Array(N).fill(0),wake=new Array(N).fill(0),mean=new Array(N).fill(0),probSum=new Array(N).fill(0);
  for(const secObj of climate.sectors){
    const dir=secObj.dir,A=secObj.A,k=secObj.k,freq=secObj.freq;
    for(let v=.5;v<=32;v+=.5){
      const prob=freq*weibullPdf(v,A,k)*.5;if(prob<1e-9)continue;
      const free=S.turbines.map(t=>v*siteRatio(t,dir));
      const wsp=wakeRun(free,dir);
      for(let i=0;i<N;i++){gross[i]+=power(free[i])*prob*8760;wake[i]+=power(wsp[i])*prob*8760;mean[i]+=free[i]*prob;probSum[i]+=prob}
    }
  }
  const loss=1-p.lossPct/100;
  const per=S.turbines.map((t,i)=>({id:t.id,name:t.name,lat:t.lat,lon:t.lon,meanWS:mean[i]/(probSum[i]||1),grossGWh:gross[i]/1e6,wakeLoss:gross[i]?(gross[i]-wake[i])/gross[i]*100:0,netGWh:wake[i]*loss/1e6,cf:wake[i]*loss/(p.ratedKW*8760)*100}));
  const grossGWh=per.reduce((s,t)=>s+t.grossGWh,0),netGWh=per.reduce((s,t)=>s+t.netGWh,0),wakeLoss=grossGWh?(grossGWh-per.reduce((s,t)=>s+t.netGWh,0)/loss)/grossGWh*100:0;
  const rix=estimateRIX();
  S.results={per,grossGWh,netGWh,wakeLoss,cf:netGWh*1000/(N*p.ratedKW/1000*8760)*100,capacityMW:N*p.ratedKW/1000,rix,climateSource:climate.source,climateMean:climate.mean,gwc:buildGwcReport(climate)};
  if(rix>5)log(`RIX ${rix.toFixed(1)}%: complex terrain; validate against mast/LiDAR or CFD/WAsP.`,'w');
  log(`AEP complete (${climate.source}): Net ${netGWh.toFixed(1)} GWh, wake ${wakeLoss.toFixed(1)}%, RIX ${rix.toFixed(1)}%`);
  return S.results;
}

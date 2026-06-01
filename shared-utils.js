let selectedSpotId = null;
let unsubSpots = null;    // listener Firestore parcheggi
let unsubHistory = null;  // listener Firestore storico
let historyCache = [];    // cache locale storico


// ââ PAN / ZOOM ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
let scale=1, panX=0, panY=0, isPanning=false;
let pSX=0, pSY=0, pSPX=0, pSPY=0;
const MIN_S=0.3, MAX_S=5;

function applyT(){
  document.getElementById("mapCanvas").style.transform=`translate(${panX}px,${panY}px) scale(${scale})`;
  document.getElementById("mapCanvas").style.transformOrigin="0 0";
  document.getElementById("zoomLabel").textContent=Math.round(scale*100)+"%";
}
function clampP(){
  const vp=document.getElementById("mapViewport"),img=document.getElementById("mapImg");
  const vpW=vp.clientWidth,vpH=vp.clientHeight,iW=img.clientWidth*scale,iH=img.clientHeight*scale;
  panX=Math.max(Math.min(0,vpW-iW),Math.min(0,panX));
  panY=Math.max(Math.min(0,vpH-iH),Math.min(0,panY));
}
function zoom(delta,cx,cy){
  const vp=document.getElementById("mapViewport");
  if(!cx)cx=vp.clientWidth/2; if(!cy)cy=vp.clientHeight/2;
  const old=scale; scale=Math.max(MIN_S,Math.min(MAX_S,scale+delta));
  panX=cx-(cx-panX)*(scale/old); panY=cy-(cy-panY)*(scale/old);
  clampP(); applyT();
}

function resetZoom(){ scale=1; panX=0; panY=0; applyT(); }

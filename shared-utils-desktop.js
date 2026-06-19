window.currentUser = null;   // { email, role, uid }

// ── SHARED-UTILS.JS ─────────────────────────────────────────────────────────
window.selectedSpotId = null;
window.unsubSpots = null;    // listener Firestore parcheggi
window.unsubHistory = null;  // listener Firestore storico
window.historyCache = [];    // cache locale storico


// ââ PAN / ZOOM ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
window.scale=1; window.panX=0; window.panY=0; window.isPanning=false;
window.pSX=0; window.pSY=0; window.pSPX=0; window.pSPY=0;
window.MIN_S=0.3; window.MAX_S=5;

function applyT(){
  document.getElementById("mapCanvas").style.transform=`translate(${window.panX}px,${window.panY}px) scale(${window.scale})`;
  document.getElementById("mapCanvas").style.transformOrigin="0 0";
  document.getElementById("zoomLabel").textContent=Math.round(window.scale*100)+"%";
}
function clampP(){
  const vp=document.getElementById("mapViewport"),img=document.getElementById("mapImg");
  const vpW=vp.clientWidth,vpH=vp.clientHeight,iW=img.clientWidth*window.scale,iH=img.clientHeight*window.scale;
  window.panX=Math.max(Math.min(0,vpW-iW),Math.min(0,window.panX));
  window.panY=Math.max(Math.min(0,vpH-iH),Math.min(0,window.panY));
}
function zoom(delta,cx,cy){
  const vp=document.getElementById("mapViewport");
  if(!cx)cx=vp.clientWidth/2; if(!cy)cy=vp.clientHeight/2;
  const old=window.scale; window.scale=Math.max(window.MIN_S,Math.min(window.MAX_S,window.scale+delta));
  window.panX=cx-(cx-window.panX)*(window.scale/old); window.panY=cy-(cy-window.panY)*(window.scale/old);
  clampP(); applyT();
}

function resetZoom(){ window.scale=1; window.panX=0; window.panY=0; applyT(); }

window.zoom      = zoom;
window.resetZoom = resetZoom;
window.applyT  = applyT;
window.clampP  = clampP;

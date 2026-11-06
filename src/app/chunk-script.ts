/**
 * Vercel Hobby has no skew protection, so a tab left open across a deploy asks for chunks that are gone. Inline, because it
 * has to be listening before any chunk can fail.
 *
 * It waits out a run, a results screen, an open dialog and a focused form, since each of those holds something a reload loses.
 * A HEAD first, because a chunk also fails offline, and reloading then would swap a working test for the browser's error page.
 * One attempt a minute: a chunk still missing after a fresh load is not skew, and looping would make the page unusable.
 */
export const CHUNK_SCRIPT = `(function(){
var K="fastypist:reloaded",armed=false,d=document;
function busy(){
var t=d.querySelector(".tp"),a=d.activeElement;
return d.documentElement.dataset.typing!==undefined||(t&&t.dataset.phase!=="idle")||d.querySelector("dialog[open]")||(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!a.classList.contains("tp-input"));
}
window.__reloadForUpdate=function(){
if(armed)return true;
try{if(Date.now()-(+sessionStorage.getItem(K)||0)<6e4)return false}catch(e){return false}
armed=true;
(function wait(){
if(busy()){setTimeout(wait,2e3);return}
(window.requestIdleCallback||setTimeout)(function(){
if(busy()){wait();return}
fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(r){
if(!r.ok||busy()){armed=false;return}
try{sessionStorage.setItem(K,Date.now())}catch(e){}
location.reload();
},function(){armed=false});
});
})();
return true;
};
addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"&&t.src.indexOf("/_next/static/")>=0)__reloadForUpdate()},true);
addEventListener("unhandledrejection",function(e){var r=e.reason;if(r&&/chunk|dynamically imported module/i.test(r.name+" "+r.message))__reloadForUpdate()});
})();`;

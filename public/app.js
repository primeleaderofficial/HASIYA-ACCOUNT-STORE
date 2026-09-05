const state={accounts:[],sold:[],page:1,range:"all",perPage:20,settings:{}};
const $=s=>document.querySelector(s);
function money(n){return "Rs. "+Number(n).toLocaleString("en-LK")}
function waUrl(a){const n=(state.settings.whatsapp_number||"").replace(/\D/g,"");if(!n)return "#";return `https://wa.me/${n}?text=${encodeURIComponent(`Hi, I'm interested in buying ${a.title} - ${money(a.price)}.`)}`}
async function get(url){const r=await fetch(url);return r.json()}
function card(a,sold=false){
  return `<article class="account-card" data-id="${a.id}">
    <img class="account-img" src="${esc(a.image_url)}" alt="${esc(a.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 800 450%22%3E%3Crect width=%22800%22 height=%22450%22 fill=%22%2307111e%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%237aa7d8%22 font-size=%2230%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3EImage unavailable%3C/text%3E%3C/svg%3E'">
    <div class="account-info"><div class="account-top"><div><div class="account-title">${esc(a.title)}</div><div class="muted">${esc(a.game)}</div></div><div class="price">${money(a.price)}</div></div>
    <span class="badge ${sold?"sold":""}">${sold?"SOLD OUT":(a.featured?"FEATURED":"AVAILABLE")}</span>
    <div class="specs"><div class="spec">Level <b>${esc(a.level||"—")}</b></div><div class="spec">Likes <b>${esc(a.likes||"—")}</b></div><div class="spec">Fashion <b>${esc(a.fashion||"—")}</b></div><div class="spec">Evo Guns <b>${esc(a.evo_guns||"—")}</b></div></div>
    <div class="account-actions"><button class="btn ghost details">VIEW DETAILS</button>${sold?"":`<a class="btn primary buy" href="${waUrl(a)}" target="_blank" rel="noopener">WHATSAPP</a>`}</div>
    </div></article>`
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function load(){
  const store=await get("/api/store");state.settings=store.settings;
  $("#storeName").textContent=state.settings.store_name;$("#slogan").textContent=state.settings.slogan;$("#secondary").textContent=state.settings.secondary_slogan;
  $("#footerSlogan").textContent=state.settings.slogan;$("#footerSecondary").textContent=state.settings.secondary_slogan;
  $("#footerWhatsApp").href=state.settings.whatsapp_number?`https://wa.me/${state.settings.whatsapp_number.replace(/\D/g,"")}`:"#";
  const [accounts,sold]=await Promise.all([get(`/api/accounts?range=${state.range}`),get("/api/accounts?sold=1")]);state.accounts=accounts;state.sold=sold;
  renderPrices(store.priceRanges);render();renderSold();
}
function renderPrices(ranges){
  const labels=["ALL PRICES",...ranges.map(x=>`Rs. ${x[1].toLocaleString()} – ${x[2].toLocaleString()}`)];
  $("#priceGrid").innerHTML=labels.map((x,i)=>`<button class="price-btn ${i===0&&state.range==="all"?"active":""}" data-range="${i===0?"all":i}">${x}</button>`).join("");
  document.querySelectorAll(".price-btn").forEach(b=>b.onclick=async()=>{state.range=b.dataset.range;state.page=1;document.querySelectorAll(".price-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.accounts=await get(`/api/accounts?range=${state.range}`);render();location.hash="accounts"});
}
function render(){
 const pages=Math.max(1,Math.ceil(state.accounts.length/state.perPage));if(state.page>pages)state.page=pages;
 const start=(state.page-1)*state.perPage;const slice=state.accounts.slice(start,start+state.perPage);
 $("#accountsGrid").innerHTML=slice.length?slice.map(a=>card(a)).join():'<div class="muted">No accounts found in this price range.</div>';
 $("#resultCount").textContent=`${state.accounts.length} account${state.accounts.length===1?"":"s"} found`;
 $("#pagination").innerHTML=pages>1?`<button class="page" data-p="${Math.max(1,state.page-1)}">PREVIOUS</button>${Array.from({length:pages},(_,i)=>`<button class="page ${state.page===i+1?"active":""}" data-p="${i+1}">${i+1}</button>`).join("")}<button class="page" data-p="${Math.min(pages,state.page+1)}">NEXT</button>`:"";
 document.querySelectorAll(".page").forEach(b=>b.onclick=()=>{state.page=Number(b.dataset.p);render();document.querySelector("#accounts").scrollIntoView({behavior:"smooth"})});
 document.querySelectorAll(".account-card").forEach(c=>{c.onclick=e=>{if(e.target.closest("a")||e.target.closest(".buy"))return;openDetails(Number(c.dataset.id),false)}})
}
function renderSold(){ $("#soldGrid").innerHTML=state.sold.length?state.sold.slice(0,20).map(a=>card(a,true)).join():'<div class="muted">No sold accounts yet.</div>';document.querySelectorAll("#soldGrid .account-card").forEach(c=>c.onclick=()=>openDetails(Number(c.dataset.id),true))}
function openDetails(id,sold){
 const a=(sold?state.sold:state.accounts).find(x=>x.id===id);if(!a)return;
 $("#detailBody").innerHTML=`<div class="detail"><img src="${esc(a.image_url)}" alt="${esc(a.title)}"><div class="account-top"><div><h2>${esc(a.title)}</h2><div class="muted">${esc(a.game)}</div></div><div class="price">${money(a.price)}</div></div><span class="badge ${sold?"sold":""}">${sold?"SOLD OUT":"AVAILABLE"}</span><div class="detail-grid"><div class="spec">Level <b>${esc(a.level||"—")}</b></div><div class="spec">Fashion / Bundles <b>${esc(a.fashion||"—")}</b></div><div class="spec">Evo Guns <b>${esc(a.evo_guns||"—")}</b></div><div class="spec">Emotes <b>${esc(a.emotes||"—")}</b></div><div class="spec">Likes <b>${esc(a.likes||"—")}</b></div><div class="spec">Bind <b>${esc(a.bind_info||"—")}</b></div></div><p class="description">${esc(a.description||"No description provided.")}</p>${sold?"":`<a class="btn primary" target="_blank" rel="noopener" href="${waUrl(a)}">BUY / CONTACT ON WHATSAPP</a>`}</div>`;
 $("#detailModal").classList.add("show");
}
$("#modalClose").onclick=()=>$("#detailModal").classList.remove("show");$("#detailModal").onclick=e=>{if(e.target.id==="detailModal")e.currentTarget.classList.remove("show")};
$("#navToggle").onclick=()=>$("#navLinks").style.display=$("#navLinks").style.display==="flex"?"none":"flex";
load();

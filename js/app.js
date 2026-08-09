
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector(".mobile-toggle")?.addEventListener("click",()=>document.querySelector(".navlinks").classList.toggle("open"));
  document.querySelectorAll(".navlinks a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".navlinks").classList.remove("open")));
  document.querySelectorAll("[data-year]").forEach(el=>el.textContent=new Date().getFullYear());
  await renderPublicServices();
});
async function renderPublicServices(){
  const root=document.querySelector("#servicesGrid"); if(!root)return;
  root.innerHTML='<div class="empty" style="grid-column:1/-1">Carregando serviços...</div>';
  const {data,error}=await sb.from("services").select("*").eq("active",true).order("sort_order");
  if(error){root.innerHTML=`<div class="empty" style="grid-column:1/-1">Erro ao carregar serviços: ${JK.esc(error.message)}</div>`;return;}
  root.innerHTML=data.map(s=>`<article class="service-card">
    <img class="service-image" src="${s.image_url||'assets/corte-classico.svg'}" alt="${JK.esc(s.name)}">
    <div class="service-body"><h3>${JK.esc(s.name)}</h3><p>${JK.esc(s.description||"")}</p>
    <div class="price-row"><span class="price">${JK.money(s.price)}</span><a class="btn btn-outline" href="agendar.html?service=${s.id}">Agendar</a></div></div></article>`).join("");
}


document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector(".mobile-toggle")?.addEventListener("click",()=>document.querySelector(".navlinks").classList.toggle("open"));
  document.querySelectorAll(".navlinks a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".navlinks").classList.remove("open")));
  document.querySelectorAll("[data-year]").forEach(el=>el.textContent=new Date().getFullYear());
  await Promise.all([renderPublicServices(),renderPublicGallery()]);
});
async function renderPublicServices(){
  const root=document.querySelector("#servicesGrid"); if(!root)return;
  root.innerHTML='<div class="empty" style="grid-column:1/-1">Carregando serviços...</div>';
  const {data,error}=await sb.from("services").select("*").eq("active",true).order("sort_order");
  if(error){root.innerHTML=`<div class="empty" style="grid-column:1/-1">Erro ao carregar serviços: ${JK.esc(error.message)}</div>`;return;}
  root.innerHTML=data.map(s=>`<article class="service-card reveal-card">
    <div class="service-media">
      <img class="service-image" src="${s.image_url||'assets/corte-classico.svg'}" alt="${JK.esc(s.name)}" loading="lazy">
      <span class="service-duration">${Number(s.duration_minutes||0)} min</span>
      <span class="service-media-glow"></span>
    </div>
    <div class="service-body">
      <div class="service-title-row"><h3>${JK.esc(s.name)}</h3><span class="price">${JK.money(s.price)}</span></div>
      <p>${JK.esc(s.description||"")}</p>
      <a class="service-book-link" href="agendar.html?service=${s.id}"><span>Agendar este serviço</span><b>→</b></a>
    </div>
  </article>`).join("");
  observeRevealCards();
}


async function renderPublicGallery(){
  const root=document.querySelector("#galleryGrid");
  if(!root)return;
  const {data,error}=await sb.from("gallery").select("*").eq("active",true).order("sort_order").order("id",{ascending:false});
  if(error){root.innerHTML='<div class="empty" style="grid-column:1/-1">Não foi possível carregar a galeria.</div>';console.error(error);return;}
  if(!data?.length){root.innerHTML='<div class="empty" style="grid-column:1/-1">Novos trabalhos serão publicados aqui em breve.</div>';return;}
  root.innerHTML=data.map(item=>`<button class="gallery-card" type="button" data-image="${JK.esc(item.image_url)}" data-title="${JK.esc(item.title||'Trabalho JK Barbearia')}" data-caption="${JK.esc(item.caption||'')}">
    <img src="${JK.esc(item.image_url)}" alt="${JK.esc(item.title||'Trabalho realizado pela JK Barbearia')}" loading="lazy">
    <span class="gallery-overlay"><strong>${JK.esc(item.title||'JK Barbearia')}</strong>${item.caption?`<small>${JK.esc(item.caption)}</small>`:''}<em>Ver foto</em></span>
  </button>`).join("");
  root.querySelectorAll(".gallery-card").forEach(card=>card.addEventListener("click",()=>openGalleryLightbox(card)));
}

function openGalleryLightbox(card){
  const box=document.querySelector("#galleryLightbox"); if(!box)return;
  document.querySelector("#lightboxImage").src=card.dataset.image||"";
  document.querySelector("#lightboxTitle").textContent=card.dataset.title||"";
  document.querySelector("#lightboxCaption").textContent=card.dataset.caption||"";
  box.classList.add("open"); box.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
}
function closeGalleryLightbox(){const box=document.querySelector("#galleryLightbox");if(!box)return;box.classList.remove("open");box.setAttribute("aria-hidden","true");document.body.style.overflow="";}
document.addEventListener("click",e=>{if(e.target.matches(".lightbox-close")||e.target.id==="galleryLightbox")closeGalleryLightbox();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeGalleryLightbox();});

function observeRevealCards(){
  const cards=document.querySelectorAll(".reveal-card:not(.revealed)");
  if(!("IntersectionObserver" in window)){cards.forEach(c=>c.classList.add("revealed"));return;}
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add("revealed");obs.unobserve(entry.target);}
    });
  },{threshold:.12});
  cards.forEach(c=>obs.observe(c));
}
window.addEventListener("scroll",()=>{
  document.documentElement.style.setProperty("--scrollY",`${window.scrollY}px`);
},{passive:true});

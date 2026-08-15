let session=null, services=[], barbers=[], galleryItems=[];
const $=(s)=>document.querySelector(s);

function adminToast(message,error=false){
  let el=$("#adminToast");
  if(!el){
    el=document.createElement("div");
    el.id="adminToast";
    el.style.cssText="position:fixed;right:18px;bottom:18px;z-index:99999;padding:14px 18px;border-radius:12px;background:#151515;color:#fff;border:1px solid #b8934b;box-shadow:0 12px 35px rgba(0,0,0,.35);font:600 14px system-ui;max-width:360px";
    document.body.appendChild(el);
  }
  el.textContent=message;
  el.style.borderColor=error?"#e36b6b":"#61c98b";
  el.style.display="block";
  clearTimeout(adminToast.timer);
  adminToast.timer=setTimeout(()=>el.style.display="none",3500);
}

document.addEventListener("DOMContentLoaded",async()=>{
  $("#loginForm")?.addEventListener("submit",login);
  $("#logout")?.addEventListener("click",logout);
  document.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>switchPanel(b.dataset.panel,b)));
  $("#serviceForm")?.addEventListener("submit",saveService);
  $("#barberForm")?.addEventListener("submit",saveBarber);
  $("#galleryForm")?.addEventListener("submit",saveGalleryItem);
  $("#settingsForm")?.addEventListener("submit",saveSettings);

  const {data,error}=await sb.auth.getSession();
  if(error)console.error(error);
  session=data?.session||null;
  if(session){showAdmin();await renderAll();}
});

async function login(e){
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  const {data,error}=await sb.auth.signInWithPassword({
    email:String(f.get("email")||"").trim(),
    password:String(f.get("password")||"")
  });
  if(error){$("#loginError").textContent="E-mail ou senha inválidos.";return;}
  session=data.session;
  $("#loginError").textContent="";
  showAdmin();
  await renderAll();
}

function showAdmin(){$("#loginOverlay")?.classList.add("hidden");}
async function logout(){await sb.auth.signOut();location.reload();}

function switchPanel(id,btn){
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  $("#"+id)?.classList.add("active");
  document.querySelectorAll("[data-panel]").forEach(b=>b.classList.remove("active"));
  btn?.classList.add("active");
}

async function renderAll(){
  const r=await Promise.allSettled([
    renderKPIs(),renderBookings(),renderServicesAdmin(),renderBarbersAdmin(),renderGalleryAdmin(),loadSettings()
  ]);
  r.forEach(x=>{if(x.status==="rejected")console.error(x.reason)});
}

async function renderKPIs(){
  const today=JK.todayISO(),month=today.slice(0,7);
  const {data,error}=await sb.from("bookings").select("booking_date,price,status");
  if(error)return console.error(error);

  const valid=(data||[]).filter(x=>x.status!=="cancelado");
  $("#kpiToday").textContent=valid.filter(x=>x.booking_date===today).length;
  const monthList=valid.filter(x=>x.booking_date.startsWith(month));
  $("#kpiMonth").textContent=monthList.length;
  $("#kpiRevenue").textContent=JK.money(monthList.reduce((a,x)=>a+Number(x.price||0),0));

  const [svc,brb,gal]=await Promise.all([
    sb.from("services").select("*",{count:"exact",head:true}).eq("active",true),
    sb.from("barbers").select("*",{count:"exact",head:true}).eq("active",true),
    sb.from("gallery").select("*",{count:"exact",head:true}).eq("active",true)
  ]);
  $("#kpiServices").textContent=svc.count||0;
  $("#kpiBarbers").textContent=brb.count||0;
  if($("#kpiGallery"))$("#kpiGallery").textContent=gal.count||0;
}

async function renderBookings(){
  const root=$("#bookingRows");
  if(!root)return;
  root.innerHTML='<tr><td colspan="8">Carregando...</td></tr>';

  const {data,error}=await sb.from("bookings").select("*")
    .order("booking_date",{ascending:false})
    .order("booking_time",{ascending:false});

  if(error){root.innerHTML='<tr><td colspan="8">Erro ao carregar.</td></tr>';return;}
  if(!data?.length){root.innerHTML='<tr><td colspan="8"><div class="empty">Nenhum agendamento ainda.</div></td></tr>';return;}

  root.innerHTML=data.map(b=>`<tr>
    <td><strong>${JK.esc(b.client_name)}</strong><br><span class="muted">${JK.esc(b.phone)}</span></td>
    <td><strong>${JK.esc(b.barber_name||"—")}</strong></td>
    <td>${JK.esc(b.service_name)}</td>
    <td>${new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR")}<br>${String(b.booking_time).slice(0,5)}</td>
    <td>${JK.money(b.price)}</td>
    <td><span class="status ${b.status}">${b.status}</span></td>
    <td>${JK.esc(b.notes||"—")}</td>
    <td><div class="action-row">
      <button type="button" class="mini-btn" onclick="setStatus(${b.id},'concluido')">Concluir</button>
      <button type="button" class="mini-btn" onclick="setStatus(${b.id},'confirmado')">Confirmar</button>
      <button type="button" class="mini-btn" onclick="setStatus(${b.id},'cancelado')">Cancelar</button>
      <button type="button" class="mini-btn" onclick="deleteBooking(${b.id})">Excluir</button>
    </div></td>
  </tr>`).join("");
}

async function setStatus(id,status){
  const {error}=await sb.from("bookings").update({status}).eq("id",id);
  if(error)return adminToast("Erro ao atualizar: "+error.message,true);
  adminToast("Agendamento atualizado.");
  await renderAll();
}

async function deleteBooking(id){
  if(!confirm("Excluir este agendamento?"))return;
  const {error}=await sb.from("bookings").delete().eq("id",id);
  if(error)return adminToast("Erro ao excluir: "+error.message,true);
  adminToast("Agendamento excluído.");
  await renderAll();
}

async function renderServicesAdmin(){
  const root=$("#serviceAdminGrid");
  if(!root)return;
  const {data,error}=await sb.from("services").select("*").order("sort_order").order("id");
  if(error){root.innerHTML='<div class="empty">Erro ao carregar serviços.</div>';console.error(error);return;}
  services=data||[];
  root.innerHTML=services.map(s=>`<div class="service-admin">
    <img src="${s.image_url||'assets/corte-classico.svg'}" alt="">
    <strong>${JK.esc(s.name)}</strong>
    <p class="muted">${JK.esc(s.description||"")}</p>
    <div class="price-row"><span class="price">${JK.money(s.price)}</span><span>${s.duration_minutes} min</span></div>
    <div class="action-row" style="margin-top:14px">
      <button type="button" class="mini-btn" onclick="editService(${s.id})">Editar</button>
      <button type="button" class="mini-btn" onclick="toggleService(${s.id},${!s.active})">${s.active?"Desativar":"Ativar"}</button>
      <button type="button" class="mini-btn" onclick="removeService(${s.id})">Excluir</button>
    </div>
  </div>`).join("");
}

async function uploadImage(file){
  if(!(file instanceof File)||!file.size)return null;
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
  const path=`services/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const {error}=await sb.storage.from("service-images").upload(path,file,{upsert:false});
  if(error)throw error;
  return sb.storage.from("service-images").getPublicUrl(path).data.publicUrl;
}

async function saveService(e){
  e.preventDefault();
  const form=e.currentTarget;
  const btn=$("#serviceSaveBtn")||form.querySelector('button[type="submit"]');
  if(btn?.disabled)return;
  const original=btn?.textContent||"Salvar serviço";
  const f=new FormData(form);
  const id=String(f.get("id")||"").trim();
  const name=String(f.get("name")||"").trim();
  const price=Number(f.get("price"));
  const duration=Number(f.get("duration"));

  if(!name)return adminToast("Informe o nome do serviço.",true);
  if(!Number.isFinite(price)||price<0)return adminToast("Informe um preço válido.",true);
  if(!Number.isFinite(duration)||duration<10)return adminToast("Informe uma duração válida.",true);
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}

  try{
    let image=String(f.get("image_url")||"").trim()||null;
    const uploaded=await uploadImage(f.get("image_file"));
    if(uploaded)image=uploaded;
    const payload={name,price,duration_minutes:duration,description:String(f.get("description")||"").trim(),image_url:image,sort_order:Number(f.get("sort_order")||0)};
    const result=id
      ? await sb.from("services").update(payload).eq("id",Number(id)).select().single()
      : await sb.from("services").insert({...payload,active:true}).select().single();
    if(result.error)throw result.error;
    form.reset();$("#serviceId").value="";$("#serviceSort").value="0";
    adminToast(id?"Serviço atualizado com sucesso.":"Serviço salvo com sucesso.");
    await renderServicesAdmin();await renderKPIs();
  }catch(err){console.error(err);adminToast("Erro ao salvar: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

function editService(id){
  const s=services.find(x=>Number(x.id)===Number(id));
  if(!s)return adminToast("Serviço não encontrado.",true);
  $("#serviceId").value=s.id;$("#serviceName").value=s.name||"";$("#servicePrice").value=s.price??0;$("#serviceDuration").value=s.duration_minutes??30;$("#serviceDescription").value=s.description||"";$("#serviceImage").value=s.image_url||"";$("#serviceSort").value=s.sort_order??0;
  $("#serviceForm").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("#serviceName")?.focus(),250);
  adminToast("Serviço carregado para edição.");
}

async function toggleService(id,active){
  const {error}=await sb.from("services").update({active}).eq("id",id);
  if(error)return adminToast("Erro ao alterar serviço: "+error.message,true);
  adminToast(active?"Serviço ativado.":"Serviço desativado.");
  await renderServicesAdmin();await renderKPIs();
}

async function removeService(id){
  if(!confirm("Excluir este serviço?"))return;
  const {error}=await sb.from("services").delete().eq("id",id);
  if(error)return adminToast("Não foi possível excluir: "+error.message,true);
  adminToast("Serviço excluído.");
  await renderServicesAdmin();await renderKPIs();
}

async function renderBarbersAdmin(){
  const root=$("#barberAdminGrid");
  if(!root)return;
  const {data,error}=await sb.from("barbers").select("*").order("sort_order").order("id");
  if(error){root.innerHTML='<div class="empty">Erro ao carregar barbeiros.</div>';console.error(error);return;}
  barbers=data||[];
  if(!barbers.length){root.innerHTML='<div class="empty">Nenhum barbeiro cadastrado. Cadastre os 3 profissionais acima.</div>';return;}
  root.innerHTML=barbers.map(b=>`<div class="service-admin">
    <div style="width:76px;height:76px;border-radius:50%;display:grid;place-items:center;background:rgba(184,147,75,.12);border:1px solid rgba(184,147,75,.35);font-size:1.5rem;font-weight:800;margin-bottom:14px">✂</div>
    <strong>${JK.esc(b.name)}</strong>
    <p class="muted">${b.active?"Disponível para agendamentos":"Inativo no agendamento"}</p>
    <div class="action-row" style="margin-top:14px">
      <button type="button" class="mini-btn" onclick="editBarber(${b.id})">Editar</button>
      <button type="button" class="mini-btn" onclick="toggleBarber(${b.id},${!b.active})">${b.active?"Desativar":"Ativar"}</button>
      <button type="button" class="mini-btn" onclick="removeBarber(${b.id})">Excluir</button>
    </div>
  </div>`).join("");
}

async function saveBarber(e){
  e.preventDefault();
  const form=e.currentTarget;
  const btn=$("#barberSaveBtn");
  if(btn?.disabled)return;
  const original=btn?.textContent||"Salvar barbeiro";
  const f=new FormData(form);
  const id=String(f.get("id")||"").trim();
  const name=String(f.get("name")||"").trim();
  const sort_order=Number(f.get("sort_order")||0);
  if(name.length<2)return adminToast("Informe o nome do barbeiro.",true);
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}
  try{
    const result=id
      ? await sb.from("barbers").update({name,sort_order}).eq("id",Number(id)).select().single()
      : await sb.from("barbers").insert({name,sort_order,active:true}).select().single();
    if(result.error)throw result.error;
    form.reset();$("#barberId").value="";$("#barberSort").value="0";
    adminToast(id?"Barbeiro atualizado com sucesso.":"Barbeiro cadastrado com sucesso.");
    await renderBarbersAdmin();await renderKPIs();
  }catch(err){console.error(err);adminToast("Erro ao salvar barbeiro: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

function editBarber(id){
  const b=barbers.find(x=>Number(x.id)===Number(id));
  if(!b)return adminToast("Barbeiro não encontrado.",true);
  $("#barberId").value=b.id;$("#barberName").value=b.name||"";$("#barberSort").value=b.sort_order??0;
  $("#barberForm").scrollIntoView({behavior:"smooth",block:"start"});
  setTimeout(()=>$("#barberName")?.focus(),250);
  adminToast("Barbeiro carregado para edição.");
}

async function toggleBarber(id,active){
  const {error}=await sb.from("barbers").update({active}).eq("id",id);
  if(error)return adminToast("Erro ao alterar barbeiro: "+error.message,true);
  adminToast(active?"Barbeiro ativado.":"Barbeiro desativado.");
  await renderBarbersAdmin();await renderKPIs();
}

async function removeBarber(id){
  if(!confirm("Excluir este barbeiro? Se ele já tiver agendamentos, prefira desativá-lo."))return;
  const {error}=await sb.from("barbers").delete().eq("id",id);
  if(error)return adminToast("Não foi possível excluir. Se houver agendamentos, desative o barbeiro em vez de excluir.",true);
  adminToast("Barbeiro excluído.");
  await renderBarbersAdmin();await renderKPIs();
}


async function renderGalleryAdmin(){
  const root=$("#galleryAdminGrid"); if(!root)return;
  root.innerHTML='<div class="empty">Carregando galeria...</div>';
  const {data,error}=await sb.from("gallery").select("*").order("sort_order").order("id",{ascending:false});
  if(error){root.innerHTML='<div class="empty">Erro ao carregar a galeria.</div>';console.error(error);return;}
  galleryItems=data||[];
  if(!galleryItems.length){root.innerHTML='<div class="empty">Nenhuma foto publicada ainda. Adicione os primeiros trabalhos acima.</div>';return;}
  root.innerHTML=galleryItems.map(g=>`<article class="gallery-admin-card">
    <img src="${JK.esc(g.image_url)}" alt="${JK.esc(g.title||'Trabalho da galeria')}">
    <div class="gallery-admin-body"><strong>${JK.esc(g.title||'Sem título')}</strong><p class="muted">${JK.esc(g.caption||'Sem legenda')}</p><span class="gallery-state ${g.active?'on':'off'}">${g.active?'Publicado':'Oculto'}</span>
    <div class="action-row"><button type="button" class="mini-btn" onclick="editGalleryItem(${g.id})">Editar</button><button type="button" class="mini-btn" onclick="toggleGalleryItem(${g.id},${!g.active})">${g.active?'Ocultar':'Publicar'}</button><button type="button" class="mini-btn" onclick="removeGalleryItem(${g.id})">Excluir</button></div></div>
  </article>`).join("");
}

async function uploadGalleryImage(file){
  if(!(file instanceof File)||!file.size)return null;
  if(!file.type.startsWith("image/"))throw new Error("Selecione apenas arquivos de imagem.");
  if(file.size>12*1024*1024)throw new Error("Cada foto deve ter no máximo 12 MB.");
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
  const path=`works/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext||'jpg'}`;
  const {error}=await sb.storage.from("gallery-images").upload(path,file,{upsert:false,cacheControl:"3600"});
  if(error)throw error;
  return sb.storage.from("gallery-images").getPublicUrl(path).data.publicUrl;
}

async function saveGalleryItem(e){
  e.preventDefault();
  const form=e.currentTarget,btn=$("#gallerySaveBtn");
  if(btn?.disabled)return;
  const original=btn?.textContent||"Publicar na galeria";
  const f=new FormData(form), id=String(f.get("id")||"").trim();
  const title=String(f.get("title")||"").trim(), caption=String(f.get("caption")||"").trim(), sort_order=Number(f.get("sort_order")||0);
  const files=Array.from($("#galleryFiles")?.files||[]);
  if(!id && !files.length)return adminToast("Selecione pelo menos uma foto.",true);
  if(btn){btn.disabled=true;btn.textContent=files.length>1?`Enviando ${files.length} fotos...`:"Salvando...";}
  try{
    if(id){
      let image_url=String(f.get("current_image")||"");
      if(files[0])image_url=await uploadGalleryImage(files[0]);
      const {error}=await sb.from("gallery").update({title,caption,sort_order,image_url}).eq("id",Number(id));
      if(error)throw error;
      adminToast("Foto atualizada com sucesso.");
    }else{
      const rows=[];
      for(let i=0;i<files.length;i++){
        if(btn)btn.textContent=`Enviando ${i+1} de ${files.length}...`;
        const image_url=await uploadGalleryImage(files[i]);
        rows.push({title,caption,sort_order:sort_order+i,image_url,active:true});
      }
      const {error}=await sb.from("gallery").insert(rows);
      if(error)throw error;
      adminToast(files.length>1?`${files.length} fotos publicadas com sucesso.`:"Foto publicada com sucesso.");
    }
    form.reset();$("#galleryId").value="";$("#galleryCurrentImage").value="";$("#gallerySort").value="0";
    await renderGalleryAdmin();await renderKPIs();
  }catch(err){console.error(err);adminToast("Erro na galeria: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

function editGalleryItem(id){
  const g=galleryItems.find(x=>Number(x.id)===Number(id)); if(!g)return;
  $("#galleryId").value=g.id;$("#galleryCurrentImage").value=g.image_url||"";$("#galleryTitle").value=g.title||"";$("#galleryCaption").value=g.caption||"";$("#gallerySort").value=g.sort_order??0;$("#galleryFiles").value="";
  $("#galleryForm").scrollIntoView({behavior:"smooth",block:"start"}); adminToast("Foto carregada para edição.");
}
async function toggleGalleryItem(id,active){const {error}=await sb.from("gallery").update({active}).eq("id",id);if(error)return adminToast("Erro ao alterar foto: "+error.message,true);adminToast(active?"Foto publicada.":"Foto ocultada.");await renderGalleryAdmin();await renderKPIs();}
async function removeGalleryItem(id){if(!confirm("Excluir esta foto da galeria?"))return;const {error}=await sb.from("gallery").delete().eq("id",id);if(error)return adminToast("Erro ao excluir: "+error.message,true);adminToast("Foto excluída da galeria.");await renderGalleryAdmin();await renderKPIs();}

async function loadSettings(){
  const {data,error}=await sb.from("settings").select("*").eq("id",1).single();
  if(error)return console.error(error);
  $("#businessName").value=data.business_name||"";$("#phone").value=data.phone||"";$("#instagram").value=data.instagram||"";$("#address").value=data.address||"";$("#openTime").value=String(data.open_time||"08:00").slice(0,5);$("#closeTime").value=String(data.close_time||"19:00").slice(0,5);$("#interval").value=data.slot_interval_minutes||30;$("#workDays").value=(data.work_days||[]).join(",");$("#blockedDates").value=(data.blocked_dates||[]).join(",");
}

async function saveSettings(e){
  e.preventDefault();
  const form=e.currentTarget;
  const btn=form.querySelector('button[type="submit"]');
  const original=btn?.textContent||"Salvar configurações";
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}
  try{
    const f=new FormData(form);
    const payload={business_name:String(f.get("businessName")||"").trim(),phone:String(f.get("phone")||"").trim(),instagram:String(f.get("instagram")||"").trim(),address:String(f.get("address")||"").trim(),open_time:f.get("openTime"),close_time:f.get("closeTime"),slot_interval_minutes:Number(f.get("interval")),work_days:String(f.get("workDays")||"").split(",").map(x=>Number(x.trim())).filter(x=>x>=0&&x<=6),blocked_dates:String(f.get("blockedDates")||"").split(",").map(x=>x.trim()).filter(Boolean)};
    const {error}=await sb.from("settings").update(payload).eq("id",1);
    if(error)throw error;
    adminToast("Configurações salvas com sucesso.");
  }catch(err){adminToast("Erro ao salvar configurações: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

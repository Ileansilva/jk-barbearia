let session=null, services=[], barbers=[], galleryItems=[], financeBookings=[], currentProfileBarberId=null;
let serviceCropState={img:null,file:null,zoom:100,x:0,y:0};
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
  $("#serviceImageFile")?.addEventListener("change",loadServiceCropImage);
  $("#serviceCropZoom")?.addEventListener("input",updateServiceCropFromControls);
  $("#serviceCropX")?.addEventListener("input",updateServiceCropFromControls);
  $("#serviceCropY")?.addEventListener("input",updateServiceCropFromControls);
  $("#serviceCropReset")?.addEventListener("click",resetServiceCropControls);
  $("#barberForm")?.addEventListener("submit",saveBarber);
  $("#galleryForm")?.addEventListener("submit",saveGalleryItem);
  $("#settingsForm")?.addEventListener("submit",saveSettings);
  $("#financeBarberSelect")?.addEventListener("change",()=>renderFinance());
  $("#financeDateFilter")?.addEventListener("change",()=>{if($("#financeDateFilter").value)$("#financeMonthFilter").value="";renderFinance();});
  $("#financeMonthFilter")?.addEventListener("change",()=>{if($("#financeMonthFilter").value)$("#financeDateFilter").value="";renderFinance();});
  $("#financeYearFilter")?.addEventListener("change",()=>renderFinance());
  $("#financePeriodFilter")?.addEventListener("change",()=>renderFinance());
  $("#financeTodayFilterBtn")?.addEventListener("click",()=>{$("#financeDateFilter").value=localDateISO();$("#financeMonthFilter").value="";renderFinance();});
  $("#financeClearDateBtn")?.addEventListener("click",()=>{$("#financeDateFilter").value="";renderFinance();});
  $("#barberPhotoFile")?.addEventListener("change",previewBarberPhoto);
  $("#profileDate")?.addEventListener("change",()=>renderBarberProfileDay());
  $("#profileTodayBtn")?.addEventListener("click",()=>{const d=$("#profileDate"); if(d){d.value=localDateISO(); renderBarberProfileDay();}});

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
    renderKPIs(),renderBookings(),renderServicesAdmin(),renderBarbersAdmin(),renderFinance(),renderGalleryAdmin(),loadSettings()
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
    <td>${JK.money(b.price)}${b.status==="concluido"&&b.barber_id?`<br><span class="muted">Comissão: ${JK.money(commissionForBooking(b))}</span>`:""}</td>
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
  let payload={status,completed_at:status==="concluido"?new Date().toISOString():null};
  if(status==="concluido"){
    const {data:b,error:loadError}=await sb.from("bookings").select("id,price,barber_id,barber_commission_percent,barber_commission_amount").eq("id",id).single();
    if(loadError)return adminToast("Erro ao carregar agendamento: "+loadError.message,true);
    if(b?.barber_id&&(b.barber_commission_percent===null||b.barber_commission_amount===null)){
      const cached=barbers.find(x=>Number(x.id)===Number(b.barber_id));
      const br=cached || (await sb.from("barbers").select("*").eq("id",b.barber_id).single()).data;
      const pct=Number(br?.commission_percent||0);
      payload.barber_commission_percent=pct;
      payload.barber_commission_amount=Number((Number(b.price||0)*pct/100).toFixed(2));
    }
  }
  const {error}=await sb.from("bookings").update(payload).eq("id",id);
  if(error)return adminToast("Erro ao atualizar: "+error.message,true);
  adminToast(status==="concluido"?"Corte concluído e lançado no financeiro.":"Agendamento atualizado.");
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
  root.innerHTML=services.map(s=>`<article class="service-admin service-admin-item">
    <div class="service-admin-image-wrap">
      <img class="service-admin-image" src="${s.image_url||'assets/corte-classico.svg'}" alt="${JK.esc(s.name||"Serviço")}">
      <span class="service-admin-duration">${Number(s.duration_minutes||0)} min</span>
    </div>
    <div class="service-admin-content">
      <div class="service-admin-heading"><strong>${JK.esc(s.name)}</strong><span class="price">${JK.money(s.price)}</span></div>
      <p class="muted">${JK.esc(s.description||"Sem descrição")}</p>
      <div class="service-admin-status"><i class="${s.active?"on":"off"}"></i>${s.active?"Serviço ativo":"Serviço inativo"}</div>
      <div class="action-row">
        <button type="button" class="mini-btn primary-mini" onclick="editService(${s.id})">Editar</button>
        <button type="button" class="mini-btn" onclick="toggleService(${s.id},${!s.active})">${s.active?"Desativar":"Ativar"}</button>
        <button type="button" class="mini-btn danger-mini" onclick="removeService(${s.id})">Excluir</button>
      </div>
    </div>
  </article>`).join("");
}

function loadServiceCropImage(e){
  const file=e.target.files?.[0];
  if(!file){
    serviceCropState={img:null,file:null,zoom:100,x:0,y:0};
    $("#serviceCropEditor").hidden=true;
    return;
  }
  if(file.size>10*1024*1024){
    e.target.value="";
    return adminToast("A imagem deve ter no máximo 10 MB.",true);
  }
  const img=new Image();
  img.onload=()=>{
    serviceCropState={img,file,zoom:100,x:0,y:0};
    $("#serviceCropEditor").hidden=false;
    resetServiceCropControls();
    URL.revokeObjectURL(img.src);
  };
  img.onerror=()=>{
    e.target.value="";
    adminToast("Não foi possível abrir essa imagem.",true);
  };
  img.src=URL.createObjectURL(file);
}
function updateServiceCropFromControls(){
  serviceCropState.zoom=Number($("#serviceCropZoom")?.value||100);
  serviceCropState.x=Number($("#serviceCropX")?.value||0);
  serviceCropState.y=Number($("#serviceCropY")?.value||0);
  $("#serviceCropZoomValue").textContent=`${serviceCropState.zoom}%`;
  $("#serviceCropXValue").textContent=serviceCropState.x;
  $("#serviceCropYValue").textContent=serviceCropState.y;
  const status=$("#serviceCropStatus");
  if(status)status.textContent="✓ Ajuste aplicado na prévia — será salvo exatamente neste enquadramento.";
  drawServiceCropPreview();
}
function resetServiceCropControls(){
  const z=$("#serviceCropZoom"),x=$("#serviceCropX"),y=$("#serviceCropY");
  if(z)z.value="100"; if(x)x.value="0"; if(y)y.value="0";
  updateServiceCropFromControls();
}
function drawServiceCrop(canvas,width,height){
  const img=serviceCropState.img;
  if(!img||!canvas)return;
  const ctx=canvas.getContext("2d");
  canvas.width=width; canvas.height=height;
  ctx.clearRect(0,0,width,height);

  const base=Math.max(width/img.naturalWidth,height/img.naturalHeight);
  const scale=base*(serviceCropState.zoom/100);
  const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
  const overflowX=Math.max(0,dw-width);
  const overflowY=Math.max(0,dh-height);

  // -100 = left/top edge, 0 = center, +100 = right/bottom edge
  const dx=(width-dw)/2 - (serviceCropState.x/100)*(overflowX/2);
  const dy=(height-dh)/2 - (serviceCropState.y/100)*(overflowY/2);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality="high";
  ctx.drawImage(img,dx,dy,dw,dh);
}
function drawServiceCropPreview(){
  const canvas=$("#serviceCropCanvas");
  if(!canvas||!serviceCropState.img)return;
  drawServiceCrop(canvas,800,500);
}
async function buildCroppedServiceFile(){
  if(!serviceCropState.img||!serviceCropState.file)return null;
  const canvas=document.createElement("canvas");
  drawServiceCrop(canvas,1200,750);
  const blob=await new Promise((resolve,reject)=>{
    canvas.toBlob(b=>b?resolve(b):reject(new Error("Não foi possível processar a imagem.")),"image/jpeg",0.9);
  });
  return new File([blob],`servico-${Date.now()}.jpg`,{type:"image/jpeg"});
}
function clearServiceCrop(){
  serviceCropState={img:null,file:null,zoom:100,x:0,y:0};
  const input=$("#serviceImageFile"); if(input)input.value="";
  const editor=$("#serviceCropEditor"); if(editor)editor.hidden=true;
  const z=$("#serviceCropZoom"),x=$("#serviceCropX"),y=$("#serviceCropY");
  if(z)z.value="100"; if(x)x.value="0"; if(y)y.value="0";
  const status=$("#serviceCropStatus");
  if(status)status.textContent="✓ O que aparece dentro do quadro será salvo exatamente assim.";
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
    const croppedFile=await buildCroppedServiceFile();
    const uploaded=await uploadImage(croppedFile||f.get("image_file"));
    if(uploaded)image=uploaded;
    const payload={name,price,duration_minutes:duration,description:String(f.get("description")||"").trim(),image_url:image,sort_order:Number(f.get("sort_order")||0)};
    const result=id
      ? await sb.from("services").update(payload).eq("id",Number(id)).select().single()
      : await sb.from("services").insert({...payload,active:true}).select().single();
    if(result.error)throw result.error;

    // Confirma visualmente que a imagem processada foi realmente salva.
    if(uploaded && result.data?.image_url!==uploaded){
      const retry=await sb.from("services").update({image_url:uploaded}).eq("id",result.data.id).select().single();
      if(retry.error)throw retry.error;
    }

    form.reset();
    $("#serviceId").value="";
    $("#serviceSort").value="0";
    $("#serviceImage").value="";
    clearServiceCrop();
    adminToast(uploaded
      ? "Serviço salvo. A imagem foi recortada e atualizada com sucesso."
      : (id?"Serviço atualizado com sucesso.":"Serviço salvo com sucesso."));
    await renderServicesAdmin();
    await renderKPIs();
  }catch(err){console.error(err);adminToast("Erro ao salvar: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

function editService(id){
  const s=services.find(x=>Number(x.id)===Number(id));
  if(!s)return adminToast("Serviço não encontrado.",true);
  $("#serviceId").value=s.id;$("#serviceName").value=s.name||"";$("#servicePrice").value=s.price??0;$("#serviceDuration").value=s.duration_minutes??30;$("#serviceDescription").value=s.description||"";$("#serviceImage").value=s.image_url||"";$("#serviceSort").value=s.sort_order??0;clearServiceCrop();
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
  syncFinanceBarberSelect();
  if(!barbers.length){root.innerHTML='<div class="empty">Nenhum barbeiro cadastrado. Cadastre os profissionais acima.</div>';return;}
  root.innerHTML=barbers.map(b=>`<div class="service-admin barber-admin-card">
    <button type="button" class="barber-card-profile" onclick="openBarberProfile(${b.id})" title="Abrir perfil de ${JK.esc(b.name)}">
      ${b.photo_url?`<img class="barber-card-photo" src="${JK.esc(b.photo_url)}" alt="Foto de ${JK.esc(b.name)}">`:`<span class="barber-avatar">✂</span>`}
      <span class="barber-card-info">
        <strong>${JK.esc(b.name)}</strong>
        <small>${b.active?"Disponível para agendamentos":"Inativo no agendamento"}</small>
      </span>
    </button>
    <div class="barber-commission-badge"><span>Comissão</span><strong>${Number(b.commission_percent||0).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:2})}%</strong></div>
    <div class="action-row" style="margin-top:14px">
      <button type="button" class="mini-btn" onclick="openBarberProfile(${b.id})">Abrir perfil</button>
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
  const commission_percent=Number(f.get("commission_percent"));
  let photo_url=String(f.get("photo_url")||"").trim()||null;
  const photoFile=f.get("photo_file");
  if(name.length<2)return adminToast("Informe o nome do barbeiro.",true);
  if(!Number.isFinite(commission_percent)||commission_percent<0||commission_percent>100)return adminToast("Informe uma comissão entre 0% e 100%.",true);
  if(photoFile?.size>5*1024*1024)return adminToast("A foto do barbeiro deve ter no máximo 5 MB.",true);
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}
  try{
    if(photoFile?.size){
      const ext=(photoFile.name.split(".").pop()||"jpg").toLowerCase();
      const path=`barbers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const up=await sb.storage.from("barber-photos").upload(path,photoFile,{cacheControl:"3600",upsert:false});
      if(up.error)throw up.error;
      photo_url=sb.storage.from("barber-photos").getPublicUrl(path).data.publicUrl;
    }

    const payload={name,sort_order,commission_percent,photo_url};
    const result=id
      ? await sb.from("barbers").update(payload).eq("id",Number(id)).select().single()
      : await sb.from("barbers").insert({...payload,active:true}).select().single();
    if(result.error)throw result.error;

    if(id){
      const {data:pending,error:pendingError}=await sb.from("bookings")
        .select("id,price,status")
        .eq("barber_id",Number(id))
        .neq("status","concluido")
        .neq("status","cancelado");
      if(pendingError)throw pendingError;
      for(const b of pending||[]){
        const amount=Number((Number(b.price||0)*commission_percent/100).toFixed(2));
        const {error:updateError}=await sb.from("bookings").update({
          barber_commission_percent:commission_percent,
          barber_commission_amount:amount
        }).eq("id",b.id);
        if(updateError)throw updateError;
      }
    }

    form.reset();
    $("#barberId").value="";
    $("#barberSort").value="0";
    $("#barberCommission").value="0";
    $("#barberPhotoUrl").value="";
    resetBarberPhotoPreview();
    adminToast(id?"Barbeiro, foto e comissão atualizados.":"Barbeiro cadastrado com sucesso.");
    await renderBarbersAdmin();await renderFinance();await renderKPIs();
  }catch(err){console.error(err);adminToast("Erro ao salvar barbeiro: "+(err?.message||"erro desconhecido"),true);}
  finally{if(btn){btn.disabled=false;btn.textContent=original;}}
}

function previewBarberPhoto(e){
  const file=e.target.files?.[0];
  if(!file)return;
  const preview=$("#barberPhotoPreview");
  const reader=new FileReader();
  reader.onload=()=>{preview.innerHTML=`<img src="${reader.result}" alt="Prévia da foto">`;};
  reader.readAsDataURL(file);
}
function resetBarberPhotoPreview(url=""){
  const preview=$("#barberPhotoPreview"); if(!preview)return;
  preview.innerHTML=url?`<img src="${JK.esc(url)}" alt="Foto do barbeiro">`:"<span>📷</span>";
}

function editBarber(id){
  const b=barbers.find(x=>Number(x.id)===Number(id));
  if(!b)return adminToast("Barbeiro não encontrado.",true);
  $("#barberId").value=b.id;$("#barberName").value=b.name||"";$("#barberCommission").value=Number(b.commission_percent||0);$("#barberSort").value=b.sort_order??0;$("#barberPhotoUrl").value=b.photo_url||"";resetBarberPhotoPreview(b.photo_url||"");
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



function saoPauloDateISO(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const map=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function localDateISO(d=new Date()){return saoPauloDateISO(d);}
function weekStartISO(){
  const today=localDateISO();
  const [y,m,day]=today.split("-").map(Number);
  const d=new Date(Date.UTC(y,m-1,day,12));
  const dow=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"short"}).format(d);
  const idx={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[dow];
  const diff=idx===0?-6:1-idx;
  d.setUTCDate(d.getUTCDate()+diff);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function monthStartISO(){return localDateISO().slice(0,7)+"-01";}
function yearStartISO(){return localDateISO().slice(0,4)+"-01-01";}
function completionDateISO(b){return b.completed_at?saoPauloDateISO(b.completed_at):b.booking_date;}
function completionDateTimeLabel(b){
  if(b.completed_at){
    const d=new Date(b.completed_at);
    const date=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric"}).format(d);
    const time=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
    return `${date}<br><span class="muted">Concluído às ${time}</span>`;
  }
  return `${new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR")}<br><span class="muted">${String(b.booking_time||"").slice(0,5)}</span>`;
}
function commissionForBooking(b){
  if(b.barber_commission_amount!==null&&b.barber_commission_amount!==undefined)return Number(b.barber_commission_amount||0);
  const pct=b.barber_commission_percent!==null&&b.barber_commission_percent!==undefined
    ? Number(b.barber_commission_percent||0)
    : Number(barbers.find(x=>Number(x.id)===Number(b.barber_id))?.commission_percent||0);
  return Number((Number(b.price||0)*pct/100).toFixed(2));
}
function percentForBooking(b){
  if(b.barber_commission_percent!==null&&b.barber_commission_percent!==undefined)return Number(b.barber_commission_percent||0);
  return Number(barbers.find(x=>Number(x.id)===Number(b.barber_id))?.commission_percent||0);
}
function financeStats(list){
  const gross=list.reduce((a,b)=>a+Number(b.price||0),0);
  const commission=list.reduce((a,b)=>a+commissionForBooking(b),0);
  return {cuts:list.length,gross,commission,net:gross-commission};
}
function setFinancePeriod(prefix,stats){
  const cap=prefix[0].toUpperCase()+prefix.slice(1);
  const cuts=$(`#fin${cap}Cuts`),gross=$(`#fin${cap}Gross`),commission=$(`#fin${cap}Commission`),net=$(`#fin${cap}Net`);
  if(cuts)cuts.textContent=`${stats.cuts} ${stats.cuts===1?"corte":"cortes"}`;
  if(gross)gross.textContent=JK.money(stats.gross);
  if(commission)commission.textContent=JK.money(stats.commission);
  if(net)net.textContent=JK.money(stats.net);
}
function syncFinanceBarberSelect(){
  const sel=$("#financeBarberSelect"); if(!sel)return;
  const current=sel.value;
  sel.innerHTML='<option value="">Todos os barbeiros</option>'+barbers.map(b=>`<option value="${b.id}">${JK.esc(b.name)} — ${Number(b.commission_percent||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}%</option>`).join("");
  if([...sel.options].some(o=>o.value===current))sel.value=current;
}
async function openBarberFinance(id){
  const financeButton=document.querySelector('[data-panel="finance"]');
  switchPanel("finance",financeButton);
  syncFinanceBarberSelect();
  const sel=$("#financeBarberSelect"); if(sel)sel.value=String(id);
  await renderFinance();
  window.scrollTo({top:0,behavior:"smooth"});
}

function backToBarbers(){
  const btn=document.querySelector('[data-panel="barbers"]');
  switchPanel("barbers",btn);
}
async function openBarberProfile(id){
  currentProfileBarberId=Number(id);
  const barber=barbers.find(b=>Number(b.id)===Number(id)) || (await sb.from("barbers").select("*").eq("id",id).single()).data;
  if(!barber)return adminToast("Barbeiro não encontrado.",true);
  if(!barbers.find(b=>Number(b.id)===Number(id)))barbers.push(barber);

  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  $("#barberProfile")?.classList.add("active");
  document.querySelectorAll(".side-nav button").forEach(b=>b.classList.remove("active"));

  $("#profileBarberName").textContent=barber.name||"Barbeiro";
  $("#profileBarberCommission").textContent=`Comissão atual: ${Number(barber.commission_percent||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}%`;
  const photo=$("#profileBarberPhoto");
  photo.innerHTML=barber.photo_url?`<img src="${JK.esc(barber.photo_url)}" alt="Foto de ${JK.esc(barber.name)}">`:"<span>✂</span>";
  const date=$("#profileDate");
  if(date&&!date.value)date.value=localDateISO();
  await renderBarberProfileDay();
  window.scrollTo({top:0,behavior:"smooth"});
}
async function loadProfileBookings(){
  if(!currentProfileBarberId)return [];
  const {data,error}=await sb.from("bookings")
    .select("id,client_name,booking_date,booking_time,completed_at,service_name,price,status,barber_id,barber_name,barber_commission_percent,barber_commission_amount")
    .eq("barber_id",currentProfileBarberId)
    .eq("status","concluido")
    .order("completed_at",{ascending:false});
  if(error){console.error(error);adminToast("Erro ao carregar o perfil financeiro.",true);return [];}
  return data||[];
}
async function renderBarberProfileDay(){
  if(!currentProfileBarberId)return;
  const barber=barbers.find(b=>Number(b.id)===Number(currentProfileBarberId));
  const selectedDate=$("#profileDate")?.value||localDateISO();
  const all=await loadProfileBookings();
  const dayList=all.filter(b=>completionDateISO(b)===selectedDate);
  const dayStats=financeStats(dayList);

  $("#profileCuts").textContent=dayStats.cuts;
  $("#profileGross").textContent=JK.money(dayStats.gross);
  $("#profileCommission").textContent=JK.money(dayStats.commission);
  $("#profileNet").textContent=JK.money(dayStats.net);
  $("#profileDayTitle").textContent=`Cortes de ${new Date(selectedDate+"T12:00:00").toLocaleDateString("pt-BR")}`;

  const rows=$("#profileDayRows");
  if(!dayList.length){
    rows.innerHTML='<tr><td colspan="7"><div class="empty">Nenhum corte concluído por este barbeiro nesta data.</div></td></tr>';
  }else{
    rows.innerHTML=dayList.map(b=>{
      const price=Number(b.price||0),commission=commissionForBooking(b),pct=percentForBooking(b);
      const time=b.completed_at
        ? new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(b.completed_at))
        : String(b.booking_time||"").slice(0,5);
      return `<tr><td>${time}</td><td>${JK.esc(b.client_name||"—")}</td><td>${JK.esc(b.service_name||"—")}</td><td>${JK.money(price)}</td><td>${pct.toLocaleString("pt-BR",{maximumFractionDigits:2})}%</td><td><strong>${JK.money(commission)}</strong></td><td>${JK.money(price-commission)}</td></tr>`;
    }).join("");
  }

  const monthPrefix=selectedDate.slice(0,7);
  const yearPrefix=selectedDate.slice(0,4);
  const monthStats=financeStats(all.filter(b=>completionDateISO(b).startsWith(monthPrefix)));
  const yearStats=financeStats(all.filter(b=>completionDateISO(b).startsWith(yearPrefix)));

  $("#profileMonthCuts").textContent=monthStats.cuts;
  $("#profileMonthGross").textContent=JK.money(monthStats.gross);
  $("#profileMonthCommission").textContent=JK.money(monthStats.commission);
  $("#profileYearCuts").textContent=yearStats.cuts;
  $("#profileYearGross").textContent=JK.money(yearStats.gross);
  $("#profileYearCommission").textContent=JK.money(yearStats.commission);
}


function ensureFinanceYearOptions(){
  const sel=$("#financeYearFilter"); if(!sel)return;
  const current=sel.value;
  const currentYear=Number(localDateISO().slice(0,4));
  const years=new Set([currentYear]);
  financeBookings.forEach(b=>{
    const y=Number(completionDateISO(b).slice(0,4));
    if(y)years.add(y);
  });
  sel.innerHTML=[...years].sort((a,b)=>b-a).map(y=>`<option value="${y}">${y}</option>`).join("");
  sel.value=current&&[...sel.options].some(o=>o.value===current)?current:String(currentYear);
}
function monthLastDate(monthValue){
  const [y,m]=monthValue.split("-").map(Number);
  return `${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
}
function periodRange(year,period){
  const y=String(year);
  const map={
    year:[`${y}-01-01`,`${y}-12-31`,"Ano inteiro"],
    semester1:[`${y}-01-01`,`${y}-06-30`,"1º semestre (jan–jun)"],
    semester2:[`${y}-07-01`,`${y}-12-31`,"2º semestre (jul–dez)"],
    quarter1:[`${y}-01-01`,`${y}-03-31`,"1º trimestre (jan–mar)"],
    quarter2:[`${y}-04-01`,`${y}-06-30`,"2º trimestre (abr–jun)"],
    quarter3:[`${y}-07-01`,`${y}-09-30`,"3º trimestre (jul–set)"],
    quarter4:[`${y}-10-01`,`${y}-12-31`,"4º trimestre (out–dez)"]
  };
  return map[period]||map.year;
}
function dateRangeFilter(list,from,to){
  return list.filter(b=>{const d=completionDateISO(b);return d>=from&&d<=to;});
}
function customFinanceSelection(base){
  const date=$("#financeDateFilter")?.value||"";
  const month=$("#financeMonthFilter")?.value||"";
  const year=$("#financeYearFilter")?.value||localDateISO().slice(0,4);
  const period=$("#financePeriodFilter")?.value||"year";
  if(date)return {list:base.filter(b=>completionDateISO(b)===date),title:`Dia ${new Date(date+"T12:00:00").toLocaleDateString("pt-BR")}`,kind:"day",date};
  if(month){
    const from=`${month}-01`,to=monthLastDate(month);
    const label=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(from+"T12:00:00"));
    return {list:dateRangeFilter(base,from,to),title:label[0].toUpperCase()+label.slice(1),kind:"month",month,from,to};
  }
  const [from,to,label]=periodRange(year,period);
  return {list:dateRangeFilter(base,from,to),title:`${label} de ${year}`,kind:"period",from,to,year,period};
}
function renderFinanceCustom(stats,title){
  $("#financeCustomTitle").textContent=title;
  $("#financeCustomCuts").textContent=stats.cuts;
  $("#financeCustomGross").textContent=JK.money(stats.gross);
  $("#financeCustomCommission").textContent=JK.money(stats.commission);
  $("#financeCustomNet").textContent=JK.money(stats.net);
}
function mondayOfDateISO(dateISO){
  const [y,m,d]=dateISO.split("-").map(Number);
  const dt=new Date(Date.UTC(y,m-1,d,12));
  const dow=dt.getUTCDay();
  const diff=dow===0?-6:1-dow;
  dt.setUTCDate(dt.getUTCDate()+diff);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}
function addDaysISO(dateISO,days){
  const [y,m,d]=dateISO.split("-").map(Number);
  const dt=new Date(Date.UTC(y,m-1,d,12));
  dt.setUTCDate(dt.getUTCDate()+days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}
function renderMonthWeeks(base,monthValue){
  const root=$("#financeWeeksGrid"),card=$("#financeWeeksCard");
  if(!root||!card)return;
  if(!monthValue){
    card.style.display="none";
    return;
  }
  card.style.display="";
  const first=`${monthValue}-01`,last=monthLastDate(monthValue);
  const label=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(first+"T12:00:00"));
  $("#financeWeeksTitle").textContent=`Semanas de ${label[0].toUpperCase()+label.slice(1)}`;

  let cursor=mondayOfDateISO(first);
  const weeks=[];
  let index=1;
  while(cursor<=last){
    const end=addDaysISO(cursor,6);
    const from=cursor<first?first:cursor;
    const to=end>last?last:end;
    const list=dateRangeFilter(base,from,to);
    weeks.push({index,from,to,stats:financeStats(list)});
    cursor=addDaysISO(cursor,7);
    index++;
  }
  root.innerHTML=weeks.map(w=>`<article class="finance-week-card">
    <div class="finance-week-title"><strong>Semana ${w.index}</strong><span>${new Date(w.from+"T12:00:00").toLocaleDateString("pt-BR")} a ${new Date(w.to+"T12:00:00").toLocaleDateString("pt-BR")}</span></div>
    <div class="finance-week-stats">
      <div><small>Cortes</small><b>${w.stats.cuts}</b></div>
      <div><small>Faturado</small><b>${JK.money(w.stats.gross)}</b></div>
      <div><small>Comissões</small><b>${JK.money(w.stats.commission)}</b></div>
      <div><small>Líquido</small><b>${JK.money(w.stats.net)}</b></div>
    </div>
  </article>`).join("");
}
function financeBarberStatsForList(list,barberId){
  return financeStats(list.filter(b=>Number(b.barber_id)===Number(barberId)));
}

async function renderFinance(){
  if(!$("#financeBarberCards"))return;

  if(!barbers.length){
    const br=await sb.from("barbers").select("*").order("sort_order").order("id");
    if(br.error){console.error(br.error);$("#financeBarberCards").innerHTML='<div class="empty">Erro ao carregar barbeiros.</div>';return;}
    barbers=br.data||[];
  }
  syncFinanceBarberSelect();

  const {data,error}=await sb.from("bookings")
    .select("id,client_name,booking_date,booking_time,completed_at,service_name,price,status,barber_id,barber_name,barber_commission_percent,barber_commission_amount")
    .eq("status","concluido")
    .order("completed_at",{ascending:false});
  if(error){
    console.error(error);
    $("#financeBarberCards").innerHTML='<div class="empty">Erro ao carregar dados financeiros.</div>';
    return;
  }
  financeBookings=data||[];
  ensureFinanceYearOptions();

  const selected=$("#financeBarberSelect")?.value||"";
  const base=selected?financeBookings.filter(b=>String(b.barber_id)===selected):financeBookings;

  const today=localDateISO(),week=weekStartISO(),month=monthStartISO(),year=yearStartISO();
  const byPeriod=(from,to=today)=>dateRangeFilter(base,from,to);
  setFinancePeriod("today",financeStats(base.filter(b=>completionDateISO(b)===today)));
  setFinancePeriod("week",financeStats(byPeriod(week)));
  setFinancePeriod("month",financeStats(byPeriod(month)));
  setFinancePeriod("year",financeStats(byPeriod(year,`${today.slice(0,4)}-12-31`)));

  const custom=customFinanceSelection(base);
  renderFinanceCustom(financeStats(custom.list),custom.title);
  renderMonthWeeks(base,$("#financeMonthFilter")?.value||"");

  const selectedBarber=barbers.find(b=>String(b.id)===selected);
  $("#financeDetailTitle").textContent=selectedBarber
    ? `${selectedBarber.name} — ${custom.title}`
    : `Barbeiros — ${custom.title}`;

  const cardsRoot=$("#financeBarberCards");
  const cardsBarbers=selectedBarber?[selectedBarber]:barbers;
  if(!cardsBarbers.length){
    cardsRoot.innerHTML='<div class="empty">Nenhum barbeiro cadastrado.</div>';
  }else{
    cardsRoot.innerHTML=cardsBarbers.map(br=>{
      const st=financeBarberStatsForList(custom.list,br.id);
      return `<button type="button" class="finance-barber-card" onclick="openBarberProfile(${br.id})">
        <div class="finance-barber-top">
          ${br.photo_url?`<img class="barber-card-photo small" src="${JK.esc(br.photo_url)}" alt="Foto de ${JK.esc(br.name)}">`:`<span class="barber-avatar small">✂</span>`}
          <div><strong>${JK.esc(br.name)}</strong><small>${Number(br.commission_percent||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}% de comissão</small></div>
        </div>
        <div class="finance-barber-numbers">
          <div><span>Cortes</span><b>${st.cuts}</b></div>
          <div><span>Faturou</span><b>${JK.money(st.gross)}</b></div>
          <div><span>Recebe</span><b>${JK.money(st.commission)}</b></div>
        </div>
        <span class="finance-open-profile">Abrir perfil individual →</span>
      </button>`;
    }).join("");
  }

  $("#financeTableTitle").textContent=`Cortes concluídos — ${custom.title}`;
  const rows=$("#financeRows");
  const rowList=custom.list.slice().sort((a,b)=>String(b.completed_at||b.booking_date).localeCompare(String(a.completed_at||a.booking_date))).slice(0,150);
  if(!rowList.length){
    rows.innerHTML='<tr><td colspan="7"><div class="empty">Nenhum corte concluído neste período.</div></td></tr>';
  }else{
    rows.innerHTML=rowList.map(b=>{
      const commission=commissionForBooking(b),price=Number(b.price||0),pct=percentForBooking(b);
      return `<tr>
        <td>${completionDateTimeLabel(b)}</td>
        <td><strong>${JK.esc(b.barber_name||"—")}</strong></td>
        <td>${JK.esc(b.service_name||"—")}</td>
        <td>${JK.money(price)}</td>
        <td>${pct.toLocaleString("pt-BR",{maximumFractionDigits:2})}%</td>
        <td><strong>${JK.money(commission)}</strong></td>
        <td>${JK.money(price-commission)}</td>
      </tr>`;
    }).join("");
  }
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

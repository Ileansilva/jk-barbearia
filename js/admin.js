
let session=null, services=[];
document.addEventListener("DOMContentLoaded", async ()=>{
  document.querySelector("#loginForm").addEventListener("submit",login);
  document.querySelector("#logout").addEventListener("click",logout);
  document.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>switchPanel(b.dataset.panel,b)));
  document.querySelector("#serviceForm").addEventListener("submit",saveService);
  document.querySelector("#settingsForm").addEventListener("submit",saveSettings);
  const {data}=await sb.auth.getSession(); session=data.session;
  if(session){showAdmin();await renderAll();}
});
async function login(e){
  e.preventDefault(); const f=new FormData(e.currentTarget);
  const {data,error}=await sb.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});
  if(error){document.querySelector("#loginError").textContent="E-mail ou senha inválidos.";return;}
  session=data.session;showAdmin();await renderAll();
}
function showAdmin(){document.querySelector("#loginOverlay").classList.add("hidden");}
async function logout(){await sb.auth.signOut();location.reload();}
function switchPanel(id,btn){document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));document.querySelector("#"+id).classList.add("active");document.querySelectorAll("[data-panel]").forEach(b=>b.classList.remove("active"));btn.classList.add("active");}
async function renderAll(){await Promise.all([renderKPIs(),renderBookings(),renderServicesAdmin(),loadSettings()]);}
async function renderKPIs(){
  const today=JK.todayISO(),month=today.slice(0,7);
  const {data,error}=await sb.from("bookings").select("booking_date,price,status");
  if(error)return;
  const valid=data.filter(x=>x.status!=="cancelado");
  document.querySelector("#kpiToday").textContent=valid.filter(x=>x.booking_date===today).length;
  const monthList=valid.filter(x=>x.booking_date.startsWith(month));
  document.querySelector("#kpiMonth").textContent=monthList.length;
  document.querySelector("#kpiRevenue").textContent=JK.money(monthList.reduce((a,x)=>a+Number(x.price||0),0));
  const {count}=await sb.from("services").select("*",{count:"exact",head:true}).eq("active",true);
  document.querySelector("#kpiServices").textContent=count||0;
}
async function renderBookings(){
  const root=document.querySelector("#bookingRows");root.innerHTML='<tr><td colspan="7">Carregando...</td></tr>';
  const {data,error}=await sb.from("bookings").select("*").order("booking_date",{ascending:false}).order("booking_time",{ascending:false});
  if(error){root.innerHTML='<tr><td colspan="7">Erro ao carregar.</td></tr>';return;}
  if(!data.length){root.innerHTML='<tr><td colspan="7"><div class="empty">Nenhum agendamento ainda.</div></td></tr>';return;}
  root.innerHTML=data.map(b=>`<tr><td><strong>${JK.esc(b.client_name)}</strong><br><span class="muted">${JK.esc(b.phone)}</span></td><td>${JK.esc(b.service_name)}</td><td>${new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR")}<br>${String(b.booking_time).slice(0,5)}</td><td>${JK.money(b.price)}</td><td><span class="status ${b.status}">${b.status}</span></td><td>${JK.esc(b.notes||"—")}</td><td><div class="action-row"><button class="mini-btn" onclick="setStatus(${b.id},'concluido')">Concluir</button><button class="mini-btn" onclick="setStatus(${b.id},'confirmado')">Confirmar</button><button class="mini-btn" onclick="setStatus(${b.id},'cancelado')">Cancelar</button><button class="mini-btn" onclick="deleteBooking(${b.id})">Excluir</button></div></td></tr>`).join("");
}
async function setStatus(id,status){await sb.from("bookings").update({status}).eq("id",id);await renderAll();}
async function deleteBooking(id){if(!confirm("Excluir este agendamento?"))return;await sb.from("bookings").delete().eq("id",id);await renderAll();}
async function renderServicesAdmin(){
  const root=document.querySelector("#serviceAdminGrid");
  const {data,error}=await sb.from("services").select("*").order("sort_order"); if(error)return;
  services=data;
  root.innerHTML=data.map(s=>`<div class="service-admin"><img src="${s.image_url||'assets/corte-classico.svg'}" alt=""><strong>${JK.esc(s.name)}</strong><p class="muted">${JK.esc(s.description||"")}</p><div class="price-row"><span class="price">${JK.money(s.price)}</span><span>${s.duration_minutes} min</span></div><div class="action-row" style="margin-top:14px"><button class="mini-btn" onclick="editService(${s.id})">Editar</button><button class="mini-btn" onclick="toggleService(${s.id},${!s.active})">${s.active?"Desativar":"Ativar"}</button><button class="mini-btn" onclick="removeService(${s.id})">Excluir</button></div></div>`).join("");
}
async function uploadImage(file){
  if(!file||!file.size)return null;
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
  const path=`services/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const {error}=await sb.storage.from("service-images").upload(path,file,{upsert:false});
  if(error)throw error;
  return sb.storage.from("service-images").getPublicUrl(path).data.publicUrl;
}
async function saveService(e){
  e.preventDefault();const f=new FormData(e.currentTarget),id=f.get("id"),file=f.get("image_file");
  let image=f.get("image_url").trim()||null;
  try{const uploaded=await uploadImage(file);if(uploaded)image=uploaded;}catch(err){return alert("Erro ao enviar imagem: "+err.message);}
  const payload={name:f.get("name").trim(),price:Number(f.get("price")),duration_minutes:Number(f.get("duration")),description:f.get("description").trim(),image_url:image,sort_order:Number(f.get("sort_order")||0)};
  const result=id?await sb.from("services").update(payload).eq("id",id):await sb.from("services").insert({...payload,active:true});
  if(result.error)return alert(result.error.message);
  e.currentTarget.reset();document.querySelector("#serviceId").value="";await renderAll();
}
function editService(id){const s=services.find(x=>x.id===id);if(!s)return;serviceId.value=s.id;serviceName.value=s.name;servicePrice.value=s.price;serviceDuration.value=s.duration_minutes;serviceDescription.value=s.description||"";serviceImage.value=s.image_url||"";serviceSort.value=s.sort_order||0;window.scrollTo({top:document.querySelector("#serviceForm").offsetTop-40,behavior:"smooth"});}
async function toggleService(id,active){await sb.from("services").update({active}).eq("id",id);await renderAll();}
async function removeService(id){if(!confirm("Excluir este serviço?"))return;const {error}=await sb.from("services").delete().eq("id",id);if(error)return alert("Não foi possível excluir: "+error.message);await renderAll();}
async function loadSettings(){const {data,error}=await sb.from("settings").select("*").eq("id",1).single();if(error)return;businessName.value=data.business_name||"";phone.value=data.phone||"";instagram.value=data.instagram||"";address.value=data.address||"";openTime.value=String(data.open_time).slice(0,5);closeTime.value=String(data.close_time).slice(0,5);interval.value=data.slot_interval_minutes;workDays.value=(data.work_days||[]).join(",");blockedDates.value=(data.blocked_dates||[]).join(",");}
async function saveSettings(e){e.preventDefault();const f=new FormData(e.currentTarget);const payload={business_name:f.get("businessName").trim(),phone:f.get("phone").trim(),instagram:f.get("instagram").trim(),address:f.get("address").trim(),open_time:f.get("openTime"),close_time:f.get("closeTime"),slot_interval_minutes:Number(f.get("interval")),work_days:String(f.get("workDays")).split(",").map(x=>Number(x.trim())).filter(x=>x>=0&&x<=6),blocked_dates:String(f.get("blockedDates")).split(",").map(x=>x.trim()).filter(Boolean)};const {error}=await sb.from("settings").update(payload).eq("id",1);alert(error?error.message:"Configurações salvas.");}

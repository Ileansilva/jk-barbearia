/*
==========================================================
JK BARBEARIA - PAINEL ADMINISTRATIVO
==========================================================
Arquivo principal do proprietário.

Controla:
- login
- dashboard
- agendamentos
- serviços
- barbeiros
- financeiro
- galeria
- configurações

DICA PARA REVENDA:
Prefira alterar textos/cores/identidade nos arquivos HTML/CSS
e dados da empresa pelo painel de Configurações.
==========================================================
*/

let session=null, services=[], barbers=[], galleryItems=[], financeBookings=[], currentProfileBarberId=null;
let bookingRealtimeChannel=null;
let bookingMessageSettingsCache=null;
let bookingAlarmTimer=null;
let bookingAudioContext=null;
let bookingRealtimeStarted=false;
let serviceCropState={img:null,file:null,zoom:100,x:0,y:0};
const $=(s)=>document.querySelector(s);
const adminActionLocks=new Set();
function adminLock(key){if(adminActionLocks.has(key))return false;adminActionLocks.add(key);return true;}
function adminUnlock(key){adminActionLocks.delete(key);}
function adminBusy(el,busy,text){
  if(!el)return;
  if(busy){
    el.dataset.busyOriginal=el.textContent;
    el.disabled=true;el.classList.add("is-busy");
    if(text)el.textContent=text;
  }else{
    el.disabled=false;el.classList.remove("is-busy");
    if(el.dataset.busyOriginal)el.textContent=el.dataset.busyOriginal;
    delete el.dataset.busyOriginal;
  }
}

// ===== MENSAGENS RÁPIDAS DO PAINEL =====
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
  $("#financeDateFilter")?.addEventListener("change",()=>{if(getFinanceDate())clearFinanceMonth();renderFinance();});
  $("#financeMonthFilter")?.addEventListener("change",()=>{if(getFinanceMonth())clearFinanceDate();renderFinance();});
  $("#financeYearFilter")?.addEventListener("change",()=>{clearFinanceDate();clearFinanceMonth();renderFinance();});
  $("#financePeriodFilter")?.addEventListener("change",()=>{clearFinanceDate();clearFinanceMonth();renderFinance();});
  $("#financeTodayFilterBtn")?.addEventListener("click",()=>{setFinanceDate(localDateISO());clearFinanceMonth();renderFinance();});
  $("#financeClearDateBtn")?.addEventListener("click",()=>{clearFinanceDate();renderFinance();});
  $("#financeAnnualShortcut")?.addEventListener("click",openAnnualFinanceReport);
  $("#financeAnnualShortcut")?.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openAnnualFinanceReport();}});
  $("#barberPhotoFile")?.addEventListener("change",previewBarberPhoto);
  $("#profileDate")?.addEventListener("change",()=>renderBarberProfileDay());
  $("#profileTodayBtn")?.addEventListener("click",()=>{const d=$("#profileDate"); if(d){d.value=localDateISO(); renderBarberProfileDay();}});

  const {data,error}=await sb.auth.getSession();
  if(error)console.error(error);
  session=data?.session||null;
  if(session){showAdmin();armBookingAlarm();startBookingRealtime();await renderCurrentPage();}
});

// ===== LOGIN DO PROPRIETÁRIO =====
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
  armBookingAlarm();
  startBookingRealtime();
  await renderCurrentPage();
}


// ===== AGENDAMENTO EM TEMPO REAL / ALARME V23 =====
function armBookingAlarm(){
  const unlock=()=>{
    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!bookingAudioContext&&AC)bookingAudioContext=new AC();
      bookingAudioContext?.resume?.();
    }catch(e){}
  };
  ["click","keydown","touchstart"].forEach(evt=>document.addEventListener(evt,unlock,{once:true,capture:true}));
}

function ensureBookingAlert(){
  let box=document.querySelector("#newBookingRealtimeAlert");
  if(box)return box;
  box=document.createElement("div");
  box.id="newBookingRealtimeAlert";
  box.className="new-booking-realtime-alert";
  box.hidden=true;
  box.innerHTML=`
    <div class="new-booking-alert-icon">🔔</div>
    <div class="new-booking-alert-content">
      <span>Novo agendamento</span>
      <strong id="newBookingAlertTitle">Novo cliente agendou</strong>
      <p id="newBookingAlertDetails"></p>
    </div>
    <div class="new-booking-alert-actions">
      <button id="newBookingViewBtn" class="btn btn-primary" type="button">Ver agendamento</button>
      <button id="newBookingDismissBtn" class="btn btn-outline" type="button">OK, entendi</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelector("#newBookingDismissBtn").addEventListener("click",dismissBookingAlert);
  box.querySelector("#newBookingViewBtn").addEventListener("click",()=>{
    dismissBookingAlert();
    if(document.body.dataset.adminPage==="appointments"){
      renderBookings();window.scrollTo({top:0,behavior:"smooth"});
    }else location.href="agendamentos-admin.html";
  });
  return box;
}

function playBookingAlarmTone(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!bookingAudioContext&&AC)bookingAudioContext=new AC();
    if(!bookingAudioContext)return;
    if(bookingAudioContext.state==="suspended")bookingAudioContext.resume();
    const now=bookingAudioContext.currentTime;
    [0,.22,.44].forEach((offset,i)=>{
      const osc=bookingAudioContext.createOscillator();
      const gain=bookingAudioContext.createGain();
      osc.frequency.setValueAtTime(i===1?880:740,now+offset);
      gain.gain.setValueAtTime(.0001,now+offset);
      gain.gain.exponentialRampToValueAtTime(.18,now+offset+.02);
      gain.gain.exponentialRampToValueAtTime(.0001,now+offset+.16);
      osc.connect(gain);gain.connect(bookingAudioContext.destination);
      osc.start(now+offset);osc.stop(now+offset+.18);
    });
  }catch(e){}
}
function startBookingAlarm(){stopBookingAlarm();playBookingAlarmTone();bookingAlarmTimer=setInterval(playBookingAlarmTone,3500);}
function stopBookingAlarm(){if(bookingAlarmTimer){clearInterval(bookingAlarmTimer);bookingAlarmTimer=null;}}
function dismissBookingAlert(){stopBookingAlarm();const b=document.querySelector("#newBookingRealtimeAlert");if(b)b.hidden=true;}

function realtimeBookingDetails(b){
  const d=b.booking_date?new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR"):"—";
  return `${b.service_name||"Serviço"} · ${b.barber_name||"Barbeiro"} · ${d} às ${String(b.booking_time||"").slice(0,5)}`;
}
async function onRealtimeBooking(payload){
  const b=payload?.new;if(!b)return;
  if(b.booking_origin&&b.booking_origin!=="online")return;
  const box=ensureBookingAlert();
  box.querySelector("#newBookingAlertTitle").textContent=`${b.client_name||"Novo cliente"} acabou de agendar`;
  box.querySelector("#newBookingAlertDetails").textContent=realtimeBookingDetails(b);
  box.hidden=false;startBookingAlarm();
  const page=document.body.dataset.adminPage||"dashboard";
  if(page==="appointments")await renderBookings();
  else if(page==="dashboard")await renderKPIs();
  else if(page==="customers"&&window.renderCustomersAdmin)await window.renderCustomersAdmin();
}
function startBookingRealtime(){
  if(bookingRealtimeStarted||!window.sb)return;
  bookingRealtimeStarted=true;
  bookingRealtimeChannel=sb.channel("jk-bookings-admin-realtime")
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"bookings"},onRealtimeBooking)
    .subscribe();
}


// ===== PROTEÇÃO DE AÇÕES SENSÍVEIS V28 =====
let ownerProtectedPendingAction=null;

function ensureOwnerProtectedModal(){
  let modal=document.querySelector("#ownerProtectedActionModal");
  if(modal)return modal;

  modal=document.createElement("div");
  modal.id="ownerProtectedActionModal";
  modal.className="owner-protected-modal";
  modal.hidden=true;
  modal.innerHTML=`
    <div class="owner-protected-backdrop" data-owner-protected-close></div>
    <div class="owner-protected-card" role="dialog" aria-modal="true" aria-labelledby="ownerProtectedTitle">
      <button class="owner-protected-close" type="button" data-owner-protected-close aria-label="Fechar">×</button>
      <span class="eyebrow">Confirmação de segurança</span>
      <h2 id="ownerProtectedTitle">Confirmar ação</h2>
      <p id="ownerProtectedDescription" class="muted">Informe o e-mail e a senha do proprietário.</p>
      <form id="ownerProtectedForm" class="form-grid">
        <div class="field full">
          <label>E-mail do proprietário</label>
          <input id="ownerProtectedEmail" type="email" autocomplete="username" required>
        </div>
        <div class="field full">
          <label>Senha</label>
          <input id="ownerProtectedPassword" type="password" autocomplete="current-password" required>
        </div>
        <div id="ownerProtectedError" class="owner-protected-error"></div>
        <div class="field full owner-protected-actions">
          <button class="btn btn-outline" type="button" data-owner-protected-close>Cancelar</button>
          <button id="ownerProtectedConfirmBtn" class="btn btn-primary" type="submit">Confirmar ação</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelectorAll("[data-owner-protected-close]").forEach(el=>{
    el.addEventListener("click",closeOwnerProtectedModal);
  });
  modal.querySelector("#ownerProtectedForm").addEventListener("submit",confirmOwnerProtectedAction);
  return modal;
}

function closeOwnerProtectedModal(){
  const modal=document.querySelector("#ownerProtectedActionModal");
  if(modal)modal.hidden=true;
  ownerProtectedPendingAction=null;
}

async function ownerProtectedAction({title,description,confirmText="Confirmar",action}){
  const modal=ensureOwnerProtectedModal();
  ownerProtectedPendingAction=action;
  modal.querySelector("#ownerProtectedTitle").textContent=title||"Confirmar ação";
  modal.querySelector("#ownerProtectedDescription").textContent=description||"Informe o e-mail e a senha do proprietário.";
  modal.querySelector("#ownerProtectedConfirmBtn").textContent=confirmText;
  modal.querySelector("#ownerProtectedError").textContent="";

  const userRes=await sb.auth.getUser();
  const currentEmail=userRes.data?.user?.email||"";
  modal.querySelector("#ownerProtectedEmail").value=currentEmail;
  modal.querySelector("#ownerProtectedPassword").value="";
  modal.hidden=false;
  setTimeout(()=>modal.querySelector("#ownerProtectedPassword")?.focus(),50);
}

async function confirmOwnerProtectedAction(e){
  e.preventDefault();
  if(!ownerProtectedPendingAction)return;

  const modal=ensureOwnerProtectedModal();
  const email=String(modal.querySelector("#ownerProtectedEmail").value||"").trim();
  const password=String(modal.querySelector("#ownerProtectedPassword").value||"");
  const errorEl=modal.querySelector("#ownerProtectedError");
  const btn=modal.querySelector("#ownerProtectedConfirmBtn");
  const original=btn.textContent;

  errorEl.textContent="";
  btn.disabled=true;
  btn.textContent="Verificando...";

  try{
    const before=await sb.auth.getUser();
    const originalUser=before.data?.user;
    if(!originalUser)throw new Error("Sessão do proprietário não encontrada.");
    if(String(originalUser.email||"").toLowerCase()!==email.toLowerCase()){
      throw new Error("Use o mesmo e-mail da conta atualmente conectada.");
    }

    const login=await sb.auth.signInWithPassword({email,password});
    if(login.error)throw new Error("E-mail ou senha incorretos.");
    if(login.data?.user?.id!==originalUser.id){
      throw new Error("A autenticação não pertence ao proprietário conectado.");
    }

    const action=ownerProtectedPendingAction;
    ownerProtectedPendingAction=null;
    modal.hidden=true;
    await action();
  }catch(error){
    errorEl.textContent=error?.message||"Não foi possível confirmar sua identidade.";
  }finally{
    btn.disabled=false;
    btn.textContent=original;
  }
}
window.ownerProtectedAction=ownerProtectedAction;

// ===== WHATSAPP DE CONFIRMAÇÃO / CANCELAMENTO V28 =====
function ownerWhatsAppDigits(value){
  let digits=String(value||"").replace(/\D/g,"").replace(/^0+/,"");
  if((digits.length===10||digits.length===11)&&!digits.startsWith("55"))digits="55"+digits;
  return digits;
}

async function getBookingMessageSettings(){
  if(bookingMessageSettingsCache)return bookingMessageSettingsCache;
  const {data,error}=await sb.from("settings")
    .select("customer_arrival_minutes,booking_confirm_message_template,booking_cancel_message_template")
    .eq("id",1).single();
  if(error)throw error;
  bookingMessageSettingsCache=data||{};
  return bookingMessageSettingsCache;
}

function fillBookingMessage(template,b,settings){
  const date=b.booking_date
    ? new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR")
    : "—";
  const values={
    "{nome}":b.client_name||"Cliente",
    "{data}":date,
    "{horario}":String(b.booking_time||"").slice(0,5),
    "{barbeiro}":b.barber_name||"—",
    "{servico}":b.service_name||"—",
    "{minutos}":String(Number(settings?.customer_arrival_minutes||10))
  };
  let text=String(template||"");
  Object.entries(values).forEach(([key,value])=>{text=text.split(key).join(value);});
  return text;
}

function openBookingWhatsAppWindow(){
  try{return window.open("about:blank","_blank");}
  catch(e){return null;}
}

function navigateWhatsApp(win,phone,message){
  const digits=ownerWhatsAppDigits(phone);
  if(digits.length<12){
    win?.close?.();
    adminToast("Agendamento atualizado, mas o WhatsApp do cliente está incompleto.",true);
    return;
  }
  const url=`https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  if(win&&!win.closed)win.location.href=url;
  else window.open(url,"_blank","noopener");
}

function showAdmin(){$("#loginOverlay")?.classList.add("hidden");}
// ===== SAIR DO PAINEL =====
async function logout(){stopBookingAlarm();if(bookingRealtimeChannel){try{await sb.removeChannel(bookingRealtimeChannel);}catch(e){}}await sb.auth.signOut();location.reload();}

function switchPanel(id,btn){
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  $("#"+id)?.classList.add("active");
  document.querySelectorAll("[data-panel]").forEach(b=>b.classList.remove("active"));
  btn?.classList.add("active");
}

// ===== CARREGA A PÁGINA ADMINISTRATIVA ATUAL =====
async function renderCurrentPage(){
  const page=document.body.dataset.adminPage||"dashboard";
  if(page==="barberProfile"){
    const id=Number(new URLSearchParams(location.search).get("id"));
    if(!id){location.href="barbeiros-admin.html";return;}
    currentProfileBarberId=id;
    const br=await sb.from("barbers").select("*").eq("id",id).single();
    if(br.error||!br.data){adminToast("Barbeiro não encontrado.",true);return;}
    barbers=[br.data];
    fillBarberProfileHeader(br.data);
    const d=$("#profileDate");if(d&&!d.value)d.value=localDateISO();
    await renderBarberProfileDay();
    return;
  }
  const tasks={dashboard:renderKPIs,appointments:renderBookings,customers:window.renderCustomersAdmin,services:renderServicesAdmin,barbers:renderBarbersAdmin,finance:renderFinance,cash:window.renderCashAdmin,gallery:renderGalleryAdmin,settings:loadSettings};
  const task=tasks[page];
  if(task)await task();
}
async function renderAll(){return renderCurrentPage();}

// ===== INDICADORES DA VISÃO GERAL =====
async function renderKPIs(){
  const today=JK.todayISO(),month=today.slice(0,7);
  const {data,error}=await sb.from("bookings").select("booking_date,price,status");
  if(error)return console.error(error);

  const valid=(data||[]).filter(x=>x.status!=="cancelado");
  if($("#kpiToday"))$("#kpiToday").textContent=valid.filter(x=>x.booking_date===today).length;
  const monthList=valid.filter(x=>x.booking_date.startsWith(month));
  if($("#kpiMonth"))$("#kpiMonth").textContent=monthList.length;
  if($("#kpiRevenue"))$("#kpiRevenue").textContent=JK.money(monthList.reduce((a,x)=>a+Number(x.price||0),0));

  const [svc,brb,gal]=await Promise.all([
    sb.from("services").select("*",{count:"exact",head:true}).eq("active",true),
    sb.from("barbers").select("*",{count:"exact",head:true}).eq("active",true),
    sb.from("gallery").select("*",{count:"exact",head:true}).eq("active",true)
  ]);
  if($("#kpiServices"))$("#kpiServices").textContent=svc.count||0;
  if($("#kpiBarbers"))$("#kpiBarbers").textContent=brb.count||0;
  if($("#kpiGallery"))$("#kpiGallery").textContent=gal.count||0;
}

// ===== LISTAGEM DOS AGENDAMENTOS =====
async function renderBookings(){
  const root=$("#bookingRows");
  if(!root)return;
  root.innerHTML='<tr><td colspan="9">Carregando...</td></tr>';

  const {data,error}=await sb.from("bookings").select("*")
    .order("booking_date",{ascending:false})
    .order("booking_time",{ascending:false});

  if(error){root.innerHTML='<tr><td colspan="9">Erro ao carregar.</td></tr>';return;}
  if(!data?.length){root.innerHTML='<tr><td colspan="9"><div class="empty">Nenhum agendamento ainda.</div></td></tr>';return;}

  root.innerHTML=data.map(b=>`<tr>
    <td><strong>${JK.esc(b.client_name)}</strong><br><span class="muted">${JK.esc(b.phone)}</span><br><span class="booking-origin-badge ${b.booking_origin||"online"}">${b.booking_origin==="encaixe"?"Encaixe":b.booking_origin==="presencial"?"Presencial":"Online"}</span></td>
    <td><strong>${JK.esc(b.barber_name||"—")}</strong></td>
    <td>${JK.esc(b.service_name)}</td>
    <td>${new Date(b.booking_date+"T12:00:00").toLocaleDateString("pt-BR")}<br>${String(b.booking_time).slice(0,5)}</td>
    <td>${JK.money(b.price)}${b.status==="concluido"&&b.barber_id?`<br><span class="muted">Comissão: ${JK.money(commissionForBooking(b))}</span>`:""}</td>
    <td>
      <select class="payment-admin-select ${paymentMethodClass(b.payment_method)}" onchange="updateBookingPayment(${b.id},this.value,this)">
        <option value="pix" ${paymentMethodClass(b.payment_method)==="pix"?"selected":""}>Pix</option>
        <option value="cartao" ${paymentMethodClass(b.payment_method)==="cartao"?"selected":""}>Cartão</option>
        <option value="dinheiro" ${paymentMethodClass(b.payment_method)==="dinheiro"?"selected":""}>Dinheiro</option>
      </select>
    </td>
    <td><span class="status ${b.status}">${b.status}</span></td>
    <td>${JK.esc(b.notes||"—")}</td>
    <td><div class="action-row">
      ${b.status==="pendente"?`
        <button type="button" class="mini-btn primary-mini" onclick="setStatus(${b.id},'confirmado',this)">Confirmar</button>
        <button type="button" class="mini-btn" onclick="setStatus(${b.id},'cancelado',this)">Cancelar</button>
      `:b.status==="confirmado"?`
        <button type="button" class="mini-btn primary-mini" onclick="setStatus(${b.id},'concluido',this)">Concluir</button>
        <button type="button" class="mini-btn" onclick="setStatus(${b.id},'cancelado',this)">Cancelar</button>
      `:""}
      <button type="button" class="mini-btn danger-mini" onclick="deleteBooking(${b.id},this)">Excluir</button>
    </div></td>
  </tr>`).join("");
}

// ===== ALTERA STATUS DO AGENDAMENTO =====
async function updateBookingPayment(id,method,selectEl){
  const key=`payment:${id}`;
  if(!adminLock(key))return;
  const value=paymentMethodClass(method);
  if(selectEl)selectEl.disabled=true;
  try{
    const {error}=await sb.from("bookings").update({payment_method:value}).eq("id",id);
    if(error)throw error;
    if(selectEl)selectEl.className=`payment-admin-select ${value}`;
    adminToast(`Pagamento alterado para ${paymentMethodLabel(value)}.`);
  }catch(error){
    adminToast("Erro ao alterar forma de pagamento: "+error.message,true);
    renderBookings();
  }finally{
    if(selectEl)selectEl.disabled=false;
    adminUnlock(key);
  }
}

async function setStatus(id,status,button=null){
  const key=`status:${id}`;
  if(!adminLock(key))return;

  const shouldWhatsApp=["confirmado","cancelado"].includes(status);
  const waWindow=shouldWhatsApp?openBookingWhatsAppWindow():null;
  adminBusy(button,true,status==="concluido"?"Concluindo...":status==="confirmado"?"Confirmando...":"Cancelando...");

  try{
    let payload={status,completed_at:status==="concluido"?new Date().toISOString():null};

    const needsBooking=status==="concluido"||shouldWhatsApp;
    let bookingData=null;

    if(needsBooking){
      const {data:b,error:loadError}=await sb.from("bookings")
        .select("id,client_name,phone,service_name,barber_name,booking_date,booking_time,price,barber_id,barber_commission_percent,barber_commission_amount,status")
        .eq("id",id).single();
      if(loadError)throw loadError;
      bookingData=b;

      if(status==="concluido"&&b?.barber_id&&(b.barber_commission_percent===null||b.barber_commission_amount===null)){
        const cached=barbers.find(x=>Number(x.id)===Number(b.barber_id));
        let br=cached;
        if(!br){
          const brRes=await sb.from("barbers").select("id,commission_percent").eq("id",b.barber_id).single();
          if(brRes.error)throw brRes.error;
          br=brRes.data;
        }
        const pct=Number(br?.commission_percent||0);
        payload.barber_commission_percent=pct;
        payload.barber_commission_amount=Number((Number(b.price||0)*pct/100).toFixed(2));
      }
    }

    const {error}=await sb.from("bookings").update(payload).eq("id",id);
    if(error)throw error;

    if(shouldWhatsApp&&bookingData){
      const settings=await getBookingMessageSettings();
      const template=status==="confirmado"
        ? settings.booking_confirm_message_template
        : settings.booking_cancel_message_template;
      const message=fillBookingMessage(template,bookingData,settings);
      navigateWhatsApp(waWindow,bookingData.phone,message);
    }else{
      waWindow?.close?.();
    }

    adminToast(
      status==="concluido"
        ?"Corte concluído e lançado no financeiro."
        :status==="confirmado"
          ?"Agendamento confirmado. A mensagem do WhatsApp foi preparada."
          :"Agendamento cancelado. A mensagem do WhatsApp foi preparada."
    );
    await renderBookings();
  }catch(error){
    waWindow?.close?.();
    adminToast("Erro ao atualizar: "+(error?.message||error),true);
  }finally{
    adminBusy(button,false);
    adminUnlock(key);
  }
}

async function deleteBooking(id,button=null){
  await ownerProtectedAction({
    title:"Excluir agendamento",
    description:"Esta ação remove o agendamento. Informe o e-mail e a senha do proprietário para continuar.",
    confirmText:"Excluir agendamento",
    action:async()=>{
      const key=`deleteBooking:${id}`;
      if(!adminLock(key))return;
      adminBusy(button,true,"Excluindo...");
      try{
        const {error}=await sb.from("bookings").delete().eq("id",id);
        if(error)throw error;
        adminToast("Agendamento excluído.");
        await renderBookings();
      }catch(error){
        adminToast("Erro ao excluir: "+error.message,true);
      }finally{
        adminBusy(button,false);
        adminUnlock(key);
      }
    }
  });
}

// ===== CARDS E GESTÃO DE SERVIÇOS =====
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

// ===== SALVA / EDITA SERVIÇO =====
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
  await ownerProtectedAction({
    title:"Excluir serviço",
    description:"Confirme sua identidade para excluir este serviço.",
    confirmText:"Excluir serviço",
    action:async()=>{
      const {error}=await sb.from("services").delete().eq("id",id);
      if(error)return adminToast("Não foi possível excluir: "+error.message,true);
      adminToast("Serviço excluído.");
      await renderServicesAdmin();await renderKPIs();
    }
  });
}

// ===== CARDS E GESTÃO DE BARBEIROS =====
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

// ===== SALVA / EDITA BARBEIRO =====
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
  await ownerProtectedAction({
    title:"Excluir barbeiro",
    description:"Confirme sua identidade para excluir este barbeiro. Se ele possui histórico, prefira desativá-lo.",
    confirmText:"Excluir barbeiro",
    action:async()=>{
      const {error}=await sb.from("barbers").delete().eq("id",id);
      if(error)return adminToast("Não foi possível excluir. Se houver agendamentos, desative o barbeiro em vez de excluir.",true);
      adminToast("Barbeiro excluído.");
      await renderBarbersAdmin();await renderKPIs();
    }
  });
}



function saoPauloDateISO(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const map=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getFinanceDate(){
  return $("#financeDateFilter")?.value||"";
}
function setFinanceDate(v){
  const el=$("#financeDateFilter"); if(el)el.value=v||"";
}
function clearFinanceDate(){
  const el=$("#financeDateFilter"); if(el)el.value="";
}
function getFinanceMonth(){
  return $("#financeMonthFilter")?.value||"";
}
function clearFinanceMonth(){
  const el=$("#financeMonthFilter"); if(el)el.value="";
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
// ===== FORMAS DE PAGAMENTO =====
function paymentMethodLabel(value){
  const map={pix:"Pix",cartao:"Cartão",dinheiro:"Dinheiro"};
  return map[String(value||"dinheiro").toLowerCase()]||"Dinheiro";
}
function paymentMethodClass(value){
  const v=String(value||"dinheiro").toLowerCase();
  return ["pix","cartao","dinheiro"].includes(v)?v:"dinheiro";
}
function paymentBreakdown(list){
  const result={
    pix:{cuts:0,total:0},
    cartao:{cuts:0,total:0},
    dinheiro:{cuts:0,total:0}
  };
  list.forEach(b=>{
    const method=paymentMethodClass(b.payment_method);
    result[method].cuts++;
    result[method].total+=Number(b.price||0);
  });
  return result;
}
function paymentBadge(value){
  const method=paymentMethodClass(value);
  return `<span class="payment-badge ${method}">${paymentMethodLabel(method)}</span>`;
}

function financeStats(list){
  const gross=list.reduce((a,b)=>a+Number(b.price||0),0);
  const commission=list.reduce((a,b)=>a+commissionForBooking(b),0);
  const payments=paymentBreakdown(list);
  return {cuts:list.length,gross,commission,net:gross-commission,payments};
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
function openBarberFinance(id){location.href=`financeiro-admin.html?barber=${encodeURIComponent(id)}`;}

function backToBarbers(){location.href="barbeiros-admin.html";}
function fillBarberProfileHeader(barber){
  $("#profileBarberName").textContent=barber.name||"Barbeiro";
  $("#profileBarberCommission").textContent=`Comissão atual: ${Number(barber.commission_percent||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}%`;
  const photo=$("#profileBarberPhoto");if(photo)photo.innerHTML=barber.photo_url?`<img src="${JK.esc(barber.photo_url)}" alt="Foto de ${JK.esc(barber.name)}">`:"<span>✂</span>";
}
function openBarberProfile(id){location.href=`barbeiro-perfil.html?id=${encodeURIComponent(id)}`;}
async function loadProfileBookings(){
  if(!currentProfileBarberId)return [];
  const {data,error}=await sb.from("bookings")
    .select("id,client_name,booking_date,booking_time,completed_at,service_name,price,status,barber_id,barber_name,barber_commission_percent,barber_commission_amount,payment_method")
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
  const dayPay=dayStats.payments;
  $("#profileDayPix").textContent=JK.money(dayPay.pix.total);
  $("#profileDayPixCuts").textContent=`${dayPay.pix.cuts} ${dayPay.pix.cuts===1?"corte":"cortes"}`;
  $("#profileDayCartao").textContent=JK.money(dayPay.cartao.total);
  $("#profileDayCartaoCuts").textContent=`${dayPay.cartao.cuts} ${dayPay.cartao.cuts===1?"corte":"cortes"}`;
  $("#profileDayDinheiro").textContent=JK.money(dayPay.dinheiro.total);
  $("#profileDayDinheiroCuts").textContent=`${dayPay.dinheiro.cuts} ${dayPay.dinheiro.cuts===1?"corte":"cortes"}`;
  $("#profileDayTitle").textContent=`Cortes de ${new Date(selectedDate+"T12:00:00").toLocaleDateString("pt-BR")}`;

  const rows=$("#profileDayRows");
  if(!dayList.length){
    rows.innerHTML='<tr><td colspan="8"><div class="empty">Nenhum corte concluído por este barbeiro nesta data.</div></td></tr>';
  }else{
    rows.innerHTML=dayList.map(b=>{
      const price=Number(b.price||0),commission=commissionForBooking(b),pct=percentForBooking(b);
      const time=b.completed_at
        ? new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(b.completed_at))
        : String(b.booking_time||"").slice(0,5);
      return `<tr><td>${time}</td><td>${JK.esc(b.client_name||"—")}</td><td>${JK.esc(b.service_name||"—")}</td><td>${paymentBadge(b.payment_method)}</td><td>${JK.money(price)}</td><td>${pct.toLocaleString("pt-BR",{maximumFractionDigits:2})}%</td><td><strong>${JK.money(commission)}</strong></td><td>${JK.money(price-commission)}</td></tr>`;
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
  $("#profileMonthPix").textContent=JK.money(monthStats.payments.pix.total);
  $("#profileMonthCartao").textContent=JK.money(monthStats.payments.cartao.total);
  $("#profileMonthDinheiro").textContent=JK.money(monthStats.payments.dinheiro.total);
  $("#profileYearPix").textContent=JK.money(yearStats.payments.pix.total);
  $("#profileYearCartao").textContent=JK.money(yearStats.payments.cartao.total);
  $("#profileYearDinheiro").textContent=JK.money(yearStats.payments.dinheiro.total);
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
  const date=getFinanceDate();
  const month=getFinanceMonth();
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

  const pay=stats.payments||paymentBreakdown([]);
  if($("#financeCustomPix"))$("#financeCustomPix").textContent=JK.money(pay.pix.total);
  if($("#financeCustomPixCuts"))$("#financeCustomPixCuts").textContent=`${pay.pix.cuts} ${pay.pix.cuts===1?"corte":"cortes"}`;
  if($("#financeCustomCartao"))$("#financeCustomCartao").textContent=JK.money(pay.cartao.total);
  if($("#financeCustomCartaoCuts"))$("#financeCustomCartaoCuts").textContent=`${pay.cartao.cuts} ${pay.cartao.cuts===1?"corte":"cortes"}`;
  if($("#financeCustomDinheiro"))$("#financeCustomDinheiro").textContent=JK.money(pay.dinheiro.total);
  if($("#financeCustomDinheiroCuts"))$("#financeCustomDinheiroCuts").textContent=`${pay.dinheiro.cuts} ${pay.dinheiro.cuts===1?"corte":"cortes"}`;
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
  const first=`${monthValue}-01`;
  const last=monthLastDate(monthValue);
  const lastDay=Number(last.slice(8,10));
  const label=new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"})
    .format(new Date(first+"T12:00:00"));

  $("#financeWeeksTitle").textContent=`Semanas de ${label[0].toUpperCase()+label.slice(1)}`;

  // V27: semanas financeiras fixas do mês.
  // Semana 1 = 01–07, Semana 2 = 08–14, Semana 3 = 15–21,
  // Semana 4 = 22–28 e Semana 5 = 29 até o último dia do mês.
  const ranges=[
    [1,7],
    [8,14],
    [15,21],
    [22,28],
    [29,lastDay]
  ].filter(([from])=>from<=lastDay);

  const weeks=ranges.map(([fromDay,toDay],i)=>{
    const safeTo=Math.min(toDay,lastDay);
    const from=`${monthValue}-${String(fromDay).padStart(2,"0")}`;
    const to=`${monthValue}-${String(safeTo).padStart(2,"0")}`;
    const list=dateRangeFilter(base,from,to);
    return {index:i+1,from,to,stats:financeStats(list)};
  });

  root.innerHTML=weeks.map(w=>`<article class="finance-week-card">
    <div class="finance-week-title">
      <strong class="week-number">Semana ${w.index}</strong>
      <span class="week-range">
        ${new Date(w.from+"T12:00:00").toLocaleDateString("pt-BR")}
        <b>até</b>
        ${new Date(w.to+"T12:00:00").toLocaleDateString("pt-BR")}
      </span>
    </div>
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

function monthNamePt(month){return new Intl.DateTimeFormat("pt-BR",{month:"long"}).format(new Date(`${month}-01T12:00:00`));}
function renderProfessionalPeriodReport(custom,source){
  const title=$("#financeReportTitle"),monthly=$("#financePeriodMonthlyGrid"),rows=$("#financePeriodBarberRows");
  if(!title||!monthly||!rows)return;
  title.textContent=`Relatório — ${custom.title}`;
  const groups={};
  custom.list.forEach(b=>{const key=completionDateISO(b).slice(0,7);(groups[key]??=[]).push(b);});
  const months=Object.keys(groups).sort();
  if(!months.length)monthly.innerHTML='<div class="empty">Nenhum corte concluído neste período.</div>';
  else monthly.innerHTML=months.map(key=>{const s=financeStats(groups[key]);const label=monthNamePt(key);return `<article class="finance-month-report"><span>${label[0].toUpperCase()+label.slice(1)}</span><strong>${JK.money(s.gross)}</strong><div><small>${s.cuts} cortes</small><small>Comissões: ${JK.money(s.commission)}</small><small>Líquido: ${JK.money(s.net)}</small></div></article>`}).join("");
  const barberList=barbers.length?barbers:[];
  const active=barberList.map(br=>({br,stats:financeStats(custom.list.filter(b=>Number(b.barber_id)===Number(br.id)))})).filter(x=>x.stats.cuts>0);
  rows.innerHTML=active.length?active.map(x=>`<tr><td><button class="finance-name-link" onclick="openBarberProfile(${x.br.id})">${x.br.photo_url?`<img src="${JK.esc(x.br.photo_url)}" alt="">`:""}<span>${JK.esc(x.br.name)}</span></button></td><td>${x.stats.cuts}</td><td>${JK.money(x.stats.gross)}</td><td>${JK.money(x.stats.commission)}</td><td>${JK.money(x.stats.net)}</td></tr>`).join(""):'<tr><td colspan="5"><div class="empty">Nenhum barbeiro com cortes concluídos neste período.</div></td></tr>';
}


// ===== RELATÓRIO ANUAL: 12 MESES + RANKINGS =====
function selectedFinanceYear(){
  return $("#financeYearFilter")?.value||localDateISO().slice(0,4);
}

function openAnnualFinanceReport(){
  clearFinanceDate();
  clearFinanceMonth();
  const yearSel=$("#financeYearFilter");
  const periodSel=$("#financePeriodFilter");
  if(yearSel&&!yearSel.value)yearSel.value=localDateISO().slice(0,4);
  if(periodSel)periodSel.value="year";
  renderFinance();
  requestAnimationFrame(()=>$("#financeAnnualDashboard")?.scrollIntoView({behavior:"smooth",block:"start"}));
}

function openAnnualMonth(monthValue){
  clearFinanceDate();
  const month=$("#financeMonthFilter");
  if(month)month.value=monthValue;
  renderFinance();
  requestAnimationFrame(()=>$("#financeCustomTitle")?.scrollIntoView({behavior:"smooth",block:"center"}));
}

function annualBarberStats(list){
  return barbers.map(br=>{
    const stats=financeBarberStatsForList(list,br.id);
    return {br,stats};
  }).filter(x=>x.stats.cuts>0);
}

function rankingMedal(index){
  if(index===0)return "🥇";
  if(index===1)return "🥈";
  if(index===2)return "🥉";
  return String(index+1).padStart(2,"0");
}

function renderAnnualRanking(rootId,items,valueLabel,valueFn){
  const root=$(rootId);
  if(!root)return;
  if(!items.length){
    root.innerHTML='<div class="empty">Nenhum corte concluído neste ano.</div>';
    return;
  }
  root.innerHTML=items.map((x,index)=>`
    <button type="button" class="finance-ranking-row" onclick="openBarberProfile(${x.br.id})">
      <span class="finance-ranking-position">${rankingMedal(index)}</span>
      ${x.br.photo_url
        ? `<img src="${JK.esc(x.br.photo_url)}" alt="Foto de ${JK.esc(x.br.name)}">`
        : `<span class="finance-ranking-avatar">✂</span>`}
      <span class="finance-ranking-name">
        <strong>${JK.esc(x.br.name)}</strong>
        <small>${x.stats.cuts} ${x.stats.cuts===1?"corte":"cortes"} · ${JK.money(x.stats.gross)}</small>
      </span>
      <span class="finance-ranking-value">
        <small>${valueLabel}</small>
        <strong>${valueFn(x)}</strong>
      </span>
    </button>`).join("");
}

function renderAnnualFinanceDashboard(base){
  const dashboard=$("#financeAnnualDashboard");
  if(!dashboard)return;

  const date=getFinanceDate();
  const month=getFinanceMonth();
  const period=$("#financePeriodFilter")?.value||"year";
  const year=selectedFinanceYear();

  // O painel anual aparece quando não há filtro de dia/mês e o período é "Ano inteiro".
  const visible=!date&&!month&&period==="year";
  dashboard.hidden=!visible;
  if(!visible)return;

  const from=`${year}-01-01`,to=`${year}-12-31`;
  const yearList=dateRangeFilter(base,from,to);
  const total=financeStats(yearList);

  $("#financeAnnualTitle").textContent=`Faturamento anual — ${year}`;
  $("#financeAnnualGross").textContent=JK.money(total.gross);
  $("#financeAnnualCuts").textContent=`${total.cuts} ${total.cuts===1?"corte concluído":"cortes concluídos"}`;
  if($("#financeAnnualPix"))$("#financeAnnualPix").textContent=JK.money(total.payments.pix.total);
  if($("#financeAnnualPixCuts"))$("#financeAnnualPixCuts").textContent=`${total.payments.pix.cuts} ${total.payments.pix.cuts===1?"corte":"cortes"}`;
  if($("#financeAnnualCartao"))$("#financeAnnualCartao").textContent=JK.money(total.payments.cartao.total);
  if($("#financeAnnualCartaoCuts"))$("#financeAnnualCartaoCuts").textContent=`${total.payments.cartao.cuts} ${total.payments.cartao.cuts===1?"corte":"cortes"}`;
  if($("#financeAnnualDinheiro"))$("#financeAnnualDinheiro").textContent=JK.money(total.payments.dinheiro.total);
  if($("#financeAnnualDinheiroCuts"))$("#financeAnnualDinheiroCuts").textContent=`${total.payments.dinheiro.cuts} ${total.payments.dinheiro.cuts===1?"corte":"cortes"}`;

  const root=$("#financeAnnualMonthsGrid");
  if(root){
    const currentMonth=localDateISO().slice(0,7);
    const cards=[];
    for(let m=1;m<=12;m++){
      const key=`${year}-${String(m).padStart(2,"0")}`;
      const list=yearList.filter(b=>completionDateISO(b).startsWith(key));
      const st=financeStats(list);
      const label=monthNamePt(key);
      const best=annualBarberStats(list).sort((a,b)=>b.stats.gross-a.stats.gross||b.stats.cuts-a.stats.cuts)[0];
      cards.push(`
        <button type="button" class="finance-annual-month-card ${key===currentMonth?"current":""}" onclick="openAnnualMonth('${key}')">
          <div class="finance-annual-month-top">
            <span>${label[0].toUpperCase()+label.slice(1)}</span>
            <small>${st.cuts} ${st.cuts===1?"corte":"cortes"}</small>
          </div>
          <strong class="finance-annual-month-gross">${JK.money(st.gross)}</strong>
          <div class="finance-annual-month-metrics">
            <span><small>Comissões</small><b>${JK.money(st.commission)}</b></span>
            <span><small>Líquido</small><b>${JK.money(st.net)}</b></span>
          </div>
          <div class="annual-month-payments">
            <span>Pix <b>${JK.money(st.payments.pix.total)}</b></span>
            <span>Cartão <b>${JK.money(st.payments.cartao.total)}</b></span>
            <span>Dinheiro <b>${JK.money(st.payments.dinheiro.total)}</b></span>
          </div>
          <div class="finance-annual-month-best">
            <small>${best?`Destaque: ${JK.esc(best.br.name)}`:"Sem movimento"}</small>
            <b>Ver mês →</b>
          </div>
        </button>`);
    }
    root.innerHTML=cards.join("");
  }

  const barberAnnual=annualBarberStats(yearList);
  const byCuts=barberAnnual.slice().sort((a,b)=>b.stats.cuts-a.stats.cuts||b.stats.gross-a.stats.gross);
  const byGross=barberAnnual.slice().sort((a,b)=>b.stats.gross-a.stats.gross||b.stats.cuts-a.stats.cuts);

  renderAnnualRanking("#financeAnnualCutsRanking",byCuts,"Cortes",x=>String(x.stats.cuts));
  renderAnnualRanking("#financeAnnualGrossRanking",byGross,"Faturamento",x=>JK.money(x.stats.gross));
}

// ===== MOTOR PRINCIPAL DO FINANCEIRO =====
async function renderFinance(){
  if(!$("#financeBarberCards"))return;

  if(!barbers.length){
    const br=await sb.from("barbers").select("*").order("sort_order").order("id");
    if(br.error){console.error(br.error);$("#financeBarberCards").innerHTML='<div class="empty">Erro ao carregar barbeiros.</div>';return;}
    barbers=br.data||[];
  }
  syncFinanceBarberSelect();
  const queryBarber=new URLSearchParams(location.search).get("barber");
  if(queryBarber&&$("#financeBarberSelect"))$("#financeBarberSelect").value=queryBarber;

  const {data,error}=await sb.from("bookings")
    .select("id,client_name,booking_date,booking_time,completed_at,service_name,price,status,barber_id,barber_name,barber_commission_percent,barber_commission_amount,payment_method")
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
  renderMonthWeeks(base,getFinanceMonth());
  renderProfessionalPeriodReport(custom,base);
  renderAnnualFinanceDashboard(base);

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
        <div class="finance-barber-payments">
          <span>Pix <b>${JK.money(st.payments.pix.total)}</b></span>
          <span>Cartão <b>${JK.money(st.payments.cartao.total)}</b></span>
          <span>Dinheiro <b>${JK.money(st.payments.dinheiro.total)}</b></span>
        </div>
        <span class="finance-open-profile">Abrir perfil individual →</span>
      </button>`;
    }).join("");
  }

  $("#financeTableTitle").textContent=`Cortes concluídos — ${custom.title}`;
  const rows=$("#financeRows");
  const rowList=custom.list.slice().sort((a,b)=>String(b.completed_at||b.booking_date).localeCompare(String(a.completed_at||a.booking_date))).slice(0,150);
  if(!rowList.length){
    rows.innerHTML='<tr><td colspan="8"><div class="empty">Nenhum corte concluído neste período.</div></td></tr>';
  }else{
    rows.innerHTML=rowList.map(b=>{
      const commission=commissionForBooking(b),price=Number(b.price||0),pct=percentForBooking(b);
      return `<tr>
        <td>${completionDateTimeLabel(b)}</td>
        <td><strong>${JK.esc(b.barber_name||"—")}</strong></td>
        <td>${JK.esc(b.service_name||"—")}</td>
        <td>${paymentBadge(b.payment_method)}</td>
        <td>${JK.money(price)}</td>
        <td>${pct.toLocaleString("pt-BR",{maximumFractionDigits:2})}%</td>
        <td><strong>${JK.money(commission)}</strong></td>
        <td>${JK.money(price-commission)}</td>
      </tr>`;
    }).join("");
  }
}

// ===== GESTÃO DA GALERIA =====
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

// ===== SALVA FOTO NA GALERIA =====
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
async function removeGalleryItem(id){
  await ownerProtectedAction({
    title:"Excluir foto",
    description:"Confirme sua identidade para excluir esta foto da galeria.",
    confirmText:"Excluir foto",
    action:async()=>{
      const {error}=await sb.from("gallery").delete().eq("id",id);
      if(error)return adminToast("Erro ao excluir: "+error.message,true);
      adminToast("Foto excluída da galeria.");
      await renderGalleryAdmin();await renderKPIs();
    }
  });
}

// ===== CARREGA CONFIGURAÇÕES =====
async function loadSettings(){
  const {data,error}=await sb.from("settings").select("*").eq("id",1).single();
  if(error){adminToast("Erro ao carregar configurações: "+error.message,true);return;}

  if($("#businessName"))$("#businessName").value=data.business_name||"";
  if($("#phone"))$("#phone").value=data.phone||"";
  if($("#instagram"))$("#instagram").value=data.instagram||"";
  if($("#address"))$("#address").value=data.address||"";
  if($("#openTime"))$("#openTime").value=String(data.open_time||"08:00").slice(0,5);
  if($("#closeTime"))$("#closeTime").value=String(data.close_time||"19:00").slice(0,5);
  if($("#interval"))$("#interval").value=String(data.slot_interval_minutes||30);
  if($("#workDays"))$("#workDays").value=(data.work_days||[]).join(",");
  if($("#blockedDates"))$("#blockedDates").value=(data.blocked_dates||[]).join(",");
  if($("#bookingEnabled"))$("#bookingEnabled").checked=data.booking_enabled!==false;
  if($("#bookingAdvanceDays"))$("#bookingAdvanceDays").value=Number(data.booking_advance_days||60);
  if($("#bookingMinNotice"))$("#bookingMinNotice").value=String(data.booking_min_notice_minutes||0);
  if($("#bookingNotice"))$("#bookingNotice").value=data.booking_notice||"";
  if($("#customerArrivalMinutes"))$("#customerArrivalMinutes").value=Number(data.customer_arrival_minutes||10);
  if($("#bookingConfirmMessageTemplate"))$("#bookingConfirmMessageTemplate").value=data.booking_confirm_message_template||"";
  if($("#bookingCancelMessageTemplate"))$("#bookingCancelMessageTemplate").value=data.booking_cancel_message_template||"";
  bookingMessageSettingsCache={
    customer_arrival_minutes:Number(data.customer_arrival_minutes||10),
    booking_confirm_message_template:data.booking_confirm_message_template||"",
    booking_cancel_message_template:data.booking_cancel_message_template||""
  };

  initSettingsVisualControls();
}

// ===== SALVA CONFIGURAÇÕES DA BARBEARIA =====
async function saveSettings(e){
  e.preventDefault();
  const form=e.currentTarget;
  const btn=form.querySelector('button[type="submit"]');
  const original=btn?.textContent||"Salvar configurações";
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}

  try{
    syncWorkDaysInput();
    syncBlockedDatesInput();

    const f=new FormData(form);
    const openTime=String(f.get("openTime")||"");
    const closeTime=String(f.get("closeTime")||"");
    const interval=Number(f.get("interval")||30);
    const workDays=String(f.get("workDays")||"").split(",").map(x=>Number(x.trim())).filter(x=>x>=0&&x<=6);
    const blockedDates=String(f.get("blockedDates")||"").split(",").map(x=>x.trim()).filter(Boolean);

    if(!openTime||!closeTime)throw new Error("Informe o horário de abertura e fechamento.");
    if(openTime>=closeTime)throw new Error("O horário de fechamento deve ser depois da abertura.");
    if(!workDays.length)throw new Error("Selecione pelo menos um dia de funcionamento.");
    if(interval<5)throw new Error("O intervalo entre horários é inválido.");

    const payload={
      business_name:String(f.get("businessName")||"").trim(),
      phone:String(f.get("phone")||"").trim(),
      instagram:String(f.get("instagram")||"").trim(),
      address:String(f.get("address")||"").trim(),
      open_time:openTime,
      close_time:closeTime,
      slot_interval_minutes:interval,
      work_days:workDays,
      blocked_dates:blockedDates,
      booking_enabled:$("#bookingEnabled")?.checked!==false,
      booking_advance_days:Math.max(1,Math.min(365,Number(f.get("bookingAdvanceDays")||60))),
      booking_min_notice_minutes:Math.max(0,Number(f.get("bookingMinNotice")||0)),
      booking_notice:String(f.get("bookingNotice")||"").trim(),
      customer_arrival_minutes:Math.max(0,Math.min(180,Number(f.get("customerArrivalMinutes")||10))),
      booking_confirm_message_template:String(f.get("bookingConfirmMessageTemplate")||"").trim(),
      booking_cancel_message_template:String(f.get("bookingCancelMessageTemplate")||"").trim()
    };

    const {error}=await sb.from("settings").update(payload).eq("id",1);
    if(error)throw error;

    bookingMessageSettingsCache=null;
    adminToast("Configurações salvas. A agenda dos clientes já está usando as novas regras.");
    await loadSettings();
  }catch(err){
    adminToast("Erro ao salvar configurações: "+(err?.message||"erro desconhecido"),true);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original;}
  }
}

function initSettingsVisualControls(){
  const workInput=$("#workDays");
  const selected=new Set(String(workInput?.value||"").split(",").filter(Boolean));
  document.querySelectorAll("#workDaysPicker [data-day]").forEach(btn=>{
    btn.classList.toggle("active",selected.has(btn.dataset.day));
    if(!btn.dataset.bound){
      btn.dataset.bound="1";
      btn.addEventListener("click",()=>{
        btn.classList.toggle("active");
        syncWorkDaysInput();
      });
    }
  });

  renderBlockedDateChips();

  const addBtn=$("#addBlockedDateBtn");
  if(addBtn&&!addBtn.dataset.bound){
    addBtn.dataset.bound="1";
    addBtn.addEventListener("click",()=>{
      const input=$("#blockedDateInput");
      const value=input?.value||"";
      if(!value)return adminToast("Escolha uma data para bloquear.",true);
      const current=getBlockedDates();
      if(!current.includes(value))current.push(value);
      current.sort();
      $("#blockedDates").value=current.join(",");
      if(input)input.value="";
      renderBlockedDateChips();
    });
  }
}

function syncWorkDaysInput(){
  const input=$("#workDays");
  if(!input)return;
  input.value=[...document.querySelectorAll("#workDaysPicker [data-day].active")]
    .map(btn=>Number(btn.dataset.day))
    .sort((a,b)=>a-b)
    .join(",");
}

function getBlockedDates(){
  return String($("#blockedDates")?.value||"").split(",").map(x=>x.trim()).filter(Boolean);
}

function syncBlockedDatesInput(){
  const input=$("#blockedDates");
  if(input)input.value=[...new Set(getBlockedDates())].sort().join(",");
}

function removeBlockedDate(value){
  const dates=getBlockedDates().filter(x=>x!==value);
  $("#blockedDates").value=dates.join(",");
  renderBlockedDateChips();
}

function renderBlockedDateChips(){
  const root=$("#blockedDateChips");
  if(!root)return;
  const dates=getBlockedDates();
  if(!dates.length){
    root.innerHTML='<span class="muted">Nenhuma data bloqueada.</span>';
    return;
  }
  root.innerHTML=dates.map(d=>`<button type="button" class="blocked-date-chip" data-date="${d}">
    <span>${new Date(d+"T12:00:00").toLocaleDateString("pt-BR")}</span><b>×</b>
  </button>`).join("");
  root.querySelectorAll(".blocked-date-chip").forEach(btn=>{
    btn.addEventListener("click",()=>removeBlockedDate(btn.dataset.date));
  });
}


// ===== USO DO SISTEMA V35 =====
function formatSystemBytes(bytes){
  const value=Number(bytes||0);
  if(value<1024)return `${value} B`;
  if(value<1024**2)return `${(value/1024).toFixed(1)} KB`;
  if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;
  return `${(value/1024**3).toFixed(2)} GB`;
}

function systemUsageLevel(percent){
  if(percent>=90)return "danger";
  if(percent>=70)return "warning";
  return "ok";
}

function updateSystemUsageBar(bar,percent){
  if(!bar)return;
  const safe=Math.max(0,Math.min(100,Number(percent||0)));
  bar.style.width=`${safe}%`;
  bar.dataset.level=systemUsageLevel(safe);
}

async function loadSystemUsage(button=null){
  const dbText=$("#systemDatabaseUsage");
  if(!dbText)return;

  const original=button?.textContent;
  if(button){
    button.disabled=true;
    button.textContent="Atualizando...";
  }

  try{
    const {data,error}=await sb.rpc("get_system_usage_stats");
    if(error)throw error;

    const usage=data||{};
    const dbUsed=Number(usage.database_bytes||0);
    const dbLimit=Number(usage.database_limit_bytes||524288000);
    const storageUsed=Number(usage.storage_bytes||0);
    const storageLimit=Number(usage.storage_limit_bytes||1073741824);

    const dbPercent=dbLimit?dbUsed/dbLimit*100:0;
    const storagePercent=storageLimit?storageUsed/storageLimit*100:0;

    $("#systemDatabaseUsage").textContent=`${formatSystemBytes(dbUsed)} / ${formatSystemBytes(dbLimit)}`;
    $("#systemDatabasePercent").textContent=`${dbPercent.toFixed(1)}%`;
    $("#systemDatabaseRemaining").textContent=`Livre: ${formatSystemBytes(Math.max(0,dbLimit-dbUsed))}`;

    $("#systemStorageUsage").textContent=`${formatSystemBytes(storageUsed)} / ${formatSystemBytes(storageLimit)}`;
    $("#systemStoragePercent").textContent=`${storagePercent.toFixed(1)}%`;
    $("#systemStorageRemaining").textContent=`Livre: ${formatSystemBytes(Math.max(0,storageLimit-storageUsed))}`;

    $("#systemCustomersCount").textContent=Number(usage.customers_count||0).toLocaleString("pt-BR");
    $("#systemBookingsCount").textContent=Number(usage.bookings_count||0).toLocaleString("pt-BR");
    $("#systemStorageFiles").textContent=Number(usage.storage_files||0).toLocaleString("pt-BR");

    updateSystemUsageBar($("#systemDatabaseBar"),dbPercent);
    updateSystemUsageBar($("#systemStorageBar"),storagePercent);

    const warning=$("#systemUsageWarning");
    const maxPercent=Math.max(dbPercent,storagePercent);
    if(warning){
      if(maxPercent>=90){
        warning.hidden=false;
        warning.dataset.level="danger";
        warning.textContent="Atenção: um dos limites está acima de 90%. É recomendável liberar espaço ou avaliar um plano maior.";
      }else if(maxPercent>=70){
        warning.hidden=false;
        warning.dataset.level="warning";
        warning.textContent="Atenção: um dos recursos já passou de 70% do limite disponível.";
      }else{
        warning.hidden=true;
        warning.textContent="";
      }
    }
  }catch(error){
    console.error("JK System Usage:",error);
    $("#systemDatabaseUsage").textContent="Não foi possível carregar";
    $("#systemStorageUsage").textContent="Não foi possível carregar";
    adminToast("Erro ao consultar uso do sistema: "+(error?.message||error),true);
  }finally{
    if(button){
      button.disabled=false;
      button.textContent=original||"Atualizar uso";
    }
  }
}

document.addEventListener("DOMContentLoaded",()=>{
  if(document.body?.dataset?.adminPage!=="settings")return;
  $("#refreshSystemUsageBtn")?.addEventListener("click",e=>loadSystemUsage(e.currentTarget));
  loadSystemUsage();
});

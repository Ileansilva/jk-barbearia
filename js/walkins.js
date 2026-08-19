/*
==========================================================
JK BARBEARIA - ENCAIXES E FILA PRESENCIAL V17
==========================================================
FILA:
- cliente aguarda sem bloquear a agenda pública;
- ao clicar "Iniciar", vira um atendimento real no horário atual.

ENCAIXE:
- proprietário escolhe data/hora manualmente;
- pode ultrapassar o fechamento;
- o sistema ainda impede choque com outro atendimento do barbeiro.
==========================================================
*/
let walkinCustomers=[],walkinServices=[],walkinBarbers=[],walkinQueue=[];
const walkinLocks=new Set();
function walkinLock(key){if(walkinLocks.has(key))return false;walkinLocks.add(key);return true;}
function walkinUnlock(key){walkinLocks.delete(key);}
function walkinBusy(btn,busy,text){if(!btn)return;if(busy){btn.dataset.old=btn.textContent;btn.disabled=true;if(text)btn.textContent=text;}else{btn.disabled=false;btn.textContent=btn.dataset.old||btn.textContent;delete btn.dataset.old;}}
const wq=s=>document.querySelector(s);

document.addEventListener("DOMContentLoaded",()=>{
  if(document.body?.dataset?.adminPage!=="appointments")return;
  wq("#openWalkinFormBtn")?.addEventListener("click",()=>{wq("#walkinFormCard").hidden=false;wq("#walkinName")?.focus();});
  wq("#closeWalkinFormBtn")?.addEventListener("click",()=>wq("#walkinFormCard").hidden=true);
  wq("#walkinMode")?.addEventListener("change",syncWalkinMode);
  wq("#walkinCustomer")?.addEventListener("change",fillWalkinCustomer);
  wq("#walkinForm")?.addEventListener("submit",saveWalkin);
  initializeWalkins();
});

async function initializeWalkins(){
  const [c,s,b]=await Promise.all([
    sb.from("jk_customers").select("id,full_name,phone,phone_digits").eq("active",true).order("full_name"),
    sb.from("services").select("id,name,price,duration_minutes").eq("active",true).order("sort_order"),
    sb.from("barbers").select("id,name").eq("active",true).order("sort_order")
  ]);
  if(c.error||s.error||b.error)return adminToast("Não foi possível carregar os dados de encaixe.",true);
  walkinCustomers=c.data||[];walkinServices=s.data||[];walkinBarbers=b.data||[];
  renderWalkinSelectors();
  setWalkinNow();
  syncWalkinMode();
  await renderWalkinQueue();
}

function renderWalkinSelectors(){
  const customer=wq("#walkinCustomer"),service=wq("#walkinService"),barber=wq("#walkinBarber");
  if(customer)customer.innerHTML='<option value="">Novo / informar abaixo</option>'+walkinCustomers.map(c=>`<option value="${c.id}">${JK.esc(c.full_name)} · ${JK.esc(c.phone)}</option>`).join("");
  if(service)service.innerHTML='<option value="">Selecione</option>'+walkinServices.map(x=>`<option value="${x.id}">${JK.esc(x.name)} · ${JK.money(x.price)}</option>`).join("");
  if(barber)barber.innerHTML='<option value="">Selecione</option>'+walkinBarbers.map(x=>`<option value="${x.id}">${JK.esc(x.name)}</option>`).join("");
}

function fillWalkinCustomer(){
  const id=Number(wq("#walkinCustomer")?.value||0),c=walkinCustomers.find(x=>Number(x.id)===id);
  if(!c)return;
  wq("#walkinName").value=c.full_name||"";
  wq("#walkinPhone").value=c.phone||"";
}

function localParts(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value;
  return {date:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`};
}
function setWalkinNow(){const p=localParts();if(wq("#walkinDate"))wq("#walkinDate").value=p.date;if(wq("#walkinTime"))wq("#walkinTime").value=p.time;}

function syncWalkinMode(){
  const isQueue=wq("#walkinMode")?.value==="fila";
  if(wq("#walkinManualTimeFields"))wq("#walkinManualTimeFields").hidden=isQueue;
  if(!isQueue)setWalkinNow();
}

function phoneDigits(v){return String(v||"").replace(/\D/g,"");}
async function ensureWalkinCustomer(name,phone,selectedId){
  const digits=phoneDigits(phone);

  // Cliente selecionado manualmente
  if(selectedId){
    const id=Number(selectedId);
    const {data,error}=await sb.from("jk_customers")
      .update({
        full_name:name,
        phone,
        phone_digits:digits,
        active:true,
        updated_at:new Date().toISOString()
      })
      .eq("id",id)
      .select("id")
      .single();

    if(error)throw error;
    return data.id;
  }

  // Procura no banco inteiro, inclusive clientes inativos.
  const existingRes=await sb.from("jk_customers")
    .select("id,active")
    .eq("phone_digits",digits)
    .maybeSingle();

  if(existingRes.error)throw existingRes.error;

  if(existingRes.data){
    const {data,error}=await sb.from("jk_customers")
      .update({
        full_name:name,
        phone,
        active:true,
        updated_at:new Date().toISOString()
      })
      .eq("id",existingRes.data.id)
      .select("id")
      .single();

    if(error)throw error;
    return data.id;
  }

  const {data,error}=await sb.from("jk_customers")
    .insert({full_name:name,phone,phone_digits:digits,active:true})
    .select("id")
    .single();

  if(error)throw error;
  return data.id;
}

async function saveWalkin(e){
  e.preventDefault();
  const mode=wq("#walkinMode").value;
  const name=String(wq("#walkinName").value||"").trim(),phone=String(wq("#walkinPhone").value||"").trim();
  const serviceId=Number(wq("#walkinService").value),barberId=Number(wq("#walkinBarber").value);
  const payment=wq("#walkinPayment").value,notes=String(wq("#walkinNotes").value||"").trim();
  const selectedCustomer=Number(wq("#walkinCustomer").value||0);
  if(name.length<2||phoneDigits(phone).length<8)return adminToast("Informe nome e WhatsApp do cliente.",true);
  if(!serviceId||!barberId)return adminToast("Escolha o serviço e o barbeiro.",true);
  const service=walkinServices.find(x=>Number(x.id)===serviceId),barber=walkinBarbers.find(x=>Number(x.id)===barberId);
  if(!service||!barber)return adminToast("Serviço ou barbeiro inválido.",true);

  const btn=e.currentTarget.querySelector("button[type=submit]");
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}
  try{
    const customerId=await ensureWalkinCustomer(name,phone,selectedCustomer);
    if(mode==="fila"){
      const {error}=await sb.from("walk_in_queue").insert({
        jk_customer_id:customerId,client_name:name,phone,service_id:service.id,service_name:service.name,
        price:service.price,duration_minutes:service.duration_minutes,barber_id:barber.id,barber_name:barber.name,
        payment_method:payment,notes
      });
      if(error)throw error;
      adminToast("Cliente adicionado à fila presencial.");
    }else{
      const date=wq("#walkinDate").value,time=wq("#walkinTime").value;
      if(!date||!time)throw new Error("Informe data e horário do encaixe.");
      const {data:bookingId,error}=await sb.rpc("create_admin_walkin_booking",{
        p_client_name:name,p_phone:phone,p_service_id:serviceId,p_barber_id:barberId,
        p_booking_date:date,p_booking_time:time,p_payment_method:payment,p_notes:notes,
        p_origin:"encaixe",p_customer_id:customerId
      });
      if(error)throw error;
      if(!bookingId)throw new Error("O encaixe não retornou confirmação do banco.");
      adminToast("Encaixe presencial criado e confirmado.");
    }
    e.currentTarget.reset();wq("#walkinCustomer").value="";setWalkinNow();syncWalkinMode();
    wq("#walkinFormCard").hidden=true;
    await renderWalkinQueue();
    await renderBookings();
  }catch(err){
    console.error("JK Walkin save:",err);
    const msg=String(err?.message||"Erro ao adicionar atendimento.");
    adminToast(msg,true);
  }
  finally{if(btn){btn.disabled=false;btn.textContent="Adicionar atendimento";}}
}

async function renderWalkinQueue(){
  const root=wq("#walkinQueueList");if(!root)return;
  const p=localParts();
  const start=`${p.date}T00:00:00-03:00`,end=`${p.date}T23:59:59-03:00`;
  const {data,error}=await sb.from("walk_in_queue").select("*").gte("arrived_at",start).lte("arrived_at",end).in("queue_status",["aguardando","atendendo"]).order("arrived_at");
  if(error){root.innerHTML='<div class="empty">Erro ao carregar a fila.</div>';return;}
  walkinQueue=data||[];
  const waiting=walkinQueue.filter(x=>x.queue_status==="aguardando").length;
  if(wq("#walkinQueueCount"))wq("#walkinQueueCount").textContent=`${waiting} aguardando`;
  if(!walkinQueue.length){root.innerHTML='<div class="empty">Nenhum cliente aguardando ou em atendimento.</div>';return;}
  let pos=0;
  root.innerHTML=walkinQueue.map(q=>{
    const waiting=q.queue_status==="aguardando";if(waiting)pos++;
    return `<article class="walkin-queue-item ${q.queue_status}">
      <div class="walkin-position">${waiting?pos:"✂"}</div>
      <div class="walkin-person">
        <span>${waiting?"Aguardando":"Em atendimento"}</span>
        <h3>${JK.esc(q.client_name)}</h3>
        <p>${JK.esc(q.service_name)} · ${JK.esc(q.barber_name||"—")} · ${JK.money(q.price)}</p>
        <small>Chegou ${new Date(q.arrived_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small>
      </div>
      <div class="walkin-actions">
        ${waiting?`<button class="btn btn-primary" type="button" onclick="startWalkinQueue(${q.id},this)">Iniciar</button>`:`<button class="btn btn-primary" type="button" onclick="finishWalkinQueue(${q.id},${q.booking_id},this)">Concluir</button>`}
        <button class="mini-btn danger-mini" type="button" onclick="cancelWalkinQueue(${q.id},this)">Cancelar</button>
      </div>
    </article>`;
  }).join("");
}

async function startWalkinQueue(id,btn=null){
  const key=`start:${id}`;if(!walkinLock(key))return;walkinBusy(btn,true,"Iniciando...");
  try{
    const {error}=await sb.rpc("start_walkin_queue",{p_queue_id:id});
    if(error)throw error;
    adminToast("Atendimento iniciado e registrado nos agendamentos.");
    await Promise.all([renderWalkinQueue(),renderBookings()]);
  }catch(error){adminToast("Não foi possível iniciar: "+error.message,true);}
  finally{walkinBusy(btn,false);walkinUnlock(key);}
}

async function finishWalkinQueue(queueId,bookingId,btn=null){
  const key=`finish:${queueId}`;
  if(!walkinLock(key))return;

  walkinBusy(btn,true,"Concluindo...");

  if(!bookingId){
    walkinBusy(btn,false);
    walkinUnlock(key);
    return adminToast("Atendimento não possui agendamento vinculado.",true);
  }

  try{
    const bookingRes=await sb.from("bookings")
      .select("id,price,barber_id,barber_commission_percent,barber_commission_amount")
      .eq("id",bookingId)
      .single();

    if(bookingRes.error)throw bookingRes.error;

    const booking=bookingRes.data;
    const payload={
      status:"concluido",
      completed_at:new Date().toISOString()
    };

    if(booking.barber_id&&(booking.barber_commission_percent===null||booking.barber_commission_amount===null)){
      let barber=walkinBarbers.find(b=>Number(b.id)===Number(booking.barber_id));
      if(!barber?.commission_percent){
        const brRes=await sb.from("barbers")
          .select("id,commission_percent")
          .eq("id",booking.barber_id)
          .single();
        if(brRes.error)throw brRes.error;
        barber=brRes.data;
      }

      const pct=Number(barber?.commission_percent||0);
      payload.barber_commission_percent=pct;
      payload.barber_commission_amount=Number((Number(booking.price||0)*pct/100).toFixed(2));
    }

    const updateBooking=await sb.from("bookings")
      .update(payload)
      .eq("id",bookingId);

    if(updateBooking.error)throw updateBooking.error;

    const queueUpdate=await sb.from("walk_in_queue")
      .update({
        queue_status:"concluido",
        finished_at:new Date().toISOString()
      })
      .eq("id",queueId);

    if(queueUpdate.error)throw queueUpdate.error;

    adminToast("Cliente concluído. Financeiro, cliente e caixa foram atualizados.");
    await Promise.all([renderWalkinQueue(),renderBookings()]);
  }catch(error){
    console.error("JK Walkin finish:",error);
    adminToast("Erro ao concluir cliente: "+(error?.message||error),true);
  }finally{
    walkinBusy(btn,false);
    walkinUnlock(key);
  }
}

async function cancelWalkinQueue(id,btn=null){
  if(!confirm("Remover este cliente da fila?"))return;
  const key=`cancel:${id}`;if(!walkinLock(key))return;walkinBusy(btn,true,"Cancelando...");
  const row=walkinQueue.find(x=>Number(x.id)===Number(id));
  if(row?.booking_id)await sb.from("bookings").update({status:"cancelado",completed_at:null}).eq("id",row.booking_id);
  const {error}=await sb.from("walk_in_queue").update({queue_status:"cancelado",finished_at:new Date().toISOString()}).eq("id",id);
  if(error){walkinBusy(btn,false);walkinUnlock(key);return adminToast("Erro ao cancelar: "+error.message,true);}
  adminToast("Cliente removido da fila.");
  await Promise.all([renderWalkinQueue(),renderBookings()]);
  walkinBusy(btn,false);walkinUnlock(key);
}

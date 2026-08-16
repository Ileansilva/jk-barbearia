function initBookingCalendar(){
  if(typeof flatpickr!=="function")return;
  if(flatpickr.l10ns?.pt)flatpickr.localize(flatpickr.l10ns.pt);
  const el=document.querySelector("#date");
  if(!el)return;
  flatpickr(el,{
    dateFormat:"Y-m-d",
    altInput:true,
    altFormat:"d/m/Y",
    minDate:"today",
    locale:"pt",
    onChange:()=>el.dispatchEvent(new Event("change",{bubbles:true}))
  });
}
let selectedTime="", settings=null, services=[], barbers=[];

document.addEventListener("DOMContentLoaded", async ()=>{
  const date=document.querySelector("#date");
  date.min=JK.todayISO();
  document.querySelector("#bookingForm").addEventListener("submit",submitBooking);
  date.addEventListener("change",renderTimes);
  document.querySelector("#service").addEventListener("change",()=>{selectedTime="";renderSummary();renderTimes();});
  document.querySelector("#barber").addEventListener("change",()=>{selectedTime="";syncBookingBarberCards();renderSummary();renderTimes();});
  await loadBase();
});

async function loadBase(){
  const [s1,s2,s3]=await Promise.all([
    sb.from("services").select("*").eq("active",true).order("sort_order").order("id"),
    sb.from("settings").select("*").eq("id",1).single(),
    sb.from("barbers").select("*").eq("active",true).order("sort_order").order("id")
  ]);

  if(s1.error)return toast("Não foi possível carregar os serviços.","error");
  if(s2.error)return toast("Não foi possível carregar os horários da barbearia.","error");
  if(s3.error)return toast("Não foi possível carregar os barbeiros.","error");

  services=s1.data||[];
  settings=s2.data;
  barbers=s3.data||[];

  const serviceSel=document.querySelector("#service");
  serviceSel.innerHTML='<option value="">Selecione um serviço</option>'+services.map(s=>`<option value="${s.id}">${JK.esc(s.name)} — ${JK.money(s.price)}</option>`).join("");

  const barberSel=document.querySelector("#barber");
  barberSel.innerHTML=barbers.length
    ? '<option value="">Selecione um barbeiro</option>'+barbers.map(b=>`<option value="${b.id}">${JK.esc(b.name)}</option>`).join("")
    : '<option value="">Nenhum barbeiro disponível</option>';
  renderBookingBarberCards();

  const pre=new URLSearchParams(location.search).get("service");
  if(pre)serviceSel.value=pre;
  renderSummary();
}


function renderBookingBarberCards(){
  const root=document.querySelector("#bookingBarberCards"); if(!root)return;
  if(!barbers.length){root.innerHTML='<div class="empty">Nenhum barbeiro disponível.</div>';return;}
  root.innerHTML=barbers.map(b=>`<button type="button" class="booking-barber-card" data-barber-id="${b.id}" onclick="selectBookingBarber(${b.id})">
    ${b.photo_url?`<img src="${JK.esc(b.photo_url)}" alt="Foto de ${JK.esc(b.name)}">`:`<span class="booking-barber-placeholder">✂</span>`}
    <strong>${JK.esc(b.name)}</strong>
    <small>Selecionar</small>
  </button>`).join("");
  syncBookingBarberCards();
}
function selectBookingBarber(id){
  const sel=document.querySelector("#barber");
  sel.value=String(id);
  sel.dispatchEvent(new Event("change",{bubbles:true}));
}
function syncBookingBarberCards(){
  const selected=document.querySelector("#barber")?.value||"";
  document.querySelectorAll(".booking-barber-card").forEach(card=>card.classList.toggle("active",card.dataset.barberId===selected));
}

async function renderTimes(){
  selectedTime="";
  renderSummary();

  const date=document.querySelector("#date").value;
  const serviceId=Number(document.querySelector("#service").value);
  const barberId=Number(document.querySelector("#barber").value);
  const root=document.querySelector("#times");

  if(!serviceId||!barberId||!date){
    root.innerHTML='<div class="empty" style="grid-column:1/-1">Escolha serviço, barbeiro e data.</div>';
    return;
  }

  root.innerHTML='<div class="empty" style="grid-column:1/-1">Consultando agenda do barbeiro...</div>';

  const {data,error}=await sb.rpc("get_available_times",{
    p_date:date,
    p_barber_id:barberId,
    p_service_id:serviceId
  });

  if(error){
    console.error(error);
    root.innerHTML='<div class="empty" style="grid-column:1/-1">Não foi possível consultar a agenda.</div>';
    return;
  }

  const available=(data||[]).map(x=>String(x.available_time).slice(0,5));
  if(!available.length){
    root.innerHTML='<div class="empty" style="grid-column:1/-1">Nenhum horário disponível para este barbeiro nesta data.</div>';
    return;
  }

  root.innerHTML=available.map(t=>`<button type="button" class="time-btn" data-time="${t}">${t}</button>`).join("");
  root.querySelectorAll(".time-btn").forEach(btn=>btn.addEventListener("click",()=>{
    root.querySelectorAll(".time-btn").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    selectedTime=btn.dataset.time;
    renderSummary();
  }));
}

function renderSummary(){
  const sid=document.querySelector("#service")?.value;
  const bid=document.querySelector("#barber")?.value;
  const s=services.find(x=>String(x.id)===String(sid));
  const b=barbers.find(x=>String(x.id)===String(bid));

  document.querySelector("#summaryBarber").textContent=b?.name||"—";
  document.querySelector("#summaryService").textContent=s?.name||"—";
  document.querySelector("#summaryPrice").textContent=s?JK.money(s.price):"—";

  const d=document.querySelector("#date")?.value;
  document.querySelector("#summaryDate").textContent=d?new Date(d+"T12:00:00").toLocaleDateString("pt-BR"):"—";
  document.querySelector("#summaryTime").textContent=selectedTime||"—";
}

async function submitBooking(e){
  e.preventDefault();
  const form=e.currentTarget;
  const f=new FormData(form);
  const barberId=Number(f.get("barber"));
  const serviceId=Number(f.get("service"));

  if(!barberId)return toast("Escolha um barbeiro.","error");
  if(!serviceId)return toast("Escolha um serviço.","error");
  if(!selectedTime)return toast("Escolha um horário.","error");

  const btn=form.querySelector("button[type=submit]");
  if(btn.disabled)return;
  btn.disabled=true;
  btn.textContent="Confirmando...";

  const {data,error}=await sb.rpc("create_booking_with_barber",{
    p_client_name:String(f.get("name")||"").trim(),
    p_phone:String(f.get("phone")||"").trim(),
    p_service_id:serviceId,
    p_barber_id:barberId,
    p_booking_date:f.get("date"),
    p_booking_time:selectedTime,
    p_notes:String(f.get("notes")||"").trim()
  });

  btn.disabled=false;
  btn.textContent="Confirmar agendamento";

  if(error){
    await renderTimes();
    return toast(error.message||"Não foi possível concluir o agendamento.","error");
  }

  document.querySelector("#protocol").textContent=data;
  document.querySelector("#successBox").style.display="block";
  form.reset();
  selectedTime="";
  document.querySelector("#times").innerHTML='<div class="empty" style="grid-column:1/-1">Escolha serviço, barbeiro e data.</div>';
  renderSummary();
  toast("Agendamento realizado com sucesso!","success");
}

function toast(msg,type="success"){
  const t=document.querySelector("#toast");
  t.textContent=msg;
  t.className=`toast ${type} show`;
  setTimeout(()=>t.classList.remove("show"),4000);
}

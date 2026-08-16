/*
==========================================================
JK BARBEARIA - AGENDAMENTO DO CLIENTE
==========================================================
Este arquivo controla:
- carregamento dos serviços
- carregamento dos barbeiros
- regras configuradas pelo proprietário
- datas permitidas
- horários disponíveis
- resumo do agendamento
- envio do agendamento ao Supabase

Ao revender, normalmente NÃO é necessário mudar este arquivo.
As regras são alteradas no painel Configurações.
==========================================================
*/

let selectedTime="";
let settings=null;
let services=[];
let barbers=[];

const qs=(s)=>document.querySelector(s);

document.addEventListener("DOMContentLoaded", initBooking);

// ===== INICIALIZA A PÁGINA DE AGENDAMENTO =====
async function initBooking(){
  const form=qs("#bookingForm");
  const date=qs("#date");
  const service=qs("#service");
  const barber=qs("#barber");

  if(!form||!date||!service||!barber){
    console.error("JK Booking: elementos essenciais do formulário não encontrados.");
    return;
  }

  date.min=JK.todayISO();

  form.addEventListener("submit",submitBooking);
  date.addEventListener("change",()=>{
    selectedTime="";
    renderSummary();
    renderTimes();
  });
  service.addEventListener("change",()=>{
    selectedTime="";
    renderSummary();
    renderTimes();
  });
  barber.addEventListener("change",()=>{
    selectedTime="";
    syncBookingBarberCards();
    renderSummary();
    renderTimes();
  });
  document.querySelectorAll('input[name="payment_method"]').forEach(input=>{
    input.addEventListener("change",renderSummary);
  });

  await loadBase();
}

// ===== CARREGA SERVIÇOS, BARBEIROS E CONFIGURAÇÕES =====
async function loadBase(){
  const serviceSel=qs("#service");
  const barberSel=qs("#barber");
  const barberCards=qs("#bookingBarberCards");

  serviceSel.innerHTML='<option value="">Carregando serviços...</option>';
  barberSel.innerHTML='<option value="">Carregando barbeiros...</option>';
  if(barberCards)barberCards.innerHTML='<div class="empty">Carregando barbeiros...</div>';

  try{
    const [s1,s2,s3]=await Promise.all([
      sb.from("services").select("*").eq("active",true).order("sort_order").order("id"),
      sb.from("settings").select("*").eq("id",1).single(),
      sb.from("barbers").select("*").eq("active",true).order("sort_order").order("id")
    ]);

    if(s1.error)throw new Error("Serviços: "+s1.error.message);
    if(s2.error)throw new Error("Configurações: "+s2.error.message);
    if(s3.error)throw new Error("Barbeiros: "+s3.error.message);

    services=s1.data||[];
    settings=s2.data||null;
    barbers=s3.data||[];
    applySettingsToBooking();

    serviceSel.innerHTML=services.length
      ? '<option value="">Selecione um serviço</option>'+services.map(s=>`<option value="${s.id}">${JK.esc(s.name)} — ${JK.money(s.price)}</option>`).join("")
      : '<option value="">Nenhum serviço disponível</option>';

    barberSel.innerHTML=barbers.length
      ? '<option value="">Selecione um barbeiro</option>'+barbers.map(b=>`<option value="${b.id}">${JK.esc(b.name)}</option>`).join("")
      : '<option value="">Nenhum barbeiro disponível</option>';

    renderBookingBarberCards();

    const pre=new URLSearchParams(location.search).get("service");
    if(pre && services.some(s=>String(s.id)===String(pre))){
      serviceSel.value=String(pre);
    }

    renderSummary();
  }catch(err){
    console.error("JK Booking loadBase:",err);
    serviceSel.innerHTML='<option value="">Erro ao carregar serviços</option>';
    barberSel.innerHTML='<option value="">Erro ao carregar barbeiros</option>';
    if(barberCards)barberCards.innerHTML='<div class="empty booking-error">Não foi possível carregar os dados do agendamento. Atualize a página.</div>';
    toast("Não foi possível carregar o agendamento. Atualize a página.","error");
  }
}

// ===== EXIBE OS BARBEIROS PARA O CLIENTE =====
function renderBookingBarberCards(){
  const root=qs("#bookingBarberCards");
  if(!root)return;

  if(!barbers.length){
    root.innerHTML='<div class="empty">Nenhum barbeiro disponível.</div>';
    return;
  }

  root.innerHTML=barbers.map(b=>`
    <button type="button" class="booking-barber-card" data-barber-id="${b.id}">
      ${b.photo_url
        ? `<img src="${JK.esc(b.photo_url)}" alt="Foto de ${JK.esc(b.name)}" loading="lazy">`
        : `<span class="booking-barber-placeholder">✂</span>`}
      <span class="booking-barber-info">
        <strong>${JK.esc(b.name)}</strong>
        <small>Selecionar profissional</small>
      </span>
      <span class="booking-barber-check">✓</span>
    </button>`).join("");

  root.querySelectorAll(".booking-barber-card").forEach(card=>{
    card.addEventListener("click",()=>selectBookingBarber(card.dataset.barberId));
  });

  syncBookingBarberCards();
}

function selectBookingBarber(id){
  const sel=qs("#barber");
  if(!sel)return;
  sel.value=String(id);
  sel.dispatchEvent(new Event("change",{bubbles:true}));
}

function syncBookingBarberCards(){
  const selected=qs("#barber")?.value||"";
  document.querySelectorAll(".booking-barber-card").forEach(card=>{
    const active=card.dataset.barberId===selected;
    card.classList.toggle("active",active);
    card.setAttribute("aria-pressed",String(active));
  });
}

function validISODate(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""));
}


const WEEK_NAMES=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

// ===== APLICA AS CONFIGURAÇÕES DO PROPRIETÁRIO NO AGENDAMENTO =====
function applySettingsToBooking(){
  if(!settings)return;

  const date=qs("#date");
  const hours=qs("#bookingHoursLabel");
  const days=qs("#bookingDaysLabel");
  const notice=qs("#bookingNoticeBox");
  const closed=qs("#bookingClosedBox");
  const form=qs("#bookingForm");

  const open=String(settings.open_time||"08:00").slice(0,5);
  const close=String(settings.close_time||"19:00").slice(0,5);
  if(hours)hours.textContent=`${open} às ${close}`;

  const workDays=(settings.work_days||[]).map(Number);
  if(days)days.textContent=workDays.map(d=>WEEK_NAMES[d]||"").filter(Boolean).join(", ")||"—";

  if(date){
    date.min=JK.todayISO();
    const maxDays=Number(settings.booking_advance_days||60);
    const max=new Date(JK.todayISO()+"T12:00:00");
    max.setDate(max.getDate()+maxDays);
    date.max=max.toISOString().slice(0,10);
  }

  const text=String(settings.booking_notice||"").trim();
  if(notice){
    notice.hidden=!text;
    notice.textContent=text;
  }

  const enabled=settings.booking_enabled!==false;
  if(closed)closed.hidden=enabled;
  if(form){
    form.querySelectorAll("input,select,textarea,button").forEach(el=>{
      if(el.id!=="") el.disabled=!enabled;
      else if(el.type==="submit") el.disabled=!enabled;
    });
  }
}

// ===== VALIDA DIA, BLOQUEIOS E REGRAS DE AGENDA =====
function validateBookingDateAgainstSettings(date){
  if(!settings)return "";
  if(settings.booking_enabled===false)return "O agendamento online está temporariamente desativado.";

  const d=new Date(date+"T12:00:00");
  if(Number.isNaN(d.getTime()))return "Escolha uma data válida.";

  const workDays=(settings.work_days||[]).map(Number);
  if(workDays.length&&!workDays.includes(d.getDay())){
    return "A barbearia não atende neste dia da semana.";
  }

  const blocked=(settings.blocked_dates||[]).map(String);
  if(blocked.includes(date)){
    return "Esta data foi bloqueada pela barbearia. Escolha outro dia.";
  }

  const today=JK.todayISO();
  if(date<today)return "Escolha uma data de hoje em diante.";

  const maxDays=Number(settings.booking_advance_days||60);
  const max=new Date(today+"T12:00:00");
  max.setDate(max.getDate()+maxDays);
  if(date>max.toISOString().slice(0,10)){
    return `O agendamento está liberado somente para os próximos ${maxDays} dias.`;
  }

  return "";
}

// ===== BUSCA HORÁRIOS DISPONÍVEIS NO SUPABASE =====
async function renderTimes(){
  selectedTime="";
  renderSummary();

  const date=qs("#date")?.value||"";
  const serviceId=Number(qs("#service")?.value||0);
  const barberId=Number(qs("#barber")?.value||0);
  const root=qs("#times");
  if(!root)return;

  if(!serviceId||!barberId||!validISODate(date)){
    root.innerHTML='<div class="empty" style="grid-column:1/-1">Escolha serviço, barbeiro e data.</div>';
    return;
  }

  const ruleError=validateBookingDateAgainstSettings(date);
  if(ruleError){
    root.innerHTML=`<div class="empty booking-error" style="grid-column:1/-1">${JK.esc(ruleError)}</div>`;
    return;
  }

  if(date<JK.todayISO()){
    root.innerHTML='<div class="empty booking-error" style="grid-column:1/-1">Escolha uma data de hoje em diante.</div>';
    return;
  }

  root.innerHTML='<div class="empty booking-loading" style="grid-column:1/-1">Consultando horários disponíveis...</div>';

  try{
    const {data,error}=await sb.rpc("get_available_times",{
      p_date:date,
      p_barber_id:barberId,
      p_service_id:serviceId
    });

    if(error)throw error;

    const available=(data||[])
      .map(x=>String(x.available_time??x).slice(0,5))
      .filter(Boolean);

    if(!available.length){
      root.innerHTML='<div class="empty" style="grid-column:1/-1">Nenhum horário disponível para este profissional nessa data.</div>';
      return;
    }

    root.innerHTML=available.map(t=>`
      <button type="button" class="time-btn" data-time="${t}" aria-pressed="false">${t}</button>
    `).join("");

    root.querySelectorAll(".time-btn").forEach(btn=>{
      btn.addEventListener("click",()=>{
        root.querySelectorAll(".time-btn").forEach(x=>{
          x.classList.remove("active");
          x.setAttribute("aria-pressed","false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed","true");
        selectedTime=btn.dataset.time;
        renderSummary();
      });
    });
  }catch(err){
    console.error("JK Booking renderTimes:",err);
    root.innerHTML='<div class="empty booking-error" style="grid-column:1/-1">Não foi possível consultar os horários. Tente novamente.</div>';
    toast("Erro ao consultar os horários disponíveis.","error");
  }
}

function paymentMethodLabel(value){
  const map={pix:"Pix",cartao:"Cartão",dinheiro:"Dinheiro"};
  return map[String(value||"").toLowerCase()]||"—";
}

function renderSummary(){
  const sid=qs("#service")?.value;
  const bid=qs("#barber")?.value;
  const s=services.find(x=>String(x.id)===String(sid));
  const b=barbers.find(x=>String(x.id)===String(bid));

  const summaryBarber=qs("#summaryBarber");
  const summaryService=qs("#summaryService");
  const summaryPrice=qs("#summaryPrice");
  const summaryDate=qs("#summaryDate");
  const summaryTime=qs("#summaryTime");

  if(summaryBarber)summaryBarber.textContent=b?.name||"—";
  if(summaryService)summaryService.textContent=s?.name||"—";
  if(summaryPrice)summaryPrice.textContent=s?JK.money(s.price):"—";
  const payment=qs('input[name="payment_method"]:checked')?.value||"";
  const summaryPayment=qs("#summaryPayment");
  if(summaryPayment)summaryPayment.textContent=paymentMethodLabel(payment);

  const d=qs("#date")?.value||"";
  if(summaryDate){
    summaryDate.textContent=validISODate(d)
      ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR")
      : "—";
  }
  if(summaryTime)summaryTime.textContent=selectedTime||"—";
}

// ===== CONFIRMA O AGENDAMENTO =====
async function submitBooking(e){
  e.preventDefault();

  const form=e.currentTarget;
  const f=new FormData(form);
  const name=String(f.get("name")||"").trim();
  const phone=String(f.get("phone")||"").trim();
  const barberId=Number(f.get("barber")||0);
  const serviceId=Number(f.get("service")||0);
  const bookingDate=String(f.get("date")||"");
  const paymentMethod=String(f.get("payment_method")||"").toLowerCase();

  if(name.length<2)return toast("Digite seu nome.","error");
  if(phone.length<8)return toast("Digite um WhatsApp válido.","error");
  if(!serviceId)return toast("Escolha um serviço.","error");
  if(!barberId)return toast("Escolha um barbeiro.","error");
  if(!validISODate(bookingDate))return toast("Escolha a data do atendimento.","error");
  const dateRuleError=validateBookingDateAgainstSettings(bookingDate); if(dateRuleError)return toast(dateRuleError,"error");
  if(!selectedTime)return toast("Escolha um horário disponível.","error");
  if(!["pix","cartao","dinheiro"].includes(paymentMethod))return toast("Escolha a forma de pagamento.","error");

  const btn=form.querySelector("button[type=submit]");
  if(!btn||btn.disabled)return;

  btn.disabled=true;
  const oldText=btn.textContent;
  btn.textContent="Confirmando agendamento...";

  try{
    const {data,error}=await sb.rpc("create_booking_with_barber",{
      p_client_name:name,
      p_phone:phone,
      p_service_id:serviceId,
      p_barber_id:barberId,
      p_booking_date:bookingDate,
      p_booking_time:selectedTime,
      p_notes:String(f.get("notes")||"").trim(),
      p_payment_method:paymentMethod
    });

    if(error)throw error;

    const protocol=qs("#protocol");
    const success=qs("#successBox");
    if(protocol)protocol.textContent=data??"Confirmado";
    if(success){
      success.style.display="block";
      success.scrollIntoView({behavior:"smooth",block:"nearest"});
    }

    form.reset();
    selectedTime="";
    syncBookingBarberCards();

    const times=qs("#times");
    if(times)times.innerHTML='<div class="empty" style="grid-column:1/-1">Escolha serviço, barbeiro e data.</div>';

    renderSummary();
    toast("Agendamento realizado com sucesso!","success");
  }catch(err){
    console.error("JK Booking submit:",err);
    toast(err?.message||"Não foi possível concluir o agendamento.","error");
    await renderTimes();
  }finally{
    btn.disabled=false;
    btn.textContent=oldText;
  }
}

function toast(msg,type="success"){
  const t=qs("#toast");
  if(!t){
    alert(msg);
    return;
  }
  t.textContent=msg;
  t.className=`toast ${type} show`;
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>t.classList.remove("show"),4500);
}

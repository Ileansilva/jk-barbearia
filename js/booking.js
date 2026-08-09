
let selectedTime="", settings=null, services=[];
document.addEventListener("DOMContentLoaded", async ()=>{
  const date=document.querySelector("#date"); date.min=JK.todayISO();
  document.querySelector("#bookingForm").addEventListener("submit",submitBooking);
  date.addEventListener("change",renderTimes);
  document.querySelector("#service").addEventListener("change",renderSummary);
  await loadBase();
});
async function loadBase(){
  const [s1,s2]=await Promise.all([
    sb.from("services").select("*").eq("active",true).order("sort_order"),
    sb.from("settings").select("*").eq("id",1).single()
  ]);
  if(s1.error) return toast("Não foi possível carregar os serviços.","error");
  if(s2.error) return toast("Não foi possível carregar os horários da barbearia.","error");
  services=s1.data; settings=s2.data;
  const sel=document.querySelector("#service");
  sel.innerHTML='<option value="">Selecione um serviço</option>'+services.map(s=>`<option value="${s.id}">${JK.esc(s.name)} — ${JK.money(s.price)}</option>`).join("");
  const pre=new URLSearchParams(location.search).get("service"); if(pre)sel.value=pre;
  renderSummary();
}
function generateTimes(){
  const [sh,sm]=settings.open_time.slice(0,5).split(":").map(Number);
  const [eh,em]=settings.close_time.slice(0,5).split(":").map(Number);
  let m=sh*60+sm,end=eh*60+em,out=[];
  while(m<end){out.push(`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`);m+=Number(settings.slot_interval_minutes||30);}
  return out;
}
async function renderTimes(){
  selectedTime="";renderSummary();
  const date=document.querySelector("#date").value,root=document.querySelector("#times");
  if(!date){root.innerHTML='<div class="empty" style="grid-column:1/-1">Escolha uma data.</div>';return;}
  const day=new Date(date+"T12:00:00").getDay();
  const workDays=(settings.work_days||[]).map(Number);
  const blocked=(settings.blocked_dates||[]);
  if(!workDays.includes(day)||blocked.includes(date)){root.innerHTML='<div class="empty" style="grid-column:1/-1">Não atendemos nesta data.</div>';return;}
  root.innerHTML='<div class="empty" style="grid-column:1/-1">Consultando horários...</div>';
  const {data,error}=await sb.rpc("get_booked_times",{p_date:date});
  if(error){root.innerHTML='<div class="empty" style="grid-column:1/-1">Não foi possível consultar a agenda.</div>';return;}
  const booked=(data||[]).map(x=>String(x.booked_time).slice(0,5));
  const now=new Date(),today=date===JK.todayISO();
  root.innerHTML=generateTimes().map(t=>{
    const [h,m]=t.split(":").map(Number); const elapsed=today&&(h*60+m<=now.getHours()*60+now.getMinutes());
    const dis=booked.includes(t)||elapsed;
    return `<button type="button" class="time-btn" ${dis?"disabled":""} data-time="${t}">${t}</button>`;
  }).join("");
  root.querySelectorAll(".time-btn:not(:disabled)").forEach(btn=>btn.addEventListener("click",()=>{root.querySelectorAll(".time-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");selectedTime=btn.dataset.time;renderSummary();}));
}
function renderSummary(){
  const sid=document.querySelector("#service")?.value;
  const s=services.find(x=>String(x.id)===String(sid));
  document.querySelector("#summaryService").textContent=s?.name||"—";
  document.querySelector("#summaryPrice").textContent=s?JK.money(s.price):"—";
  const d=document.querySelector("#date")?.value;
  document.querySelector("#summaryDate").textContent=d?new Date(d+"T12:00:00").toLocaleDateString("pt-BR"):"—";
  document.querySelector("#summaryTime").textContent=selectedTime||"—";
}
async function submitBooking(e){
  e.preventDefault();
  if(!selectedTime)return toast("Escolha um horário.","error");
  const btn=e.currentTarget.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Confirmando...";
  const f=new FormData(e.currentTarget);
  const {data,error}=await sb.rpc("create_booking",{
    p_client_name:String(f.get("name")).trim(),
    p_phone:String(f.get("phone")).trim(),
    p_service_id:Number(f.get("service")),
    p_booking_date:f.get("date"),
    p_booking_time:selectedTime,
    p_notes:String(f.get("notes")||"").trim()
  });
  btn.disabled=false;btn.textContent="Confirmar agendamento";
  if(error){
    if(String(error.message).toLowerCase().includes("horário")||String(error.message).toLowerCase().includes("slot")) await renderTimes();
    return toast(error.message||"Não foi possível concluir o agendamento.","error");
  }
  document.querySelector("#protocol").textContent=data;
  document.querySelector("#successBox").style.display="block";
  e.currentTarget.reset();selectedTime="";document.querySelector("#times").innerHTML='<div class="empty" style="grid-column:1/-1">Escolha uma data.</div>';renderSummary();
  toast("Agendamento realizado com sucesso!","success");
}
function toast(msg,type="success"){const t=document.querySelector("#toast");t.textContent=msg;t.className=`toast ${type} show`;setTimeout(()=>t.classList.remove("show"),4000);}

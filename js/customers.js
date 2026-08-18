/*
==========================================================
JK BARBEARIA - CRM / CADASTRO DE CLIENTES V16
==========================================================
Este arquivo controla:
- cadastro e edição de clientes;
- ligação do cadastro com histórico de agendamentos;
- aniversariantes do dia;
- clientes sem retorno há X dias;
- pesquisa profissional;
- mensagens prontas para WhatsApp.

IMPORTANTE:
O botão WhatsApp abre a conversa com a mensagem preenchida.
O envio final é feito pelo proprietário no próprio WhatsApp.
==========================================================
*/

let customerCRMCustomers=[];
const customerActionLocks=new Set();
function customerLock(key){if(customerActionLocks.has(key))return false;customerActionLocks.add(key);return true;}
function customerUnlock(key){customerActionLocks.delete(key);}
let customerCRMBookings=[];
let customerCRMSettings=null;
let customerCRMView=[];

const cq=(selector)=>document.querySelector(selector);

document.addEventListener("DOMContentLoaded",()=>{
  if(document.body?.dataset?.adminPage!=="customers")return;

  cq("#customerForm")?.addEventListener("submit",saveCustomer);
  cq("#cancelCustomerEditBtn")?.addEventListener("click",resetCustomerForm);
  cq("#newCustomerBtn")?.addEventListener("click",()=>{
    resetCustomerForm();
    cq("#customerFullName")?.focus();
    cq("#customerForm")?.scrollIntoView({behavior:"smooth",block:"center"});
  });
  cq("#saveCustomerRulesBtn")?.addEventListener("click",saveCustomerRules);
  cq("#customerSearch")?.addEventListener("input",renderCustomerTable);
  cq("#customerFilter")?.addEventListener("change",renderCustomerTable);
  cq("#customerInactiveDays")?.addEventListener("input",()=>{
    renderInactiveCustomers();
    renderCustomerTable();
    updateCustomerKPIs();
  });

  document.querySelectorAll(".customer-day-presets [data-days]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const input=cq("#customerInactiveDays");
      if(input)input.value=btn.dataset.days;
      renderInactiveCustomers();
      renderCustomerTable();
      updateCustomerKPIs();
    });
  });
});

// ===== ENTRADA CHAMADA PELO PAINEL ADMIN =====
async function renderCustomersAdmin(){
  await loadCustomerCRM();
}

// ===== CARREGAMENTO DOS DADOS =====
async function loadCustomerCRM(){
  const rows=cq("#customerRows");
  if(rows)rows.innerHTML='<tr><td colspan="8">Carregando clientes...</td></tr>';

  const [customersRes,bookingsRes,settingsRes]=await Promise.all([
    sb.from("jk_customers").select("*").order("full_name"),
    sb.from("bookings")
      .select("id,jk_customer_id,phone,client_name,status,completed_at,booking_date,booking_time,price,service_name,barber_name")
      .eq("status","concluido"),
    sb.from("settings")
      .select("customer_inactive_days,birthday_message_template,inactive_message_template")
      .eq("id",1)
      .single()
  ]);

  if(customersRes.error){
    adminToast("Erro ao carregar clientes: "+customersRes.error.message,true);
    return;
  }
  if(bookingsRes.error){
    adminToast("Erro ao carregar histórico dos clientes: "+bookingsRes.error.message,true);
    return;
  }
  if(settingsRes.error){
    adminToast("Erro ao carregar regras de clientes: "+settingsRes.error.message,true);
    return;
  }

  customerCRMCustomers=customersRes.data||[];
  customerCRMBookings=bookingsRes.data||[];
  customerCRMSettings=settingsRes.data||{};

  const days=cq("#customerInactiveDays");
  if(days)days.value=Number(customerCRMSettings.customer_inactive_days||30);

  const birthday=cq("#birthdayMessageTemplate");
  if(birthday)birthday.value=customerCRMSettings.birthday_message_template||"";

  const inactive=cq("#inactiveMessageTemplate");
  if(inactive)inactive.value=customerCRMSettings.inactive_message_template||"";

  customerCRMView=customerCRMCustomers.map(buildCustomerView);
  updateCustomerKPIs();
  renderBirthdayCustomers();
  renderInactiveCustomers();
  renderCustomerTable();
  renderCustomerDateLabels();
}

// ===== NORMALIZAÇÃO DE TELEFONE =====
function customerPhoneDigits(value){
  return String(value||"").replace(/\D/g,"");
}

function whatsappPhone(value){
  let digits=customerPhoneDigits(value).replace(/^0+/,"");
  if((digits.length===10||digits.length===11)&&!digits.startsWith("55"))digits="55"+digits;
  return digits;
}

// ===== DATAS / HISTÓRICO =====
function crmTodayISO(){
  if(window.JK?.todayISO)return JK.todayISO();
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Sao_Paulo",
    year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function completedDateISO(booking){
  if(booking.completed_at){
    try{
      return new Intl.DateTimeFormat("en-CA",{
        timeZone:"America/Sao_Paulo",
        year:"numeric",month:"2-digit",day:"2-digit"
      }).format(new Date(booking.completed_at));
    }catch(e){}
  }
  return String(booking.booking_date||"");
}

function daysBetweenISO(from,to){
  if(!from||!to)return null;
  const a=new Date(from+"T12:00:00");
  const b=new Date(to+"T12:00:00");
  return Math.max(0,Math.floor((b-a)/86400000));
}

function birthMonthDay(value){
  return String(value||"").slice(5,10);
}

function customerAge(birthDate){
  if(!birthDate)return null;
  const today=crmTodayISO();
  const b=new Date(birthDate+"T12:00:00");
  const t=new Date(today+"T12:00:00");
  let age=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate()))age--;
  return Math.max(0,age);
}

function formatBRDate(value){
  if(!value)return "—";
  try{return new Date(value+"T12:00:00").toLocaleDateString("pt-BR");}
  catch(e){return "—";}
}

// ===== MONTA A VISÃO COMPLETA DE CADA CLIENTE =====
function buildCustomerView(customer){
  const digits=customerPhoneDigits(customer.phone_digits||customer.phone);
  const visits=customerCRMBookings
    .filter(b=>{
      if(Number(b.jk_customer_id)===Number(customer.id))return true;
      return !b.jk_customer_id && customerPhoneDigits(b.phone)===digits;
    })
    .sort((a,b)=>String(completedDateISO(b)).localeCompare(String(completedDateISO(a))));

  const last=visits[0]||null;
  const lastVisit=last?completedDateISO(last):null;
  const daysAway=lastVisit?daysBetweenISO(lastVisit,crmTodayISO()):null;
  const revenue=visits.reduce((sum,b)=>sum+Number(b.price||0),0);
  const birthdayToday=customer.birth_date && birthMonthDay(customer.birth_date)===birthMonthDay(crmTodayISO());

  return {
    ...customer,
    visits,
    visitCount:visits.length,
    lastVisit,
    daysAway,
    revenue,
    birthdayToday,
    age:customerAge(customer.birth_date)
  };
}

// ===== KPIs =====
function inactiveThreshold(){
  return Math.max(1,Number(cq("#customerInactiveDays")?.value||customerCRMSettings?.customer_inactive_days||30));
}

function isInactiveCustomer(c){
  const threshold=inactiveThreshold();
  return c.lastVisit && Number(c.daysAway)>=threshold;
}

function updateCustomerKPIs(){
  const total=customerCRMView.filter(c=>c.active!==false).length;
  const birthdays=customerCRMView.filter(c=>c.active!==false&&c.birthdayToday).length;
  const inactive=customerCRMView.filter(c=>c.active!==false&&isInactiveCustomer(c)).length;
  const visits=customerCRMView.reduce((sum,c)=>sum+c.visitCount,0);

  if(cq("#customerKpiTotal"))cq("#customerKpiTotal").textContent=total;
  if(cq("#customerKpiBirthdays"))cq("#customerKpiBirthdays").textContent=birthdays;
  if(cq("#customerKpiInactive"))cq("#customerKpiInactive").textContent=inactive;
  if(cq("#customerKpiVisits"))cq("#customerKpiVisits").textContent=visits;
  if(cq("#customerKpiInactiveLabel"))cq("#customerKpiInactiveLabel").textContent=`Há ${inactiveThreshold()}+ dias`;
  if(cq("#inactiveDaysBadge"))cq("#inactiveDaysBadge").textContent=`${inactiveThreshold()}+ dias`;
}

function renderCustomerDateLabels(){
  const el=cq("#birthdayTodayDate");
  if(el)el.textContent=new Date(crmTodayISO()+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long"});
}

// ===== MENSAGENS / WHATSAPP =====
function customerFirstName(fullName){
  return String(fullName||"Cliente").trim().split(/\s+/)[0]||"Cliente";
}

function fillCustomerTemplate(template,customer){
  return String(template||"")
    .replaceAll("{nome}",customerFirstName(customer.full_name))
    .replaceAll("{nome_completo}",customer.full_name||"")
    .replaceAll("{dias}",String(customer.daysAway??""));
}

function openCustomerWhatsApp(id,type){
  const customer=customerCRMView.find(c=>Number(c.id)===Number(id));
  if(!customer)return adminToast("Cliente não encontrado.",true);

  const phone=whatsappPhone(customer.phone);
  if(phone.length<12)return adminToast("WhatsApp deste cliente está incompleto.",true);

  const template=type==="birthday"
    ? (cq("#birthdayMessageTemplate")?.value||customerCRMSettings?.birthday_message_template||"")
    : (cq("#inactiveMessageTemplate")?.value||customerCRMSettings?.inactive_message_template||"");

  const message=fillCustomerTemplate(template,customer);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener");
}

// ===== ANIVERSARIANTES DO DIA =====
function renderBirthdayCustomers(){
  const root=cq("#birthdayCustomersGrid");
  if(!root)return;

  const list=customerCRMView
    .filter(c=>c.active!==false&&c.birthdayToday)
    .sort((a,b)=>a.full_name.localeCompare(b.full_name,"pt-BR"));

  if(!list.length){
    root.innerHTML='<div class="empty customer-empty-special">Nenhum aniversariante cadastrado para hoje.</div>';
    return;
  }

  root.innerHTML=list.map(c=>`
    <article class="customer-special-card birthday-card">
      <div class="customer-special-icon">🎂</div>
      <div class="customer-special-main">
        <span class="customer-special-label">Aniversariante de hoje</span>
        <h3>${JK.esc(c.full_name)}</h3>
        <p>${c.age!==null?`${c.age} anos · `:""}${JK.esc(c.phone)}</p>
      </div>
      <button type="button" class="customer-whatsapp-btn" onclick="openCustomerWhatsApp(${c.id},'birthday')">
        WhatsApp
      </button>
    </article>`).join("");
}

// ===== CLIENTES SEM RETORNO =====
function renderInactiveCustomers(){
  const root=cq("#inactiveCustomersGrid");
  if(!root)return;

  updateCustomerKPIs();

  const list=customerCRMView
    .filter(c=>c.active!==false&&isInactiveCustomer(c))
    .sort((a,b)=>Number(b.daysAway)-Number(a.daysAway));

  if(!list.length){
    root.innerHTML=`<div class="empty customer-empty-special">Nenhum cliente está há ${inactiveThreshold()} dias ou mais sem retornar.</div>`;
    return;
  }

  root.innerHTML=list.map(c=>`
    <article class="customer-special-card inactive-card">
      <div class="customer-away-days">
        <strong>${c.daysAway}</strong>
        <span>dias</span>
      </div>
      <div class="customer-special-main">
        <span class="customer-special-label">Última visita: ${formatBRDate(c.lastVisit)}</span>
        <h3>${JK.esc(c.full_name)}</h3>
        <p>${c.visitCount} ${c.visitCount===1?"visita":"visitas"} · ${JK.money(c.revenue)} gerados</p>
      </div>
      <button type="button" class="customer-whatsapp-btn" onclick="openCustomerWhatsApp(${c.id},'inactive')">
        WhatsApp
      </button>
    </article>`).join("");
}

// ===== PESQUISA / TABELA =====
function filteredCustomerList(){
  const term=String(cq("#customerSearch")?.value||"").trim().toLowerCase();
  const filter=cq("#customerFilter")?.value||"all";

  return customerCRMView.filter(c=>{
    const searchable=`${c.full_name} ${c.phone} ${c.phone_digits}`.toLowerCase();
    if(term&&!searchable.includes(term))return false;

    // Por padrão mostramos os ativos. Clientes inativos aparecem
    // quando o usuário pesquisa pelo nome/telefone ou escolhe o filtro Inativos.
    if(c.active===false && filter!=="inactive-status" && !term)return false;
    if(filter==="inactive-status"&&c.active!==false)return false;

    if(filter==="birthday"&&(!c.birthdayToday||c.active===false))return false;
    if(filter==="inactive"&&(!isInactiveCustomer(c)||c.active===false))return false;
    if(filter==="with-birthday"&&(!c.birth_date||c.active===false))return false;
    if(filter==="without-birthday"&&(c.birth_date||c.active===false))return false;

    return true;
  }).sort((a,b)=>{
    if(a.active!==b.active)return a.active===false?1:-1;
    return a.full_name.localeCompare(b.full_name,"pt-BR");
  });
}

function renderCustomerTable(){
  const root=cq("#customerRows");
  if(!root)return;

  const list=filteredCustomerList();
  if(!list.length){
    root.innerHTML='<tr><td colspan="8"><div class="empty">Nenhum cliente encontrado com esse filtro.</div></td></tr>';
    return;
  }

  root.innerHTML=list.map(c=>{
    const lastVisit=c.lastVisit
      ? `${formatBRDate(c.lastVisit)}${c.daysAway!==null?`<br><span class="muted">${c.daysAway} dias atrás</span>`:""}`
      : '<span class="muted">Sem visita concluída</span>';

    const birthday=c.birth_date
      ? `${formatBRDate(c.birth_date)}${c.age!==null?`<br><span class="muted">${c.age} anos</span>`:""}`
      : '<span class="muted">Não informado</span>';

    return `<tr>
      <td><strong>${JK.esc(c.full_name)}</strong><br><span class="muted">${JK.esc(c.phone)}</span></td>
      <td>${birthday}</td>
      <td>${lastVisit}</td>
      <td><strong>${c.visitCount}</strong></td>
      <td><strong>${JK.money(c.revenue)}</strong></td>
      <td><button type="button" class="mini-btn whatsapp-mini" onclick="openCustomerWhatsApp(${c.id},'inactive')">WhatsApp</button></td>
      <td><span class="customer-status-badge ${c.active===false?"inactive":"active"}">${c.active===false?"Inativo":"Ativo"}</span></td>
      <td>
        <div class="action-row">
          <button type="button" class="mini-btn primary-mini" onclick="editCustomer(${c.id})">Editar</button>
          ${c.active===false
            ? `<button type="button" class="mini-btn reactivate-mini" onclick="reactivateCustomer(${c.id})">Reativar</button>`
            : `<button type="button" class="mini-btn danger-mini" onclick="deactivateCustomer(${c.id})">Inativar</button>`}
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ===== CADASTRO E EDIÇÃO =====
function resetCustomerForm(){
  cq("#customerForm")?.reset();
  if(cq("#customerId"))cq("#customerId").value="";
  if(cq("#customerFormTitle"))cq("#customerFormTitle").textContent="Novo cliente";
  if(cq("#cancelCustomerEditBtn"))cq("#cancelCustomerEditBtn").hidden=true;
}

function editCustomer(id){
  const customer=customerCRMCustomers.find(c=>Number(c.id)===Number(id));
  if(!customer)return;

  cq("#customerId").value=customer.id;
  cq("#customerFullName").value=customer.full_name||"";
  cq("#customerPhone").value=customer.phone||"";
  cq("#customerBirthDate").value=customer.birth_date||"";
  cq("#customerNotes").value=customer.notes||"";
  cq("#customerFormTitle").textContent="Editar cliente";
  cq("#cancelCustomerEditBtn").hidden=false;

  cq("#customerForm")?.scrollIntoView({behavior:"smooth",block:"center"});
}

async function saveCustomer(e){
  e.preventDefault();
  if(!customerLock("save"))return;

  const id=Number(cq("#customerId")?.value||0);
  const fullName=String(cq("#customerFullName")?.value||"").trim();
  const phone=String(cq("#customerPhone")?.value||"").trim();
  const digits=customerPhoneDigits(phone);
  const birthDate=cq("#customerBirthDate")?.value||null;
  const notes=String(cq("#customerNotes")?.value||"").trim();

  if(fullName.length<3){customerUnlock("save");return adminToast("Informe o nome completo do cliente.",true);}
  if(digits.length<10){customerUnlock("save");return adminToast("Informe um WhatsApp válido.",true);}

  const duplicate=customerCRMCustomers.find(c=>c.phone_digits===digits&&Number(c.id)!==id);
  if(duplicate&&duplicate.active!==false){
    customerUnlock("save");
    return adminToast(`Esse WhatsApp já está cadastrado para ${duplicate.full_name}.`,true);
  }

  // Se o número pertence a um cliente inativo, reaproveitamos o cadastro
  // em vez de bloquear o usuário com "WhatsApp já cadastrado".
  if(duplicate&&duplicate.active===false&&!id){
    const btn=e.currentTarget.querySelector('button[type="submit"]');
    const old=btn?.textContent||"Salvar cliente";
    if(btn){btn.disabled=true;btn.textContent="Reativando cliente...";}

    const payload={
      full_name:fullName,
      phone,
      phone_digits:digits,
      birth_date:birthDate||duplicate.birth_date||null,
      notes:notes||duplicate.notes||"",
      active:true,
      updated_at:new Date().toISOString()
    };

    const {data:reactivated,error:reactivateError}=await sb.from("jk_customers")
      .update(payload)
      .eq("id",duplicate.id)
      .select("*")
      .single();

    if(btn){btn.disabled=false;btn.textContent=old;}
    customerUnlock("save");

    if(reactivateError){
      return adminToast("Erro ao reativar cliente: "+reactivateError.message,true);
    }

    customerCRMCustomers=customerCRMCustomers.map(c=>Number(c.id)===Number(duplicate.id)?reactivated:c);
    customerCRMView=customerCRMCustomers.map(buildCustomerView);
    updateCustomerKPIs();renderBirthdayCustomers();renderInactiveCustomers();renderCustomerTable();
    resetCustomerForm();
    adminToast("Cliente reativado e cadastro atualizado.");
    return;
  }

  const btn=e.currentTarget.querySelector('button[type="submit"]');
  const old=btn?.textContent||"Salvar cliente";
  if(btn){btn.disabled=true;btn.textContent="Salvando...";}

  const payload={
    full_name:fullName,
    phone,
    phone_digits:digits,
    birth_date:birthDate||null,
    notes,
    active:true,
    updated_at:new Date().toISOString()
  };

  let result;
  if(id){
    result=await sb.from("jk_customers").update(payload).eq("id",id).select("*").single();
  }else{
    result=await sb.from("jk_customers").insert(payload).select("*").single();
  }

  if(result.error){
    if(btn){btn.disabled=false;btn.textContent=old;}
    customerUnlock("save");
    adminToast("Erro ao salvar cliente: "+result.error.message,true);
    return;
  }

  const saved=result.data;
  if(id){
    customerCRMCustomers=customerCRMCustomers.map(c=>Number(c.id)===Number(id)?saved:c);
  }else{
    customerCRMCustomers=[...customerCRMCustomers,saved];
  }
  customerCRMView=customerCRMCustomers.map(buildCustomerView);
  updateCustomerKPIs();renderBirthdayCustomers();renderInactiveCustomers();renderCustomerTable();

  if(btn){btn.disabled=false;btn.textContent=old;}
  customerUnlock("save");
  adminToast(id?"Cliente atualizado.":"Cliente cadastrado.");
  resetCustomerForm();
}

async function deactivateCustomer(id){
  const customer=customerCRMCustomers.find(c=>Number(c.id)===Number(id));
  if(!customer)return;
  if(!confirm(`Inativar ${customer.full_name}? O histórico será mantido.`))return;

  const {error}=await sb.from("jk_customers")
    .update({active:false,updated_at:new Date().toISOString()})
    .eq("id",id);

  if(error)return adminToast("Erro ao inativar cliente: "+error.message,true);

  adminToast("Cliente inativado. O histórico foi preservado.");
  await loadCustomerCRM();
}


async function reactivateCustomer(id){
  const customer=customerCRMCustomers.find(c=>Number(c.id)===Number(id));
  if(!customer)return adminToast("Cliente não encontrado.",true);
  if(customer.active!==false)return adminToast("Este cliente já está ativo.");

  const key=`reactivate:${id}`;
  if(!customerLock(key))return;

  try{
    const {data,error}=await sb.from("jk_customers")
      .update({active:true,updated_at:new Date().toISOString()})
      .eq("id",id)
      .select("*")
      .single();

    if(error)throw error;

    customerCRMCustomers=customerCRMCustomers.map(c=>Number(c.id)===Number(id)?data:c);
    customerCRMView=customerCRMCustomers.map(buildCustomerView);
    updateCustomerKPIs();renderBirthdayCustomers();renderInactiveCustomers();renderCustomerTable();
    adminToast(`${data.full_name} foi reativado.`);
  }catch(error){
    adminToast("Erro ao reativar cliente: "+error.message,true);
  }finally{
    customerUnlock(key);
  }
}

// ===== SALVA TEMPO DE RETORNO E MENSAGENS =====
async function saveCustomerRules(){
  if(!customerLock("rules"))return;
  const btn=cq("#saveCustomerRulesBtn"); if(btn){btn.disabled=true;btn.textContent="Salvando...";}
  const days=inactiveThreshold();
  const birthday=String(cq("#birthdayMessageTemplate")?.value||"").trim();
  const inactive=String(cq("#inactiveMessageTemplate")?.value||"").trim();

  if(!birthday){if(btn){btn.disabled=false;btn.textContent="Salvar regras";}customerUnlock("rules");return adminToast("A mensagem de aniversário não pode ficar vazia.",true);}
  if(!inactive){if(btn){btn.disabled=false;btn.textContent="Salvar regras";}customerUnlock("rules");return adminToast("A mensagem de retorno não pode ficar vazia.",true);}

  const {error}=await sb.from("settings").update({
    customer_inactive_days:days,
    birthday_message_template:birthday,
    inactive_message_template:inactive
  }).eq("id",1);

  if(error){if(btn){btn.disabled=false;btn.textContent="Salvar regras";}customerUnlock("rules");return adminToast("Erro ao salvar regras: "+error.message,true);}

  customerCRMSettings={
    ...(customerCRMSettings||{}),
    customer_inactive_days:days,
    birthday_message_template:birthday,
    inactive_message_template:inactive
  };

  if(btn){btn.disabled=false;btn.textContent="Salvar regras";}
  customerUnlock("rules");
  adminToast("Regras de clientes e mensagens salvas.");
  updateCustomerKPIs();
  renderInactiveCustomers();
  renderCustomerTable();
}

// Disponibiliza o módulo para o roteador do painel.
window.renderCustomersAdmin=renderCustomersAdmin;

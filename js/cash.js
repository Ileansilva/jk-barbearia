/*
==========================================================
JK BARBEARIA - ABERTURA E FECHAMENTO DE CAIXA V17
==========================================================
- um caixa aberto por vez;
- vendas entram quando o atendimento vira "concluido";
- Pix/Cartão entram no total de vendas, mas somente Dinheiro
  altera o dinheiro físico esperado;
- entradas/suprimentos somam no físico;
- saídas/sangrias reduzem o físico;
- fechamento salva a diferença entre contado e esperado.
==========================================================
*/
let currentCashRegister=null,currentCashBookings=[],currentCashMovements=[];
let pendingCashDeleteId=null,pendingCashDeleteRow=null;
const cashActionLocks=new Set();
let cashPendingMovementCount=0;

function cashOperationKey(){
  if(window.crypto?.randomUUID)return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
    const r=Math.random()*16|0,v=c==="x"?r:(r&0x3|0x8);
    return v.toString(16);
  });
}

function cashLock(key){
  if(cashActionLocks.has(key))return false;
  cashActionLocks.add(key);return true;
}
function cashUnlock(key){cashActionLocks.delete(key);}
function cashSetBusy(button,busy,label){
  if(!button)return;
  if(busy){
    button.dataset.originalText=button.textContent;
    button.disabled=true;
    button.classList.add("is-busy");
    button.textContent=label||"Salvando...";
  }else{
    button.disabled=false;
    button.classList.remove("is-busy");
    button.textContent=button.dataset.originalText||button.textContent;
    delete button.dataset.originalText;
  }
}
const cashQ=s=>document.querySelector(s);

document.addEventListener("DOMContentLoaded",()=>{
  if(document.body?.dataset?.adminPage!=="cash")return;
  cashQ("#openCashForm")?.addEventListener("submit",openCashRegister);
  cashQ("#cashMovementForm")?.addEventListener("submit",addCashMovement);
  cashQ("#closeCashForm")?.addEventListener("submit",closeCashRegister);
  cashQ("#refreshCashBtn")?.addEventListener("click",renderCashAdmin);
  cashQ("#cashCountedAmount")?.addEventListener("input",updateCashClosePreview);
  cashQ("#deleteCashAuthForm")?.addEventListener("submit",confirmDeleteCash);
  cashQ("#closeDeleteCashModalBtn")?.addEventListener("click",closeDeleteCashModal);
  cashQ("#cancelDeleteCashBtn")?.addEventListener("click",closeDeleteCashModal);
  document.querySelector("[data-close-cash-delete]")?.addEventListener("click",closeDeleteCashModal);
});

async function renderCashAdmin(){
  if(!cashLock("render"))return;
  try{
    const openPromise=sb.from("cash_registers").select("*").eq("status","aberto").maybeSingle();
    const historyPromise=renderCashHistory();

    const {data:open,error}=await openPromise;
    if(error)return adminToast("Erro ao carregar caixa: "+error.message,true);

    currentCashRegister=open||null;
    cashQ("#cashClosedState").hidden=!!currentCashRegister;
    cashQ("#cashOpenState").hidden=!currentCashRegister;

    if(currentCashRegister)await loadOpenCashDetails();
    await historyPromise;
  }finally{cashUnlock("render");}
}

async function openCashRegister(e){
  e.preventDefault();
  if(!cashLock("open"))return;
  const amount=Number(cashQ("#cashOpeningAmount")?.value||0);
  const btn=e.currentTarget.querySelector("button");
  if(amount<0){cashUnlock("open");return adminToast("Valor inicial inválido.",true);}
  cashSetBusy(btn,true,"Abrindo caixa...");
  try{
    const {data,error}=await sb.from("cash_registers").insert({opening_amount:amount}).select("*").single();
    if(error)throw error;
    currentCashRegister=data;
    currentCashBookings=[];currentCashMovements=[];
    cashQ("#cashClosedState").hidden=true;
    cashQ("#cashOpenState").hidden=false;
    renderOpenCashNumbers();
    renderCashMovements();
    adminToast("Caixa aberto com sucesso.");
    renderCashHistory(); // sincroniza sem travar a ação principal
  }catch(error){
    if(String(error?.message||"").toLowerCase().includes("duplicate"))adminToast("Já existe um caixa aberto.",true);
    else adminToast("Erro ao abrir caixa: "+(error?.message||error),true);
  }finally{cashSetBusy(btn,false);cashUnlock("open");}
}

async function loadOpenCashDetails(){
  const id=currentCashRegister.id;
  const [bookingsRes,movementsRes]=await Promise.all([
    sb.from("bookings").select("id,client_name,service_name,price,payment_method,completed_at,barber_name").eq("cash_register_id",id).eq("status","concluido").order("completed_at"),
    sb.from("cash_movements").select("*").eq("cash_register_id",id).order("created_at",{ascending:false})
  ]);
  if(bookingsRes.error)return adminToast("Erro ao carregar vendas do caixa: "+bookingsRes.error.message,true);
  if(movementsRes.error)return adminToast("Erro ao carregar movimentações: "+movementsRes.error.message,true);

  currentCashBookings=bookingsRes.data||[];
  currentCashMovements=movementsRes.data||[];
  renderOpenCashNumbers();
  renderCashMovements();
}

function cashMoney(value){return window.JK?.money?JK.money(Number(value||0)):Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function cashSales(method){return currentCashBookings.filter(b=>b.payment_method===method);}
function cashSum(list,key="price"){return list.reduce((a,x)=>a+Number(x[key]||0),0);}

function cashLiveStats(){
  const pix=cashSales("pix"),card=cashSales("cartao"),money=cashSales("dinheiro");
  const incoming=currentCashMovements.filter(m=>["entrada","suprimento"].includes(m.movement_type));
  const outgoing=currentCashMovements.filter(m=>["saida","sangria"].includes(m.movement_type));
  const inTotal=cashSum(incoming,"amount"),outTotal=cashSum(outgoing,"amount");
  const opening=Number(currentCashRegister?.opening_amount||0);
  return {
    pixTotal:cashSum(pix),cardTotal:cashSum(card),moneyTotal:cashSum(money),
    pixCuts:pix.length,cardCuts:card.length,moneyCuts:money.length,
    gross:cashSum(currentCashBookings),
    cuts:currentCashBookings.length,
    inTotal,outTotal,
    movementNet:inTotal-outTotal,
    expected:opening+cashSum(money)+inTotal-outTotal
  };
}

function renderOpenCashNumbers(){
  const st=cashLiveStats();
  const date=new Date(currentCashRegister.opened_at);
  cashQ("#cashOpenedAt").textContent=`desde ${date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}`;
  cashQ("#cashOpeningKpi").textContent=cashMoney(currentCashRegister.opening_amount);
  cashQ("#cashGrossKpi").textContent=cashMoney(st.gross);
  cashQ("#cashCutsKpi").textContent=`${st.cuts} ${st.cuts===1?"corte":"cortes"} concluídos`;
  cashQ("#cashExpectedKpi").textContent=cashMoney(st.expected);
  cashQ("#cashMovementKpi").textContent=cashMoney(st.movementNet);
  cashQ("#cashPixTotal").textContent=cashMoney(st.pixTotal);
  cashQ("#cashPixCuts").textContent=`${st.pixCuts} cortes`;
  cashQ("#cashCardTotal").textContent=cashMoney(st.cardTotal);
  cashQ("#cashCardCuts").textContent=`${st.cardCuts} cortes`;
  cashQ("#cashMoneyTotal").textContent=cashMoney(st.moneyTotal);
  cashQ("#cashMoneyCuts").textContent=`${st.moneyCuts} cortes`;
  updateCashClosePreview();
}

function renderCashMovements(){
  const root=cashQ("#cashMovementList");
  if(!root)return;
  if(!currentCashMovements.length){
    root.innerHTML='<div class="empty">Nenhuma movimentação manual neste caixa.</div>';
    return;
  }
  const labels={entrada:"Entrada",saida:"Saída",sangria:"Sangria",suprimento:"Suprimento"};
  root.innerHTML=currentCashMovements.map(m=>`
    <div class="cash-movement-row ${m.movement_type} ${m._optimistic?"is-syncing":""}">
      <span class="cash-movement-sign">${["entrada","suprimento"].includes(m.movement_type)?"+":"−"}</span>
      <span><strong>${labels[m.movement_type]||m.movement_type}</strong><small>${JK.esc(m.description)}${m._optimistic?" · sincronizando...":""}</small></span>
      <span><strong>${cashMoney(m.amount)}</strong><small>${new Date(m.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small></span>
    </div>`).join("");
}

async function addCashMovement(e){
  e.preventDefault();
  if(!currentCashRegister)return adminToast("Abra o caixa primeiro.",true);
  if(!cashLock("movement"))return;

  const type=cashQ("#cashMovementType").value;
  const amount=Number(cashQ("#cashMovementAmount").value||0);
  const description=String(cashQ("#cashMovementDescription").value||"").trim();
  const btn=e.currentTarget.querySelector('button[type="submit"]');

  if(amount<=0){cashUnlock("movement");return adminToast("Informe um valor maior que zero.",true);}
  if(description.length<2){cashUnlock("movement");return adminToast("Informe a descrição.",true);}

  const operationKey=cashOperationKey();
  const optimisticId=`temp-${operationKey}`;
  const optimisticRow={
    id:optimisticId,
    cash_register_id:currentCashRegister.id,
    movement_type:type,
    amount,
    description,
    operation_key:operationKey,
    created_at:new Date().toISOString(),
    _optimistic:true
  };

  // Resposta visual instantânea.
  cashPendingMovementCount++;
  currentCashMovements=[optimisticRow,...currentCashMovements];
  renderOpenCashNumbers();
  renderCashMovements();
  e.currentTarget.reset();
  cashSetBusy(btn,true,"Salvando...");

  try{
    const payload={
      cash_register_id:currentCashRegister.id,
      movement_type:type,
      amount,
      description,
      operation_key:operationKey
    };

    let {data,error}=await sb.from("cash_movements").insert(payload).select("*").single();

    // Em conexão instável, o banco pode ter confirmado a gravação
    // mesmo que o navegador tenha perdido a resposta.
    if(error||!data){
      const verify=await sb.from("cash_movements")
        .select("*")
        .eq("operation_key",operationKey)
        .maybeSingle();

      if(verify.data){
        data=verify.data;
        error=null;
      }
    }

    if(error||!data)throw error||new Error("Não foi possível confirmar a movimentação.");

    currentCashMovements=currentCashMovements.map(row=>
      row.id===optimisticId?data:row
    );
    renderOpenCashNumbers();
    renderCashMovements();
    adminToast("Movimentação registrada.");
  }catch(error){
    // Só remove o lançamento visual se realmente não conseguimos confirmar.
    currentCashMovements=currentCashMovements.filter(row=>row.id!==optimisticId);
    renderOpenCashNumbers();
    renderCashMovements();
    adminToast("Não foi possível confirmar a movimentação. Tente novamente.",true);
    console.error("JK Caixa addCashMovement:",error);
  }finally{
    cashPendingMovementCount=Math.max(0,cashPendingMovementCount-1);
    cashSetBusy(btn,false);
    cashUnlock("movement");
  }
}

function updateCashClosePreview(){
  const box=cashQ("#cashClosePreview");
  if(!box||!currentCashRegister)return;

  const input=cashQ("#cashCountedAmount");
  const rawValue=String(input?.value??"").trim();
  const st=cashLiveStats();

  // Enquanto o proprietário ainda não informar o valor contado,
  // não mostramos diferença negativa para evitar confusão.
  if(rawValue===""){
    box.innerHTML=`
      <div><span>Esperado em dinheiro</span><strong>${cashMoney(st.expected)}</strong></div>
      <div><span>Contado</span><strong>—</strong></div>
      <div class="waiting"><span>Diferença</span><strong>Aguardando contagem</strong></div>`;
    return;
  }

  const counted=Number(rawValue);
  const diff=counted-st.expected;

  box.innerHTML=`
    <div><span>Esperado em dinheiro</span><strong>${cashMoney(st.expected)}</strong></div>
    <div><span>Contado</span><strong>${cashMoney(counted)}</strong></div>
    <div class="${diff===0?"ok":diff>0?"positive":"negative"}"><span>Diferença</span><strong>${cashMoney(diff)}</strong></div>`;
}

async function closeCashRegister(e){
  e.preventDefault();
  if(!currentCashRegister)return adminToast("Nenhum caixa aberto.",true);
  if(cashPendingMovementCount>0)return adminToast("Aguarde a movimentação terminar de sincronizar antes de fechar o caixa.",true);
  if(!cashLock("close"))return;
  const counted=Number(cashQ("#cashCountedAmount").value);
  const notes=String(cashQ("#cashCloseNotes").value||"").trim();
  const st=cashLiveStats(),diff=counted-st.expected;

  if(!Number.isFinite(counted)||counted<0){cashUnlock("close");return adminToast("Informe o dinheiro contado.",true);}
  if(Math.abs(diff)>=0.01&&!notes){
    cashUnlock("close"); return adminToast("Há diferença no caixa. Informe uma observação antes de fechar.",true);
  }
  if(!confirm(`Fechar o caixa?\nEsperado: ${cashMoney(st.expected)}\nContado: ${cashMoney(counted)}\nDiferença: ${cashMoney(diff)}`)){cashUnlock("close");return;}

  const btn=e.currentTarget.querySelector("button");
  cashSetBusy(btn,true,"Fechando caixa...");
  try{
    const {error}=await sb.rpc("close_cash_register",{p_counted_cash:counted,p_notes:notes});
    if(error)throw error;
    adminToast("Caixa fechado e conferido.");
    e.currentTarget.reset();
    currentCashRegister=null;currentCashBookings=[];currentCashMovements=[];
    cashQ("#cashClosedState").hidden=false;
    cashQ("#cashOpenState").hidden=true;
    await renderCashHistory();
  }catch(error){
    adminToast("Erro ao fechar caixa: "+(error?.message||error),true);
  }finally{cashSetBusy(btn,false);cashUnlock("close");}
}

async function renderCashHistory(){
  const root=cashQ("#cashHistoryRows");
  if(!root)return;
  const {data,error}=await sb.from("cash_registers").select("*").order("opened_at",{ascending:false}).limit(40);
  if(error){root.innerHTML='<tr><td colspan="9">Erro ao carregar histórico.</td></tr>';return;}
  if(!data?.length){root.innerHTML='<tr><td colspan="9"><div class="empty">Nenhum caixa registrado.</div></td></tr>';return;}

  root.innerHTML=data.map(r=>{
    const opened=new Date(r.opened_at);
    const closed=r.closed_at?new Date(r.closed_at):null;
    const diff=Number(r.difference_amount||0);
    return `<tr>
      <td>${opened.toLocaleDateString("pt-BR")}</td>
      <td>${opened.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}<br><span class="muted">${cashMoney(r.opening_amount)}</span></td>
      <td>${closed?closed.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):'<span class="status confirmado">ABERTO</span>'}</td>
      <td><strong>${cashMoney(r.gross_total)}</strong></td>
      <td>${cashMoney(r.pix_total)}</td>
      <td>${cashMoney(r.card_total)}</td>
      <td>${cashMoney(r.cash_sales_total)}</td>
      <td class="${diff<0?"cash-diff-negative":diff>0?"cash-diff-positive":""}"><strong>${r.status==="fechado"?cashMoney(diff):"—"}</strong></td>
      <td><div class="cash-history-actions">
        <button class="mini-btn" type="button" onclick="showCashHistoryDetail(${r.id})">Detalhes</button>
        ${r.status==="fechado"?`<button class="mini-btn cash-delete-btn" type="button" onclick="openDeleteCashModal(${r.id})">Excluir</button>`:""}
      </div></td>
    </tr>`;
  }).join("");
}

async function showCashHistoryDetail(id){
  const detail=cashQ("#cashHistoryDetail");
  if(!detail)return;
  detail.hidden=false;
  detail.innerHTML="Carregando detalhes...";
  const [regRes,bookRes,movRes]=await Promise.all([
    sb.from("cash_registers").select("*").eq("id",id).single(),
    sb.from("bookings").select("client_name,service_name,barber_name,price,payment_method,completed_at").eq("cash_register_id",id).eq("status","concluido").order("completed_at"),
    sb.from("cash_movements").select("*").eq("cash_register_id",id).order("created_at")
  ]);
  if(regRes.error||bookRes.error||movRes.error){detail.innerHTML='<div class="empty">Não foi possível carregar os detalhes.</div>';return;}
  const r=regRes.data,b=bookRes.data||[],m=movRes.data||[];
  detail.innerHTML=`
    <div class="card-head"><div><span class="eyebrow">Caixa #${r.id}</span><h2>${new Date(r.opened_at).toLocaleDateString("pt-BR")}</h2></div><button type="button" class="mini-btn" onclick="document.querySelector('#cashHistoryDetail').hidden=true">Fechar detalhe</button></div>
    <div class="cash-detail-summary">
      <span>Inicial <b>${cashMoney(r.opening_amount)}</b></span>
      <span>Vendas <b>${cashMoney(r.gross_total)}</b></span>
      <span>Esperado <b>${r.expected_cash===null?"—":cashMoney(r.expected_cash)}</b></span>
      <span>Contado <b>${r.counted_cash===null?"—":cashMoney(r.counted_cash)}</b></span>
      <span>Diferença <b>${r.difference_amount===null?"—":cashMoney(r.difference_amount)}</b></span>
    </div>
    <h3>Atendimentos</h3>
    <div class="cash-detail-list">${b.length?b.map(x=>`<div><span>${JK.esc(x.client_name)} · ${JK.esc(x.service_name)} · ${JK.esc(x.barber_name||"—")}</span><strong>${cashMoney(x.price)} · ${x.payment_method==="cartao"?"Cartão":x.payment_method==="pix"?"Pix":"Dinheiro"}</strong></div>`).join(""):'<div class="empty">Nenhuma venda vinculada.</div>'}</div>
    <h3>Movimentações manuais</h3>
    <div class="cash-detail-list">${m.length?m.map(x=>`<div><span>${JK.esc(x.description)}</span><strong>${x.movement_type} · ${cashMoney(x.amount)}</strong></div>`).join(""):'<div class="empty">Nenhuma movimentação.</div>'}</div>`;
  detail.scrollIntoView({behavior:"smooth",block:"start"});
}

// Disponibiliza o módulo para o roteador do painel.
window.renderCashAdmin=renderCashAdmin;


// ===== EXCLUSÃO PROTEGIDA DE CAIXA V18 =====
async function openDeleteCashModal(id){
  const {data,error}=await sb.from("cash_registers").select("*").eq("id",id).single();
  if(error||!data)return adminToast("Não foi possível localizar este caixa.",true);
  if(data.status!=="fechado")return adminToast("Feche o caixa antes de excluí-lo.",true);

  pendingCashDeleteId=Number(id);
  pendingCashDeleteRow=data;

  const {data:authData}=await sb.auth.getUser();
  const currentEmail=authData?.user?.email||"";
  cashQ("#deleteCashEmail").value=currentEmail;
  cashQ("#deleteCashPassword").value="";
  cashQ("#deleteCashError").hidden=true;
  cashQ("#deleteCashError").textContent="";

  const date=new Date(data.opened_at);
  cashQ("#deleteCashSummary").innerHTML=`
    <span><small>Caixa</small><strong>#${data.id}</strong></span>
    <span><small>Data</small><strong>${date.toLocaleDateString("pt-BR")}</strong></span>
    <span><small>Vendas</small><strong>${cashMoney(data.gross_total)}</strong></span>
    <span><small>Diferença</small><strong>${cashMoney(data.difference_amount)}</strong></span>`;

  cashQ("#deleteCashModal").hidden=false;
  document.body.classList.add("cash-modal-open");
  setTimeout(()=>cashQ("#deleteCashPassword")?.focus(),80);
}

function closeDeleteCashModal(){
  cashQ("#deleteCashModal").hidden=true;
  document.body.classList.remove("cash-modal-open");
  pendingCashDeleteId=null;
  pendingCashDeleteRow=null;
  cashQ("#deleteCashPassword").value="";
  cashQ("#deleteCashError").hidden=true;
  cashQ("#deleteCashError").textContent="";
}

function deleteCashError(message){
  const box=cashQ("#deleteCashError");
  box.textContent=message; box.hidden=false;
}

async function confirmDeleteCash(e){
  e.preventDefault();
  if(!pendingCashDeleteId||!pendingCashDeleteRow)return deleteCashError("Nenhum caixa selecionado.");
  if(pendingCashDeleteRow.status!=="fechado")return deleteCashError("Somente caixas fechados podem ser excluídos.");

  const email=String(cashQ("#deleteCashEmail").value||"").trim().toLowerCase();
  const password=String(cashQ("#deleteCashPassword").value||"");
  const button=cashQ("#confirmDeleteCashBtn");

  const {data:userData,error:userError}=await sb.auth.getUser();
  if(userError||!userData?.user)return deleteCashError("Sua sessão expirou. Entre novamente.");
  const currentUser=userData.user;
  const currentEmail=String(currentUser.email||"").trim().toLowerCase();

  if(email!==currentEmail)return deleteCashError("Use o mesmo e-mail do proprietário que está logado.");
  if(!password)return deleteCashError("Informe a senha do proprietário.");

  button.disabled=true; button.textContent="Validando senha...";
  try{
    const {data:reauth,error:reauthError}=await sb.auth.signInWithPassword({email,password});
    if(reauthError||!reauth?.user)throw new Error("E-mail ou senha incorretos.");
    if(reauth.user.id!==currentUser.id)throw new Error("Conta diferente do proprietário logado.");

    const {data:latest,error:latestError}=await sb.from("cash_registers")
      .select("id,status").eq("id",pendingCashDeleteId).single();
    if(latestError||!latest)throw new Error("Este caixa não existe mais.");
    if(latest.status!=="fechado")throw new Error("Este caixa não está fechado.");

    button.textContent="Excluindo...";
    const cashId=pendingCashDeleteId;
    const {error:deleteError}=await sb.from("cash_registers")
      .delete().eq("id",cashId).eq("status","fechado");
    if(deleteError)throw deleteError;

    closeDeleteCashModal();
    const detail=cashQ("#cashHistoryDetail"); if(detail)detail.hidden=true;
    adminToast(`Caixa #${cashId} excluído com confirmação do proprietário.`);
    await renderCashHistory();
  }catch(err){
    deleteCashError(err?.message||"Não foi possível excluir o caixa.");
  }finally{
    button.disabled=false; button.textContent="Confirmar e excluir";
  }
}

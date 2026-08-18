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
const cashQ=s=>document.querySelector(s);

document.addEventListener("DOMContentLoaded",()=>{
  if(document.body?.dataset?.adminPage!=="cash")return;
  cashQ("#openCashForm")?.addEventListener("submit",openCashRegister);
  cashQ("#cashMovementForm")?.addEventListener("submit",addCashMovement);
  cashQ("#closeCashForm")?.addEventListener("submit",closeCashRegister);
  cashQ("#refreshCashBtn")?.addEventListener("click",renderCashAdmin);
  cashQ("#cashCountedAmount")?.addEventListener("input",updateCashClosePreview);
});

async function renderCashAdmin(){
  const {data:open,error}=await sb.from("cash_registers").select("*").eq("status","aberto").maybeSingle();
  if(error)return adminToast("Erro ao carregar caixa: "+error.message,true);
  currentCashRegister=open||null;

  cashQ("#cashClosedState").hidden=!!currentCashRegister;
  cashQ("#cashOpenState").hidden=!currentCashRegister;

  if(currentCashRegister)await loadOpenCashDetails();
  await renderCashHistory();
}

async function openCashRegister(e){
  e.preventDefault();
  const amount=Number(cashQ("#cashOpeningAmount")?.value||0);
  if(amount<0)return adminToast("Valor inicial inválido.",true);

  const btn=e.currentTarget.querySelector("button");
  if(btn){btn.disabled=true;btn.textContent="Abrindo...";}
  const {error}=await sb.from("cash_registers").insert({opening_amount:amount});
  if(btn){btn.disabled=false;btn.textContent="Abrir caixa";}
  if(error){
    if(String(error.message).toLowerCase().includes("duplicate"))return adminToast("Já existe um caixa aberto.",true);
    return adminToast("Erro ao abrir caixa: "+error.message,true);
  }
  adminToast("Caixa aberto com sucesso.");
  await renderCashAdmin();
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
    <div class="cash-movement-row ${m.movement_type}">
      <span class="cash-movement-sign">${["entrada","suprimento"].includes(m.movement_type)?"+":"−"}</span>
      <span><strong>${labels[m.movement_type]||m.movement_type}</strong><small>${JK.esc(m.description)}</small></span>
      <span><strong>${cashMoney(m.amount)}</strong><small>${new Date(m.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small></span>
    </div>`).join("");
}

async function addCashMovement(e){
  e.preventDefault();
  if(!currentCashRegister)return adminToast("Abra o caixa primeiro.",true);
  const type=cashQ("#cashMovementType").value;
  const amount=Number(cashQ("#cashMovementAmount").value||0);
  const description=String(cashQ("#cashMovementDescription").value||"").trim();
  if(amount<=0)return adminToast("Informe um valor maior que zero.",true);
  if(description.length<2)return adminToast("Informe a descrição.",true);

  const {error}=await sb.from("cash_movements").insert({
    cash_register_id:currentCashRegister.id,movement_type:type,amount,description
  });
  if(error)return adminToast("Erro ao registrar movimentação: "+error.message,true);
  e.currentTarget.reset();
  adminToast("Movimentação registrada.");
  await loadOpenCashDetails();
}

function updateCashClosePreview(){
  const box=cashQ("#cashClosePreview");
  if(!box||!currentCashRegister)return;
  const counted=Number(cashQ("#cashCountedAmount")?.value||0);
  const st=cashLiveStats(),diff=counted-st.expected;
  box.innerHTML=`
    <div><span>Esperado em dinheiro</span><strong>${cashMoney(st.expected)}</strong></div>
    <div><span>Contado</span><strong>${cashMoney(counted)}</strong></div>
    <div class="${diff===0?"ok":diff>0?"positive":"negative"}"><span>Diferença</span><strong>${cashMoney(diff)}</strong></div>`;
}

async function closeCashRegister(e){
  e.preventDefault();
  if(!currentCashRegister)return adminToast("Nenhum caixa aberto.",true);
  const counted=Number(cashQ("#cashCountedAmount").value);
  const notes=String(cashQ("#cashCloseNotes").value||"").trim();
  const st=cashLiveStats(),diff=counted-st.expected;

  if(!Number.isFinite(counted)||counted<0)return adminToast("Informe o dinheiro contado.",true);
  if(Math.abs(diff)>=0.01&&!notes){
    return adminToast("Há diferença no caixa. Informe uma observação antes de fechar.",true);
  }
  if(!confirm(`Fechar o caixa?\nEsperado: ${cashMoney(st.expected)}\nContado: ${cashMoney(counted)}\nDiferença: ${cashMoney(diff)}`))return;

  const btn=e.currentTarget.querySelector("button");
  if(btn){btn.disabled=true;btn.textContent="Fechando...";}
  const {error}=await sb.rpc("close_cash_register",{p_counted_cash:counted,p_notes:notes});
  if(btn){btn.disabled=false;btn.textContent="Fechar caixa";}
  if(error)return adminToast("Erro ao fechar caixa: "+error.message,true);

  adminToast("Caixa fechado e conferido.");
  e.currentTarget.reset();
  await renderCashAdmin();
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
      <td><button class="mini-btn" type="button" onclick="showCashHistoryDetail(${r.id})">Detalhes</button></td>
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


const { createClient } = supabase;

function ensureConfig(){
  const cfg = window.JK_CONFIG || {};
  const bad = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
    cfg.SUPABASE_URL.includes("COLE_") || cfg.SUPABASE_ANON_KEY.includes("COLE_");
  if(bad){
    throw new Error("Supabase ainda não configurado. Edite js/config.js.");
  }
  return cfg;
}
const cfg = ensureConfig();
window.sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
window.JK = {
  money(v){ return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); },
  todayISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().split("T")[0]; },
  esc(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
};

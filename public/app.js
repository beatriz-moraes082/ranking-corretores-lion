/* Ranking de Corretores, Lion. Frontend (sem dependências). */
const $ = (s, r = document) => r.querySelector(s);
const num = (n) => (n || 0).toLocaleString("pt-BR");
const brlK = (n) => {
  n = n || 0;
  if (n >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (n >= 1e3) return "R$ " + Math.round(n / 1e3) + "k";
  return "R$ " + num(n);
};

let estado = { data: null, ord: "score", view: "ranking", equipe: "", corretorSel: "", evolucao: null, evolucaoErro: null, evoJanela: "semana", paradosTodos: false };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const chave = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;

/* ---------- ícones (traço fino, herdam a cor do texto) ---------- */
const ICO_PATHS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  proposta: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  trofeu: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  moeda: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11"/>',
  alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  seta: '<path d="M7 17 17 7M8 7h9v9"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  casa: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  chave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M15 8l2 2"/>',
  alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  pct: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  escudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  movim: '<path d="m3 17 6-6 4 4 8-8M14 7h7v7"/>',
};
const ico = (k) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO_PATHS[k] || ""}</svg>`;

// textos de como cada dimensão é medida
const DIM_DESC = {
  volume: "Nº de leads recebidos no período.",
  vendas: "Nº de vendas fechadas (leads que viraram venda).",
  propostas: "Leads recebidos no período que chegaram em Proposta (ou já viraram venda).",
  conversao: "Vendas ÷ leads recebidos.",
  contato: "Tempo entre a captura do lead e a qualificação. Quanto menor, mais rápido.",
  mov: "Leads trabalhados ÷ leads recebidos (saíram de 'novos').",
  consist: "Leads parados +15 dias por lead. Quanto menos, melhor.",
};
const DIM_ICO = { volume: "users", vendas: "trofeu", propostas: "proposta", conversao: "pct", contato: "relogio", mov: "movim", consist: "escudo" };

/* ---------- tema ---------- */
// Padrão claro (como a referência). A escolha fica salva no navegador.
const TEMA_KEY = "tema-v3";
function lerTema() { try { return localStorage.getItem(TEMA_KEY) || "light"; } catch { return "light"; } }
function aplicarTema(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("#themeToggle").innerHTML = ico(t === "dark" ? "sol" : "lua");
}
function toggleTema() {
  const novo = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try { localStorage.setItem(TEMA_KEY, novo); } catch {}
  aplicarTema(novo);
  if (estado.data) render();
}
aplicarTema(lerTema());

/* ---------- período ---------- */
// data local (Brasil), não UTC: depois das 21h o UTC já é o dia seguinte
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dataBR = (iso) => iso.split("-").reverse().join("/");
const dataCurta = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
function periodoAtual() {
  const preset = $(".chip.ativo").dataset.preset;
  const hoje = new Date();
  if (preset === "semana") { const i = new Date(hoje); i.setDate(hoje.getDate() - 6); return { inicio: isoDate(i), fim: isoDate(hoje) }; }
  if (preset === "custom") return { inicio: $("#inicio").value, fim: $("#fim").value };
  return { inicio: isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoDate(hoje) };
}

/* ---------- perfis: score + dimensões do radar ---------- */
const DIMS = [
  { key: "volume", label: "Volume", short: "Volume", raw: (c) => c.leads, disp: (c) => `${c.leads} leads` },
  { key: "vendas", label: "Vendas", short: "Vendas", raw: (c) => c.vendas, disp: (c) => `${c.vendas} vendas` },
  { key: "conversao", label: "Conversão", short: "Conv.", raw: (c) => c.conversao, disp: (c) => `${c.conversao}%` },
  { key: "contato", label: "1º contato", short: "1º contato", raw: (c) => (c.tempoQualifHoras == null ? null : -c.tempoQualifHoras), disp: (c) => (c.tempoQualifHoras == null ? "n/d" : `${c.tempoQualifHoras}h`) },
  { key: "mov", label: "Movimentação", short: "Movim.", raw: (c) => (c.leads ? c.movimentados / c.leads : 0), disp: (c) => `${Math.round((c.leads ? c.movimentados / c.leads : 0) * 100)}%` },
  { key: "consist", label: "Consistência", short: "Consist.", raw: (c) => (c.leads ? -(c.parados15d / c.leads) : 0), disp: (c) => `${c.parados15d} parados` },
];
// Score: volume, movimentação e 1º contato ficam só no radar (o pré-atendimento é
// da recepção, o corretor já recebe o lead qualificado). Proposta entra com peso alto porque
// acontece mais que venda e converte bem, mostra quem está construindo resultado.
const DIM_PROPOSTAS = { key: "propostas", label: "Propostas", short: "Propostas", raw: (c) => c.propostas || 0, disp: (c) => `${c.propostas || 0} proposta${c.propostas === 1 ? "" : "s"}` };
const SCORE_DIMS = [DIMS[1], DIM_PROPOSTAS, DIMS[2], DIMS[5]];
const PESOS = { vendas: 0.35, propostas: 0.3, conversao: 0.2, consist: 0.15 };

function calcularPerfis(corretores) {
  const cohort = corretores.filter((c) => c.leads > 0);
  if (!cohort.length) return [];
  // min/max por dimensão (ignora null)
  const stats = {};
  const TODAS = [...DIMS, DIM_PROPOSTAS];
  for (const d of TODAS) {
    const vals = cohort.map((c) => d.raw(c)).filter((v) => v != null);
    stats[d.key] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  const norm = (d, c) => {
    let v = d.raw(c);
    const { min, max } = stats[d.key];
    if (v == null) v = min;
    if (max === min) return 50;
    return Math.round(((v - min) / (max - min)) * 100);
  };
  const perfis = cohort.map((c) => {
    const dims = {};
    for (const d of TODAS) dims[d.key] = norm(d, c);
    const score = Math.round(SCORE_DIMS.reduce((s, d) => s + dims[d.key] * (PESOS[d.key] || 0), 0));
    const ord = [...DIMS].sort((a, b) => dims[b.key] - dims[a.key]);
    return {
      c, dims, score,
      fortes: ord.slice(0, 2).map((d) => ({ label: d.label, v: d.disp(c) })),
      melhorar: ord.slice(-2).reverse().map((d) => ({ label: d.label, v: d.disp(c) })),
    };
  });
  perfis.sort((a, b) => b.score - a.score);
  return perfis;
}

/* ---------- utilidades visuais ---------- */
function iniciais(nome) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
const avatar = (nome, extra = "") => `<span class="av ${extra}">${iniciais(nome)}</span>`;
const nomeCurto = (nome) => {
  const p = nome.trim().split(/\s+/);
  return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : nome.trim();
};

// Card de número (padrão da referência): ícone, título, apoio e o número embaixo.
function statCard({ ico: i, titulo, sub = "", valor, unid = "", extra = "", cls = "", go = "", cu = true, money = false }) {
  return `<div class="card stat ${cls}">
    <div class="stat-top"><span class="ico-c">${ico(i)}</span>${go ? `<button class="ic-go" data-go="${go}" title="Abrir" aria-label="Abrir">${ico("seta")}</button>` : ""}</div>
    <div class="stat-tit">${titulo}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
    <div class="stat-base">
      <div class="stat-val"><b ${cu && typeof valor === "number" ? `data-cu="${valor}" data-money="${money ? 1 : 0}"` : ""}>${typeof valor === "number" ? (money ? brlK(valor) : num(valor)) : valor}</b>${unid ? `<small>${unid}</small>` : ""}</div>
      ${extra}
    </div>
  </div>`;
}

// Mini-gráfico de pontos (até 5): quantos de N, como os pontinhos da referência.
const pontos = (qtd, total = 5) => `<span class="pontos">${Array.from({ length: total }, (_, i) => `<i class="${i < qtd ? "on" : ""}"></i>`).join("")}</span>`;
// Mini barras verticais (proporção de uma parte no todo).
function miniBarras(vals) {
  const max = Math.max(1, ...vals);
  return `<span class="mbar">${vals.map((v) => `<i style="height:${Math.max(8, (v / max) * 100)}%"></i>`).join("")}</span>`;
}

/* radar hexagonal */
function radarSVG(dims) {
  const cx = 150, cy = 106, R = 80, N = DIMS.length;
  const ang = (i) => (Math.PI * 2 * i) / N - Math.PI / 2;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  let g = "";
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    const pts = DIMS.map((_, i) => pt(i, R * ring).map((n) => n.toFixed(1)).join(",")).join(" ");
    g += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  }
  DIMS.forEach((d, i) => {
    const [x, y] = pt(i, R);
    g += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 16);
    const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
    g += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" font-weight="500" fill="var(--txt-dim)" font-family="Inter Tight,sans-serif">${d.short}</text>`;
  });
  const poly = DIMS.map((d, i) => pt(i, R * Math.max(0.04, dims[d.key] / 100)).map((n) => n.toFixed(1)).join(",")).join(" ");
  g += `<polygon points="${poly}" fill="var(--accent-wash)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  DIMS.forEach((d, i) => { const [x, y] = pt(i, R * Math.max(0.04, dims[d.key] / 100)); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>`; });
  return `<svg class="radar-svg" viewBox="0 0 300 214" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

/* ---------- carregar ---------- */
async function carregar({ soft = false } = {}) {
  const { inicio, fim } = periodoAtual();
  if (!inicio || !fim) return;
  if (!soft) {
    $("#conteudo").innerHTML = `<div class="carregando"><div class="loader"></div><p>Consultando o Supremo CRM…<br><small>Períodos longos podem levar ~1 min na 1ª vez.</small></p></div>`;
    $("#bento").innerHTML = ""; $("#heroNum").innerHTML = ""; $("#escuro").classList.add("oculto");
  }
  try {
    const r = await fetch(`/api/ranking?inicio=${inicio}&fim=${fim}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalhe || data.erro || "Falha");
    estado.data = data;
    render();
    const hora = new Date(data.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("#atualizadoEm").textContent = `${hora} · ${dataCurta(data.periodo.inicio)} a ${dataCurta(data.periodo.fim)}`;
    $("#rodapeInfo").textContent = `Dados do Supremo CRM · período ${dataBR(data.periodo.inicio)} a ${dataBR(data.periodo.fim)} · atualizado às ${hora}`;
  } catch (e) {
    if (!soft) $("#conteudo").innerHTML = `<div class="erro"><b>Não consegui carregar.</b><br>${esc(e.message)}</div>`;
  }
}

/* ---------- equipes ---------- */
// A API do Supremo não tem equipe/gerente: vêm do equipes.json do servidor.
function equipeAtual() {
  return (estado.data?.equipes || []).find((e) => e.id === estado.equipe) || null;
}
function naEquipe(nome) {
  const eq = equipeAtual();
  if (!eq) return true;
  if (!eq._set) eq._set = new Set(eq.corretores.map(chave));
  return eq._set.has(chave(nome));
}
function nomeGrupo() {
  const eq = equipeAtual();
  return eq ? eq.nome : "Imobiliária";
}
function renderSeletorEquipe() {
  const sel = $("#equipeSel");
  const equipes = estado.data?.equipes || [];
  if (estado.equipe && !equipes.some((e) => e.id === estado.equipe)) estado.equipe = "";
  sel.classList.toggle("oculto", !equipes.length);
  sel.innerHTML = `<option value="">Toda a imobiliária</option>` +
    equipes.map((e) => `<option value="${esc(e.id)}">${esc(e.nome)}${e.gerente ? ` · ${esc(e.gerente)}` : ""}</option>`).join("");
  sel.value = estado.equipe;
}

/* ---------- render ---------- */
const TITULOS = { ranking: "Ranking dos corretores", funil: "Funil de vendas", perfil: "Perfil comportamental", metodo: "Como o score funciona" };

function render() {
  const d = estado.data;
  renderSeletorEquipe();
  // Score é sempre relativo à imobiliária inteira (não muda ao filtrar a equipe).
  const perfis = calcularPerfis(d.corretores).filter((p) => naEquipe(p.c.nome));
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("ativo", t.dataset.view === estado.view));
  $("#titulo").textContent = TITULOS[estado.view];
  $("#filtrosExtra").innerHTML = "";
  $("#conteudo").innerHTML = "";
  $("#escuroIn").innerHTML = "";
  if (estado.view === "metodo") renderMetodo(perfis);
  else if (estado.view === "perfil") renderPerfil(perfis);
  else if (estado.view === "funil") renderFunil(d);
  else renderRanking(d, perfis);
  $("#escuro").classList.toggle("oculto", !$("#escuroIn").children.length);
  $("#bento").classList.toggle("oculto", !$("#bento").children.length);
  animarNumeros();
}

// count-up dos números grandes
function animarNumeros() {
  document.querySelectorAll("[data-cu]").forEach((el) => {
    const alvo = Number(el.dataset.cu);
    const money = el.dataset.money === "1";
    if (!alvo) return;
    const final = money ? brlK(alvo) : num(alvo);
    const t0 = performance.now();
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      const v = alvo * (1 - Math.pow(1 - p, 3));
      el.textContent = p < 1 ? (money ? brlK(v) : Math.round(v).toLocaleString("pt-BR")) : final;
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
    // garante o valor final mesmo se a aba estiver em segundo plano (rAF pausado)
    setTimeout(() => { el.textContent = final; }, 1100);
  });
}

function heroNum({ rotulo, valor, nota }) {
  $("#heroNum").innerHTML = `<div class="hero-num">
    <div class="hero-rot">${rotulo}</div>
    <div class="hero-linha"><b data-cu="${valor}">${num(valor)}</b><span>${nota}</span></div>
  </div>`;
}

const secao = (titulo, sub, extra = "") => `<div class="secao-hd"><h2>${titulo}</h2>${sub ? `<span>${sub}</span>` : ""}${extra}</div>`;

/* ---------- aba: ranking ---------- */
function renderRanking(d, perfis) {
  const eq = equipeAtual();
  const alertas = (d.alertas || []).filter((a) => naEquipe(a.corretor));
  let r = d.resumo;
  const cs = d.corretores.filter((x) => naEquipe(x.nome));
  const propostas = cs.reduce((s, x) => s + (x.propostas || 0), 0);
  if (eq) {
    const leads = cs.reduce((s, x) => s + x.leads, 0), vendas = cs.reduce((s, x) => s + x.vendas, 0), vgv = cs.reduce((s, x) => s + x.vgv, 0);
    r = {
      leads, vendas, vgv, ticketMedio: vendas ? Math.round(vgv / vendas) : 0,
      corretoresAtivos: cs.filter((x) => x.leads > 0).length,
      conversaoGeral: leads ? +(100 * vendas / leads).toFixed(1) : 0,
      parados15d: alertas.length,
    };
  }

  heroNum({
    rotulo: "leads recebidos no período",
    valor: r.leads,
    nota: `${plural(r.corretoresAtivos, "corretor ativo", "corretores ativos")}${eq ? `<br>${esc(eq.nome)}` : ""}`,
  });

  /* bento: pódio + 3 números */
  const top = perfis.slice(0, 3);
  const podio = top.map((p, i) => `<div class="card stat pod ${i === 0 ? "glass" : ""}">
      <div class="stat-top"><span class="pod-pos">${i + 1}º</span><span class="pod-chip">${p.c.leads} leads</span></div>
      <div class="stat-tit">${esc(nomeCurto(p.c.nome))}</div>
      <div class="stat-sub">${plural(p.c.vendas, "venda", "vendas")} · ${plural(p.c.propostas || 0, "proposta", "propostas")} · conv. ${p.c.conversao}%</div>
      <div class="stat-base"><div class="stat-val"><b data-cu="${p.score}">${p.score}</b><small>pts</small></div>${pontos(Math.round(p.score / 20))}</div>
    </div>`).join("");
  const graves = alertas.filter((a) => a.diasParado > 30).length;
  $("#bento").innerHTML = podio +
    statCard({ ico: "proposta", titulo: "Propostas", sub: "leads do período que chegaram em proposta", valor: propostas, unid: "propostas" }) +
    statCard({
      ico: "trofeu", titulo: "Vendas fechadas", sub: `conversão ${r.conversaoGeral}% · VGV ${brlK(r.vgv)} · ticket ${brlK(r.ticketMedio)}`,
      valor: r.vendas, unid: r.vendas === 1 ? "venda" : "vendas",
    }) +
    statCard({
      ico: "alerta", titulo: "Parados +15 dias", sub: d.alertasProntos ? `${num(graves)} há mais de 30 dias` : "calculando…",
      valor: r.parados15d, unid: "leads", go: "funil", cls: r.parados15d ? "alerta" : "",
      extra: miniBarras([alertas.length - graves, graves]),
    });

  /* área escura: ranking completo + parados */
  const ordens = [
    { k: "score", lab: "Score" }, { k: "propostas", lab: "Propostas" }, { k: "vendas", lab: "Vendas" },
    { k: "conversao", lab: "Conversão" }, { k: "leads", lab: "Leads" }, { k: "contato", lab: "1º contato" }, { k: "parados15d", lab: "Parados" },
  ];
  const valOrd = (p, key) => key === "score" ? p.score : key === "contato" ? (p.c.tempoQualifHoras == null ? 1e9 : p.c.tempoQualifHoras) : p.c[key] ?? 0;
  const asc = estado.ord === "contato" || estado.ord === "parados15d"; // menor é melhor
  const ordenado = [...perfis].sort((a, b) => { const x = valOrd(a, estado.ord), y = valOrd(b, estado.ord); return asc ? x - y : y - x; });
  const posScore = Object.fromEntries(perfis.map((p, i) => [p.c.nome, i + 1]));
  const nivel = (n) => (n >= 67 ? "alto" : n >= 34 ? "medio" : "baixo");

  const linhas = ordenado.map((p) => {
    const pos = posScore[p.c.nome];
    const barras = SCORE_DIMS.map((dm) => `<div class="rb"><span>${dm.label} · <b>${dm.disp(p.c).replace(/ (vendas|propostas|proposta|parados)$/, "")}</b></span><i><u class="${nivel(p.dims[dm.key])}" style="width:${Math.max(3, p.dims[dm.key])}%"></u></i></div>`).join("");
    return `<div class="rk-row ${pos === 1 ? "lider" : ""}">
      <div class="rk-pos">${pos}º</div>
      <div class="rk-who"><b>${esc(p.c.nome.trim())}</b><span>${plural(p.c.leads, "lead", "leads")} · 1º contato ${p.c.tempoQualifHoras == null ? "n/d" : p.c.tempoQualifHoras + "h"}</span><i class="rk-track"><u style="width:${p.score}%"></u></i></div>
      <div class="rk-score">${p.score}<small>pts</small></div>
      <div class="rk-bars">${barras}</div>
      <div class="rk-chips">
        <span class="dk-chip" title="VGV vendido">${ico("moeda")}${brlK(p.c.vgv)}</span>
        <span class="dk-chip ${p.c.parados15d ? "ruim" : ""}" title="Leads parados +15 dias">${ico("alerta")}${p.c.parados15d}</span>
      </div>
    </div>`;
  }).join("");

  const escuro = $("#escuroIn");
  escuro.innerHTML = `<section>
      ${secao("Ranking completo", `${perfis.length} corretores · cada barra mostra a nota da métrica (0 a 100) e o valor real`,
        `<div class="pills" id="ordem">${ordens.map((o) => `<button class="pill-b ${o.k === estado.ord ? "ativo" : ""}" data-k="${o.k}">${o.lab}</button>`).join("")}</div>`)}
      <div class="rk-lista">${linhas || `<div class="vazio">Sem dados no período.</div>`}</div>
    </section>
    <section class="secao">${secao("Leads parados há mais de 15 dias", `ativos, sem movimentação · capturados nos últimos ${d.alertaJanelaDias || 45} dias`)}
      ${listaParadosHTML(d, alertas.slice(0, 12), { mostrarCorretor: true })}
      ${alertas.length > 12 ? `<button class="btn-mais" data-go="funil">Ver todos no Funil (${num(alertas.length)})</button>` : ""}
    </section>`;
  escuro.querySelector("#ordem").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    estado.ord = b.dataset.k; render();
  });
}

function listaParadosHTML(d, lista, { mostrarCorretor }) {
  if (!d.alertasProntos) return `<div class="dk-card vazio">Calculando varredura… recarrega em instantes.</div>`;
  if (!lista.length) return `<div class="dk-card vazio">Nenhum lead parado além de 15 dias.</div>`;
  return `<div class="parados-grid">${lista.map((a) => `
    <div class="parado ${a.diasParado > 30 ? "grave" : ""}">
      <div class="pd-dias"><b>${a.diasParado}</b><span>dias</span></div>
      <div class="pd-info">
        <div class="l">${esc(a.lead)}${a.telefone ? ` <span>· ${esc(a.telefone)}</span>` : ""}</div>
        <div class="m"><span class="dk-tag">${esc(a.etapaFunil || "Qualificado")}</span>${mostrarCorretor ? `<span class="dk-tag sutil">${esc(nomeCurto(a.corretor))}</span>` : ""}${a.situacao ? `<span class="sit">${esc(a.situacao.trim())}</span>` : ""}</div>
      </div>
    </div>`).join("")}</div>`;
}

/* ---------- aba: perfil comportamental ---------- */
function renderPerfil(perfis) {
  heroNum({ rotulo: "corretores com leads no período", valor: perfis.length, nota: "6 dimensões, comparadas<br>entre os corretores do período" });
  $("#bento").innerHTML = DIMS.map((dm) => `<div class="card mini-dim ${PESOS[dm.key] ? "" : "fora"}">
      <span class="ico-c">${ico(DIM_ICO[dm.key])}</span>
      <div><b>${dm.label}</b><span>${DIM_DESC[dm.key]}</span></div>
      <em>${PESOS[dm.key] ? `${Math.round(PESOS[dm.key] * 100)}% do score` : "fora do score"}</em>
    </div>`).join("");
  $("#conteudo").innerHTML = `<section class="secao">${secao("Um radar por corretor", "quanto mais longe do centro, melhor naquela dimensão · Volume, Movimentação e 1º contato não entram no score")}
    <div class="radar-grid">${perfis.length ? perfis.map((p, i) => `<div class="card radar-card anim" style="animation-delay:${Math.min(i, 11) * 40}ms">
      <div class="radar-hd">${avatar(p.c.nome)}<div><div class="n">${esc(p.c.nome.trim())}</div><div class="s">score ${p.score} · ${plural(p.c.vendas, "venda", "vendas")} · ${plural(p.c.propostas || 0, "proposta", "propostas")}</div></div><span class="radar-pos">${i + 1}º</span></div>
      ${radarSVG(p.dims)}
      <div class="radar-legend">
        <div class="up"><h4>Fortes</h4><p>${p.fortes.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
        <div class="down"><h4>A melhorar</h4><p>${p.melhorar.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
      </div>
    </div>`).join("") : `<div class="vazio">Sem corretores com leads no período.</div>`}</div></section>`;
}

/* ---------- aba: como o score funciona ---------- */
function renderMetodo(perfis) {
  heroNum({ rotulo: "métricas formam o score", valor: SCORE_DIMS.length, nota: "nota de 0 a 100,<br>relativa aos colegas do período" });
  const ordPeso = [...SCORE_DIMS].sort((a, b) => (PESOS[b.key] || 0) - (PESOS[a.key] || 0));
  $("#bento").innerHTML = `<div class="bento-4">${ordPeso.map((dm) => statCard({
    ico: DIM_ICO[dm.key], titulo: dm.label, sub: DIM_DESC[dm.key], valor: `${Math.round(PESOS[dm.key] * 100)}%`, unid: "do score", cu: false,
    extra: pontos(Math.round(PESOS[dm.key] * 100 / 7), 5),
  })).join("")}</div>`;

  let exemplo = "";
  if (perfis.length) {
    const lider = perfis[0];
    const linhas = SCORE_DIMS.map((dm) => ({
      label: dm.label, valor: dm.disp(lider.c), nota: lider.dims[dm.key], peso: Math.round((PESOS[dm.key] || 0) * 100),
      contrib: lider.dims[dm.key] * (PESOS[dm.key] || 0),
    })).sort((a, b) => b.contrib - a.contrib);
    const total = linhas.reduce((s, l) => s + l.contrib, 0);
    exemplo = `<section class="secao">${secao(`Exemplo real: ${esc(lider.c.nome.trim())}`, "líder do período, calculado ao vivo")}
      <div class="card ex-card">${linhas.map((l) => `<div class="ex-row">
          <span class="ex-nome">${l.label}</span><span class="ex-val">${l.valor}</span>
          <span class="ex-bar"><i style="width:${l.nota}%"></i></span><span class="ex-nota">nota ${l.nota}</span>
          <span class="ex-peso">× ${l.peso}%</span><span class="ex-contrib">${l.contrib.toFixed(1)}</span>
        </div>`).join("")}
        <div class="ex-row total"><span class="ex-nome">Score final</span><span></span><span></span><span></span><span></span><span class="ex-contrib">${Math.round(total)}</span></div>
      </div></section>`;
  }

  $("#conteudo").innerHTML = `
    <section class="secao"><div class="card intro"><p class="big-note">Em cada métrica, o melhor corretor do período vira <em>100</em>, o pior vira <em>0</em> e os outros ficam proporcionais no meio. Depois as notas são somadas com os pesos ao lado.</p>
      <p>A comparação é sempre com a imobiliária inteira, mesmo com uma equipe filtrada.</p></div></section>
    ${exemplo}
    <section class="secao metodo-grid">
      <div class="card"><h3>Pontos importantes</h3><ul class="caveats">
        <li><b>É relativo, não absoluto.</b> O mesmo corretor pode ter score diferente se você muda o período ou o conjunto de colegas comparados.</li>
        <li><b>Consistência</b> é medida por lead: um corretor com muitos leads e alguns parados pode pontuar melhor que outro com poucos leads e vários parados.</li>
        <li><b>Volume, Movimentação e 1º contato não entram no score.</b> O pré-atendimento é feito pela recepção e o corretor já recebe o lead qualificado: quantos leads ele recebe e o tempo da captura até a qualificação não dependem dele. Os três continuam no perfil comportamental e no ranking, como informação.</li>
        <li><b>Propostas</b> tem peso alto porque acontece com mais frequência que a venda e converte bem: mostra quem está construindo resultado antes do fechamento.</li>
        <li><b>Os pesos são ajustáveis.</b> Se para a Lion vale mais proposta, ou punir mais os leads parados, é só recalibrar.</li>
      </ul></div>
      <div class="card"><h3>Como o funil é calculado</h3><ul class="caveats">
        <li><b>Começa em Qualificado.</b> A etapa Lead → Qualificado é do pré-atendimento, então todo lead que chegou ao corretor conta como Qualificado.</li>
        <li><b>As etapas vêm da situação do lead no Supremo:</b> Agendamento ou Análise de crédito → Agendamento/Crédito; Visita; Proposta; Venda (lead vendido).</li>
        <li><b>Etapa pulada conta como passada.</b> Um lead que foi de Qualificado direto pra Visita conta também em Agendamento/Crédito. Lead perdido conta até a situação em que estava quando foi perdido.</li>
        <li><b>Taxa de passagem</b> = quantos chegaram na etapa ÷ quantos chegaram na anterior. O <b>gargalo</b> é a passagem em que o corretor mais fica abaixo da equipe (só conta com pelo menos ${MIN_GARGALO} leads na etapa anterior).</li>
        <li><b>Funil = leads recebidos no período.</b> Por isso a Venda do funil pode ser menor que "Vendas fechadas", que conta pela data da venda, inclusive leads de meses anteriores.</li>
        <li><b>A API só mostra a situação atual,</b> sem o histórico. Se o corretor não atualiza a situação no Supremo, o lead fica parado em Qualificado no funil.</li>
      </ul></div>
    </section>`;
}

/* ---------- aba: funil ---------- */
const MIN_GARGALO = 3; // mínimo de leads na etapa anterior pra uma passagem valer como gargalo
const ETAPAS_PADRAO = ["Qualificado", "Agendamento/Crédito", "Visita", "Proposta", "Venda"];
const ETAPA_ICO = ["check", "agenda", "casa", "proposta", "chave"];
const CURTO = ["Qualif.", "Agend./Créd.", "Visita", "Proposta", "Venda"];
const somaFunil = (lista) => lista.reduce((acc, f) => acc.map((v, i) => v + (f[i] || 0)), ETAPAS_PADRAO.map(() => 0));
// taxa de passagem i-1 -> i (null quando não há base)
const taxa = (f, i) => (f[i - 1] ? (100 * f[i]) / f[i - 1] : null);
const pct = (v) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })}%`);
const pp = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })} p.p.`;

// Passagem em que o corretor mais fica abaixo da referência (equipe).
function gargalo(f, ref) {
  let pior = null;
  for (let i = 1; i < f.length; i++) {
    const t = taxa(f, i), tr = taxa(ref, i);
    if (t == null || tr == null || f[i - 1] < MIN_GARGALO) continue;
    const delta = t - tr;
    if (delta < 0 && (!pior || delta < pior.delta)) pior = { i, delta };
  }
  return pior;
}
// Passagem com a menor taxa (quando não há referência pra comparar).
function piorPassagem(f) {
  let pior = null;
  for (let i = 1; i < f.length; i++) { const t = taxa(f, i); if (t != null && f[i - 1] >= MIN_GARGALO && (!pior || t < pior.t)) pior = { i, t }; }
  return pior;
}

function renderFunil(d) {
  const etapas = d.etapasFunil || ETAPAS_PADRAO;
  const grupo = nomeGrupo();
  const eq = equipeAtual();
  const refNome = eq ? "equipe" : "imob.";
  const corretores = d.corretores.filter((x) => naEquipe(x.nome) && x.funil && x.leads > 0);
  const fGrupo = somaFunil(corretores.map((x) => x.funil));
  const fImob = somaFunil(d.corretores.filter((x) => x.funil).map((x) => x.funil));
  if (estado.corretorSel && !corretores.some((x) => x.nome === estado.corretorSel)) estado.corretorSel = "";
  const sel = corretores.find((x) => x.nome === estado.corretorSel);

  /* seletor de corretor (abaixo dos filtros de período) */
  $("#filtrosExtra").innerHTML = `<div class="fn-sel">
    <select id="corretorSel" class="sel">
      <option value="">${esc(eq ? eq.nome : "Toda a imobiliária")} · resultado geral</option>
      ${[...corretores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((x) => `<option value="${esc(x.nome)}" ${x.nome === estado.corretorSel ? "selected" : ""}>${esc(x.nome.trim())}</option>`).join("")}
    </select>
    ${sel ? `<button class="btn-link" id="voltarGrupo">← voltar para ${esc(eq ? eq.nome : "a imobiliária")}</button>` : ""}
  </div>`;
  $("#corretorSel").addEventListener("change", (e) => { estado.corretorSel = e.target.value; render(); });
  $("#voltarGrupo")?.addEventListener("click", () => { estado.corretorSel = ""; render(); });

  // f = funil mostrado; ref = com quem comparar
  const f = sel ? sel.funil : fGrupo;
  const ref = sel ? fGrupo : eq ? fImob : null;
  const refRot = sel ? (eq ? "equipe" : "imob.") : "imob.";
  heroNum({
    rotulo: sel ? `qualificados recebidos · ${esc(nomeCurto(sel.nome))}` : "qualificados recebidos",
    valor: f[0],
    nota: `${pct(f[0] ? (100 * f[4]) / f[0] : null)} viraram venda<br>leads de ${dataCurta(d.periodo.inicio)} a ${dataCurta(d.periodo.fim)}`,
  });

  /* bento: as 5 etapas + o card de leitura (gargalo) */
  const base = Math.max(1, f[0]);
  const g = ref ? gargalo(f, ref) : null;
  const cards = etapas.map((nome, i) => {
    const t = i ? taxa(f, i) : null, tr = i && ref ? taxa(ref, i) : null;
    const fraco = i && f[i - 1] < MIN_GARGALO;
    let cmp = "";
    if (i && ref) {
      const dir = fraco || t == null || tr == null ? "n" : t >= tr ? "g" : "r";
      cmp = `<span class="cmp ${dir}">${dir === "g" ? "▲" : dir === "r" ? "▼" : "·"} ${refRot} ${pct(tr)}</span>`;
    }
    const sub = i ? `<b>${pct(t)}</b> passaram da etapa anterior ${cmp}` : "todo lead que chegou ao corretor";
    return statCard({
      ico: ETAPA_ICO[i], titulo: `<span class="etapa-n">${i + 1}</span>${nome}`, sub, valor: f[i], cls: `etapa ${g && g.i === i ? "garg" : ""}`,
      unid: i ? `${pct((100 * f[i]) / base)} da base` : "leads",
      extra: `<span class="share"><i style="width:${f[i] ? Math.max(3, (100 * f[i]) / base) : 0}%"></i></span>`,
    });
  });
  let leitura;
  if (ref && g) {
    leitura = { tit: "Gargalo", txt: `${CURTO[g.i - 1]} → ${CURTO[g.i]}: passam ${pct(taxa(f, g.i))}, contra ${pct(taxa(ref, g.i))} ${refRot === "imob." ? "na imobiliária" : "na equipe"}.`, val: pp(g.delta).replace(" p.p.", ""), unid: "p.p. vs referência" };
  } else if (ref) {
    leitura = { tit: "Sem gargalo", txt: `Nenhuma passagem abaixo ${refRot === "imob." ? "da imobiliária" : "da equipe"} (etapas com ${MIN_GARGALO}+ leads).`, val: "✓", unid: "" };
  } else {
    const pior = piorPassagem(f);
    leitura = pior
      ? { tit: "Onde mais se perde", txt: `${CURTO[pior.i - 1]} → ${CURTO[pior.i]}: só ${pct(pior.t)} dos leads avançam.`, val: pct(pior.t), unid: "avançam" }
      : { tit: "Onde mais se perde", txt: "Ainda não há leads suficientes nas etapas.", val: "—", unid: "" };
  }
  cards.push(`<div class="card stat glass">
    <div class="stat-top"><span class="ico-c">${ico("alvo")}</span></div>
    <div class="stat-tit">${leitura.tit}</div><div class="stat-sub">${leitura.txt}</div>
    <div class="stat-base"><div class="stat-val"><b>${leitura.val}</b><small>${leitura.unid}</small></div></div>
  </div>`);
  $("#bento").innerHTML = cards.join("");

  /* área escura: comparativo, parados e evolução */
  const refTxt = eq ? "a equipe" : "a imobiliária";
  const maxQ = Math.max(1, ...corretores.map((x) => x.funil[0]));
  const celula = (fx, i, refx, garg) => {
    const t = taxa(fx, i), tr = refx ? taxa(refx, i) : null, fraco = fx[i - 1] < MIN_GARGALO;
    let dl = "";
    if (t != null && tr != null && !fraco) {
      const dv = t - tr;
      dl = `<small class="${dv >= 0 ? "g" : "r"}">${dv >= 0 ? "▲" : "▼"} ${pp(Math.abs(dv)).replace("+", "")}</small>`;
    }
    return `<td class="cx ${garg ? "gargalo" : fraco ? "fraco" : ""}" title="${num(fx[i])} de ${num(fx[i - 1])}"><b>${pct(t)}</b>${dl}</td>`;
  };
  const linhaRef = `<tr class="ref-row"><td><div class="tb-who"><span class="av ref">∑</span><span><b>${esc(grupo)}</b><br><small>referência</small></span></div></td>
    <td class="cx"><b>${num(fGrupo[0])}</b></td>${CURTO.slice(1).map((_, i) => `<td class="cx"><b>${pct(taxa(fGrupo, i + 1))}</b></td>`).join("")}
    <td class="cx"><b>${pct(fGrupo[0] ? (100 * fGrupo[4]) / fGrupo[0] : null)}</b></td><td></td></tr>`;
  const linhas = [...corretores].sort((a, b) => b.funil[0] - a.funil[0]).map((x) => {
    const gx = gargalo(x.funil, fGrupo);
    return `<tr class="clicavel ${x.nome === estado.corretorSel ? "selecionado" : ""}" data-nome="${esc(x.nome)}">
      <td><div class="tb-who">${avatar(x.nome)}<b>${esc(x.nome.trim())}</b></div></td>
      <td class="cx"><b>${num(x.funil[0])}</b><span class="tb-bar"><i style="width:${(x.funil[0] / maxQ) * 100}%"></i></span></td>
      ${CURTO.slice(1).map((_, i) => celula(x.funil, i + 1, fGrupo, gx && gx.i === i + 1)).join("")}
      <td class="cx"><b>${pct(x.funil[0] ? (100 * x.funil[4]) / x.funil[0] : null)}</b></td>
      <td>${gx ? `<span class="dk-tag ruim">${CURTO[gx.i - 1]} → ${CURTO[gx.i]}</span>` : `<span class="dk-tag sutil">—</span>`}</td>
    </tr>`;
  }).join("");

  const alvoNomes = sel ? [sel.nome] : corretores.map((x) => x.nome);
  const alvoChaves = new Set(alvoNomes.map(chave));
  const parados = (d.alertas || []).filter((a) => alvoChaves.has(chave(a.corretor)));
  const porEtapa = etapas.map((e) => ({ e, n: parados.filter((a) => (a.etapaFunil || "Qualificado") === e).length })).filter((x) => x.n);
  const graves = parados.filter((a) => a.diasParado > 30).length;
  const LIM = 24;

  const escuro = $("#escuroIn");
  escuro.innerHTML = `<section>
      ${secao(`Comparativo ${eq ? "da equipe" : "dos corretores"}`, "taxa de passagem entre etapas · clique num corretor pra abrir o funil dele")}
      <div class="legenda">
        <span><i class="g">▲</i> acima de ${refTxt}</span><span><i class="r">▼</i> abaixo de ${refTxt}</span>
        <span><i class="lg-garg"></i> gargalo: maior queda vs ${refTxt}</span><span><i class="lg-fraco"></i> menos de ${MIN_GARGALO} leads na etapa anterior</span>
      </div>
      <div class="dk-card tabela rolavel"><table class="fn-tab">
        <thead><tr><th>Corretor</th><th>Qualificados</th>${CURTO.slice(1).map((e, i) => `<th>${CURTO[i]} →<br>${e}</th>`).join("")}<th>Qualif. →<br>Venda</th><th>Gargalo</th></tr></thead>
        <tbody>${linhaRef}${linhas || `<tr><td colspan="8" class="vazio">Sem leads no período.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section class="secao">
      ${secao(sel ? `Leads parados de ${esc(nomeCurto(sel.nome))}` : "Leads parados", `ativos, sem movimentação há +15 dias · capturados nos últimos ${d.alertaJanelaDias || 45} dias`)}
      ${d.alertasProntos && parados.length ? `<div class="pd-resumo">
        <div><b>${num(parados.length)}</b><span>leads parados</span></div>
        <div class="grave"><b>${num(graves)}</b><span>há mais de 30 dias</span></div>
        <div class="pd-etapas">${porEtapa.map((x) => `<span class="dk-tag">${x.e} <b>${num(x.n)}</b></span>`).join("")}</div>
      </div>` : ""}
      ${listaParadosHTML(d, estado.paradosTodos ? parados : parados.slice(0, LIM), { mostrarCorretor: !sel })}
      ${parados.length > LIM ? `<button class="btn-mais" id="paradosMais">${estado.paradosTodos ? "Mostrar menos" : `Mostrar todos (${num(parados.length)})`}</button>` : ""}
    </section>
    <section class="secao">
      ${secao("Evolução", `${estado.evoJanela === "semana" ? "últimos 7 dias × os 7 dias antes" : "mês atual × mesmo trecho do mês anterior"} · não depende do filtro de período`,
        `<div class="pills" id="evoJanela"><button class="pill-b ${estado.evoJanela === "semana" ? "ativo" : ""}" data-j="semana">Semana</button><button class="pill-b ${estado.evoJanela !== "semana" ? "ativo" : ""}" data-j="mes">Mês</button></div>`)}
      ${evolucaoHTML(estado.evolucao, alvoNomes, sel ? sel.nome.trim() : eq ? eq.nome : "toda a imobiliária")}
    </section>`;

  escuro.querySelectorAll("tr[data-nome]").forEach((tr) => tr.addEventListener("click", () => {
    estado.corretorSel = tr.dataset.nome;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  escuro.querySelector("#paradosMais")?.addEventListener("click", () => { estado.paradosTodos = !estado.paradosTodos; render(); });
  escuro.querySelector("#evoJanela").addEventListener("click", (e) => {
    const b = e.target.closest("[data-j]"); if (!b) return;
    estado.evoJanela = b.dataset.j; render();
  });
}

function evolucaoHTML(ev, nomes, alvo) {
  if (estado.evolucaoErro && !ev) return `<div class="dk-card vazio">Não consegui calcular a evolução: ${esc(estado.evolucaoErro)}</div>`;
  if (!ev) return `<div class="dk-card vazio">Calculando semana e mês anteriores… a 1ª vez pode levar ~1 min.</div>`;
  const doGrupo = (k) => {
    const js = nomes.map((n) => ev.porChave[chave(n)]?.[k]).filter(Boolean);
    return { funil: somaFunil(js.map((j) => j.funil)), vendas: js.reduce((s, j) => s + j.vendas, 0) };
  };
  const [kA, kB] = estado.evoJanela === "semana" ? ["semanaAtual", "semanaAnterior"] : ["mesAtual", "mesAnterior"];
  const a = doGrupo(kA), b = doGrupo(kB), ja = ev.janelas[kA], jb = ev.janelas[kB];
  const rotA = `${dataCurta(ja.inicio)}–${dataCurta(ja.fim)}`, rotB = `${dataCurta(jb.inicio)}–${dataCurta(jb.fim)}`;
  const tq = (fx) => (fx[0] ? (100 * fx[3]) / fx[0] : null);
  const met = [
    { nome: "Qualificados recebidos", a: a.funil[0], b: b.funil[0] },
    { nome: "Agendamento/Crédito", a: a.funil[1], b: b.funil[1] },
    { nome: "Visitas", a: a.funil[2], b: b.funil[2] },
    { nome: "Propostas", a: a.funil[3], b: b.funil[3] },
    { nome: "Vendas fechadas", a: a.vendas, b: b.vendas },
    { nome: "Qualificado → Proposta", a: tq(a.funil), b: tq(b.funil), taxa: true },
  ];
  const tiles = met.map((m) => {
    const v = (x) => (m.taxa ? pct(x) : num(x));
    let delta = `<span class="dk-tag sutil">sem base</span>`;
    if (m.a != null && m.b != null) {
      const dv = m.a - m.b;
      const txt = m.taxa ? pp(dv) : m.b ? `${dv > 0 ? "+" : ""}${Math.round((100 * dv) / m.b)}%` : dv ? `+${num(dv)}` : "igual";
      delta = `<span class="dk-tag ${dv > 0 ? "bom" : dv < 0 ? "ruim" : "sutil"}">${dv > 0 ? "▲ " : dv < 0 ? "▼ " : ""}${txt}</span>`;
    }
    const max = Math.max(m.a || 0, m.b || 0) || 1;
    return `<div class="dk-card evo">
      <div class="evo-rot">${m.nome}</div>
      <div class="evo-val"><b>${v(m.a)}</b>${delta}</div>
      <div class="evo-bar atual"><span>${rotA}</span><i><u style="width:${((m.a || 0) / max) * 100}%"></u></i><em>${v(m.a)}</em></div>
      <div class="evo-bar ant"><span>${rotB}</span><i><u style="width:${((m.b || 0) / max) * 100}%"></u></i><em>${v(m.b)}</em></div>
    </div>`;
  }).join("");
  return `<div class="evo-grid">${tiles}</div>
    <p class="nota">Evolução de ${esc(alvo)}. Etapas = leads recebidos em cada janela e até onde chegaram; vendas pela data da venda.</p>`;
}

async function carregarEvolucao() {
  try {
    const r = await fetch("/api/evolucao");
    const ev = await r.json();
    if (!r.ok) throw new Error(ev.detalhe || ev.erro || "Falha");
    // indexa por nome normalizado (equipes.json pode vir com acento/caixa diferente)
    ev.porChave = {};
    for (const [nome, v] of Object.entries(ev.corretores || {})) ev.porChave[chave(nome)] = v;
    estado.evolucao = ev;
    estado.evolucaoErro = null;
  } catch (e) {
    estado.evolucaoErro = e.message;
  }
  if (estado.data && estado.view === "funil") render();
}

/* ---------- eventos ---------- */
function irPara(view) {
  estado.view = view;
  if (estado.data) render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#views").addEventListener("click", (e) => {
  const b = e.target.closest(".view-tab"); if (b) irPara(b.dataset.view);
});
// botões "abrir" dos cards
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]"); if (b) irPara(b.dataset.go);
});
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  $(".chip.ativo").classList.remove("ativo"); b.classList.add("ativo");
  const custom = b.dataset.preset === "custom";
  $("#datasCustom").classList.toggle("oculto", !custom);
  if (!custom) carregar();
});
$("#aplicar").addEventListener("click", () => carregar());
$("#themeToggle").addEventListener("click", toggleTema);
// Equipe vai na URL (?equipe=id): cada gerente pode salvar o link da própria equipe.
$("#equipeSel").addEventListener("change", (e) => {
  estado.equipe = e.target.value;
  estado.corretorSel = "";
  const u = new URL(location.href);
  if (estado.equipe) u.searchParams.set("equipe", estado.equipe); else u.searchParams.delete("equipe");
  history.replaceState(null, "", u);
  if (estado.data) render();
});
estado.equipe = new URL(location.href).searchParams.get("equipe") || "";

(function initDatas() {
  const hoje = new Date();
  $("#fim").value = isoDate(hoje);
  $("#inicio").value = isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
})();

carregar();
carregarEvolucao();
// auto-refresh para o modo TV
setInterval(() => { carregar({ soft: true }); carregarEvolucao(); }, 3 * 60 * 1000);

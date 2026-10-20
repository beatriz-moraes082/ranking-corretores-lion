/* Ranking de Corretores, Lion. Frontend (sem dependências). */
const $ = (s, r = document) => r.querySelector(s);
// tons terrosos da identidade da Lion (avatares e radar)
const PALETA = ["#a65b45", "#6f6e68", "#8c6a5c", "#4a4a46", "#b9836c", "#5d675e"];
const num = (n) => (n || 0).toLocaleString("pt-BR");
const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;
const brlK = (n) => {
  n = n || 0;
  if (n >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (n >= 1e3) return "R$ " + Math.round(n / 1e3) + "k";
  return "R$ " + num(n);
};

let estado = { data: null, ord: "score", view: "ranking", refreshTimer: null, equipe: "", corretorSel: "", evolucao: null, evolucaoErro: null, evoJanela: "semana", paradosTodos: false };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const chave = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// textos de como cada dimensão é medida (aba metodologia)
const DIM_DESC = {
  volume: "Nº de leads recebidos no período.",
  vendas: "Nº de vendas fechadas (leads que viraram venda).",
  propostas: "Nº de leads recebidos no período que chegaram em Proposta (ou já viraram venda).",
  conversao: "Vendas ÷ leads recebidos.",
  contato: "Tempo entre a captura do lead e a qualificação, quanto menor, mais rápido o 1º contato.",
  mov: "Leads trabalhados ÷ leads recebidos (saíram de 'novos').",
  consist: "Leads parados +15 dias por lead, quanto menos, melhor.",
};

/* ---------- tema ---------- */
// Cores do painel completo: "b" (fundos em degradê suave) é o padrão escolhido.
// ?cores=a mostra a variação com cor só nos detalhes; ?cores=0 volta ao visual sem degradês.
(function initCores() {
  const v = new URL(location.href).searchParams.get("cores");
  if (v !== "0") document.documentElement.dataset.cores = v === "a" ? "a" : "b";
})();
(function initTema() {
  // Padrão: escuro (mais forte para exibição em TV). Usuário pode alternar.
  const tema = localStorage.getItem("tema") || "dark";
  document.documentElement.setAttribute("data-theme", tema);
})();
function toggleTema() {
  const atual = document.documentElement.getAttribute("data-theme");
  const novo = atual === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", novo);
  localStorage.setItem("tema", novo);
  if (estado.data) render();
}

/* ---------- período ---------- */
// data local (Brasil), não UTC: depois das 21h o UTC já é o dia seguinte
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
function corDe(i) { return PALETA[i % PALETA.length]; }

function countUp(el, alvo, { dur = 900, dec = 0, pre = "", suf = "" } = {}) {
  const t0 = performance.now();
  const passo = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = alvo * e;
    el.textContent = pre + v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/* radar hexagonal */
function radarSVG(dims, cor) {
  const cx = 150, cy = 106, R = 80, N = DIMS.length;
  const ang = (i) => (Math.PI * 2 * i) / N - Math.PI / 2;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  let g = "";
  // anéis
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    const pts = DIMS.map((_, i) => pt(i, R * ring).map((n) => n.toFixed(1)).join(",")).join(" ");
    g += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  }
  // eixos + rótulos
  DIMS.forEach((d, i) => {
    const [x, y] = pt(i, R);
    g += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 16);
    const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
    g += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" font-weight="700" fill="var(--txt-dim)" font-family="Manrope,sans-serif">${d.short}</text>`;
  });
  // polígono do corretor
  const poly = DIMS.map((d, i) => pt(i, R * Math.max(0.04, dims[d.key] / 100)).map((n) => n.toFixed(1)).join(",")).join(" ");
  g += `<polygon points="${poly}" fill="${cor}33" stroke="${cor}" stroke-width="2.5" stroke-linejoin="round"/>`;
  DIMS.forEach((d, i) => { const [x, y] = pt(i, R * Math.max(0.04, dims[d.key] / 100)); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${cor}"/>`; });
  return `<svg class="radar-svg" viewBox="0 0 300 214" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

/* ---------- carregar ---------- */
// Últimos dados recebidos ficam guardados no navegador (da TV, do celular...). Se o
// servidor reiniciar ou o Supremo bloquear as consultas, a tela continua mostrando
// esses dados em vez de ficar em "Carregando…".
const CACHE_LOCAL = "elite-lion-ultimo";
function chaveDados(inicio, fim) { return `${inicio}|${fim}`; }
function lerLocal(nome) { try { return JSON.parse(localStorage.getItem(`${CACHE_LOCAL}-${nome}`) || "null"); } catch { return null; } }
function salvarLocal(nome, valor) { try { localStorage.setItem(`${CACHE_LOCAL}-${nome}`, JSON.stringify(valor)); } catch {} }
let retentativa = null;

async function carregar({ soft = false } = {}) {
  const { inicio, fim } = periodoAtual();
  if (!inicio || !fim) return;
  const chave = chaveDados(inicio, fim);
  // mostra na hora o que ficou guardado deste período (se houver)
  if (!estado.data || estado.dataChave !== chave) {
    const guardado = lerLocal("ranking");
    if (guardado?.chave === chave && guardado.data) {
      estado.data = guardado.data; estado.dataChave = chave; estado.semConexao = false;
      render();
    } else if (!soft) {
      estado.data = null;
      $("#conteudo").innerHTML = `<div class="carregando"><div class="loader"></div><p>Consultando o Supremo CRM…<br><small>Períodos longos podem levar ~1 min na 1ª vez.</small></p></div>`;
      if (estado.view === "tv") renderTV();
    }
  }
  try {
    const r = await fetch(`/api/ranking?inicio=${inicio}&fim=${fim}`, { signal: AbortSignal.timeout(90000) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalhe || data.erro || "Falha");
    estado.data = data; estado.dataChave = chave; estado.semConexao = false;
    salvarLocal("ranking", { chave, data });
    clearTimeout(retentativa);
    render();
    $("#rodapeInfo").textContent = `Período ${data.periodo.inicio} a ${data.periodo.fim} · atualizado ${new Date(data.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    // sem conexão: mantém os últimos dados na tela e tenta de novo em 1 minuto
    clearTimeout(retentativa);
    retentativa = setTimeout(() => carregar({ soft: true }), 60_000);
    if (estado.data) { estado.semConexao = true; render(); return; }
    if (!soft) $("#conteudo").innerHTML = `<div class="erro"><b>Não consegui carregar.</b><br>${esc(e.message)}<br><small>Tentando de novo em 1 minuto.</small></div>`;
  }
}

/* ---------- render ---------- */
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

function render() {
  const d = estado.data;
  renderSeletorEquipe();
  // Score é sempre relativo à imobiliária inteira (não muda ao filtrar a equipe).
  const perfis = calcularPerfis(d.corretores).filter((p) => naEquipe(p.c.nome));
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("ativo", t.dataset.view === estado.view));
  if (estado.view === "tv") return renderTV();
  if (estado.view === "metodo") return renderMetodo(perfis);
  if (estado.view === "perfil") return renderPerfil(perfis);
  if (estado.view === "funil") return renderFunil(d);
  renderRanking(d, perfis);
}

function renderRanking(d, perfis) {
  const byNome = Object.fromEntries(perfis.map((p, i) => [p.c.nome, { ...p, i }]));
  const c = $("#conteudo");
  c.innerHTML = "";

  /* KPIs (da equipe, quando filtrada) */
  const eq = equipeAtual();
  const alertas = (d.alertas || []).filter((a) => naEquipe(a.corretor));
  let r = d.resumo;
  if (eq) {
    const cs = d.corretores.filter((x) => naEquipe(x.nome));
    const leads = cs.reduce((s, x) => s + x.leads, 0), vendas = cs.reduce((s, x) => s + x.vendas, 0), vgv = cs.reduce((s, x) => s + x.vgv, 0);
    const propostas = cs.reduce((s, x) => s + (x.propostas || 0), 0);
    r = {
      leads, vendas, vgv, propostas, ticketMedio: vendas ? Math.round(vgv / vendas) : 0,
      corretoresAtivos: cs.filter((x) => x.leads > 0).length,
      conversaoGeral: leads ? +(100 * vendas / leads).toFixed(1) : 0,
      parados15d: alertas.length,
    };
  }
  const kpis = [
    { rot: "Leads no período", ico: "", cor: "var(--c3)", val: r.leads, sub: `${r.corretoresAtivos} corretores ativos` },
    { rot: "Propostas", ico: "", cor: "var(--c2)", val: r.propostas ?? d.corretores.reduce((s, x) => s + (x.propostas || 0), 0), sub: "leads que chegaram em proposta" },
    { rot: "Vendas fechadas", ico: "", cor: "var(--gold)", val: r.vendas, sub: `conversão ${r.conversaoGeral}%` },
    { rot: "VGV vendido", ico: "", cor: "var(--c4)", val: r.vgv, money: true, sub: `ticket ${brlK(r.ticketMedio)}` },
    { rot: "Parados +15 dias", ico: "", cor: "var(--c5)", val: r.parados15d, sub: d.alertasProntos ? "precisam de ação" : "calculando…" },
  ];
  const kpiEl = document.createElement("section");
  kpiEl.className = "kpis";
  kpiEl.innerHTML = kpis.map((k, i) => `
    <div class="kpi anim k${i}" style="--kc:${k.cor};animation-delay:${i * 60}ms">
      <div class="rot"><em>${k.ico}</em>${k.rot}</div>
      <div class="val" data-cu="${k.val}" data-money="${k.money ? 1 : 0}">0</div>
      <div class="sub">${k.sub}</div>
    </div>`).join("");
  c.appendChild(kpiEl);

  /* Pódio */
  if (perfis.length) {
    const top = perfis.slice(0, 3);
    const ordemVisual = [1, 0, 2].filter((idx) => top[idx]); // 2º, 1º, 3º
    const medals = ["1º", "2º", "3º"];
    const sec = document.createElement("section");
    sec.className = "secao";
    sec.innerHTML = `<div class="secao-hd"><h2>Pódio do período</h2><span>score = mix de vendas, propostas, conversão e consistência</span></div>`;
    const grid = document.createElement("div");
    grid.className = "podio";
    grid.innerHTML = ordemVisual.map((idx) => {
      const p = top[idx], cor = corDe(idx);
      return `<div class="pod-card p${idx + 1} anim" style="animation-delay:${idx * 90}ms">
        <div class="pod-medal">${medals[idx]}</div>
        <div class="pod-av" style="background:linear-gradient(150deg,${cor},${cor}bb)">${iniciais(p.c.nome)}</div>
        <div class="pod-nome">${p.c.nome.trim()}</div>
        <div class="pod-score" data-cu="${p.score}">0<small> pts</small></div>
        <div class="pod-stats">
          <div><b>${p.c.vendas}</b><span>vendas</span></div>
          <div><b>${p.c.propostas || 0}</b><span>propostas</span></div>
          <div><b>${p.c.conversao}%</b><span>conv.</span></div>
          <div><b>${p.c.tempoQualifHoras == null ? "n/d" : p.c.tempoQualifHoras + "h"}</b><span>1º contato</span></div>
        </div>
      </div>`;
    }).join("");
    sec.appendChild(grid);
    c.appendChild(sec);
  }

  /* Ranking completo */
  const cols = [
    { key: "score", lab: "Score" },
    { key: "leads", lab: "Leads" },
    { key: "contato", lab: "1º contato" },
    { key: "propostas", lab: "Propostas" },
    { key: "vendas", lab: "Vendas" },
    { key: "vgv", lab: "VGV", hide: true },
    { key: "conversao", lab: "Conversão" },
    { key: "parados15d", lab: "Parados +15d" },
  ];
  const valOrd = (p, key) => key === "score" ? p.score : key === "contato" ? (p.c.tempoQualifHoras == null ? 1e9 : p.c.tempoQualifHoras) : p.c[key] ?? 0;
  const asc = estado.ord === "contato" || estado.ord === "parados15d"; // menor é melhor
  const ordenado = [...perfis].sort((a, b) => {
    const x = valOrd(a, estado.ord), y = valOrd(b, estado.ord);
    return asc ? x - y : y - x;
  });
  const maxScore = Math.max(1, ...perfis.map((p) => p.score));

  const sec2 = document.createElement("section");
  sec2.className = "secao anim";
  sec2.style.animationDelay = "120ms";
  sec2.innerHTML = `<div class="secao-hd"><h2>Ranking completo</h2><span>${perfis.length} corretores · clique no cabeçalho pra reordenar</span></div>`;
  const wrap = document.createElement("div");
  wrap.className = "tabela-wrap";
  const thead = `<thead><tr><th>Corretor</th>${cols.map((col) => `<th data-k="${col.key}" class="${col.key === estado.ord ? "ord" : ""} ${col.hide ? "hide-sm" : ""}">${col.lab}</th>`).join("")}</tr></thead>`;
  const tbody = ordenado.map((p, i) => {
    const cor = corDe(byNome[p.c.nome].i);
    const lider = estado.ord === "score" && i === 0;
    return `<tr class="${lider ? "lider" : ""}">
      <td><div class="rk">
        <span class="rk-pos ${i < 3 ? "m" : ""}">${i + 1}º</span>
        <span class="rk-av" style="background:linear-gradient(150deg,${cor},${cor}bb)">${iniciais(p.c.nome)}</span>
        <span><span class="rk-nome">${p.c.nome.trim()}</span><br><span class="rk-sub">${p.c.leads} leads · ${DIM_PROPOSTAS.disp(p.c)}</span></span>
      </div></td>
      <td><span class="score-cell">${p.score}</span><span class="mini-bar"><i style="width:${(p.score / maxScore) * 100}%"></i></span></td>
      <td><span class="cell-num">${p.c.leads}</span></td>
      <td><span class="cell-num">${p.c.tempoQualifHoras == null ? "n/d" : p.c.tempoQualifHoras + "h"}</span></td>
      <td><span class="cell-num">${p.c.propostas || 0}</span></td>
      <td><span class="cell-num">${p.c.vendas}</span></td>
      <td class="hide-sm"><span class="cell-num">${brlK(p.c.vgv)}</span></td>
      <td><span class="pill ${p.c.conversao >= 3 ? "g" : "n"}">${p.c.conversao}%</span></td>
      <td>${p.c.parados15d ? `<span class="pill r">${p.c.parados15d}</span>` : `<span class="pill n">0</span>`}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table>${thead}<tbody>${tbody || `<tr><td colspan="9" class="vazio">Sem dados no período.</td></tr>`}</tbody></table>`;
  wrap.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { estado.ord = th.dataset.k; render(); }));
  sec2.appendChild(wrap);
  c.appendChild(sec2);

  /* Alertas */
  const sec4 = document.createElement("section");
  sec4.className = "secao";
  sec4.innerHTML = `<div class="secao-hd"><h2>Leads parados +15 dias</h2><span>ativos, sem movimentação há +15 dias · janela de ${d.alertaJanelaDias || 45} dias</span></div>`;
  const box = document.createElement("div");
  box.className = "alertas-box";
  if (!d.alertasProntos) box.innerHTML = `<div class="vazio">Calculando varredura dos últimos ${d.alertaJanelaDias || 45} dias… recarrega em instantes.</div>`;
  else if (!alertas.length) box.innerHTML = `<div class="vazio">Nenhum lead parado além de 15 dias.</div>`;
  else box.innerHTML = alertas.slice(0, 12).map((a) => `
    <div class="alerta-row">
      <div class="alerta-dias"><b>${a.diasParado}</b><span>dias</span></div>
      <div class="alerta-info">
        <div class="l">${a.lead} ${a.telefone ? `<span class="alerta-tel">· ${a.telefone}</span>` : ""}</div>
        <div class="m"><span class="tag-corr">${a.corretor.trim()}</span>${a.etapa ? " · " + a.etapa : ""}${a.situacao ? " · " + a.situacao : ""}</div>
      </div>
    </div>`).join("");
  sec4.appendChild(box);
  c.appendChild(sec4);

  /* count-up (números-herói dos KPIs e do pódio) */
  c.querySelectorAll("[data-cu]").forEach((el) => {
    const alvo = Number(el.dataset.cu);
    const money = el.dataset.money === "1";
    const small = el.querySelector("small"); // ex: " pts"
    const t0 = performance.now();
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / 1000);
      const e = 1 - Math.pow(1 - p, 3);
      const v = alvo * e;
      el.textContent = money ? brlK(v) : Math.round(v).toLocaleString("pt-BR");
      if (small) el.appendChild(small);
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

/* ---------- render: aba "perfil comportamental" (todos os corretores) ---------- */
function radarCardHTML(p, i) {
  const cor = corDe(i);
  return `<div class="radar-card anim" style="animation-delay:${Math.min(i, 11) * 45}ms">
    <div class="radar-hd">
      <span class="rk-av" style="background:linear-gradient(150deg,${cor},${cor}bb)">${iniciais(p.c.nome)}</span>
      <div><div class="n">${p.c.nome.trim()}</div><div class="s">score ${p.score} · ${p.c.vendas} vendas · 1º contato ${p.c.tempoQualifHoras == null ? "n/d" : p.c.tempoQualifHoras + "h"}</div></div>
    </div>
    ${radarSVG(p.dims, cor)}
    <div class="radar-legend">
      <div class="up"><h4>▲ Fortes</h4><p>${p.fortes.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
      <div class="down"><h4>▼ A melhorar</h4><p>${p.melhorar.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
    </div>
  </div>`;
}

function renderPerfil(perfis) {
  const c = $("#conteudo");
  c.innerHTML = "";
  const equipes = estado.data?.equipes || [];
  const eqSel = equipeAtual();
  const idx = new Map(perfis.map((p, i) => [p.c.nome, i])); // cor do radar = posição no ranking
  const membrosDe = (e) => { if (!e._set) e._set = new Set(e.corretores.map(chave)); return perfis.filter((p) => e._set.has(chave(p.c.nome))); };

  // Grupos: uma seção por equipe (ou só a selecionada no topo) + "Sem equipe"
  let grupos;
  if (!equipes.length) grupos = [{ id: "todos", nome: null, membros: perfis }];
  else {
    grupos = (eqSel ? [eqSel] : equipes).map((e) => ({ id: e.id, nome: e.nome, gerente: e.gerente, total: e.corretores.length, membros: membrosDe(e) }));
    if (!eqSel) {
      const comEquipe = new Set(grupos.flatMap((g) => g.membros.map((p) => p.c.nome)));
      const sem = perfis.filter((p) => !comEquipe.has(p.c.nome));
      if (sem.length) grupos.push({ id: "sem-equipe", nome: "Sem equipe", gerente: "", membros: sem, sem: true });
    }
  }

  const sec = document.createElement("section");
  sec.innerHTML = `<div class="secao-hd" style="margin-top:6px"><h2>Perfil comportamental</h2><span>${perfis.length} corretores · 6 dimensões, normalizadas entre os corretores do período · Volume, Movimentação e 1º contato ficam só aqui, fora do score</span></div>
    ${grupos.length > 1 ? `<nav class="pf-atalhos">${grupos.map((g) => `<a href="#pf-${g.id}" class="pf-atalho">${esc(g.nome)} <b>${g.membros.length}</b></a>`).join("")}</nav>` : ""}`;
  for (const g of grupos) {
    const bloco = document.createElement("div");
    bloco.className = "pf-grupo";
    bloco.id = `pf-${g.id}`;
    if (g.nome) {
      const media = g.membros.length ? Math.round(g.membros.reduce((s, p) => s + p.score, 0) / g.membros.length) : null;
      const semLeads = g.total ? g.total - g.membros.length : 0;
      bloco.innerHTML = `<div class="pf-hd">
        <div><h3>${esc(g.nome)}</h3><span>${g.gerente ? `Gerente: ${esc(g.gerente)} · ` : ""}${plural(g.membros.length, "corretor com leads", "corretores com leads")} no período${semLeads > 0 ? ` · ${plural(semLeads, "sem leads", "sem leads")}` : ""}${g.sem ? " · não estão em nenhuma equipe cadastrada" : ""}</span></div>
        ${media != null ? `<div class="pf-media"><b>${media}</b><span>score médio</span></div>` : ""}
      </div>`;
    }
    const grid = document.createElement("div");
    grid.className = "radar-grid";
    grid.innerHTML = g.membros.length ? g.membros.map((p) => radarCardHTML(p, idx.get(p.c.nome))).join("") : `<div class="vazio">Nenhum corretor desta equipe com leads no período.</div>`;
    bloco.appendChild(grid);
    sec.appendChild(bloco);
  }
  if (!perfis.length) sec.innerHTML += `<div class="vazio">Sem corretores com leads no período.</div>`;
  c.appendChild(sec);
}

/* ---------- render: aba "como o score é calculado" ---------- */
function renderMetodo(perfis) {
  const c = $("#conteudo");
  c.innerHTML = "";
  const ordPeso = [...SCORE_DIMS].sort((a, b) => (PESOS[b.key] || 0) - (PESOS[a.key] || 0));
  const maxPeso = Math.max(...Object.values(PESOS)) * 100;

  // 1) intro
  const intro = document.createElement("section");
  intro.className = "anim";
  intro.innerHTML = `<div class="card">
    <div class="big-note">O <em>Score de Performance</em> é uma nota de <em>0 a 100</em> que resume ${SCORE_DIMS.length} métricas do corretor num número só.</div>
    <p style="margin-top:14px">É <b>relativo ao grupo do período</b>: cada corretor é comparado com os outros corretores da imobiliária que tiveram leads naquele intervalo (mesmo com uma equipe filtrada). Em cada métrica, o melhor do grupo vira 100, o pior vira 0, e o resto fica proporcional no meio. Depois somamos essas notas com pesos diferentes.</p>
  </div>`;
  c.appendChild(intro);

  // 2) dimensões e pesos
  const dims = document.createElement("section");
  dims.className = "secao anim";
  dims.style.animationDelay = "70ms";
  dims.innerHTML = `<div class="secao-hd"><h2>As ${SCORE_DIMS.length} métricas e seus pesos</h2><span>somam 100%</span></div>`;
  const cardD = document.createElement("div");
  cardD.className = "card";
  cardD.innerHTML = ordPeso.map((d, i) => {
    const peso = Math.round((PESOS[d.key] || 0) * 100);
    return `<div class="dim-row">
      <span class="dim-dot" style="background:${PALETA[i % PALETA.length]}"></span>
      <span class="dim-nome">${d.label}</span>
      <span class="dim-desc">${DIM_DESC[d.key]}</span>
      <span class="peso-track"><i style="width:${peso / maxPeso * 100}%"></i></span>
      <span class="dim-peso">${peso}%</span>
    </div>`;
  }).join("");
  dims.appendChild(cardD);
  c.appendChild(dims);

  // 3) exemplo real com o líder
  if (perfis.length) {
    const lider = perfis[0];
    const linhas = SCORE_DIMS.map((d) => ({
      label: d.label, valor: d.disp(lider.c),
      nota: lider.dims[d.key], peso: Math.round((PESOS[d.key] || 0) * 100),
      contrib: lider.dims[d.key] * (PESOS[d.key] || 0),
    })).sort((a, b) => b.contrib - a.contrib);
    const total = linhas.reduce((s, l) => s + l.contrib, 0);

    const ex = document.createElement("section");
    ex.className = "secao anim";
    ex.style.animationDelay = "140ms";
    ex.innerHTML = `<div class="secao-hd"><h2>Exemplo real, ${lider.c.nome.trim()}</h2><span>líder do período, calculado ao vivo</span></div>`;
    const wrap = document.createElement("div");
    wrap.className = "tabela-wrap";
    wrap.innerHTML = `<table>
      <thead><tr><th>Dimensão</th><th>Valor real</th><th>Nota 0 a 100</th><th>Peso</th><th>Contribui</th></tr></thead>
      <tbody>
        ${linhas.map((l) => `<tr>
          <td style="font-weight:700">${l.label}</td>
          <td class="cell-num">${l.valor}</td>
          <td class="cell-num">${l.nota}</td>
          <td class="cell-num">${l.peso}%</td>
          <td class="cell-num">${l.contrib.toFixed(1)}</td>
        </tr>`).join("")}
        <tr class="exemplo-total">
          <td>Score final</td><td></td><td></td><td></td><td>${Math.round(total)}</td>
        </tr>
      </tbody></table>`;
    ex.appendChild(wrap);
    c.appendChild(ex);
  }

  // 4) pontos importantes
  const cav = document.createElement("section");
  cav.className = "secao anim";
  cav.style.animationDelay = "200ms";
  cav.innerHTML = `<div class="secao-hd"><h2>Pontos importantes</h2></div>`;
  const cardC = document.createElement("div");
  cardC.className = "card";
  cardC.innerHTML = `<ul class="caveats">
    <li><b>É relativo, não absoluto.</b> O mesmo corretor pode ter score diferente se você muda o período ou o conjunto de colegas comparados.</li>
    <li><b>Consistência</b> é medida por lead: um corretor com muitos leads e alguns parados pode pontuar melhor que outro com poucos leads e vários parados.</li>
    <li><b>Volume, Movimentação e 1º contato não entram no score.</b> O pré-atendimento é feito pela recepção e o corretor já recebe o lead qualificado: quantos leads ele recebe e o tempo da captura até a qualificação não dependem dele. Os três continuam no perfil comportamental e na tabela, como informação (dá pra ver, por exemplo, quem recebe muito e converte pouco).</li>
    <li><b>Propostas</b> tem peso alto porque acontece com mais frequência que a venda e converte bem: mostra quem está construindo resultado antes do fechamento. Conta os leads recebidos no período que estão em Proposta ou já viraram venda.</li>
    <li><b>Os pesos são ajustáveis.</b> Se para a Lion vale mais proposta, ou punir mais os leads parados, é só recalibrar.</li>
  </ul>
  </div>`;
  cav.appendChild(cardC);
  c.appendChild(cav);

  // 5) funil
  const fun = document.createElement("section");
  fun.className = "secao anim";
  fun.style.animationDelay = "260ms";
  fun.innerHTML = `<div class="secao-hd"><h2>Como o funil é calculado</h2></div>`;
  const cardF = document.createElement("div");
  cardF.className = "card";
  cardF.innerHTML = `<ul class="caveats">
    <li><b>O funil começa em Qualificado.</b> A etapa Lead → Qualificado é do pré-atendimento, então todo lead que chegou ao corretor conta como Qualificado.</li>
    <li><b>As etapas vêm da situação do lead no Supremo:</b> Agendamento ou Análise de crédito → Agendamento/Crédito; Visita; Proposta; Venda (lead vendido).</li>
    <li><b>Etapa pulada conta como passada.</b> Um lead que foi de Qualificado direto pra Visita conta também em Agendamento/Crédito. Lead perdido conta até a situação em que estava quando foi perdido.</li>
    <li><b>Taxa de passagem</b> = quantos chegaram na etapa ÷ quantos chegaram na etapa anterior. O <b>gargalo</b> é a passagem em que o corretor mais fica abaixo da equipe (só conta quando ele tem pelo menos ${MIN_GARGALO} leads na etapa anterior).</li>
    <li><b>Funil = leads recebidos no período.</b> Mostra até onde chegaram os leads capturados no intervalo, por isso a Venda do funil pode ser menor que "Vendas fechadas" (que conta pela data da venda, inclusive leads de meses anteriores). Leads muito recentes ainda não tiveram tempo de avançar.</li>
    <li><b>A API só mostra a situação atual,</b> sem o histórico. Se o corretor não atualiza a situação no Supremo, o lead fica parado em Qualificado no funil.</li>
  </ul>`;
  fun.appendChild(cardF);
  c.appendChild(fun);
}

/* ---------- render: aba "funil" ---------- */
const MIN_GARGALO = 3; // mínimo de leads na etapa anterior pra uma passagem valer como gargalo
const ETAPAS_PADRAO = ["Qualificado", "Agendamento/Crédito", "Visita", "Proposta", "Venda"];
const somaFunil = (lista) => lista.reduce((acc, f) => acc.map((v, i) => v + (f[i] || 0)), ETAPAS_PADRAO.map(() => 0));
// taxa de passagem i-1 -> i (null quando não há base)
const taxa = (f, i) => (f[i - 1] ? (100 * f[i]) / f[i - 1] : null);
const pct = (v) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })}%`);

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

const CURTO = ["Qualif.", "Agend./Créd.", "Visita", "Proposta", "Venda"];
const pp = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })} p.p.`;
const avatar = (nome, i, cls = "rk-av") => `<span class="${cls}" style="background:linear-gradient(150deg,${corDe(i)},${corDe(i)}bb)">${iniciais(nome)}</span>`;

// Funil em degraus: cada etapa é um bloco com o número grande; entre eles, a taxa de
// passagem (e a da referência). Uma cor só (é uma sequência, não categorias).
function funilFluxoHTML({ titulo, sub, av, f, ref, refNome, etapas }) {
  const base = Math.max(1, f[0]);
  const g = ref ? gargalo(f, ref) : null;
  let partes = "";
  etapas.forEach((nome, i) => {
    if (i) {
      const t = taxa(f, i), tr = ref ? taxa(ref, i) : null;
      const fraco = f[i - 1] < MIN_GARGALO;
      let cmp = "";
      if (ref) {
        const dir = t == null || tr == null ? "n" : t >= tr ? "g" : "r";
        cmp = `<div class="fx-cmp ${fraco ? "n" : dir}">${dir === "g" && !fraco ? "▲" : dir === "r" && !fraco ? "▼" : "·"} ${refNome} ${pct(tr)}</div>`;
      }
      partes += `<div class="fx-link ${g && g.i === i ? "gargalo" : ""}">
        <svg class="fx-seta" viewBox="0 0 40 12" aria-hidden="true"><path d="M0 6h34M29 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="fx-rate">${pct(t)}</div><small>${g && g.i === i ? "gargalo" : "passaram"}</small>${cmp}
      </div>`;
    }
    const share = (100 * f[i]) / base;
    partes += `<div class="fx-stage" style="--a:${0.35 + 0.65 * (1 - i / (etapas.length - 1))}">
      <div class="fx-lab">${nome.replace("/", "/<wbr>")}</div>
      <div class="fx-num">${num(f[i])}</div>
      <div class="fx-share">${i ? `${pct(share)} da base` : "base do funil"}</div>
      <div class="fx-track"><i style="width:${f[i] ? Math.max(2, share) : 0}%"></i></div>
    </div>`;
  });

  // leitura em uma frase
  let insight = "";
  if (ref && g) insight = `<b>Gargalo:</b> ${CURTO[g.i - 1]} → ${CURTO[g.i]}. Passam ${pct(taxa(f, g.i))}, contra ${pct(taxa(ref, g.i))} ${refNome === "imob." ? "na imobiliária" : "na equipe"} (${pp(g.delta)}).`;
  else if (ref) insight = `Nenhuma passagem abaixo ${refNome === "imob." ? "da imobiliária" : "da equipe"} (considerando etapas com ${MIN_GARGALO}+ leads).`;
  else {
    let pior = null;
    for (let i = 1; i < f.length; i++) { const t = taxa(f, i); if (t != null && f[i - 1] >= MIN_GARGALO && (!pior || t < pior.t)) pior = { i, t }; }
    if (pior) insight = `<b>Onde mais se perde:</b> ${CURTO[pior.i - 1]} → ${CURTO[pior.i]}. Só ${pct(pior.t)} avançam.`;
  }
  return `<div class="card fx">
    <div class="fx-hd">${av || ""}<div><h3>${titulo}</h3><span>${sub}</span></div></div>
    <div class="fx-flow">${partes}</div>
    ${insight ? `<div class="fx-insight">${insight}</div>` : ""}
  </div>`;
}

function evolucaoHTML(ev, nomes, alvo) {
  if (estado.evolucaoErro && !ev) return `<div class="card vazio">Não consegui calcular a evolução: ${esc(estado.evolucaoErro)}</div>`;
  if (!ev) return `<div class="card vazio">Calculando semana e mês anteriores… a 1ª vez pode levar ~1 min.</div>`;
  const doGrupo = (k) => {
    const js = nomes.map((n) => ev.porChave[chave(n)]?.[k]).filter(Boolean);
    return { funil: somaFunil(js.map((j) => j.funil)), vendas: js.reduce((s, j) => s + j.vendas, 0) };
  };
  const fmtD = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const [kA, kB] = estado.evoJanela === "semana" ? ["semanaAtual", "semanaAnterior"] : ["mesAtual", "mesAnterior"];
  const a = doGrupo(kA), b = doGrupo(kB), ja = ev.janelas[kA], jb = ev.janelas[kB];
  const rotA = `${fmtD(ja.inicio)}–${fmtD(ja.fim)}`, rotB = `${fmtD(jb.inicio)}–${fmtD(jb.fim)}`;
  const tq = (f) => (f[0] ? (100 * f[3]) / f[0] : null);
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
    let delta = `<span class="pill n">sem base</span>`;
    if (m.a != null && m.b != null) {
      const dv = m.a - m.b;
      const txt = m.taxa ? pp(dv) : m.b ? `${dv > 0 ? "+" : ""}${Math.round((100 * dv) / m.b)}%` : dv ? `+${num(dv)}` : "igual";
      delta = `<span class="pill ${dv > 0 ? "g" : dv < 0 ? "r" : "n"}">${dv > 0 ? "▲ " : dv < 0 ? "▼ " : ""}${txt}</span>`;
    }
    const max = Math.max(m.a || 0, m.b || 0) || 1;
    return `<div class="evo-tile">
      <div class="evo-rot">${m.nome}</div>
      <div class="evo-val"><b>${v(m.a)}</b>${delta}</div>
      <div class="evo-bars">
        <div class="evo-bar atual"><span>${rotA}</span><i><u style="width:${((m.a || 0) / max) * 100}%"></u></i><em>${v(m.a)}</em></div>
        <div class="evo-bar ant"><span>${rotB}</span><i><u style="width:${((m.b || 0) / max) * 100}%"></u></i><em>${v(m.b)}</em></div>
      </div>
    </div>`;
  }).join("");
  return `<div class="evo-tiles">${tiles}</div>
    <p class="nota">Evolução de ${esc(alvo)}. Etapas = leads recebidos em cada janela e até onde chegaram; vendas pela data da venda.</p>`;
}

function renderFunil(d) {
  const c = $("#conteudo");
  c.innerHTML = "";
  const etapas = d.etapasFunil || ETAPAS_PADRAO;
  const grupo = nomeGrupo();
  const eq = equipeAtual();
  const refNome = eq ? "equipe" : "imob.";
  const corretores = d.corretores.filter((x) => naEquipe(x.nome) && x.funil && x.leads > 0);
  const fGrupo = somaFunil(corretores.map((x) => x.funil));
  const fImob = somaFunil(d.corretores.filter((x) => x.funil).map((x) => x.funil));
  if (estado.corretorSel && !corretores.some((x) => x.nome === estado.corretorSel)) estado.corretorSel = "";
  const sel = corretores.find((x) => x.nome === estado.corretorSel);
  const idxCor = Object.fromEntries([...d.corretores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((x, i) => [x.nome, i]));
  const per = `${d.periodo.inicio.split("-").reverse().join("/")} a ${d.periodo.fim.split("-").reverse().join("/")}`;

  /* seletor de corretor */
  const top = document.createElement("section");
  top.className = "fn-top anim";
  top.innerHTML = `<label>Ver funil de
    <select id="corretorSel" class="sel">
      <option value="">${esc(eq ? eq.nome : "Toda a imobiliária")} (resultado geral)</option>
      ${[...corretores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((x) => `<option value="${esc(x.nome)}" ${x.nome === estado.corretorSel ? "selected" : ""}>${esc(x.nome.trim())}</option>`).join("")}
    </select></label>
    ${sel ? `<button class="btn-link" id="voltarGrupo">← voltar para ${esc(eq ? eq.nome : "a imobiliária")}</button>` : ""}
    <span class="fn-per">leads recebidos de ${per}</span>`;
  top.querySelector("#corretorSel").addEventListener("change", (e) => { estado.corretorSel = e.target.value; render(); });
  top.querySelector("#voltarGrupo")?.addEventListener("click", () => { estado.corretorSel = ""; render(); });
  c.appendChild(top);

  /* funil em degraus */
  const secF = document.createElement("section");
  secF.className = "anim";
  secF.style.animationDelay = "60ms";
  if (sel) {
    secF.innerHTML = funilFluxoHTML({
      titulo: esc(sel.nome.trim()), av: avatar(sel.nome, idxCor[sel.nome] ?? 0),
      sub: `${num(sel.funil[0])} qualificados recebidos · comparado com ${esc(eq ? eq.nome : "a imobiliária")}`,
      f: sel.funil, ref: fGrupo, refNome, etapas,
    });
  } else {
    secF.innerHTML = funilFluxoHTML({
      titulo: esc(eq ? eq.nome : "Imobiliária"),
      sub: `${corretores.length} corretores · ${num(fGrupo[0])} qualificados recebidos${eq ? " · comparado com a imobiliária" : ""}`,
      f: fGrupo, ref: eq ? fImob : null, refNome: "imob.", etapas,
    });
  }
  c.appendChild(secF);

  /* comparativo */
  const refTxt = eq ? "a equipe" : "a imobiliária";
  const sec2 = document.createElement("section");
  sec2.className = "secao anim";
  sec2.style.animationDelay = "120ms";
  sec2.innerHTML = `<div class="secao-hd"><h2>Comparativo ${eq ? "da equipe" : "dos corretores"}</h2><span>taxa de passagem entre etapas · clique num corretor pra abrir o funil dele</span></div>
    <div class="legenda">
      <span><i class="lg-g">▲</i> acima de ${refTxt}</span>
      <span><i class="lg-r">▼</i> abaixo de ${refTxt}</span>
      <span><i class="lg-garg"></i> gargalo: maior queda vs ${refTxt}</span>
      <span><i class="lg-fraco"></i> menos de ${MIN_GARGALO} leads na etapa anterior</span>
      <button class="btn-ajuda" id="ajudaComparativo" type="button">? Como ler esta tabela</button>
    </div>`;
  const maxQ = Math.max(1, ...corretores.map((x) => x.funil[0]));
  const celula = (f, i, ref, garg) => {
    const t = taxa(f, i), tr = ref ? taxa(ref, i) : null, fraco = f[i - 1] < MIN_GARGALO;
    let d = "";
    if (t != null && tr != null && !fraco) {
      const dv = t - tr;
      d = `<small class="${dv >= 0 ? "g" : "r"}">${dv >= 0 ? "▲" : "▼"} ${pp(Math.abs(dv)).replace("+", "")}</small>`;
    }
    return `<td class="cx cx-explica ${garg ? "gargalo" : fraco ? "fraco" : ""}" data-etapa="${i}" title="Clique para entender este número"><b>${pct(t)}</b>${d}</td>`;
  };
  const linhaRef = `<tr class="fn-ref-row"><td><div class="rk"><span class="rk-av ref">∑</span><span><span class="rk-nome">${esc(grupo)}</span><br><span class="rk-sub">referência</span></span></div></td>
    <td class="cx"><b>${num(fGrupo[0])}</b></td>${CURTO.slice(1).map((_, i) => `<td class="cx"><b>${pct(taxa(fGrupo, i + 1))}</b></td>`).join("")}
    <td class="cx"><b>${pct(fGrupo[0] ? (100 * fGrupo[4]) / fGrupo[0] : null)}</b></td><td></td></tr>`;
  const linhas = [...corretores].sort((a, b) => b.funil[0] - a.funil[0]).map((x) => {
    const g = gargalo(x.funil, fGrupo);
    return `<tr class="clicavel ${x.nome === estado.corretorSel ? "selecionado" : ""}" data-nome="${esc(x.nome)}">
      <td><div class="rk">${avatar(x.nome, idxCor[x.nome] ?? 0)}<span class="rk-nome">${esc(x.nome.trim())}</span></div></td>
      <td class="cx"><b>${num(x.funil[0])}</b><span class="mini-bar"><i style="width:${(x.funil[0] / maxQ) * 100}%"></i></span></td>
      ${CURTO.slice(1).map((_, i) => celula(x.funil, i + 1, fGrupo, g && g.i === i + 1)).join("")}
      <td class="cx"><b>${pct(x.funil[0] ? (100 * x.funil[4]) / x.funil[0] : null)}</b></td>
      <td>${g ? `<span class="tag-garg">${CURTO[g.i - 1]} → ${CURTO[g.i]}</span>` : `<span class="pill n">—</span>`}</td>
    </tr>`;
  }).join("");
  const wrap = document.createElement("div");
  wrap.className = "tabela-wrap rolavel";
  wrap.innerHTML = `<table class="fn-tab"><thead><tr><th>Corretor</th><th>Qualificados</th>${CURTO.slice(1).map((e, i) => `<th>${CURTO[i]} <span>→</span><br>${e}</th>`).join("")}<th>Qualif. <span>→</span><br>Venda</th><th>Gargalo</th></tr></thead>
    <tbody>${linhaRef}${linhas || `<tr><td colspan="8" class="vazio">Sem leads no período.</td></tr>`}</tbody></table>`;
  const abrirFunil = (nome) => { estado.corretorSel = nome; render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  wrap.querySelectorAll("tr[data-nome]").forEach((tr) => tr.addEventListener("click", (ev) => {
    const cel = ev.target.closest(".cx-explica");
    const x = corretores.find((c) => c.nome === tr.dataset.nome);
    // clique numa porcentagem explica o número; no resto da linha abre o funil
    if (cel && x) return explicarPassagem({ x, i: Number(cel.dataset.etapa), ref: fGrupo, refTxt, grupo, etapas, onFunil: () => abrirFunil(x.nome) });
    abrirFunil(tr.dataset.nome);
  }));
  sec2.querySelector("#ajudaComparativo").addEventListener("click", () => explicarTabela(refTxt));
  sec2.appendChild(wrap);
  c.appendChild(sec2);

  /* leads parados */
  const alvoNomes = sel ? [sel.nome] : corretores.map((x) => x.nome);
  const alvoChaves = new Set(alvoNomes.map(chave));
  const parados = (d.alertas || []).filter((a) => alvoChaves.has(chave(a.corretor)));
  const sec3 = document.createElement("section");
  sec3.className = "secao anim";
  sec3.style.animationDelay = "160ms";
  sec3.innerHTML = `<div class="secao-hd"><h2>Leads parados${sel ? ` de ${esc(sel.nome.trim())}` : ""}</h2><span>ativos, sem movimentação há +15 dias · capturados nos últimos ${d.alertaJanelaDias || 45} dias</span></div>`;
  if (!d.alertasProntos) sec3.innerHTML += `<div class="alertas-box"><div class="vazio">Calculando varredura… recarrega em instantes.</div></div>`;
  else if (!parados.length) sec3.innerHTML += `<div class="alertas-box"><div class="vazio">Nenhum lead parado além de 15 dias.</div></div>`;
  else {
    const porEtapa = etapas.map((e) => ({ e, n: parados.filter((a) => (a.etapaFunil || "Qualificado") === e).length })).filter((x) => x.n);
    const graves = parados.filter((a) => a.diasParado > 30).length;
    const LIM = 24;
    const lista = estado.paradosTodos ? parados : parados.slice(0, LIM);
    sec3.innerHTML += `<div class="parados-resumo">
        <div class="pr-total"><b>${num(parados.length)}</b><span>leads parados</span></div>
        <div class="pr-graves"><b>${num(graves)}</b><span>há mais de 30 dias</span></div>
        <div class="pr-etapas">${porEtapa.map((x) => `<span class="pr-chip">${x.e} <b>${num(x.n)}</b></span>`).join("")}</div>
      </div>
      <div class="parados-grid">${lista.map((a) => `
        <div class="parado ${a.diasParado > 30 ? "grave" : ""}">
          <div class="alerta-dias"><b>${a.diasParado}</b><span>dias</span></div>
          <div class="alerta-info">
            <div class="l">${esc(a.lead)} ${a.telefone ? `<span class="alerta-tel">· ${esc(a.telefone)}</span>` : ""}</div>
            <div class="m"><span class="pr-chip sm">${esc(a.etapaFunil || "Qualificado")}</span>${sel ? "" : ` <span class="tag-corr">${esc(a.corretor.trim())}</span>`}${a.situacao ? ` <span class="sit">${esc(a.situacao.trim())}</span>` : ""}</div>
          </div>
        </div>`).join("")}</div>
      ${parados.length > LIM ? `<button class="btn-mais" id="paradosMais">${estado.paradosTodos ? "Mostrar menos" : `Mostrar todos (${num(parados.length)})`}</button>` : ""}`;
    sec3.querySelector("#paradosMais")?.addEventListener("click", () => { estado.paradosTodos = !estado.paradosTodos; render(); });
  }
  c.appendChild(sec3);

  /* evolução */
  const sec4 = document.createElement("section");
  sec4.className = "secao anim";
  sec4.style.animationDelay = "200ms";
  sec4.innerHTML = `<div class="secao-hd evo-hd"><h2>Evolução</h2><span>${estado.evoJanela === "semana" ? "últimos 7 dias × os 7 dias antes" : "mês atual × mesmo trecho do mês anterior"} · não depende do filtro de período</span>
    <div class="chips mini" id="evoJanela"><button class="chip ${estado.evoJanela === "semana" ? "ativo" : ""}" data-j="semana">Semana</button><button class="chip ${estado.evoJanela !== "semana" ? "ativo" : ""}" data-j="mes">Mês</button></div></div>`;
  sec4.querySelector("#evoJanela").addEventListener("click", (e) => {
    const b = e.target.closest("[data-j]"); if (!b) return;
    estado.evoJanela = b.dataset.j; render();
  });
  const evBox = document.createElement("div");
  evBox.innerHTML = evolucaoHTML(estado.evolucao, alvoNomes, sel ? sel.nome.trim() : eq ? eq.nome : "toda a imobiliária");
  sec4.appendChild(evBox);
  c.appendChild(sec4);
}

async function carregarEvolucao() {
  try {
    const r = await fetch("/api/evolucao");
    if (r.status === 202) return; // ainda calculando no servidor; tenta de novo no próximo ciclo
    const ev = await r.json();
    if (!r.ok) throw new Error(ev.detalhe || ev.erro || "Falha");
    // indexa por nome normalizado (equipes.json pode vir com acento/caixa diferente)
    ev.porChave = {};
    for (const [nome, v] of Object.entries(ev.corretores || {})) ev.porChave[chave(nome)] = v;
    estado.evolucao = ev;
    estado.evolucaoErro = null;
    salvarLocal("evolucao", ev);
  } catch (e) {
    if (!estado.evolucao) {
      const guardada = lerLocal("evolucao");
      if (guardada) estado.evolucao = guardada; else estado.evolucaoErro = e.message;
    }
  }
  if (estado.data && estado.view === "funil") render();
}


/* ---------- popups de explicação do comparativo ---------- */
// O "▼ 14 p.p." sozinho confunde; clicar numa porcentagem abre esta explicação
// em linguagem simples, com os números de verdade por trás da taxa.
function abrirPopup(html) {
  let dlg = document.getElementById("popupExplica");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "popupExplica";
    dlg.className = "popup";
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-fechar]")) dlg.close(); });
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = html;
  dlg.showModal();
  return dlg;
}
const plural2 = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;
// no popup, sempre 1 casa decimal, pra conta "a − b = c p.p." fechar
const pct1 = (v) => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("pt-BR")}%`);

function explicarPassagem({ x, i, ref, refTxt, grupo, etapas, onFunil }) {
  const nome = esc(nomeCurtoTV(x.nome));
  const de = etapas[i - 1], para = etapas[i];
  const base = x.funil[i - 1], passou = x.funil[i];
  const t = taxa(x.funil, i), tr = taxa(ref, i);
  const fraco = base < MIN_GARGALO;
  const g = gargalo(x.funil, ref);
  const deCem = (v) => (v == null ? "—" : Math.round(v));
  let veredito;
  if (t == null) veredito = `<p>${nome} ainda não tem nenhum lead em <b>${de}</b> neste período, então não dá pra calcular a passagem.</p>`;
  else if (fraco) veredito = `<p class="pp-aviso">Com só ${plural2(base, "lead", "leads")} em ${de}, ainda é cedo pra tirar conclusão: um único lead muda muito a porcentagem.</p>`;
  else if (tr != null) {
    const dv = Math.round(Math.abs(t - tr) * 10) / 10;
    const dvTxt = dv.toLocaleString("pt-BR");
    veredito = t >= tr
      ? `<p class="pp-bom">▲ Está <b>${dvTxt} pontos acima</b> de ${refTxt}. Pra cada 100 leads nessa etapa, ${nome} faz cerca de ${deCem(t - tr)} a mais avançarem.</p>`
      : `<p class="pp-ruim">▼ Está <b>${dvTxt} pontos abaixo</b> de ${refTxt}. Pra cada 100 leads nessa etapa, cerca de ${deCem(tr - t)} a menos avançam com ${nome}.</p>`;
  }
  const barra = (rotulo, v, cls) => `<div class="pp-barra ${cls}"><span>${rotulo}</span><i><u style="width:${v == null ? 0 : Math.max(1, v)}%"></u></i><b>${pct1(v)}</b></div>`;
  abrirPopup(`<div class="pp">
    <button class="pp-x" data-fechar aria-label="Fechar">×</button>
    <div class="pp-rot">${de} → ${para}</div>
    <h3>${esc(x.nome.trim())}</h3>
    <div class="pp-num"><b>${num(passou)}</b> de <b>${num(base)}</b> ${base === 1 ? "lead" : "leads"} que chegaram em ${de} ${passou === 1 ? "avançou" : "avançaram"} para ${para}</div>
    <div class="pp-barras">${barra(nome, t, "eu")}${barra(esc(grupo), tr, "ref")}</div>
    ${veredito}
    ${g && g.i === i ? `<p class="pp-garg">Este é o <b>gargalo</b> de ${nome}: a passagem em que ele mais fica abaixo de ${refTxt}.</p>` : ""}
    <p class="pp-nota"><b>"p.p." = pontos percentuais.</b> É só a diferença entre as duas porcentagens: ${tr == null || t == null ? "por exemplo, 14% − 0% = 14 p.p." : `${pct1(Math.max(t, tr))} − ${pct1(Math.min(t, tr))} = ${(Math.round(Math.abs(t - tr) * 10) / 10).toLocaleString("pt-BR")} p.p.`}</p>
    <p class="pp-nota">A etapa só conta quando a situação do lead é atualizada no Supremo.</p>
    <div class="pp-acoes"><button class="btn" id="ppFunil" type="button">Ver funil de ${nome}</button><button class="btn-sec" data-fechar type="button">Fechar</button></div>
  </div>`).querySelector("#ppFunil").addEventListener("click", () => { document.getElementById("popupExplica").close(); onFunil(); });
}

function explicarTabela(refTxt) {
  abrirPopup(`<div class="pp">
    <button class="pp-x" data-fechar aria-label="Fechar">×</button>
    <div class="pp-rot">Comparativo</div>
    <h3>Como ler esta tabela</h3>
    <ol class="pp-lista">
      <li><b>Cada coluna é uma passagem</b> do funil, como Qualificado → Agendamento/Crédito.</li>
      <li><b>A porcentagem grande</b> é quantos leads do corretor passaram de uma etapa pra outra. Ex.: 7,5% = de cada 100 leads qualificados, 7 ou 8 chegaram em Agendamento/Crédito.</li>
      <li><b>A linha de cima (∑)</b> é a referência: o resultado de ${refTxt} inteira.</li>
      <li><b>O número pequeno com ▲ ou ▼</b> compara o corretor com a referência, em <b>pontos percentuais (p.p.)</b>, que é só a diferença entre as duas porcentagens. Ex.: 0% contra 14% = <span class="pp-ruim-txt">▼ 14 p.p.</span></li>
      <li><b>Célula vermelha</b> = o gargalo do corretor, a passagem em que ele mais fica abaixo de ${refTxt}.</li>
      <li><b>Número apagado</b> = menos de ${MIN_GARGALO} leads na etapa: pouco pra tirar conclusão.</li>
    </ol>
    <p class="pp-nota">Clique numa porcentagem pra ver a explicação daquele número. Clique no nome do corretor pra abrir o funil dele.</p>
    <div class="pp-acoes"><button class="btn" data-fechar type="button">Entendi</button></div>
  </div>`);
}
/* ---------- modo TV ---------- */
// O link principal abre aqui: uma pergunta por tela, telas que passam sozinhas.
// Estilo "galeria clara": fundo off-white da Lion, tipografia fina, linhas finas e
// uma cor de destaque por tela (a cor varia, o fundo não).
const TV_SEG = 15; // segundos por tela
const tvNome = (nome) => esc(nomeCurtoTV(nome));
function nomeCurtoTV(nome) {
  const p = nome.trim().split(/\s+/);
  const cap = (w) => (w.length <= 3 && /^(da|de|do|das|dos|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return (p.length > 2 ? [p[0], p[p.length - 1]] : p).map(cap).join(" ");
}
function rotuloPeriodo() {
  const preset = $(".chip.ativo")?.dataset.preset;
  if (preset === "semana") return "últimos 7 dias";
  if (preset === "custom") return "período escolhido";
  return new Date().toLocaleDateString("pt-BR", { month: "long" });
}

// Ranking por uma métrica: pódio em colunas à esquerda, 4º ao 10º à direita.
function telaRanking({ lista, valor, fmt, unid, vazioDir = "" }) {
  const top = lista.slice(0, 3), resto = lista.slice(3, 10);
  const alturas = [9, 6, 4]; // 1º mais alto
  const podio = [1, 0, 2].filter((i) => top[i]).map((i) => {
    const c = top[i];
    return `<div class="tvb-pd p${i + 1}">
      <span class="tvb-pd-pos">${i + 1}º lugar</span>
      <span class="tvb-pd-nome">${tvNome(c.nome)}</span>
      <span class="tvb-pd-val">${fmt(valor(c))}<small>${unid(valor(c))}</small></span>
      <span class="tvb-pd-col" style="height:calc(var(--u) * ${alturas[i]})"></span>
    </div>`;
  }).join("");
  const linhas = resto.map((c, j) => `<div class="tvb-ln">
      <span class="tvb-ln-pos">${j + 4}º</span>
      <span class="tvb-ln-nome">${tvNome(c.nome)}</span>
      <span class="tvb-ln-val">${fmt(valor(c))}</span>
    </div>`).join("");
  return `<div class="tvb-duo">
      <div class="tvb-podio">${podio}</div>
      <div class="tvb-lista">${linhas ? linhas + (lista.length > 10 ? `<div class="tvb-mais">+ ${lista.length - 10} corretores no painel completo</div>` : "")
        : `<div class="tvb-recado"><p><b>${lista.length === 1 ? "Só 1 corretor aparece" : `Só ${lista.length} corretores aparecem`}</b> neste ranking por enquanto.</p>${vazioDir ? `<p class="tvb-recado-ac">${vazioDir}</p>` : ""}</div>`}</div>
    </div>`;
}

function telasTV(d) {
  const perfis = calcularPerfis(d.corretores).filter((p) => naEquipe(p.c.nome));
  const cs = d.corretores.filter((x) => naEquipe(x.nome));
  const per = rotuloPeriodo();
  const grupo = equipeAtual() ? equipeAtual().nome : "Lion";
  const sub = (extra) => `${per.charAt(0).toUpperCase() + per.slice(1)}${extra ? ` · ${extra}` : ""}`;
  const telas = [];

  // 1) corretor destaque
  if (perfis.length) {
    const [p1, p2, p3] = perfis;
    const stat = (v, um, varios) => `<div class="tvb-dq-stat"><b>${num(v)}</b><span>${v === 1 ? um : varios}</span></div>`;
    telas.push({
      id: "destaque", nome: "Destaque", titulo: "Corretor destaque", sub: sub(`${grupo}`),
      rodape: "O destaque é quem tem o maior score do período",
      html: `<div class="tvb-dq">
        <div>
          <span class="tvb-kicker">1º lugar no score</span>
          <h2 class="tvb-dq-nome">${tvNome(p1.c.nome)}</h2>
          <div class="tvb-dq-score"><b>${p1.score}</b><span>pontos<br>de 100</span></div>
        </div>
        <div class="tvb-dq-lado">
          ${stat(p1.c.propostas || 0, "proposta", "propostas")}
          ${stat(p1.c.vendas, "venda fechada", "vendas fechadas")}
          ${stat(p1.c.leads, "lead recebido", "leads recebidos")}
          <div class="tvb-dq-cola">${p2 ? `<span>2º ${tvNome(p2.c.nome)} <b>${p2.score}</b></span>` : ""}${p3 ? `<span>3º ${tvNome(p3.c.nome)} <b>${p3.score}</b></span>` : ""}</div>
        </div>
      </div>`,
    });
  }

  // 2) ranking geral (score)
  if (perfis.length) {
    telas.push({
      id: "score", nome: "Ranking geral", titulo: "Ranking geral", sub: sub(`${perfis.length} corretores`),
      rodape: "Score de 0 a 100 · vendas 35% · propostas 30% · conversão 20% · leads em dia 15%",
      html: telaRanking({ lista: perfis.map((p) => ({ nome: p.c.nome, score: p.score })), valor: (c) => c.score, fmt: num, unid: () => "pts" }),
    });
  }

  // 3) propostas
  const comProposta = cs.filter((x) => (x.propostas || 0) > 0).sort((a, b) => b.propostas - a.propostas);
  if (comProposta.length) {
    telas.push({
      id: "propostas", nome: "Propostas", titulo: "Quem mais fez propostas", sub: sub(`${comProposta.length} ${comProposta.length === 1 ? "corretor" : "corretores"}`),
      rodape: "Conta os leads do período que chegaram em Proposta ou já viraram venda",
      html: telaRanking({
        lista: comProposta, valor: (c) => c.propostas, fmt: num, unid: (v) => (v === 1 ? "proposta" : "propostas"),
        vazioDir: "Proposta vale 30% do score. Cada proposta registrada no Supremo leva você pra cima no ranking.",
      }),
    });
  }

  // 4) vendas
  const comVenda = cs.filter((x) => x.vendas > 0).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  if (comVenda.length) {
    telas.push({
      id: "vendas", nome: "Vendas", titulo: "Quem mais vendeu", sub: sub(`VGV ${brlK(comVenda.reduce((s, x) => s + x.vgv, 0))}`),
      rodape: "Vendas registradas no Supremo no período",
      html: telaRanking({
        lista: comVenda, valor: (c) => c.vendas, fmt: num, unid: (v) => (v === 1 ? "venda" : "vendas"),
        vazioDir: "Venda vale 35% do score. Lembre de marcar o lead como vendido no Supremo.",
      }),
    });
  }

  // 5) funil em linguagem simples
  const f = somaFunil(cs.filter((x) => x.funil && x.leads > 0).map((x) => x.funil));
  if (f[0]) {
    const etapas = d.etapasFunil || ETAPAS_PADRAO;
    const de100 = (v) => { const r = (100 * v) / f[0]; return v && r < 1 ? "&lt;1" : Math.round(r); };
    const pior = piorPassagemTV(f);
    telas.push({
      id: "funil", nome: "Funil", titulo: "Funil de vendas", sub: sub(`${num(f[0])} leads qualificados`),
      rodape: pior ? `Onde mais perdemos: ${etapas[pior.i - 1]} → ${etapas[pior.i]} · só ${pct(pior.t)} avançam` : "Atualize a situação do lead no Supremo a cada passo",
      html: `<div class="tvb-fn">
        <p class="tvb-fn-intro">De cada <b>100</b> leads que chegam ao corretor…</p>
        ${etapas.map((e, i) => `<div class="tvb-fn-ln">
          <span class="tvb-fn-etapa">${e}</span>
          <span class="tvb-fn-trilho"><i style="width:${Math.max(0.6, (100 * f[i]) / f[0])}%"></i></span>
          <span class="tvb-fn-100"><b>${de100(f[i])}</b> de 100</span>
          <span class="tvb-fn-qtd">${num(f[i])} leads</span>
        </div>`).join("")}
      </div>`,
    });
  }

  // 6) leads parados
  if (d.alertasProntos) {
    const alertas = (d.alertas || []).filter((a) => naEquipe(a.corretor));
    const porCorretor = {};
    for (const a of alertas) porCorretor[a.corretor] = (porCorretor[a.corretor] || 0) + 1;
    const lista = Object.entries(porCorretor).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n).slice(0, 7);
    const graves = alertas.filter((a) => a.diasParado > 30).length;
    telas.push({
      id: "parados", nome: "Leads parados", titulo: "Leads parados", sub: "Ativos, sem movimentação há mais de 15 dias",
      rodape: "Lead com a situação atualizada no Supremo sai desta lista",
      html: alertas.length ? `<div class="tvb-duo">
          <div class="tvb-big">
            <b>${num(alertas.length)}</b>
            <p>leads sem nenhuma movimentação há mais de 15 dias</p>
            <p class="tvb-big-sub"><b>${num(graves)}</b> deles há mais de 30 dias</p>
          </div>
          <div class="tvb-lista">
            <div class="tvb-lista-tit">Quem tem mais leads parados</div>
            ${lista.map((x) => `<div class="tvb-ln sem-pos">
              <span class="tvb-ln-nome">${tvNome(x.nome)}</span>
              <span class="tvb-ln-val">${num(x.n)}</span>
            </div>`).join("")}
          </div>
        </div>`
        : `<div class="tvb-zerado"><b>0</b><p>Nenhum lead parado há mais de 15 dias. Parabéns, time!</p></div>`,
    });
  }
  return telas;
}
function piorPassagemTV(f) {
  let pior = null;
  for (let i = 1; i < f.length; i++) { const t = taxa(f, i); if (t != null && f[i - 1] >= MIN_GARGALO && (!pior || t < pior.t)) pior = { i, t }; }
  return pior;
}

let tvTimer = null;
function renderTV() {
  const tv = $("#tv");
  if (!estado.data) {
    tv.innerHTML = `<div class="tv-carregando"><div class="loader"></div><p>Carregando o ranking da Lion…</p></div>`;
    return;
  }
  const telas = telasTV(estado.data);
  if (!telas.length) { tv.innerHTML = `<div class="tv-carregando"><p>Sem dados no período.</p></div>`; return; }
  estado.tvIdx = ((estado.tvIdx || 0) % telas.length + telas.length) % telas.length;
  const t = telas[estado.tvIdx];
  const gerado = new Date(estado.data.geradoEm);
  const hoje = gerado.toDateString() === new Date().toDateString();
  const hora = (hoje ? "" : gerado.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " ") + gerado.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  tv.dataset.tema = t.id;
  tv.innerHTML = `<div class="tv-quadro">
    <header class="tvb-topo">
      <img class="tvb-logo" src="/logo-lion-preto.png" alt="Lion Negócios Imobiliários" />
      <div class="tvb-tit"><h1>${t.titulo}</h1><span>${t.sub || ""}</span></div>
      <div class="tvb-info">${estado.semConexao ? `<span class="tvb-vivo off"><i></i>reconectando…</span>` : `<span class="tvb-vivo"><i></i>ao vivo</span>`}<span>atualizado ${hoje ? "às " : "em "}${hora}</span></div>
    </header>
    <section class="tvb-tela">${t.html}</section>
    <footer class="tvb-rod">
      <span class="tvb-rod-txt">${t.rodape || ""}</span>
      <nav class="tvb-nav">
        ${telas.map((x, i) => `<button class="tvb-nav-it ${i === estado.tvIdx ? "ativo" : ""}" data-tv="${i}"><i>${i === estado.tvIdx ? `<u style="animation-duration:${TV_SEG}s"></u>` : ""}</i>${x.nome}</button>`).join("")}
        <button class="tvb-sair" id="tvSair" type="button">Abrir painel completo <span class="seta" aria-hidden="true">→</span></button>
      </nav>
    </footer>
  </div>`;
  tv.querySelectorAll("[data-tv]").forEach((b) => b.addEventListener("click", () => { estado.tvIdx = Number(b.dataset.tv); agendarTV(); renderTV(); }));
  $("#tvSair").addEventListener("click", () => irParaView("ranking"));
}
function agendarTV() {
  clearInterval(tvTimer);
  tvTimer = setInterval(() => { if (estado.view !== "tv") return; estado.tvIdx = (estado.tvIdx || 0) + 1; renderTV(); }, TV_SEG * 1000);
}
function irParaView(v) {
  estado.view = v;
  const u = new URL(location.href);
  if (v === "tv") u.searchParams.delete("view"); else u.searchParams.set("view", v);
  history.replaceState(null, "", u);
  aplicarModo();
  if (estado.data) render();
  window.scrollTo({ top: 0 });
}
function aplicarModo() {
  const tv = estado.view === "tv";
  document.body.classList.toggle("modo-tv", tv);
  $("#tv").classList.toggle("oculto", !tv);
  if (tv) { agendarTV(); renderTV(); } else clearInterval(tvTimer);
}
document.addEventListener("keydown", (e) => {
  if (estado.view !== "tv") return;
  if (e.key === "ArrowRight") { estado.tvIdx = (estado.tvIdx || 0) + 1; agendarTV(); renderTV(); }
  if (e.key === "ArrowLeft") { estado.tvIdx = (estado.tvIdx || 0) - 1; agendarTV(); renderTV(); }
  if (e.key === "Escape") irParaView("ranking");
});

/* ---------- eventos ---------- */
$("#views").addEventListener("click", (e) => {
  const b = e.target.closest(".view-tab"); if (!b) return;
  irParaView(b.dataset.view);
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
// O link sem ?view abre o modo TV (é o que passa na televisão da imobiliária).
const viewUrl = new URL(location.href).searchParams.get("view");
estado.view = ["ranking", "funil", "perfil", "metodo"].includes(viewUrl) ? viewUrl : "tv";
// No app instalado o link abre sem ?equipe: usa a última equipe escolhida nele.
const ehApp = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
try {
  if (ehApp && !estado.equipe) estado.equipe = localStorage.getItem("equipe") || "";
  if (estado.equipe) localStorage.setItem("equipe", estado.equipe);
} catch {}
$("#equipeSel").addEventListener("change", () => { try { localStorage.setItem("equipe", estado.equipe); } catch {} });

// app instalável: registra o service worker (só funciona em https ou localhost)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

(function initDatas() {
  const hoje = new Date();
  $("#fim").value = isoDate(hoje);
  $("#inicio").value = isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
})();

aplicarModo();
carregar();
carregarEvolucao();
// auto-refresh para o modo TV
setInterval(() => { carregar({ soft: true }); carregarEvolucao(); }, 3 * 60 * 1000);

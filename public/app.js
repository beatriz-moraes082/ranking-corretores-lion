/* Ranking de Corretores — Lion. Frontend (sem dependências). */
const $ = (s, r = document) => r.querySelector(s);
const PALETA = ["#f0a51e", "#8b5cf6", "#3b82f6", "#10b981", "#ec4899", "#f97316"];
const num = (n) => (n || 0).toLocaleString("pt-BR");
const brlK = (n) => {
  n = n || 0;
  if (n >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (n >= 1e3) return "R$ " + Math.round(n / 1e3) + "k";
  return "R$ " + num(n);
};

let estado = { data: null, ord: "score", refreshTimer: null };

/* ---------- tema ---------- */
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
const isoDate = (d) => d.toISOString().slice(0, 10);
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
  { key: "contato", label: "1º contato", short: "1º contato", raw: (c) => (c.tempoQualifHoras == null ? null : -c.tempoQualifHoras), disp: (c) => (c.tempoQualifHoras == null ? "—" : `${c.tempoQualifHoras}h`) },
  { key: "mov", label: "Movimentação", short: "Movim.", raw: (c) => (c.leads ? c.movimentados / c.leads : 0), disp: (c) => `${Math.round((c.leads ? c.movimentados / c.leads : 0) * 100)}%` },
  { key: "consist", label: "Consistência", short: "Consist.", raw: (c) => (c.leads ? -(c.parados15d / c.leads) : 0), disp: (c) => `${c.parados15d} parados` },
];
const PESOS = { vendas: 0.28, conversao: 0.2, volume: 0.16, contato: 0.16, mov: 0.1, consist: 0.1 };

function calcularPerfis(corretores) {
  const cohort = corretores.filter((c) => c.leads > 0);
  if (!cohort.length) return [];
  // min/max por dimensão (ignora null)
  const stats = {};
  for (const d of DIMS) {
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
    for (const d of DIMS) dims[d.key] = norm(d, c);
    const score = Math.round(DIMS.reduce((s, d) => s + dims[d.key] * (PESOS[d.key] || 0), 0));
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
async function carregar({ soft = false } = {}) {
  const { inicio, fim } = periodoAtual();
  if (!inicio || !fim) return;
  if (!soft) $("#conteudo").innerHTML = `<div class="carregando"><div class="loader"></div><p>Consultando o Supremo CRM…<br><small>Períodos longos podem levar ~1 min na 1ª vez.</small></p></div>`;
  try {
    const r = await fetch(`/api/ranking?inicio=${inicio}&fim=${fim}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalhe || data.erro || "Falha");
    estado.data = data;
    render();
    $("#rodapeInfo").textContent = `Período ${data.periodo.inicio} a ${data.periodo.fim} · atualizado ${new Date(data.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    if (!soft) $("#conteudo").innerHTML = `<div class="erro"><b>Não consegui carregar.</b><br>${e.message}</div>`;
  }
}

/* ---------- render ---------- */
function render() {
  const d = estado.data;
  const perfis = calcularPerfis(d.corretores);
  const byNome = Object.fromEntries(perfis.map((p, i) => [p.c.nome, { ...p, i }]));
  const c = $("#conteudo");
  c.innerHTML = "";

  /* KPIs */
  const r = d.resumo;
  const kpis = [
    { rot: "Leads no período", ico: "👥", cor: "var(--c3)", val: r.leads, sub: `${r.corretoresAtivos} corretores ativos` },
    { rot: "Vendas fechadas", ico: "🏆", cor: "var(--gold)", val: r.vendas, sub: `conversão ${r.conversaoGeral}%` },
    { rot: "VGV vendido", ico: "💰", cor: "var(--c4)", val: r.vgv, money: true, sub: `ticket ${brlK(r.ticketMedio)}` },
    { rot: "Parados +15 dias", ico: "🚨", cor: "var(--c5)", val: r.parados15d, sub: d.alertasProntos ? "precisam de ação" : "calculando…" },
  ];
  const kpiEl = document.createElement("section");
  kpiEl.className = "kpis";
  kpiEl.innerHTML = kpis.map((k, i) => `
    <div class="kpi anim" style="--kc:${k.cor};animation-delay:${i * 60}ms">
      <div class="rot"><em>${k.ico}</em>${k.rot}</div>
      <div class="val" data-cu="${k.val}" data-money="${k.money ? 1 : 0}">0</div>
      <div class="sub">${k.sub}</div>
    </div>`).join("");
  c.appendChild(kpiEl);

  /* Pódio */
  if (perfis.length) {
    const top = perfis.slice(0, 3);
    const ordemVisual = [1, 0, 2].filter((idx) => top[idx]); // 2º, 1º, 3º
    const medals = ["🥇", "🥈", "🥉"];
    const sec = document.createElement("section");
    sec.className = "secao";
    sec.innerHTML = `<div class="secao-hd"><h2>Pódio do período</h2><span>score = mix de vendas, conversão, volume, 1º contato, movimentação e consistência</span></div>`;
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
          <div><b>${p.c.conversao}%</b><span>conv.</span></div>
          <div><b>${p.c.tempoQualifHoras == null ? "—" : p.c.tempoQualifHoras + "h"}</b><span>1º contato</span></div>
        </div>
      </div>`;
    }).join("");
    sec.appendChild(grid);
    c.appendChild(sec);
  }

  /* Ranking completo */
  const cols = [
    { key: "score", lab: "Score", sortable: true },
    { key: "vendas", lab: "Vendas", sortable: true },
    { key: "vgv", lab: "VGV", sortable: true, hide: true },
    { key: "conversao", lab: "Conversão", sortable: true },
    { key: "leads", lab: "Leads", sortable: true, hide: true },
    { key: "contato", lab: "1º contato", sortable: true },
    { key: "parados15d", lab: "Parados +15d", sortable: true },
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
        <span class="rk-pos ${i < 3 ? "m" : ""}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
        <span class="rk-av" style="background:linear-gradient(150deg,${cor},${cor}bb)">${iniciais(p.c.nome)}</span>
        <span><span class="rk-nome">${p.c.nome.trim()}</span><br><span class="rk-sub">${p.c.leads} leads · ${p.c.movimentados} movim.</span></span>
      </div></td>
      <td><span class="score-cell">${p.score}</span><span class="mini-bar"><i style="width:${(p.score / maxScore) * 100}%"></i></span></td>
      <td><span class="cell-num">${p.c.vendas}</span></td>
      <td class="hide-sm"><span class="cell-num">${brlK(p.c.vgv)}</span></td>
      <td><span class="pill ${p.c.conversao >= 3 ? "g" : "n"}">${p.c.conversao}%</span></td>
      <td class="hide-sm"><span class="cell-num">${p.c.leads}</span></td>
      <td><span class="cell-num">${p.c.tempoQualifHoras == null ? "—" : p.c.tempoQualifHoras + "h"}</span></td>
      <td>${p.c.parados15d ? `<span class="pill r">${p.c.parados15d}</span>` : `<span class="pill n">0</span>`}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table>${thead}<tbody>${tbody || `<tr><td colspan="8" class="vazio">Sem dados no período.</td></tr>`}</tbody></table>`;
  wrap.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { estado.ord = th.dataset.k; render(); }));
  sec2.appendChild(wrap);
  c.appendChild(sec2);

  /* Perfil comportamental (radar) */
  if (perfis.length) {
    const sec3 = document.createElement("section");
    sec3.className = "secao";
    sec3.innerHTML = `<div class="secao-hd"><h2>Perfil comportamental</h2><span>6 dimensões, normalizadas entre os corretores do período</span></div>`;
    const grid = document.createElement("div");
    grid.className = "radar-grid";
    grid.innerHTML = perfis.slice(0, 6).map((p, i) => {
      const cor = corDe(i);
      return `<div class="radar-card anim" style="animation-delay:${i * 70}ms">
        <div class="radar-hd">
          <span class="rk-av" style="background:linear-gradient(150deg,${cor},${cor}bb)">${iniciais(p.c.nome)}</span>
          <div><div class="n">${p.c.nome.trim()}</div><div class="s">score ${p.score} · ${p.c.vendas} vendas · 1º contato ${p.c.tempoQualifHoras == null ? "—" : p.c.tempoQualifHoras + "h"}</div></div>
        </div>
        ${radarSVG(p.dims, cor)}
        <div class="radar-legend">
          <div class="up"><h4>▲ Fortes</h4><p>${p.fortes.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
          <div class="down"><h4>▼ A melhorar</h4><p>${p.melhorar.map((f) => `<b>${f.label}</b> ${f.v}`).join("<br>")}</p></div>
        </div>
      </div>`;
    }).join("");
    sec3.appendChild(grid);
    c.appendChild(sec3);
  }

  /* Alertas */
  const sec4 = document.createElement("section");
  sec4.className = "secao";
  sec4.innerHTML = `<div class="secao-hd"><h2>🚨 Leads parados +15 dias</h2><span>ativos, sem movimentação há +15 dias · janela de ${d.alertaJanelaDias || 45} dias</span></div>`;
  const box = document.createElement("div");
  box.className = "alertas-box";
  if (!d.alertasProntos) box.innerHTML = `<div class="vazio">⏳ Calculando varredura dos últimos ${d.alertaJanelaDias || 45} dias… recarrega em instantes.</div>`;
  else if (!d.alertas.length) box.innerHTML = `<div class="vazio">🎉 Nenhum lead parado além de 15 dias.</div>`;
  else box.innerHTML = d.alertas.slice(0, 12).map((a) => `
    <div class="alerta-row">
      <div class="alerta-dias"><b>${a.diasParado}</b><span>dias</span></div>
      <div class="alerta-info">
        <div class="l">${a.lead} ${a.telefone ? `<span class="alerta-tel">· ${a.telefone}</span>` : ""}</div>
        <div class="m">👤 ${a.corretor.trim()} · ${a.etapa || ""}${a.situacao ? " · " + a.situacao : ""}</div>
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

/* ---------- eventos ---------- */
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  $(".chip.ativo").classList.remove("ativo"); b.classList.add("ativo");
  const custom = b.dataset.preset === "custom";
  $("#datasCustom").classList.toggle("oculto", !custom);
  if (!custom) carregar();
});
$("#aplicar").addEventListener("click", () => carregar());
$("#themeToggle").addEventListener("click", toggleTema);

(function initDatas() {
  const hoje = new Date();
  $("#fim").value = isoDate(hoje);
  $("#inicio").value = isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
})();

carregar();
// auto-refresh para o modo TV
setInterval(() => carregar({ soft: true }), 3 * 60 * 1000);

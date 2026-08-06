// Painel de ranking — logica de frontend (sem dependencias).
const $ = (s, r = document) => r.querySelector(s);
const brl = (n) => "R$ " + (n || 0).toLocaleString("pt-BR");
const brlK = (n) => (n >= 1000 ? "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "k" : brl(n));
const num = (n) => (n || 0).toLocaleString("pt-BR");

let estado = { data: null, tab: "corretores", ordCorretor: "vendas", ordQualif: "vendas" };

function isoDate(d) { return d.toISOString().slice(0, 10); }

function periodoAtual() {
  const preset = $(".chip.ativo").dataset.preset;
  const hoje = new Date();
  if (preset === "semana") {
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - 6);
    return { inicio: isoDate(ini), fim: isoDate(hoje) };
  }
  if (preset === "custom") {
    return { inicio: $("#inicio").value, fim: $("#fim").value };
  }
  return { inicio: isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoDate(hoje) };
}

async function carregar() {
  const { inicio, fim } = periodoAtual();
  if (!inicio || !fim) return;
  $("#conteudo").innerHTML = '<div class="carregando">Consultando o Supremo CRM…<br><small>Pode levar alguns segundos em períodos longos.</small></div>';
  $("#kpis").innerHTML = "";
  try {
    const r = await fetch(`/api/ranking?inicio=${inicio}&fim=${fim}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detalhe || data.erro || "Falha na consulta");
    estado.data = data;
    renderKpis();
    render();
    $("#rodapeInfo").textContent = `Período ${data.periodo.inicio} a ${data.periodo.fim} · atualizado ${new Date(data.geradoEm).toLocaleString("pt-BR")}`;
  } catch (e) {
    $("#conteudo").innerHTML = `<div class="erro"><b>Não consegui carregar.</b><br>${e.message}</div>`;
  }
}

function renderKpis() {
  const r = estado.data.resumo;
  const cards = [
    { rot: "Leads no período", val: num(r.leads), sub: `${r.corretoresAtivos} corretores ativos` },
    { rot: "Vendas fechadas", val: num(r.vendas), sub: `conversão ${r.conversaoGeral}%`, destaque: true },
    { rot: "VGV (volume vendido)", val: brlK(r.vgv), sub: `ticket médio ${brlK(r.ticketMedio)}` },
    { rot: "Leads parados +15 dias", val: num(r.parados15d), sub: "precisam de ação" },
  ];
  $("#kpis").innerHTML = cards.map((c) => `
    <div class="kpi ${c.destaque ? "destaque" : ""}">
      <div class="rotulo">${c.rot}</div>
      <div class="valor">${c.val}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join("");
}

function pos(i) {
  const cls = i < 3 ? `p${i + 1}` : "";
  const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
  return `<span class="pos ${cls}">${i < 3 ? medal : i + 1}</span>`;
}

function tabela(rows, cols, ordKey, ordSetter) {
  const ordenado = [...rows].sort((a, b) => {
    const va = a[ordKey], vb = b[ordKey];
    if (va == null) return 1; if (vb == null) return -1;
    return vb - va;
  });
  const head = cols.map((c) => `<th data-col="${c.key}" class="${c.key === ordKey ? "ord" : ""}">${c.lab}</th>`).join("");
  const body = ordenado.slice(0, 40).map((row, i) => "<tr>" + cols.map((c, ci) =>
    `<td>${ci === 0 ? pos(i) : ""}${c.fmt(row[c.key], row)}</td>`).join("") + "</tr>").join("");
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="vazio">Sem dados no período.</td></tr>`}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { ordSetter(th.dataset.col); render(); }));
  return t;
}

function painel(titulo, dica, node) {
  const p = document.createElement("div");
  p.className = "painel";
  p.innerHTML = `<h2>${titulo}</h2><div class="dica">${dica}</div>`;
  p.appendChild(node);
  return p;
}

function render() {
  const c = $("#conteudo");
  c.innerHTML = "";
  const d = estado.data;
  if (!d) return;

  if (estado.tab === "corretores") {
    const maxV = Math.max(1, ...d.corretores.map((x) => x.vendas));
    const cols = [
      { key: "nome", lab: "Corretor", fmt: (v) => `<span class="nome">${v}</span>` },
      { key: "vendas", lab: "Vendas", fmt: (v) => `<b>${v}</b> <span class="barra" style="display:inline-block;width:50px;vertical-align:middle"><i style="width:${(v / maxV) * 100}%"></i></span>` },
      { key: "vgv", lab: "VGV", fmt: (v) => brlK(v) },
      { key: "conversao", lab: "Conversão", fmt: (v) => `<span class="pill ${v >= 3 ? "g" : "n"}">${v}%</span>` },
      { key: "leads", lab: "Leads", fmt: (v) => num(v) },
      { key: "movimentados", lab: "Movim.", fmt: (v) => num(v) },
      { key: "tempoQualifHoras", lab: "T. qualif.", fmt: (v) => (v == null ? "—" : `${v}h`) },
      { key: "parados15d", lab: "Parados+15d", fmt: (v) => v ? `<span class="pill r">${v}</span>` : `<span class="pill n">0</span>` },
    ];
    c.appendChild(painel("🏆 Ranking de corretores",
      "Clique no cabeçalho pra ordenar. Vendas contam pela data da venda; conversão = vendas ÷ leads recebidos no período.",
      tabela(d.corretores, cols, estado.ordCorretor, (k) => estado.ordCorretor = k)));
  }

  if (estado.tab === "qualificadores") {
    const cols = [
      { key: "nome", lab: "Qualificador", fmt: (v) => `<span class="nome">${v}</span>` },
      { key: "leads", lab: "Leads", fmt: (v) => num(v) },
      { key: "qualificados", lab: "Qualificados", fmt: (v) => num(v) },
      { key: "tempoQualifHoras", lab: "Tempo médio", fmt: (v) => (v == null ? "—" : `${v}h`) },
      { key: "vendas", lab: "Viraram venda", fmt: (v) => `<b>${v}</b>` },
    ];
    c.appendChild(painel("🎧 Ranking de qualificadores (pré-atendimento)",
      "Time que faz o primeiro contato/qualificação. Tempo médio = captura até qualificar (quanto menor, mais rápido responde o lead).",
      tabela(d.qualificadores, cols, estado.ordQualif, (k) => estado.ordQualif = k)));
  }

  if (estado.tab === "origens") {
    const cols = [
      { key: "nome", lab: "Origem", fmt: (v) => `<span class="nome">${v}</span>` },
      { key: "leads", lab: "Leads", fmt: (v) => num(v) },
      { key: "vendas", lab: "Vendas", fmt: (v) => `<b>${v}</b>` },
      { key: "conversao", lab: "Conversão", fmt: (v) => `<span class="pill ${v >= 3 ? "g" : "n"}">${v}%</span>` },
    ];
    c.appendChild(painel("📣 Desempenho por origem",
      "Quais canais trazem mais lead e mais venda. Útil pra decidir onde investir mídia.",
      tabela(d.origens, cols, "leads", () => {})));
  }

  if (estado.tab === "funil") {
    const g = document.createElement("div"); g.className = "grid2";
    // funil
    const f = d.funil; const totalF = Math.max(1, f.novos + f.comCorretor + f.vendidos + f.perdidos);
    const fp = document.createElement("div"); fp.className = "painel";
    fp.innerHTML = `<h2>🔻 Funil do período</h2><div class="dica">Distribuição dos leads capturados por etapa.</div>`;
    const etapas = [
      { lab: "Leads novos", v: f.novos, cor: "var(--blue)" },
      { lab: "Com o corretor", v: f.comCorretor, cor: "var(--gold)" },
      { lab: "Vendidos", v: f.vendidos, cor: "var(--green)" },
      { lab: "Perdidos", v: f.perdidos, cor: "var(--red)" },
    ];
    fp.innerHTML += etapas.map((e) => `
      <div class="funil-linha">
        <span class="lab">${e.lab}</span>
        <span class="track"><i style="width:${(e.v / totalF) * 100}%;background:${e.cor}"></i></span>
        <span class="num">${num(e.v)}</span>
      </div>`).join("");
    g.appendChild(fp);

    // motivos de perda
    const mp = document.createElement("div"); mp.className = "painel";
    mp.innerHTML = `<h2>❌ Motivos de perda</h2><div class="dica">Por que os leads foram perdidos no período.</div>`;
    const maxM = Math.max(1, ...d.motivosPerda.map((m) => m.qtd));
    mp.innerHTML += (d.motivosPerda.length ? d.motivosPerda.slice(0, 10).map((m) => `
      <div class="funil-linha">
        <span class="lab" style="width:auto;flex:1">${m.motivo}</span>
        <span class="track" style="max-width:120px"><i style="width:${(m.qtd / maxM) * 100}%;background:var(--red)"></i></span>
        <span class="num">${num(m.qtd)}</span>
      </div>`).join("") : `<div class="vazio">Nenhuma perda registrada no período.</div>`);
    g.appendChild(mp);
    c.appendChild(g);

    // evolucao
    if (d.evolucao.length) {
      const ev = document.createElement("div"); ev.className = "painel"; ev.style.marginTop = "18px";
      ev.innerHTML = `<h2>📈 Leads capturados por dia</h2><div class="dica">Volume diário de entrada de leads.</div>`;
      const maxE = Math.max(1, ...d.evolucao.map((x) => x.qtd));
      ev.innerHTML += `<div class="spark">${d.evolucao.map((x) => `<i style="height:${(x.qtd / maxE) * 100}%" title="${x.dia}: ${x.qtd}"></i>`).join("")}</div>`;
      c.appendChild(ev);
    }
  }

  if (estado.tab === "alertas") {
    const p = document.createElement("div"); p.className = "painel";
    p.innerHTML = `<h2>🚨 Leads ativos parados há mais de 15 dias</h2>
      <div class="dica">Leads ainda ativos, sem movimentação de etapa há +15 dias. Varredura dos últimos ${d.alertaJanelaDias || 45} dias (independente do período selecionado acima). Ordenados do mais parado ao menos.</div>`;
    if (!d.alertasProntos) {
      p.innerHTML += `<div class="vazio">⏳ Calculando a varredura dos últimos ${d.alertaJanelaDias || 45} dias…<br><small>Leva ~1-2 min na primeira vez. Recarregue em instantes.</small></div>`;
    } else if (!d.alertas.length) {
      p.innerHTML += `<div class="vazio">🎉 Nenhum lead ativo parado além de 15 dias.</div>`;
    } else {
      p.innerHTML += d.alertas.slice(0, 100).map((a) => `
        <div class="alerta-item">
          <div class="alerta-dias">${a.diasParado}<small>dias</small></div>
          <div class="alerta-info">
            <div class="l">${a.lead} ${a.telefone ? `· <span style="color:var(--txt-dim)">${a.telefone}</span>` : ""}</div>
            <div class="m">👤 ${a.corretor} · ${a.etapa || ""}${a.situacao ? " · " + a.situacao : ""}</div>
          </div>
        </div>`).join("");
    }
    c.appendChild(p);
  }
}

// eventos
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  $(".chip.ativo").classList.remove("ativo"); b.classList.add("ativo");
  const custom = b.dataset.preset === "custom";
  $("#datasCustom").classList.toggle("oculto", !custom);
  if (!custom) carregar();
});
$("#aplicar").addEventListener("click", carregar);
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  $(".tab.ativo").classList.remove("ativo"); b.classList.add("ativo");
  estado.tab = b.dataset.tab; render();
});

// datas padrao no custom
(() => {
  const hoje = new Date();
  $("#fim").value = isoDate(hoje);
  $("#inicio").value = isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
})();
carregar();

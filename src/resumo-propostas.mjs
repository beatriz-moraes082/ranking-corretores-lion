// Resumo semanal de propostas por campanha, entregue como tarefa no ClickUp
// (para o assessor de tráfego cruzar proposta com a campanha que gerou o lead).
//
// O Supremo não guarda quando um lead entrou em Proposta, então "proposta nova"
// é a que ainda não saiu em nenhum resumo anterior. Os resumos já criados ficam
// no próprio ClickUp (cada lead aparece como "lead #ID"), e é de lá que o servidor
// lê o que já foi enviado: funciona mesmo depois de reinícios e publicações.
//
// Só a criação da tarefa escreve no ClickUp; nenhuma consulta extra ao Supremo.

import { nivelFunil } from "./aggregate.mjs";

const API = "https://api.clickup.com/api/v2";
const ETIQUETA = "resumo-propostas";
const NIVEL_PROPOSTA = 3;

const limpo = (s) => (s || "").trim();
const semCampanha = "(sem campanha no Supremo)";
// O ClickUp desfaz o "\|" e a tabela desalinha: dentro dela, "|" vira "/".
const celula = (s) => String(s).replace(/\s*\|\s*/g, " / ");
const dataBR = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
const pseudo = (n) => !n || ["DESCARTE", "(SEM CORRETOR)", "SEM CORRETOR"].includes(n.toUpperCase());

// Leads que chegaram a Proposta (ou além) entre os que o painel tem em memória.
export function propostasEm(leads) {
  const vistos = new Set();
  const out = [];
  for (const l of leads) {
    if (l.id == null || vistos.has(l.id)) continue;
    vistos.add(l.id);
    if (pseudo(limpo(l.nome_corretor))) continue;
    if (nivelFunil(l) < NIVEL_PROPOSTA) continue;
    out.push(l);
  }
  return out;
}

// Monta o resumo: propostas ainda não enviadas, agrupadas por campanha, com o
// volume de leads de cada campanha no mesmo recorte para dar a proporção.
export function montarResumo({ leads, jaEnviados, periodo }) {
  const porCampanha = new Map();
  const campanha = (l) => limpo(l.nome_campanha) || semCampanha;
  for (const l of leads) {
    const c = campanha(l);
    if (!porCampanha.has(c)) porCampanha.set(c, { campanha: c, leads: 0, propostas: 0, novas: [] });
    porCampanha.get(c).leads++;
  }
  const todas = propostasEm(leads);
  for (const l of todas) {
    const g = porCampanha.get(campanha(l));
    g.propostas++;
    if (!jaEnviados.has(String(l.id))) g.novas.push(l);
  }
  const grupos = [...porCampanha.values()].filter((g) => g.novas.length)
    .sort((a, b) => b.novas.length - a.novas.length || a.campanha.localeCompare(b.campanha));
  const novas = grupos.reduce((n, g) => n + g.novas.length, 0);
  return { periodo, novas, grupos, primeiro: jaEnviados.size === 0 };
}

// Nome começa pelo verbo, sem o cliente (ele vai no campo Clientes). A marca
// (sem a contagem) identifica a semana para não criar dois resumos iguais.
export function marcaResumo(r) {
  return `Analisar propostas x campanhas (${dataBR(r.periodo.inicio).slice(0, 5)} a ${dataBR(r.periodo.fim).slice(0, 5)})`;
}
export function tituloResumo(r) {
  return `${marcaResumo(r)} — ${r.novas} ${r.novas === 1 ? "proposta" : "propostas"}`;
}

export function textoResumo(r) {
  const linhas = [];
  linhas.push(`**${r.novas} ${r.novas === 1 ? "proposta nova" : "propostas novas"}** desde o último resumo, com a campanha de origem de cada lead.`);
  if (r.primeiro) linhas.push("", "_Primeiro resumo: entram todas as propostas dos leads captados neste mês e no anterior._");
  linhas.push("", "| Campanha | Propostas novas | Propostas no total | Leads da campanha |", "|---|---|---|---|");
  for (const g of r.grupos) linhas.push(`| ${celula(g.campanha)} | **${g.novas.length}** | ${g.propostas} | ${g.leads} |`);
  linhas.push("", "_Total e leads contam os captados de " + dataBR(r.periodo.baseInicio) + " até " + dataBR(r.periodo.baseFim) + "._");
  for (const g of r.grupos) {
    linhas.push("", `### ${g.campanha}`);
    for (const l of g.novas) {
      const extra = [limpo(l.nome_origem), limpo(l.nome_empreendimento)].filter(Boolean).join(" · ");
      const situacao = nivelFunil(l) >= 4 ? "**virou venda**" : limpo(l.nome_situacao) || limpo(l.nome_etapa);
      linhas.push(`- **${limpo(l.nome_pessoa) || "Lead sem nome"}** · Corretor: ${limpo(l.nome_corretor)} · Captado em ${dataBR(l.data_captura)}${extra ? ` · ${extra}` : ""} · ${situacao} (lead #${l.id})`);
    }
  }
  linhas.push("", "---", "**Como ler**",
    "- **Propostas novas:** leads que chegaram a Proposta (ou viraram venda) e ainda não tinham saído em resumo anterior.",
    "- **Propostas no total** e **Leads da campanha:** tudo o que a campanha gerou nos leads captados neste mês e no anterior.",
    `- **Campanha:** a registrada no Supremo para o lead. Leads sem campanha aparecem em "${semCampanha}".`,
    "- **Semana sem proposta nova** não gera tarefa.");
  return linhas.join("\n");
}

// IDs de leads que já saíram em resumos anteriores (lidos das tarefas do ClickUp).
export function idsNoTexto(texto) {
  return [...String(texto || "").matchAll(/lead #(\d+)/g)].map((m) => m[1]);
}

async function clickup(token, caminho, opcoes = {}) {
  const r = await fetch(`${API}${caminho}`, {
    ...opcoes,
    headers: { Authorization: token, "content-type": "application/json", ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Resumos já criados na lista (abertos e concluídos).
export async function resumosAnteriores(token, lista) {
  const tarefas = [];
  for (let page = 0; page < 20; page++) {
    const q = `include_closed=true&include_markdown_description=true&subtasks=false&tags[]=${ETIQUETA}&page=${page}`;
    const r = await clickup(token, `/list/${lista}/task?${q}`);
    tarefas.push(...(r.tasks || []));
    if (r.last_page !== false || !(r.tasks || []).length) break;
  }
  return tarefas;
}

// campo: "idDoCampo=idDaOpcao" (ex.: Clientes = Lion Imob), opcional.
export async function criarTarefa(token, lista, { nome, texto, responsavel, prazo, campo }) {
  const corpo = { name: nome, markdown_content: texto, tags: [ETIQUETA] };
  if (responsavel) corpo.assignees = [Number(responsavel)];
  if (campo?.includes("=")) { const [id, value] = campo.split("="); corpo.custom_fields = [{ id: id.trim(), value: value.trim() }]; }
  if (prazo) { corpo.due_date = prazo; corpo.due_date_time = true; } // com horário, não só o dia
  return clickup(token, `/list/${lista}/task`, { method: "POST", body: JSON.stringify(corpo) });
}

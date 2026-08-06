// Agregacao dos leads brutos do Supremo em metricas de ranking e analises.

const DIA_MS = 24 * 60 * 60 * 1000;

// "Corretores" que na verdade sao buckets do sistema, nao pessoas.
const PSEUDO = new Set(["DESCARTE", "(sem corretor)", "SEM CORRETOR"]);

function parseData(s) {
  if (!s) return null;
  // formatos: "2026-08-06 13:54:00" ou "2026-08-06"
  const iso = s.includes(" ") ? s.replace(" ", "T") : `${s}T00:00:00`;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function nomeLimpo(s) {
  return (s || "").trim();
}

function ehPseudo(nome) {
  return !nome || PSEUDO.has(nome.toUpperCase());
}

function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dentro(d, ini, fim) {
  if (!d) return false;
  return d >= ini && d <= fim;
}

// Varredura independente de leads ATIVOS parados ha mais de `diasLimite` dias
// (sem movimentacao de etapa). Usada para o alerta global, que nao depende do
// periodo selecionado no painel. Retorna a lista + contagem por corretor.
export function escanearParados(leads, agora, diasLimite = 15) {
  const alertas = [];
  const porCorretor = new Map();
  for (const l of leads) {
    if ((l.nome_status || "").toUpperCase() !== "ATIVO") continue;
    const corretor = nomeLimpo(l.nome_corretor);
    if (ehPseudo(corretor)) continue;
    const ult = [
      parseData(l.data_ultima_interacao),
      parseData(l.data_com_corretor),
      parseData(l.data_qualificado),
      parseData(l.data_captura),
    ].filter(Boolean).sort((a, b) => b - a)[0];
    if (!ult) continue;
    const diasParado = Math.floor((agora - ult) / DIA_MS);
    if (diasParado <= diasLimite) continue;
    porCorretor.set(corretor, (porCorretor.get(corretor) || 0) + 1);
    alertas.push({
      lead: l.nome_pessoa || "(sem nome)",
      telefone: l.telefone_pessoa || null,
      corretor,
      etapa: l.nome_etapa,
      situacao: l.nome_situacao,
      diasParado,
      desde: l.data_ultima_interacao || l.data_com_corretor || l.data_qualificado || l.data_captura,
    });
  }
  alertas.sort((a, b) => b.diasParado - a.diasParado);
  return { alertas, porCorretor: Object.fromEntries(porCorretor) };
}

// Entrada:
//   leadsPeriodo: leads capturados no periodo (filtro data_captura)
//   vendidos: TODOS os leads etapa 4 (filtramos por data da venda no periodo)
//   periodo: { inicio: Date, fim: Date }
//   agora: Date (referencia para o alerta de dias parado)
export function agregar({ leadsPeriodo, vendidos, periodo, agora }) {
  const { inicio, fim } = periodo;
  const corretores = new Map();
  const qualificadores = new Map();
  const origens = new Map();
  const motivos = new Map();
  const funil = { novos: 0, comCorretor: 0, vendidos: 0, perdidos: 0 };
  const capturaPorDia = new Map();
  const alertas = [];

  const getC = (nome) => {
    if (!corretores.has(nome))
      corretores.set(nome, {
        nome, leads: 0, movimentados: 0, vendas: 0, vgv: 0,
        perdidos: 0, ativos: 0, parados15d: 0, tempoQualifMin: [],
      });
    return corretores.get(nome);
  };
  const getQ = (nome) => {
    if (!qualificadores.has(nome))
      qualificadores.set(nome, { nome, leads: 0, qualificados: 0, tempoQualifMin: [], vendas: 0 });
    return qualificadores.get(nome);
  };

  // --- Leads do periodo (volume, movimentacao, velocidade, funil, perdas, alertas) ---
  for (const l of leadsPeriodo) {
    const corretor = nomeLimpo(l.nome_corretor);
    const qualificador = nomeLimpo(l.nome_qualificador);
    const etapa = String(l.etapa ?? "");
    const status = (l.nome_status || "").toUpperCase();
    const dCaptura = parseData(l.data_captura);
    const dQualif = parseData(l.data_qualificado);
    const dCorretor = parseData(l.data_com_corretor);
    const dInteracao = parseData(l.data_ultima_interacao);

    // Funil (por etapa)
    if (etapa === "1") funil.novos++;
    else if (etapa === "4") funil.vendidos++;
    else if (etapa === "5") funil.perdidos++;
    else funil.comCorretor++;

    // Captura por dia (evolucao temporal)
    if (dCaptura) {
      const key = l.data_captura.slice(0, 10);
      capturaPorDia.set(key, (capturaPorDia.get(key) || 0) + 1);
    }

    // Origem
    const origem = nomeLimpo(l.nome_origem) || "(sem origem)";
    if (!origens.has(origem)) origens.set(origem, { nome: origem, leads: 0, vendas: 0 });
    origens.get(origem).leads++;

    // Motivo de perda
    if (etapa === "5" && l.motivo_perda) {
      motivos.set(l.motivo_perda, (motivos.get(l.motivo_perda) || 0) + 1);
    }

    // Metricas por corretor (ignora buckets do sistema)
    if (!ehPseudo(corretor)) {
      const c = getC(corretor);
      c.leads++;
      if (etapa === "5") c.perdidos++;
      // "movimentado" = saiu de LEADS NOVOS (foi trabalhado)
      if (etapa !== "1") c.movimentados++;
      // velocidade de qualificacao: captura -> qualificado
      if (dCaptura && dQualif) {
        const min = (dQualif - dCaptura) / 60000;
        if (min >= 0 && min < 30 * 24 * 60) c.tempoQualifMin.push(min);
      }
      // ativos e alerta de parado
      if (status === "ATIVO") {
        c.ativos++;
        const ult = [dInteracao, dCorretor, dQualif, dCaptura].filter(Boolean).sort((a, b) => b - a)[0];
        if (ult) {
          const diasParado = Math.floor((agora - ult) / DIA_MS);
          if (diasParado > 15) {
            c.parados15d++;
            alertas.push({
              lead: l.nome_pessoa || "(sem nome)",
              telefone: l.telefone_pessoa || null,
              corretor,
              etapa: l.nome_etapa,
              situacao: l.nome_situacao,
              diasParado,
              desde: (ult === dInteracao && l.data_ultima_interacao) || l.data_com_corretor || l.data_qualificado || l.data_captura,
            });
          }
        }
      }
    }

    // Metricas por qualificador
    if (!ehPseudo(qualificador)) {
      const q = getQ(qualificador);
      q.leads++;
      if (dQualif) q.qualificados++;
      if (dCaptura && dQualif) {
        const min = (dQualif - dCaptura) / 60000;
        if (min >= 0 && min < 30 * 24 * 60) q.tempoQualifMin.push(min);
      }
    }
  }

  // --- Vendas: filtra etapa 4 pela DATA DA VENDA (data_vendido_perdido) dentro do periodo ---
  for (const v of vendidos) {
    const dVenda = parseData(v.data_vendido_perdido);
    if (!dentro(dVenda, inicio, fim)) continue;
    const valor = Number(v.valor_vendido) || 0;
    const corretor = nomeLimpo(v.nome_corretor);
    const qualificador = nomeLimpo(v.nome_qualificador);
    const origem = nomeLimpo(v.nome_origem) || "(sem origem)";

    if (!ehPseudo(corretor)) {
      const c = getC(corretor);
      c.vendas++;
      c.vgv += valor;
    }
    if (!ehPseudo(qualificador)) getQ(qualificador).vendas++;
    if (!origens.has(origem)) origens.set(origem, { nome: origem, leads: 0, vendas: 0 });
    origens.get(origem).vendas++;
  }

  // --- Finaliza corretores ---
  const listaCorretores = [...corretores.values()].map((c) => {
    const tqMed = mediana(c.tempoQualifMin);
    return {
      nome: c.nome,
      leads: c.leads,
      movimentados: c.movimentados,
      vendas: c.vendas,
      vgv: Math.round(c.vgv),
      ticketMedio: c.vendas ? Math.round(c.vgv / c.vendas) : 0,
      conversao: c.leads ? +(100 * c.vendas / c.leads).toFixed(1) : 0,
      perdidos: c.perdidos,
      ativos: c.ativos,
      parados15d: c.parados15d,
      tempoQualifHoras: tqMed != null ? +(tqMed / 60).toFixed(1) : null,
    };
  });

  const listaQualificadores = [...qualificadores.values()].map((q) => {
    const tqMed = mediana(q.tempoQualifMin);
    return {
      nome: q.nome,
      leads: q.leads,
      qualificados: q.qualificados,
      vendas: q.vendas,
      tempoQualifHoras: tqMed != null ? +(tqMed / 60).toFixed(1) : null,
    };
  });

  const listaOrigens = [...origens.values()]
    .map((o) => ({ ...o, conversao: o.leads ? +(100 * o.vendas / o.leads).toFixed(1) : 0 }))
    .sort((a, b) => b.leads - a.leads);

  const listaMotivos = [...motivos.entries()]
    .map(([motivo, qtd]) => ({ motivo, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const evolucao = [...capturaPorDia.entries()]
    .map(([dia, qtd]) => ({ dia, qtd }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  alertas.sort((a, b) => b.diasParado - a.diasParado);

  const totalVendas = listaCorretores.reduce((s, c) => s + c.vendas, 0);
  const totalVgv = listaCorretores.reduce((s, c) => s + c.vgv, 0);

  return {
    periodo: {
      inicio: inicio.toISOString().slice(0, 10),
      fim: fim.toISOString().slice(0, 10),
    },
    resumo: {
      leads: leadsPeriodo.length,
      vendas: totalVendas,
      vgv: totalVgv,
      ticketMedio: totalVendas ? Math.round(totalVgv / totalVendas) : 0,
      corretoresAtivos: listaCorretores.filter((c) => c.leads > 0).length,
      parados15d: alertas.length,
      conversaoGeral: leadsPeriodo.length ? +(100 * totalVendas / leadsPeriodo.length).toFixed(1) : 0,
    },
    corretores: listaCorretores,
    qualificadores: listaQualificadores,
    origens: listaOrigens,
    motivosPerda: listaMotivos,
    funil,
    evolucao,
    alertas,
  };
}

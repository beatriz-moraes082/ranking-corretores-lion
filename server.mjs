// Servidor do painel de ranking de corretores (Lion Negocios Imobiliarios).
// - Guarda o token do Supremo no servidor (nunca vai pro browser).
// - Expoe /api/ranking?inicio=YYYY-MM-DD&fim=YYYY-MM-DD com metricas agregadas.
// - Serve o painel estatico de /public.
// Sem dependencias externas: usa apenas modulos nativos do Node (>=20).

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLeadsPorPeriodo, fetchVendidos, statusLimite } from "./src/supremo.mjs";
import { agregar, escanearParados, agregarEvolucao } from "./src/aggregate.mjs";
import { criarArmazem } from "./src/armazem.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Datas do Supremo vem no horario local (Maceio, UTC-3). Sem isso, no Render (UTC)
// o "hoje" vira o dia seguinte depois das 21h.
process.env.TZ ||= "America/Maceio";

// --- .env simples (opcional) ---
function loadEnv() {
  const f = join(__dirname, ".env");
  if (!existsSync(f)) return;
  for (const linha of readFileSync(f, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const TOKEN = process.env.SUPREMO_TOKEN;
const PORT = Number(process.env.PORT) || 8787;
// Janela (em dias) da varredura global de "leads parados", independente do periodo do painel.
const ALERTA_DIAS = Number(process.env.ALERTA_DIAS) || 45;

if (!TOKEN || TOKEN.includes("cole_seu_token")) {
  console.error("\n[ERRO] Defina SUPREMO_TOKEN no arquivo .env (copie de .env.example).\n");
  process.exit(1);
}

// --- Dados: duas bases, atualizadas por AGENDA, e tudo calculado a partir delas ---
// Agenda (horário de Maceió, segunda a sábado, 8h às 19h):
//   - leads de HOJE: a cada 30 min (1-2 páginas), juntados à base do mês
//   - mês atual inteiro: às 8h, 12h e 17h (atualiza situação, funil e parados)
//   - vendidos: junto com a das 17h (e se faltar)
//   - mês anterior: uma vez por dia
//   - fora do horário e no domingo: nada (exceto se faltar alguma base)
// Bloqueio (429): a busca para na hora e nada sai por 30-60 min.
// O Supremo bloqueia (HTTP 429) quando recebe consultas demais. Ranking, semana,
// leads parados e evolução saem das duas bases (mês atual e anterior) sem nova
// consulta. Com a agenda, fica em torno de 200 páginas por dia.
const CACHE_DIR = join(__dirname, ".cache");
const CACHE_FILE = join(CACHE_DIR, "dados-v3.json");
// BASE_TTL_MIN (e não o antigo CACHE_TTL_MIN=15 que ainda está no Render): renovar
// o mês atual mais vezes que isso volta a encostar no limite do Supremo.
const HOJE_A_CADA = (Number(process.env.BASE_TTL_MIN) || 30) * 60 * 1000; // leads de hoje
const HORARIOS_MES = [8, 12, 17];   // atualizações completas do mês atual
const EXPEDIENTE = [8, 19];         // das 8h às 19h
const ANTERIOR_TTL = 6 * 60 * 60 * 1000; // períodos avulsos (fora das bases)
const MAX_PERIODOS = 12; // períodos fora das bases (raros) ficam num cache próprio

let baseAtual = null;    // { ts, inicio, fim, rows }
let baseAnterior = null; // { ts, inicio, fim, rows }
let vendidosCache = null; // { ts, rows }
const avulsos = new Map(); // "inicio|fim" -> { ts, data } (períodos fora das bases)
const emVoo = new Map();   // dedupe de buscas simultâneas

// Só os campos que o painel usa (sem "interesses"/"anotacoes", que são textos longos).
const CAMPOS = ["nome_pessoa", "telefone_pessoa", "nome_origem", "data_captura", "data_qualificado", "data_com_corretor",
  "data_ultima_interacao", "nome_qualificador", "nome_corretor", "nome_status", "etapa", "nome_etapa",
  "data_vendido_perdido", "nome_situacao", "valor_vendido", "motivo_perda", "id"];
const enxugar = (rows) => rows.map((r) => Object.fromEntries(CAMPOS.map((k) => [k, r[k] ?? null])));

function faixas(hoje = new Date()) {
  return {
    atual: { inicio: isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoDate(hoje) },
    anterior: { inicio: isoDate(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), fim: isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 0)) },
  };
}
const fresco = (e, ttl) => !!e && Date.now() - e.ts < ttl;

// --- persistência: disco + (opcional) Render Key Value em KV_URL ---
const armazem = criarArmazem(process.env.KV_URL);
const KV_CHAVE = "elite-lion:dados:v3";
let kvAgendado = null;
function montarCache() {
  const per = [...avulsos.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, MAX_PERIODOS);
  return { versao: 3, baseAtual, baseAnterior, vendidos: vendidosCache, avulsos: Object.fromEntries(per) };
}
function aplicarCache(obj, origem) {
  if (!obj || obj.versao !== 3) return;
  const novo = (a, b) => (!a ? b : !b ? a : (b.ts || 0) > (a.ts || 0) ? b : a);
  baseAtual = novo(baseAtual, obj.baseAtual);
  baseAnterior = novo(baseAnterior, obj.baseAnterior);
  vendidosCache = novo(vendidosCache, obj.vendidos);
  for (const [k, v] of Object.entries(obj.avulsos || {})) if (!avulsos.has(k) || v.ts > avulsos.get(k).ts) avulsos.set(k, v);
  console.log(`  dados carregados do ${origem} (mês atual: ${baseAtual?.rows.length ?? 0} leads, anterior: ${baseAnterior?.rows.length ?? 0})`);
}
async function persistir() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(montarCache()));
  } catch {}
  if (armazem && !kvAgendado) {
    kvAgendado = setTimeout(() => {
      kvAgendado = null;
      armazem.set(KV_CHAVE, JSON.stringify(montarCache())).catch((e) => console.error("  [kv] falha ao gravar:", e.message));
    }, 20_000);
  }
}
function carregarCacheDisco() {
  try { if (existsSync(CACHE_FILE)) aplicarCache(JSON.parse(readFileSync(CACHE_FILE, "utf8")), "disco"); } catch {}
}
async function carregarCacheKV() {
  if (!armazem) return;
  try {
    const bruto = await armazem.get(KV_CHAVE);
    if (bruto) aplicarCache(JSON.parse(bruto), "Key Value"); else console.log("  [kv] vazio (primeira vez)");
  } catch (e) { console.error("  [kv] falha ao ler:", e.message); }
}

// --- buscas (as únicas que vão ao Supremo) ---
function umaVez(chave, fn) {
  if (emVoo.has(chave)) return emVoo.get(chave);
  const p = fn().finally(() => emVoo.delete(chave));
  emVoo.set(chave, p);
  return p;
}
const baseValida = (b, faixa) => !!b && b.inicio === faixa.inicio;
// Horário atual na agenda: em expediente? qual o último horário completo do mês?
function momento(agora = new Date()) {
  const h = agora.getHours() + agora.getMinutes() / 60;
  const expediente = agora.getDay() !== 0 && h >= EXPEDIENTE[0] && h < EXPEDIENTE[1];
  const passou = HORARIOS_MES.filter((x) => h >= x);
  return { hoje: isoDate(agora), expediente, slot: passou.length ? `${isoDate(agora)}@${passou.at(-1)}` : null, slotHora: passou.at(-1) };
}
function buscarBase(qual) {
  return umaVez(`base:${qual}`, async () => {
    const faixa = faixas()[qual];
    const { rows } = await fetchLeadsPorPeriodo(TOKEN, faixa.inicio, faixa.fim);
    // slot: marca qual horário da agenda esta busca completa já atendeu
    const base = { ts: Date.now(), tsHoje: Date.now(), slot: momento().slot, dia: momento().hoje, ...faixa, rows: enxugar(rows) };
    if (qual === "atual") baseAtual = base; else baseAnterior = base;
    memo.clear();
    console.log(`  [dados] base ${qual} atualizada: ${rows.length} leads`);
    persistir();
    return base;
  });
}
// Só os leads de hoje (1-2 páginas), trocando os de hoje que já estavam na base.
function buscarHoje() {
  return umaVez("base:hoje", async () => {
    const hoje = momento().hoje;
    const { rows } = await fetchLeadsPorPeriodo(TOKEN, hoje, hoje);
    if (!baseAtual) return;
    baseAtual.rows = baseAtual.rows.filter((r) => dia(r.data_captura) !== hoje).concat(enxugar(rows));
    baseAtual.fim = hoje;
    baseAtual.tsHoje = Date.now();
    memo.clear();
    console.log(`  [dados] leads de hoje atualizados: ${rows.length}`);
    persistir();
  });
}
function buscarVendidos() {
  return umaVez("vendidos", async () => {
    const { rows } = await fetchVendidos(TOKEN);
    vendidosCache = { ts: Date.now(), rows: enxugar(rows) };
    memo.clear();
    persistir();
    return vendidosCache;
  });
}
// Garante a base (espera só se não existir nenhuma versão dela).
async function garantirBase(qual) {
  const b = qual === "atual" ? baseAtual : baseAnterior;
  return baseValida(b, faixas()[qual]) ? b : buscarBase(qual);
}
async function garantirVendidos() {
  return vendidosCache || buscarVendidos();
}
// Renova o que venceu, em sequência (é o único lugar que consulta o Supremo
// periodicamente). Ordem: o que a TV mostra primeiro.
// A agenda roda a cada 5 min, mas só consulta o Supremo quando algo está na hora.
let renovando = false, renovandoDesde = 0, ultimaAgenda = null, erroAgenda = null;
const iniciouEm = Date.now();
async function renovar() {
  // trava de segurança: uma rodada presa há mais de 20 min é liberada
  if (renovando && Date.now() - renovandoDesde > 20 * 60 * 1000) { console.warn("  [dados] agenda presa, liberando"); renovando = false; emVoo.clear(); }
  if (renovando || statusLimite().pausado) return;
  renovando = true; renovandoDesde = Date.now(); ultimaAgenda = Date.now();
  try {
    const f = faixas();
    const m = momento();
    // 1) falta alguma base (servidor acabou de subir ou virou o mês): busca já
    if (!baseValida(baseAtual, f.atual)) await buscarBase("atual");
    if (!vendidosCache) await buscarVendidos();
    if (!baseValida(baseAnterior, f.anterior)) await buscarBase("anterior");
    // 2) mês atual completo nos horários da agenda (8h, 12h, 17h), uma vez cada
    if (m.expediente && m.slot && baseAtual.slot !== m.slot) {
      await buscarBase("atual");
      if (m.slotHora === 17) await buscarVendidos();
    }
    // 3) leads de hoje a cada 30 min no expediente
    else if (m.expediente && Date.now() - (baseAtual.tsHoje || baseAtual.ts) >= HOJE_A_CADA) await buscarHoje();
    // 4) mês anterior uma vez por dia: fora do expediente se o servidor estiver
    //    acordado; senão, junto da janela das 17h
    const anteriorDeOntem = (baseAnterior.dia || "") < m.hoje;
    if (anteriorDeOntem && (!m.expediente || m.slotHora === 17)) await buscarBase("anterior");
    if (Date.now() - vendidosCache.ts > 24 * 60 * 60 * 1000) await buscarVendidos();
    erroAgenda = null;
  } catch (e) {
    erroAgenda = { em: Date.now(), msg: e.message };
    console.error("  [dados] agenda:", e.message);
  } finally {
    renovando = false;
  }
}

// Diagnóstico sem consultar o Supremo: /api/status
function statusServidor() {
  const h = (t) => (t ? new Date(t).toLocaleString("pt-BR") : null);
  const b = (x) => x && { leads: x.rows.length, de: x.inicio, ate: x.fim, baixadaEm: h(x.ts), hojeEm: h(x.tsHoje), slot: x.slot || null, dia: x.dia || null };
  const lim = statusLimite();
  return {
    agora: h(Date.now()), ligadoDesde: h(iniciouEm), agenda: momento(),
    baseAtual: b(baseAtual), baseAnterior: b(baseAnterior), vendidos: vendidosCache && { qtd: vendidosCache.rows.length, em: h(vendidosCache.ts) },
    renovando, renovandoDesde: renovando ? h(renovandoDesde) : null, ultimaAgenda: h(ultimaAgenda),
    erroAgenda: erroAgenda && { em: h(erroAgenda.em), msg: erroAgenda.msg }, buscasEmAndamento: [...emVoo.keys()],
    supremo: { pausadoAte: lim.pausado ? h(lim.retomaEm) : null, ultimoSucesso: h(lim.ultimoSucesso), ultimo429: h(lim.ultimo429), consultasDesdeQueLigou: lim.consultas },
    keyValue: !!armazem,
  };
}

// --- cálculos (sem rede) ---
const memo = new Map(); // resultados derivados; zera quando uma base muda
const dia = (s) => (s ? String(s).slice(0, 10) : "");
function linhasEntre(inicio, fim) {
  const out = [];
  for (const b of [baseAnterior, baseAtual]) if (b) for (const r of b.rows) { const d = dia(r.data_captura); if (d >= inicio && d <= fim) out.push(r); }
  return out;
}
const cobre = (inicio, fim) => { const f = faixas(); return inicio >= f.anterior.inicio && fim <= f.atual.fim; };

function alertasAtuais() {
  if (memo.has("alertas")) return memo.get("alertas");
  if (!baseAtual) return null;
  const hoje = new Date();
  const ini = new Date(hoje); ini.setDate(hoje.getDate() - ALERTA_DIAS);
  const r = escanearParados(linhasEntre(isoDate(ini), isoDate(hoje)), hoje, 15);
  memo.set("alertas", r);
  return r;
}

async function calcularRanking(inicio, fim) {
  const chave = `ranking:${inicio}|${fim}`;
  let data = memo.get(chave);
  if (!data) {
    let leadsPeriodo;
    if (cobre(inicio, fim)) {
      const f = faixas();
      await garantirBase("atual");
      if (inicio < f.atual.inicio) await garantirBase("anterior");
      leadsPeriodo = linhasEntre(inicio, fim);
    } else {
      // período fora das bases (raro): busca direta, com cache próprio
      const av = avulsos.get(`${inicio}|${fim}`);
      if (av && fresco(av, ANTERIOR_TTL)) return aplicarAlertas(av.data);
      leadsPeriodo = enxugar((await umaVez(`avulso:${inicio}|${fim}`, () => fetchLeadsPorPeriodo(TOKEN, inicio, fim))).rows);
    }
    // Sem a lista de vendidos (bloqueio no meio da busca), o ranking sai mesmo assim
    // com os leads já baixados; só as vendas ficam marcadas como indisponíveis.
    let vendidos = vendidosCache?.rows, semVendas = false;
    if (!vendidos) {
      try { vendidos = (await garantirVendidos()).rows; }
      catch (e) { if (!e.bloqueio) throw e; vendidos = []; semVendas = true; }
    }
    data = agregar({ leadsPeriodo, vendidos, periodo: { inicio: new Date(`${inicio}T00:00:00`), fim: new Date(`${fim}T23:59:59`) }, agora: new Date() });
    data.geradoEm = new Date(baseAtual ? Math.max(baseAtual.ts, baseAtual.tsHoje || 0) : Date.now()).toISOString();
    data.vendasIndisponiveis = semVendas;
    if (semVendas) return aplicarAlertas(data); // não guarda: recalcula quando as vendas chegarem
    if (cobre(inicio, fim)) memo.set(chave, data);
    else { avulsos.set(`${inicio}|${fim}`, { ts: Date.now(), data }); persistir(); }
  }
  return aplicarAlertas(data);
}

// Sobrepõe os leads parados (janela de ALERTA_DIAS dias) em qualquer período.
function aplicarAlertas(data) {
  const a = alertasAtuais();
  data.alertaJanelaDias = ALERTA_DIAS;
  data.alertasProntos = !!a;
  if (a) {
    data.alertas = a.alertas;
    data.resumo.parados15d = a.alertas.length;
    for (const c of data.corretores) c.parados15d = a.porCorretor[c.nome] || 0;
  }
  return data;
}

// --- Evolução: semana e mês, atual x anterior (das mesmas bases) ---
function janelasEvolucao(hoje = new Date()) {
  const d = (base, dias) => { const x = new Date(base); x.setDate(x.getDate() + dias); return x; };
  const iniMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const iniMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const fimMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1,
    Math.min(hoje.getDate(), new Date(hoje.getFullYear(), hoje.getMonth(), 0).getDate()));
  return {
    semanaAtual: { inicio: isoDate(d(hoje, -6)), fim: isoDate(hoje) },
    semanaAnterior: { inicio: isoDate(d(hoje, -13)), fim: isoDate(d(hoje, -7)) },
    mesAtual: { inicio: isoDate(iniMes), fim: isoDate(hoje) },
    mesAnterior: { inicio: isoDate(iniMesAnt), fim: isoDate(fimMesAnt) },
  };
}
function evolucaoAtual() {
  if (memo.has("evolucao")) return memo.get("evolucao");
  if (!baseAtual || !baseAnterior || !vendidosCache) return null;
  const data = agregarEvolucao({ leads: [...baseAnterior.rows, ...baseAtual.rows], vendidos: vendidosCache.rows, janelas: janelasEvolucao() });
  data.geradoEm = new Date(Math.max(baseAtual.ts, baseAtual.tsHoje || 0)).toISOString();
  memo.set("evolucao", data);
  return data;
}

// --- Equipes (a API do Supremo nao tem equipe/gerente) ---
// Definidas em equipes.json (ou na env EQUIPES_JSON, que tem prioridade). Lido a
// cada requisicao, entao da pra editar sem reiniciar.
function lerEquipes() {
  try {
    const raw = process.env.EQUIPES_JSON || readFileSync(join(__dirname, "equipes.json"), "utf8");
    const lista = JSON.parse(raw);
    return Array.isArray(lista) ? lista.filter((e) => e && e.id && Array.isArray(e.corretores)) : [];
  } catch {
    return [];
  }
}

// --- static ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
};

function isoDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/ranking") {
      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const inicio = url.searchParams.get("inicio") || isoDate(inicioMes);
      const fim = url.searchParams.get("fim") || isoDate(hoje);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ erro: "Datas invalidas. Use inicio e fim no formato YYYY-MM-DD." }));
      }
      const data = await calcularRanking(inicio, fim);
      data.equipes = lerEquipes();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(data));
    }

    // Equipes vêm do equipes.json, sem consultar o Supremo: assim aparecem mesmo
    // quando a tela está usando dados guardados de antes das equipes existirem.
    if (url.pathname === "/api/status") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      return res.end(JSON.stringify(statusServidor(), null, 2));
    }

    if (url.pathname === "/api/equipes") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      return res.end(JSON.stringify(lerEquipes()));
    }

    if (url.pathname === "/api/evolucao") {
      // Sai das mesmas bases do ranking; enquanto o mês anterior não chegou, 202.
      const data = evolucaoAtual();
      if (!data) {
        res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ pendente: true }));
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(data));
    }

    // static
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = join(__dirname, "public", p);
    if (!filePath.startsWith(join(__dirname, "public"))) {
      res.writeHead(403); return res.end("Forbidden");
    }
    const buf = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      // Sempre revalida: garante que atualizações do painel apareçam sem cache preso.
      "cache-control": "no-cache, must-revalidate",
    });
    res.end(buf);
  } catch (err) {
    if (err?.code === "ENOENT") {
      res.writeHead(404); return res.end("Nao encontrado");
    }
    console.error("[erro]", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ erro: "Falha ao consultar o Supremo CRM.", detalhe: String(err?.message || err) }));
  }
});


server.listen(PORT, async () => {
  console.log(`\n  Ranking de Corretores - Lion Negocios Imobiliarios`);
  console.log(`  Painel rodando em: http://localhost:${PORT}`);
  console.log(armazem ? "  armazém persistente: Render Key Value (KV_URL)" : "  armazém persistente: não configurado (defina KV_URL)");
  carregarCacheDisco();
  await carregarCacheKV();
  // Renova o que estiver vencido agora e depois a cada 5 min (cada base só é
  // baixada de novo quando passa do seu prazo).
  renovar();
  setInterval(renovar, 5 * 60 * 1000);
  console.log("");
});

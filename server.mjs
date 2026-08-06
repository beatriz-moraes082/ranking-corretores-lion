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
import { fetchLeadsPorPeriodo, fetchVendidos } from "./src/supremo.mjs";
import { agregar, escanearParados } from "./src/aggregate.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
const CACHE_TTL = (Number(process.env.CACHE_TTL_MIN) || 15) * 60 * 1000;
// Janela (em dias) da varredura global de "leads parados", independente do periodo do painel.
const ALERTA_DIAS = Number(process.env.ALERTA_DIAS) || 45;
const ALERTA_TTL = 60 * 60 * 1000; // status de "parado" muda devagar: refresh de hora em hora

if (!TOKEN || TOKEN.includes("cole_seu_token")) {
  console.error("\n[ERRO] Defina SUPREMO_TOKEN no arquivo .env (copie de .env.example).\n");
  process.exit(1);
}

// --- cache (memoria + disco) com stale-while-revalidate ---
// A API do Supremo e limitada a ~1 req/seg, entao uma consulta a frio de um mes
// (~57 paginas) leva ~1 min. Servimos sempre o cache (mesmo vencido) na hora e
// revalidamos em segundo plano; quem abre o painel quase nunca espera.
const CACHE_DIR = join(__dirname, ".cache");
const CACHE_FILE = join(CACHE_DIR, "ranking.json");
const cache = new Map(); // key -> { ts, data }
let vendidosCache = null; // { ts, rows }
let alertasCache = null; // { ts, alertas, porCorretor }
let alertasEmVoo = null;
const emVoo = new Map(); // key -> Promise (dedupe de buscas simultaneas)

async function persistir() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const obj = { vendidos: vendidosCache, alertas: alertasCache, periodos: Object.fromEntries(cache) };
    await writeFile(CACHE_FILE, JSON.stringify(obj));
  } catch {}
}
function carregarCacheDisco() {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const obj = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    vendidosCache = obj.vendidos || null;
    alertasCache = obj.alertas || null;
    for (const [k, v] of Object.entries(obj.periodos || {})) cache.set(k, v);
    console.log(`  cache em disco carregado (${cache.size} periodos)`);
  } catch {}
}

async function getVendidos() {
  if (vendidosCache && Date.now() - vendidosCache.ts < CACHE_TTL * 4) return vendidosCache.rows;
  const { rows } = await fetchVendidos(TOKEN);
  vendidosCache = { ts: Date.now(), rows };
  return rows;
}

// Varredura global de leads parados (janela de ALERTA_DIAS dias), com cache proprio.
function getAlertas() {
  if (alertasCache && Date.now() - alertasCache.ts < ALERTA_TTL) return Promise.resolve(alertasCache);
  if (alertasEmVoo) return alertasEmVoo;
  alertasEmVoo = (async () => {
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - ALERTA_DIAS);
    const { rows } = await fetchLeadsPorPeriodo(TOKEN, isoDate(ini), isoDate(hoje));
    const { alertas, porCorretor } = escanearParados(rows, new Date(), 15);
    alertasCache = { ts: Date.now(), alertas, porCorretor };
    persistir();
    return alertasCache;
  })().finally(() => (alertasEmVoo = null));
  return alertasEmVoo;
}

// Busca + agrega de verdade (custa rede). Deduplicado por periodo.
function buscarEAgregar(inicio, fim) {
  const key = `${inicio}|${fim}`;
  if (emVoo.has(key)) return emVoo.get(key);
  const p = (async () => {
    // Sequencial de proposito: a API limita conexoes simultaneas/taxa (429).
    const vendidos = await getVendidos();
    const { rows: leadsPeriodo } = await fetchLeadsPorPeriodo(TOKEN, inicio, fim);
    const data = agregar({
      leadsPeriodo, vendidos,
      periodo: { inicio: new Date(`${inicio}T00:00:00`), fim: new Date(`${fim}T23:59:59`) },
      agora: new Date(),
    });
    data.geradoEm = new Date().toISOString();
    cache.set(key, { ts: Date.now(), data });
    persistir();
    return data;
  })().finally(() => emVoo.delete(key));
  emVoo.set(key, p);
  return p;
}

async function calcularRanking(inicio, fim) {
  const key = `${inicio}|${fim}`;
  const hit = cache.get(key);
  let data;
  if (hit) {
    // stale-while-revalidate: se venceu, dispara refresh em background e serve o atual.
    if (Date.now() - hit.ts >= CACHE_TTL) buscarEAgregar(inicio, fim).catch(() => {});
    data = hit.data;
  } else {
    // Sem cache: precisa aguardar (primeira carga do periodo).
    data = await buscarEAgregar(inicio, fim);
  }
  return aplicarAlertas(data);
}

// Sobrepoe o alerta global (varredura independente do periodo) na resposta, a
// cada requisicao. Assim os alertas aparecem assim que a varredura termina, sem
// esperar o ranking ser reagregado. Dispara a varredura se faltar/estiver velha.
function aplicarAlertas(data) {
  if (!alertasCache || Date.now() - alertasCache.ts >= ALERTA_TTL) getAlertas().catch(() => {});
  data.alertaJanelaDias = ALERTA_DIAS;
  data.alertasProntos = !!alertasCache;
  if (alertasCache) {
    data.alertas = alertasCache.alertas;
    data.resumo.parados15d = alertasCache.alertas.length;
    const map = alertasCache.porCorretor;
    for (const c of data.corretores) c.parados15d = map[c.nome] || 0;
  }
  return data;
}

// --- static ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isoDate(d) {
  return d.toISOString().slice(0, 10);
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
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
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

function periodoMesAtual() {
  const hoje = new Date();
  return { inicio: isoDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoDate(hoje) };
}

server.listen(PORT, () => {
  console.log(`\n  Ranking de Corretores - Lion Negocios Imobiliarios`);
  console.log(`  Painel rodando em: http://localhost:${PORT}`);

  carregarCacheDisco();

  // Pre-aquece o mes atual (sem bloquear) e revalida periodicamente, para que
  // quem abrir o painel pegue sempre o cache quente.
  const aquecer = () => {
    const { inicio, fim } = periodoMesAtual();
    buscarEAgregar(inicio, fim)
      .then((d) => console.log(`  [cache] mes atual pronto: ${d.resumo.leads} leads, ${d.resumo.vendas} vendas, ${d.resumo.parados15d} parados`))
      .catch((e) => console.error("  [cache] falha ao aquecer:", e.message));
  };
  setTimeout(aquecer, 500);
  setInterval(aquecer, CACHE_TTL);
  // Alerta global (varredura de 45 dias) tem ciclo proprio, mais espacado.
  setInterval(() => getAlertas().catch(() => {}), ALERTA_TTL);
  console.log("");
});

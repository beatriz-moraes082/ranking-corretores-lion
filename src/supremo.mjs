// Cliente da API aberta do Supremo CRM.
// Base: https://api.supremocrm.com.br/v1
// Autenticacao: header Authorization: Bearer <token JWT>
// Paginacao: resposta { data:[...], paginaAtual, porPagina(=20 fixo), totalPaginas, total }
//            navega com ?pagina=N. Filtros de /leads: data_inicio, data_fim, id_corretor, etapa.

const BASE = "https://api.supremocrm.com.br/v1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Throttle global SERIALIZADO: encadeia todas as requisicoes numa fila para
// garantir um intervalo minimo entre o inicio de cada uma, mesmo com concorrencia.
// A API do Supremo aplica rate limit (HTTP 429), entao seguramos o ritmo.
// A API do Supremo usa um token-bucket (~30 req, refill ~1/seg). A taxa
// sustentavel medida e ~1 req/seg; abaixo disso nao ha 429. Mantemos 1050ms.
const MIN_INTERVALO_MS = 1050;
let ultimaChamada = 0;
let fila = Promise.resolve();
// Orçamento de consultas: o Supremo aguenta umas 30 seguidas e depois demora horas
// para liberar. Então guardamos "fichas": até SUPREMO_RAJADA (20) de uma vez e,
// gastas, uma nova a cada SUPREMO_INTERVALO_SEG (120 s). Espalha as buscas ao
// longo do dia em vez de fazer rajadas.
const RAJADA = Number(process.env.SUPREMO_RAJADA) || 20;
const RECARGA_MS = (Number(process.env.SUPREMO_INTERVALO_SEG) || 120) * 1000;
let fichas = RAJADA, ultimaRecarga = Date.now();
function recarregar() {
  const agora = Date.now();
  const novas = Math.floor((agora - ultimaRecarga) / RECARGA_MS);
  if (novas > 0) { fichas = Math.min(RAJADA, fichas + novas); ultimaRecarga += novas * RECARGA_MS; }
  if (fichas >= RAJADA) ultimaRecarga = agora;
}
export function orcamento() {
  recarregar();
  return { fichas, rajada: RAJADA, intervaloSeg: RECARGA_MS / 1000, proximaFicha: fichas >= RAJADA ? null : ultimaRecarga + RECARGA_MS };
}
// Freio global: quando o Supremo responde 429, a busca para na hora (não insiste)
// e nenhuma consulta sai por 30 min; se o 429 se repetir, 60 min. Zera no primeiro
// sucesso. Insistir mantém o bloqueio ativo indefinidamente.
let pausaAte = 0;
let pausaAtual = 0;
const PAUSA_MIN = 30 * 60_000, PAUSA_MAX = 60 * 60_000;
function registrar429() {
  ultimo429 = Date.now();
  pausaAtual = pausaAtual ? Math.min(PAUSA_MAX, pausaAtual * 2) : PAUSA_MIN;
  pausaAte = Date.now() + pausaAtual;
  fichas = 0; ultimaRecarga = Date.now(); // o balde do Supremo está vazio
  console.warn(`  [supremo] 429: pausando consultas por ${Math.round(pausaAtual / 60000)} min`);
}
function registrarSucesso() {
  pausaAtual = 0;
  ultimoSucesso = Date.now();
}
let ultimoSucesso = 0, ultimo429 = 0, consultas = 0;
export function statusLimite() {
  return { pausado: Date.now() < pausaAte, retomaEm: pausaAte, ultimoSucesso, ultimo429, consultas };
}
export class BloqueioSupremo extends Error {}
function throttle() {
  if (Date.now() < pausaAte) {
    const e = new BloqueioSupremo(`Supremo bloqueado; nova tentativa após ${new Date(pausaAte).toLocaleTimeString("pt-BR")}`);
    e.bloqueio = true;
    return Promise.reject(e);
  }
  const anterior = fila;
  let liberar;
  fila = new Promise((r) => (liberar = r));
  return anterior.then(async () => {
    // Se o bloqueio começou enquanto esta consulta esperava na fila, desiste na hora
    // (antes ela dormia a pausa inteira e prendia a agenda do servidor).
    if (Date.now() < pausaAte) {
      liberar();
      const e = new BloqueioSupremo("Supremo bloqueado durante a fila");
      e.bloqueio = true;
      throw e;
    }
    try {
      recarregar();
      if (fichas < 1) await sleep(ultimaRecarga + RECARGA_MS - Date.now());
      recarregar();
      if (Date.now() < pausaAte) { const e = new BloqueioSupremo("Supremo bloqueado durante a fila"); e.bloqueio = true; throw e; }
      const espera = MIN_INTERVALO_MS - (Date.now() - ultimaChamada);
      if (espera > 0) await sleep(espera);
      fichas = Math.max(0, fichas - 1);
      ultimaChamada = Date.now();
    } finally {
      liberar();
    }
  });
}

// Busca uma pagina com retry e backoff. Trata 429/5xx com espera maior
// (respeitando Retry-After quando presente).
async function fetchPage(path, token, { retries = 10 } = {}) {
  const url = `${BASE}${path}`;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await throttle();
      consultas++;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) {
        // Bloqueio por excesso de consultas: aciona o freio global e desiste desta
        // busca (a agenda do servidor tenta de novo depois da pausa).
        const ra = Number(res.headers.get("retry-after"));
        if (ra > 0) { pausaAte = Date.now() + ra * 1000; } else registrar429();
        const e = new Error(`HTTP 429 em ${url}`);
        e.bloqueio = true;
        throw e;
      }
      if (res.status >= 500) {
        await sleep(Math.min(15000, 3000 + 2000 * attempt));
        throw new Error(`HTTP ${res.status} em ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.data)) throw new Error(`Resposta sem data em ${url}`);
      registrarSucesso();
      return json;
    } catch (err) {
      if (err.bloqueio) throw err; // 429: não insiste
      lastErr = err;
      if (!String(err.message).startsWith("HTTP")) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}


// Monta a query string a partir de um objeto de filtros (ignora null/undefined).
function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// Busca TODAS as paginas de um recurso paginado aplicando filtros.
// maxPaginas protege contra buscas gigantes acidentais.
// Páginas já baixadas de uma busca interrompida (bloqueio no meio): a próxima
// tentativa continua de onde parou em vez de recomeçar. Vale por 3 h.
const progresso = new Map(); // chave da busca -> { ts, totalPaginas, paginas: Map }
const PROGRESSO_TTL = 3 * 60 * 60 * 1000;
export function buscasIncompletas() {
  return [...progresso.entries()].map(([k, v]) => ({ busca: k, paginas: `${v.paginas.size}/${v.totalPaginas}` }));
}
export async function fetchAll(resource, token, filtros = {}, { maxPaginas = 5000 } = {}) {
  const chave = `${resource}${qs(filtros)}`;
  let prog = progresso.get(chave);
  if (!prog || Date.now() - prog.ts > PROGRESSO_TTL) { prog = { ts: Date.now(), totalPaginas: null, paginas: new Map() }; progresso.set(chave, prog); }
  if (!prog.paginas.has(1)) {
    const first = await fetchPage(`/${resource}${qs({ ...filtros, pagina: 1 })}`, token);
    prog.totalPaginas = Math.min(first.totalPaginas || 1, maxPaginas);
    prog.paginas.set(1, first.data);
  }
  for (let p = 2; p <= prog.totalPaginas; p++) {
    if (prog.paginas.has(p)) continue;
    const pg = await fetchPage(`/${resource}${qs({ ...filtros, pagina: p })}`, token);
    prog.paginas.set(p, pg.data);
  }
  progresso.delete(chave);
  // junta as páginas sem repetir lead (a ordem pode mudar entre uma página e outra)
  const vistos = new Set(), rows = [];
  for (let p = 1; p <= prog.totalPaginas; p++) for (const r of prog.paginas.get(p) || []) {
    const id = r.id ?? JSON.stringify(r);
    if (!vistos.has(id)) { vistos.add(id); rows.push(r); }
  }
  return { rows, total: rows.length, totalPaginas: prog.totalPaginas };
}

// Leads capturados num intervalo (filtro por data_captura).
export function fetchLeadsPorPeriodo(token, dataInicio, dataFim, opts = {}) {
  return fetchAll("leads", token, { data_inicio: dataInicio, data_fim: dataFim }, opts);
}

// Todos os leads vendidos (etapa 4). Sao poucos (~500), pode buscar completo e cachear.
export function fetchVendidos(token, opts = {}) {
  return fetchAll("leads", token, { etapa: 4 }, opts);
}

// Lista de corretores cadastrados.
export function fetchCorretores(token, opts = {}) {
  return fetchAll("corretores", token, {}, opts);
}

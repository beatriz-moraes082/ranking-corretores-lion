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
function throttle() {
  const anterior = fila;
  let liberar;
  fila = new Promise((r) => (liberar = r));
  return anterior.then(async () => {
    const espera = MIN_INTERVALO_MS - (Date.now() - ultimaChamada);
    if (espera > 0) await sleep(espera);
    ultimaChamada = Date.now();
    liberar();
  });
}

// Busca uma pagina com retry e backoff. Trata 429/5xx com espera maior
// (respeitando Retry-After quando presente).
async function fetchPage(path, token, { retries = 7 } = {}) {
  const url = `${BASE}${path}`;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status >= 500) {
        // 429 = bucket vazio; espera o refill (~1/seg). Retry-After tem prioridade.
        const ra = Number(res.headers.get("retry-after"));
        const espera = ra > 0 ? ra * 1000 : Math.min(15000, 3000 + 2000 * attempt);
        await sleep(espera);
        throw new Error(`HTTP ${res.status} em ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.data)) throw new Error(`Resposta sem data em ${url}`);
      return json;
    } catch (err) {
      lastErr = err;
      if (!String(err.message).startsWith("HTTP")) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Executa tarefas com um limite de concorrencia.
async function pool(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
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
export async function fetchAll(resource, token, filtros = {}, { maxPaginas = 5000, concurrency = 1 } = {}) {
  const first = await fetchPage(`/${resource}${qs({ ...filtros, pagina: 1 })}`, token);
  const totalPaginas = Math.min(first.totalPaginas || 1, maxPaginas);
  const rows = [...first.data];
  if (totalPaginas <= 1) return { rows, total: first.total ?? rows.length, totalPaginas };

  const restantes = [];
  for (let p = 2; p <= totalPaginas; p++) restantes.push(p);
  const pages = await pool(
    restantes,
    (p) => fetchPage(`/${resource}${qs({ ...filtros, pagina: p })}`, token),
    concurrency
  );
  for (const pg of pages) if (pg?.data) rows.push(...pg.data);
  return { rows, total: first.total ?? rows.length, totalPaginas };
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

// Armazém persistente opcional para o cache do painel (Render Key Value / Redis).
// No plano gratuito do Render o disco do serviço é apagado a cada publicação; sem
// isso, toda publicação obrigava o servidor a buscar tudo de novo no Supremo (e o
// Supremo bloqueia quando são consultas demais). Com KV_URL definido, o cache
// sobrevive às publicações.
//
// Cliente mínimo do protocolo Redis (só GET e SET), sem dependências externas.
// Aceita redis://[usuario:senha@]host:porta e rediss:// (com TLS).

import net from "node:net";
import tls from "node:tls";

function comando(partes) {
  let out = `*${partes.length}\r\n`;
  const bufs = [];
  for (const p of partes) {
    const b = Buffer.isBuffer(p) ? p : Buffer.from(String(p), "utf8");
    bufs.push(Buffer.from(`${out}$${b.length}\r\n`, "utf8"), b, Buffer.from("\r\n"));
    out = "";
  }
  return Buffer.concat(bufs);
}

// Lê uma resposta a partir de `pos`; devolve { valor, fim } ou null se ainda incompleta.
function lerResposta(buf, pos) {
  const fimLinha = buf.indexOf("\r\n", pos);
  if (fimLinha < 0) return null;
  const tipo = String.fromCharCode(buf[pos]);
  const linha = buf.toString("utf8", pos + 1, fimLinha);
  if (tipo === "+" || tipo === ":") return { valor: linha, fim: fimLinha + 2 };
  if (tipo === "-") return { erro: linha, fim: fimLinha + 2 };
  if (tipo === "$") {
    const n = Number(linha);
    if (n < 0) return { valor: null, fim: fimLinha + 2 };
    const ini = fimLinha + 2;
    if (buf.length < ini + n + 2) return null;
    return { valor: buf.toString("utf8", ini, ini + n), fim: ini + n + 2 };
  }
  return { erro: `resposta inesperada: ${tipo}`, fim: buf.length };
}

function executar(url, partes, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const porta = Number(u.port) || 6379;
    const usarTls = u.protocol === "rediss:";
    const sock = usarTls
      ? tls.connect({ host: u.hostname, port: porta, servername: u.hostname })
      : net.connect({ host: u.hostname, port: porta });
    const cmds = [];
    if (u.password) cmds.push(u.username ? ["AUTH", decodeURIComponent(u.username), decodeURIComponent(u.password)] : ["AUTH", decodeURIComponent(u.password)]);
    cmds.push(partes);
    let buf = Buffer.alloc(0), pos = 0, lidas = 0;
    const fim = (fn, v) => { clearTimeout(t); sock.destroy(); fn(v); };
    const t = setTimeout(() => fim(reject, new Error("KV: tempo esgotado")), timeout);
    sock.on(usarTls ? "secureConnect" : "connect", () => sock.write(Buffer.concat(cmds.map(comando))));
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const r = lerResposta(buf, pos);
        if (!r) return;
        pos = r.fim;
        lidas++;
        if (r.erro) return fim(reject, new Error(`KV: ${r.erro}`));
        if (lidas === cmds.length) return fim(resolve, r.valor);
      }
    });
    sock.on("error", (e) => fim(reject, e));
  });
}

export function criarArmazem(url) {
  if (!url) return null;
  return {
    get: (chave) => executar(url, ["GET", chave]),
    set: (chave, valor) => executar(url, ["SET", chave, valor], { timeout: 30000 }),
  };
}

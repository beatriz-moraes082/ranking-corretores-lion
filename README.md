# 🦁 Ranking de Corretores — Lion Negócios Imobiliários

Painel de ranking e análises de corretores, integrado à **API aberta do Supremo CRM**.
Feito para ser visto por toda a imobiliária: mostra quem mais vende, quem responde
mais rápido, quais leads estão parados e de onde vêm os melhores negócios.

Sem dependências externas — roda com Node.js puro (nativo).

---

## O que o painel mostra

**Indicadores do topo (KPIs):** leads no período, vendas fechadas, VGV (volume vendido),
ticket médio e leads parados há mais de 15 dias.

**Abas:**

| Aba | O que traz |
|-----|-----------|
| 🏆 **Corretores** | Ranking por vendas, VGV, conversão, volume de leads, movimentação, tempo de qualificação e leads parados. Clique no cabeçalho pra reordenar. |
| 🎧 **Qualificadores** | Ranking do time de pré-atendimento: quantos leads qualificaram, tempo médio de resposta e quantos viraram venda. |
| 📣 **Origens** | Desempenho por canal de origem (Instagram, portais, etc.): leads, vendas e conversão. |
| 🔻 **Funil & Perdas** | Distribuição dos leads por etapa, principais motivos de perda e volume diário de captação. |
| 🚨 **Alertas** | Leads **ativos parados há mais de 15 dias** sem movimentação, com nome, telefone e corretor responsável. |

**Filtro de período:** Semana · Mês atual · Personalizado (intervalo à escolha).

---

## Como rodar

Precisa de **Node.js 20 ou superior** e do **token da API do Supremo CRM** da imobiliária.

```bash
# 1. Configure o token
cp .env.example .env
# abra o .env e cole o token no lugar de SUPREMO_TOKEN

# 2. Suba o painel
npm start

# 3. Abra no navegador
# http://localhost:8787
```

> O token fica **só no servidor** (arquivo `.env`, que nunca vai pro Git). O navegador
> nunca vê o token — ele só conversa com este servidor.

---

## Como funciona por dentro

- `server.mjs` — servidor HTTP (Node nativo). Guarda o token, expõe `/api/ranking` e
  serve o painel. Tem cache em memória e em disco.
- `src/supremo.mjs` — cliente da API do Supremo (paginação, retry e controle de ritmo).
- `src/aggregate.mjs` — transforma os leads brutos nas métricas do ranking.
- `public/` — o painel (HTML, CSS e JS sem frameworks).

### Sobre a velocidade / rate limit

A API do Supremo limita a **~1 requisição por segundo** e devolve os leads de
**20 em 20**. Um mês (~1.100 leads ≈ 57 páginas) leva cerca de **1 minuto** na primeira
carga. Por isso o painel:

- **pré-aquece** o mês atual quando o servidor sobe;
- serve sempre o **cache** na hora e atualiza em segundo plano (*stale-while-revalidate*);
- guarda o cache **em disco** (`.cache/`), então reinícios já sobem quentes.

Assim, quem abre o painel praticamente nunca espera — só períodos personalizados
inéditos passam pela carga completa.

### O alerta de "leads parados"

A varredura de parados roda sobre os **últimos 45 dias** de leads ativos (independente
do período selecionado no painel) e atualiza de hora em hora. Ajuste a janela pela
variável `ALERTA_DIAS` no `.env`.

---

## Variáveis de ambiente (`.env`)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SUPREMO_TOKEN` | — | **Obrigatório.** Token JWT da API do Supremo CRM. |
| `PORT` | `8787` | Porta do servidor. |
| `CACHE_TTL_MIN` | `15` | Minutos de cache dos dados do período. |
| `ALERTA_DIAS` | `45` | Janela (dias) da varredura de leads parados. |

---

## O que a API do Supremo entrega (e o que não entrega)

Fonte: `https://api.supremocrm.com.br/v1` — recursos `leads`, `corretores`, `imoveis`,
`empreendimentos`.

- ✅ **Vendas** vêm da etapa "LEADS VENDIDOS" (com valor, corretor e data da venda).
- ✅ **Movimentação, funil, origens, motivos de perda, qualificadores** — tudo por lead.
- ⚠️ **Tempo de resposta**: medimos o tempo de captura → qualificação (a "primeira
  resposta" literal quase não é registrada pela API).
- ❌ A API **não expõe "tarefas"** — por isso a métrica de produtividade usa **vendas
  fechadas** no lugar.

---

Feito para a Lion Negócios Imobiliários · dados ao vivo do Supremo CRM.

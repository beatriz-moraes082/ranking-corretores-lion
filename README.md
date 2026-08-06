# 🦁 Ranking de Corretores — Lion Negócios Imobiliários

Painel de **ranking de performance dos corretores**, integrado à **API aberta do
Supremo CRM**. Pensado para ficar passando numa TV da imobiliária: bem visual,
legível de longe, com **tema claro e escuro**.

Sem dependências externas — roda com Node.js puro (nativo).

---

## O que o painel mostra (página única, foco no corretor)

- **KPIs** — leads no período, vendas fechadas, VGV (volume vendido), ticket médio e
  leads parados +15 dias, com números animados.
- **🏆 Pódio do período** — top 3 corretores por *Score de Performance*.
- **Ranking completo** — tabela ordenável por Score, vendas, VGV, conversão, leads,
  1º contato e parados +15d. Linha do líder destacada.
- **Perfil comportamental** — um radar por corretor com 6 dimensões (Volume, Vendas,
  Conversão, 1º contato, Movimentação, Consistência) e destaques de **fortes** e
  **a melhorar** — inspirado no perfil de SDRs.
- **🚨 Leads parados +15 dias** — ativos sem movimentação há +15 dias, com nome,
  telefone e corretor responsável.

**Filtro de período:** Semana · Mês atual · Personalizado. **Auto-refresh** a cada 3 min
(modo TV) e alternância de **tema claro/escuro** (botão no topo, padrão escuro).

### Score de Performance

Índice de 0 a 100 que combina, normalizado entre os corretores do período:
vendas (28%), conversão (20%), volume (16%), 1º contato (16%), movimentação (10%) e
consistência (10%). É o que ordena o pódio e o ranking por padrão.

> **1º contato** = tempo entre a captura do lead e a qualificação (quando o time faz o
> primeiro contato). Quanto menor, mais rápido o lead é atendido.

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

# 🦁 Elite Lion — Ranking de Performance dos Corretores

Painel de **ranking de performance dos corretores**, integrado à **API aberta do
Supremo CRM**. Pensado para ficar passando numa TV da imobiliária: bem visual,
legível de longe, com **tema claro e escuro**.

Sem dependências externas — roda com Node.js puro (nativo).

## Publicar online (1 clique)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/beatriz-moraes082/ranking-corretores-lion)

Ao clicar, o Render lê o arquivo `render.yaml` e configura tudo sozinho. Você só
precisa **colar o token do Supremo CRM** no campo `SUPREMO_TOKEN` e confirmar. Em
poucos minutos você recebe um link fixo (ex.: `https://elite-lion.onrender.com`).

> No plano gratuito o serviço "dorme" após 15 min sem acesso e demora ~1 min pra
> voltar. Com a TV aberta (o painel se atualiza sozinho a cada 3 min) ele fica acordado.

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
- **Funil** — funil do corretor (Qualificado → Agendamento/Crédito → Visita → Proposta →
  Venda) com a taxa de passagem entre etapas ao lado da taxa da equipe; tabela
  comparativa com o **gargalo** de cada corretor (passagem com maior queda vs a equipe);
  leads parados do corretor com a etapa atual; e **evolução** vs semana e mês anteriores.
- **Equipes** — seletor de equipe no topo. O link fica com `?equipe=<id>`, então cada
  gerente salva o link da própria equipe e vê o resultado geral dela.

**Filtro de período:** Semana · Mês atual · Personalizado. **Auto-refresh** a cada 3 min
(modo TV) e alternância de **tema claro/escuro** (botão no topo, padrão claro). Visual nas cores da Lion: preto, branco, off-white e terracota.

### Score de Performance

Índice de 0 a 100 que combina, normalizado entre os corretores do período:
vendas (35%), propostas (30%), conversão (20%) e consistência (15%).
É o que ordena o pódio e o ranking por padrão. Volume, movimentação e 1º contato ficam só
no perfil comportamental: o pré-atendimento é da recepção e o corretor já recebe o lead
qualificado.

### Funil

Começa em **Qualificado** (todo lead que chegou ao corretor). As etapas seguintes vêm da
*situação* atual do lead no Supremo: Agendamento ou Análise de crédito → Agendamento/Crédito,
Visita, Proposta, e Venda (lead vendido). **Etapa pulada conta como passada**: um lead em
Visita conta também em Agendamento/Crédito. A API só dá a situação atual (sem histórico).

### Equipes

A API do Supremo não tem equipe nem gerente, então elas ficam em `equipes.json`
(ou na variável `EQUIPES_JSON`, que tem prioridade):

```json
[
  { "id": "equipe-ana", "nome": "Equipe Ana", "gerente": "Ana", "corretores": ["Nome do corretor", "..."] }
]
```

Os nomes são comparados sem acento e sem diferenciar maiúsculas. Com a lista vazia, o
seletor some e o painel mostra a imobiliária toda.

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
  `/api/evolucao` (semana e mês x anteriores) e serve o painel. Tem cache em memória e em disco.
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
| `BASE_TTL_MIN` | `30` | Minutos entre as buscas dos leads de hoje, no expediente. |
| `ALERTA_DIAS` | `45` | Janela (dias) da varredura de leads parados. |
| `EQUIPES_JSON` | — | Opcional. Equipes em JSON (substitui o `equipes.json`). |
| `SUPREMO_RAJADA` | `20` | Consultas que podem sair de uma vez. |
| `SUPREMO_INTERVALO_SEG` | `120` | Depois da rajada, uma consulta a cada tantos segundos. |
| `KV_URL` | — | Recomendado no Render. URL do Key Value (Redis) onde o cache sobrevive às publicações. |
| `CLICKUP_TOKEN` | — | Opcional. Token da API do ClickUp para o resumo semanal de propostas. |
| `CLICKUP_LISTA_PROPOSTAS` | — | ID da lista do ClickUp onde o resumo é criado. |
| `CLICKUP_RESPONSAVEL` | — | Opcional. ID do usuário do ClickUp que recebe a tarefa. |
| `CLICKUP_CAMPO_CLIENTE` | — | Opcional. `idDoCampo=idDaOpcao` de um campo de lista suspensa (ex.: Clientes = Lion Imob). |
| `RESUMO_DIA` / `RESUMO_HORA` | `1` / `9` | Dia da semana (0 = domingo) e hora do resumo. |

### Agenda de consultas ao Supremo

O Supremo bloqueia (HTTP 429) quando recebe consultas demais, então o servidor segue
uma agenda (horário de Maceió) em vez de baixar tudo o tempo todo:

| O que | Quando |
|---|---|
| Leads de hoje (1-2 páginas) | a cada 30 min, de segunda a sábado, das 8h às 19h |
| Mês atual inteiro | às 8h, 12h e 17h |
| Vendidos | junto com a das 17h |
| Mês anterior | uma vez por dia |
| Noite e domingo | nada |

As consultas seguem um orçamento: até 20 de uma vez e, depois, uma a cada 2 minutos
(`SUPREMO_RAJADA` e `SUPREMO_INTERVALO_SEG`), porque o Supremo aguenta só umas 30
seguidas. Se a busca for interrompida por um bloqueio, a próxima continua da página
onde parou. O estado fica em `/api/status`.

Ranking, semana, funil, leads parados e evolução são calculados dessas bases, sem
nova consulta (~200 páginas por dia). Se vier um 429, a busca para na hora e nenhuma
consulta sai por 30 min (60 min se repetir). Lead novo aparece em até 30 min; mudança
de situação de lead mais antigo aparece na próxima atualização do mês.

### Cache persistente (Render Key Value)

No plano gratuito do Render o disco do serviço é apagado a cada publicação. Sem um
armazém fora dele, toda publicação faz o servidor buscar tudo de novo no Supremo, e o
Supremo bloqueia temporariamente quando recebe consultas demais (HTTP 429).

1. No Render: **New → Key Value**, plano **Free**, mesma região do serviço (Oregon).
2. Copie a **Internal Key Value URL** (começa com `redis://`).
3. No serviço `elite-lion` → **Environment** → adicione `KV_URL` com essa URL → **Save**.

Com isso o servidor sobe já com os dados e só consulta o Supremo o que estiver vencido.
Além disso, o navegador da TV guarda os últimos dados: se o servidor ou o Supremo
ficarem fora, a TV continua mostrando o último ranking com "reconectando…".

### Resumo semanal de propostas x campanhas (ClickUp)

Toda segunda, a partir das 9h, o servidor cria uma tarefa no ClickUp com as propostas
novas e a campanha de origem de cada lead (campo `nome_campanha` do Supremo), para o
assessor de tráfego cruzar proposta com campanha. Semana sem proposta nova não gera
tarefa. Não faz nenhuma consulta extra ao Supremo: usa os leads que o painel já tem.

- **Proposta** = lead em situação de Proposta ou que virou venda (mesma regra do funil).
- **Nova** = ainda não saiu em resumo anterior. O servidor lê os resumos já criados na
  lista (etiqueta `resumo-propostas`, cada lead aparece como `lead #ID`), então não
  repete leads nem cria dois resumos na mesma semana, mesmo depois de reiniciar.
- Entram os leads captados no mês atual e no anterior. O primeiro resumo traz todas as
  propostas desse período.
- Prévia sem criar nada: `/api/resumo-propostas?formato=texto`.

Para ligar, no serviço `elite-lion` → **Environment**: `CLICKUP_TOKEN` (ClickUp →
Settings → Apps → API Token), `CLICKUP_LISTA_PROPOSTAS` e, se quiser, `CLICKUP_RESPONSAVEL`.
O estado aparece em `/api/status` → `resumoPropostas`.

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

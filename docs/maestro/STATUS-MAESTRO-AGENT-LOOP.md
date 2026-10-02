# STATUS-MAESTRO-AGENT-LOOP.md

Versão: 1.0
Status: Oficial — fonte única do estado atual do Maestro V2
Última atualização: 26/07/2026
Projeto: Vibe

> Este documento substitui `STATUS-MAESTRO-V2.md` (movido para
> `docs/_archive/maestro/` em 26/07/2026 — cobria o motor simples/legado até
> 22/07 e ficou desatualizado quanto a migrations, flags e capacidades).

---

# 1. Arquitetura atual

O Maestro opera com DOIS motores atrás da mesma rota `/api/maestro/simple`:

- **Agent loop (V2, leitura)** — `src/features/maestro/core/agent/`:
  loop de function calling da OpenAI (`maestro-agent-loop.ts`) com catálogo de
  tools read-only (`maestro-agent-tools.ts`), system prompt de regras de
  negócio (`maestro-agent-prompt.ts`) e sanitização (`maestro-agent-sanitize.ts`).
  Ativado por `deveUsarAgentLoop` quando a flag está ligada E não há estado de
  escrita/cotação em andamento.
- **Motor legado (simple engine)** — permanece o ÚNICO caminho para cotação,
  salvamento de proposta e demais fluxos de escrita assistida. Também é o
  fallback integral: qualquer erro do agent loop cai nele (o Maestro nunca
  fica mudo).

Guardas do loop: MAX_ITERATIONS=5, MAX_TOOL_CALLS=8, TIMEOUT_MS=25000,
resposta parcial segura, guarda determinística de citações (número de
proposta não confirmado por tool no turno é corrigido ou redigido).

## Feature flags

| Flag | Efeito | Deploy hoje |
|---|---|---|
| `MAESTRO_AGENT_LOOP_ENABLED` | liga o agent loop | ausente (legado) |
| `MAESTRO_AGENT_LOOP_MODEL` | modelo (padrão gpt-4.1) | ausente |
| `MAESTRO_PERSISTENCE_ENABLED` | persistência de conversas | ausente |
| `MAESTRO_AUDIT_DB_ENABLED` | auditoria em `maestro_acoes` | ausente |

Reversão total = desligar `MAESTRO_AGENT_LOOP_ENABLED`.

---

# 2. Catálogo de tools (23, todas somente leitura)

- **Cliente**: `resolver_cliente`, `confirmar_cliente_candidato`,
  `visao_geral_cliente` (visão consolidada primeiro — princípio permanente),
  `dados_cadastrais_cliente`, `enderecos_cliente`, `contatos_cliente`,
  `socios_cliente`.
- **Propostas (pipeline comercial)**: `propostas_cliente` (agregados por
  status no servidor), `ultimo_orcamento_cliente` (filtros
  `nao_aprovada_comercial`/`nao_avulsa`), `maior_pedido_cliente`,
  `detalhe_proposta` (itens + situação operacional do pedido),
  `soma_pedidos_producao_periodo`.
- **Financeiro**: `faturamento_cliente`, `vendas_por_vendedor` (gate
  `propostas.view_all`; sem ela, só os próprios números),
  `recebimento_periodo`, `comparar_recebimento_meses`,
  `perfil_pagamento_cliente`, `boletos_cliente`, `conta_corrente_cliente`,
  `analise_credito_cliente` (gate `cadastros.view_credito` — RPC definer).
- **Produtos**: `listar_produtos` (busca ampla + formato/peso/prazo),
  `buscar_produto`, `simular_orcamento_avulso` (peso total e prazo calculados).

Todas as consultas financeiras suportam `id_empresa`
(`pagamentos_v2.id_empresa`) — princípio permanente.

---

## 2.1 Manual de uso e consulta por pedido (02/10/2026)

O catálogo real hoje tem **31 tools**: as 29 que já existiam (28 de leitura e a
escrita `salvar_cotacao_como_proposta`, única exceção de escrita por decisão do
dono em 01/10/2026) e as duas abaixo. O Maestro só orienta e mostra dados.

- **`consultar_manual`** — lê páginas de `docs/manual/` (manual de uso, mantido
  fora do Maestro: uma página por tela, atualizada no mesmo commit de cada
  mudança visível; regra no `AGENTS.md`). O índice das páginas (título, onde
  fica, o que cobre, páginas vizinhas) entra no prompt a cada turno; a tool
  devolve o texto inteiro das páginas pedidas e o retrato de quem pergunta
  (perfil e permissões pelos rótulos da tela de Perfis). Sem permissão, o
  Maestro explica o passo e diz a quem pedir.
- **`consultar_pedido`** — situação real de um pedido pelo número, sem cliente
  ativo, em partes: `situacao`, `cobrancas`, `titulos`, `nota_fiscal`,
  `producao`, `expedicao`, `tarefas`. Duas travas no servidor:
  1. **Escopo por vendedor**: vendedor sem `propostas.view_all` só consulta o
     pedido em que ele é o vendedor (`usuarios.meu_vendedor || nome_usuario` ×
     `propostas.vendedor`). Pedido de outro devolve recusa sem nenhum dado. A
     trava fica na tool porque a RLS de `propostas` é aberta. Quem não vende
     (Produção, Designer, Expedição) é recortado só pela permissão de cada parte.
  2. **Permissão por parte**, igual à da tela: `situacao` → `propostas.view*`;
     `cobrancas` → `cobrancas.view`/`cobrancas.create`/`conferencia.view`;
     `titulos` → `contas_receber.view`; `nota_fiscal` → `fiscal.view`;
     `producao` → `pedidos.view`; `expedicao` → `expedicao.view`;
     `tarefas` → `tarefas.participar`. Administrador e super admin passam, como
     no `PermissionGuard`.
  Nunca saem: linha digitável, código de barras, nosso número, link de boleto,
  chave de NF-e, CPF/CNPJ. Totais e contagens saem prontos.

Travas contra passo a passo inventado (todas no servidor, depois do modelo):

| Trava | O que barra | Efeito |
|---|---|---|
| Passos sem manual | Resposta ensina a usar uma tela e nenhuma página foi lida no turno | Uma rodada de correção; persistindo, a resposta vira o texto fixo "ainda não tenho esse passo a passo" |
| Nome fora da página | Menu, aba ou botão que não está em nenhuma página lida | Uma rodada de correção; persistindo, aviso no fim com os nomes |
| Conferência do assunto | Página lida ensina OUTRA tarefa (só palavras em comum) | Chamada curta ao modelo; "outra tarefa" troca a resposta pelo texto fixo |

A auditoria (`maestro_acoes.payload`) passou a registrar `consultas` (qual
página do manual, qual pedido, quais partes e se saiu dado), `manual_lido`,
`conferencia_do_assunto`, `correcoes_do_manual` e `trava_do_manual`.

Arquivos: `maestro-agent-manual.server.ts`, `maestro-agent-pedido.server.ts`,
`maestro-agent-acesso.server.ts`, `maestro-agent-trava-manual.ts`,
`maestro-agent-conferencia.server.ts`. Teste sem banco e sem modelo:
`scripts/testes/maestro-manual-e-pedido.test.mts`. Em produção os `.md` do
manual chegam à função por `outputFileTracingIncludes` no `next.config.ts`.

Limite conhecido: o Maestro lê só a página que escolheu; quando o fluxo
continua em outra tela, ele cita a tela mas nem sempre detalha os passos de lá.

## 2.2 Trava de vendedor nas consultas por cliente (02/10/2026)

A mesma regra da consulta por pedido, aplicada às consultas comerciais e
financeiras por cliente: `visao_geral_cliente`, `propostas_cliente`,
`detalhe_proposta`, `ultimo_orcamento_cliente`, `maior_pedido_cliente`,
`soma_pedidos_producao_periodo`, `faturamento_cliente`, `recebimento_periodo`,
`comparar_recebimento_meses`, `perfil_pagamento_cliente`, `boletos_cliente`,
`conta_corrente_cliente` e `analise_credito_cliente`.

Vale para vendedor sem `propostas.view_all` (visão geral e quem não vende
seguem como estavam):

1. **O cliente é dele** quando está na carteira dele (`clientes.nome_vendedor`)
   ou quando ele tem ao menos um pedido ligado ao cliente (como cliente ou como
   faturado). Fora disso, a consulta devolve `CLIENTE_DE_OUTRO_VENDEDOR` e
   nenhum dado.
2. **Dentro de um cliente dele, só os pedidos dele**: proposta, pagamento,
   boleto, pendência e movimento de pedido de outro vendedor não aparecem
   (cerca de 34 clientes têm pedidos de mais de um vendedor). Linha sem pedido
   (boleto avulso) aparece só para o dono da carteira. Nesses clientes a visão
   consolidada (`vw_maestro_cliente_360`, que soma tudo) não é exibida, e o
   resultado sai com `escopo_aplicado` para o Maestro dizer o recorte.
3. O saldo de crédito é do cliente, não de um pedido: sai para quem tem o
   cliente no escopo.

A trava mora **dentro dos adapters de dados** (`maestro-simple-propostas`,
`-pagamentos`, `-boletos`, `-conta-corrente`), em
`maestro-agent-escopo.server.ts`, e por isso vale também no motor legado
(cotação em andamento ou fallback), que responde com um texto fixo de recusa. A
rota registra o usuário da sessão no client da requisição; client sem registro
é recusado (falha fechada).

Ficam de fora, de propósito: `resolver_cliente`, cadastro, endereços, contatos,
sócios, cotação, frete e salvar proposta — o vendedor cota para qualquer
cliente, como na tela.

## 2.3 Regra única de título em aberto e em atraso (02/10/2026)

Uma regra só, em `core/simple/maestro-regra-titulos.ts`, usada por
`boletos_cliente` (filtros abertos, atrasados e todos), pelo resumo de boletos
de `visao_geral_cliente` e pela parte `titulos` de `consultar_pedido`:

- **Em aberto** = título sem pagamento e não cancelado, em qualquer status
  (a vencer, a receber, vencido). O "Substituído" do Refazer boleto é gravado
  como cancelado e não entra.
- **Em atraso** = em aberto com vencimento antes de hoje, no calendário de
  Brasília. Os dias de atraso saem dessa conta, não da coluna `dias_atraso`.
- **Não liquidado** = o mesmo que em aberto.

Antes eram três regras: em aberto só via status `A_VENCER` (o título
`A_RECEBER` não pago sumia), em atraso dependia de `dias_atraso` (contava
cancelado com dias congelados) e não liquidado contava cancelado.
`boletos_cliente` passou a devolver `resumo` com os totais prontos de todos os
títulos em aberto e em atraso, e não só dos 30 listados.

## 2.4 Faturamento igual ao Dashboard e manual lido de verdade (02/10/2026)

**Faturamento.** Maestro e Dashboard sempre usaram a mesma regra, mas o Maestro
fazia UMA leitura de `pagamentos_v2` e o banco entrega no máximo 1.000 linhas.
Todo mês desde maio/2026 tem mais de 1.000 cobranças: setembro saiu
R$ 780.657,05 quando o Dashboard mostra R$ 1.121.100,46. O aviso de incompleto
não disparava porque contava as linhas depois de tirar as cortesias.

- A leitura linha a linha é paginada até o fim (teto de segurança: 40 páginas).
- No consolidado (sem cliente e sem filtro de vendedor), o valor e a contagem de
  cobranças saem de `view_pagamentos_pagos_v2`, a mesma visão do card
  Faturamento; a soma linha a linha fica como conferência (`conferencia`).
- O período vale pelo dia de Brasília: meia-noite UTC do dia 1 significa "o dia
  1 do calendário", e mês atual/passado saem do calendário de Brasília.
- `aviso_truncamento` conta as linhas lidas, antes de tirar cortesia.
- A resposta traz `total_cobrancas`, `total_propostas`, `medida` e
  `como_apresentar`: o Maestro mostra cobranças e propostas e diz que
  faturamento não é o recebido em caixa.
- Gabarito contra o banco real: `scripts/testes/maestro-faturamento-gabarito.test.mts`
  (setembro/2026 = R$ 1.121.100,46 em 1.324 cobranças, e igual à visão lida na hora).

**Manual.** Em 02/10/2026 o Maestro respondeu que "CPF exige aprovação manual"
sem abrir a página: deduziu da linha do índice e citou a página como fonte.

- Trava nova (`cita_manual_sem_ler`): resposta que cita o manual, ou uma tela
  que tem página no índice, sem nenhuma página lida no turno → rodada de
  correção mandando ler a página; persistindo, texto fixo. Se a resposta só diz
  que o manual não tem aquilo e nada foi consultado, vira o texto fixo direto.
- O prompt diz que o índice só serve para escolher a página.

## 2.5 Pedido citado = pedido consultado; pago x confirmado (02/10/2026)

**O caso.** Na mesma conversa o usuário perguntou a situação do pedido 23020
e, depois, a do 23071. Na segunda (auditoria 761, `tools: []`) o modelo não
consultou nada: copiou do histórico a resposta do 23020, trocou o número e
fechou com "Fonte: Pedido 23071 e cobranças (ERP)". A guarda de citações não
pegou porque aceita como confirmado todo número digitado na pergunta.

**Trava do pedido** (`maestro-agent-trava-pedido.ts`, aplicada no loop):

- Número apresentado como pedido ou proposta só passa se uma ferramenta foi
  chamada com ele, ou o devolveu, NESTA pergunta. A pergunta do usuário e o
  histórico não contam.
- Linha de "Fonte:" só passa se alguma consulta deu certo nesta pergunta.
- Número SOLTO de 4 a 6 dígitos (sem as palavras pedido, proposta ou
  orçamento) entra na mesma regra quando a frase o trata como um pedido
  (artigo antes: "o 23071", "do 23071"; título de linha: "23071 — Situação";
  verbo de situação depois: "23071 está") E há dado de pedido ao lado
  (cliente, valor, status, cobrança, produção). Ficam fora: quantidade
  ("5000 unidades", "5000 tribands", "Quantidade: 5000"), CEP, valor,
  telefone, data, ano, faixa ("de 1000 a 5000") e código de cliente
  rotulado. Código de cliente sem rótulo passa se for o cliente ativo ou um
  candidato da sessão.
- Falhou: uma rodada forçada mandando chamar `consultar_pedido` com o número.
  Persistiu: a resposta inteira é trocada por um texto fixo sem dado nenhum
  (redigir só o número deixaria os dados do outro pedido na tela). Em turno
  que gravou algo, só entra um aviso.
- Auditoria: `correcoes_de_pedido` e `trava_do_pedido`
  (`resposta_substituida`, `fonte_removida`, `aviso_pedido_sem_consulta`).

**Pago x confirmado.** `consultar_pedido`, parte `cobrancas`, devolve a
situação de cada cobrança separando "Paga e confirmada pelo financeiro" de
"Paga pelo cliente, ainda NÃO confirmada pelo financeiro", e um bloco
`cobertura` com a leitura pronta:

| `cobertura.situacao` | Quando |
|---|---|
| `COBERTO_E_CONFIRMADO` | cobranças confirmadas cobrem o valor do pedido |
| `PAGO_AGUARDANDO_CONFERENCIA` | o que falta confirmar já foi pago pelo cliente |
| `FATURADO_AGUARDANDO_APROVACAO` | faturado a vencer ainda sem aprovação |
| `FALTA_PAGAMENTO` | ainda há valor sem pagamento |
| `SEM_COBRANCA` | nenhuma cobrança ativa |

O prompt só deixa dizer "pago" sem ressalva em `COBERTO_E_CONFIRMADO`. Em
`PAGO_AGUARDANDO_CONFERENCIA` a resposta explica que falta a conferência do
financeiro e que por isso o status continua AGUARDANDO.

**Provas.** `scripts/testes/maestro-manual-e-pedido.test.mts` (seções 7 e 8,
com o texto real da resposta errada).

## 2.6 Status do pedido: copiado da consulta, nunca reescrito (02/10/2026)

**Regra.** O Maestro informa o status do pedido exatamente como a consulta
devolveu, ou pelo rótulo que as telas do Vibe mostram para aquele status.

**A tabela** (`maestro-agent-status.ts`):

- a lista é a de `docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §3 (21
  status, com `NOVO_ARTE_APROVADA` e `AGUARDANDO_ARTE_APROVADA`), mais os
  legados `APROVADO` e `RECEBIDO`, que existem no banco;
- o rótulo é o da **lista de Propostas**: `getStatusLabel`
  (`orcamentos/mappers.ts`) seguido de `humanizeStatus`, exatamente o que a
  lista faz — não há segunda tabela de rótulos;
- o sufixo ` / EM ARTE` vem de `composeStatusEmArte`, como nas telas.

**Status exibido como outro (decisão do dono, 02/10/2026).** Na lista de
Propostas, `APROVADO` aparece como "Liberado" (é o legado de `LIBERADO`, sem
relação com arte) e `AGUARDANDO / PENDENTE`, `EM IMPRESSAO / PENDENTE` e
`EM ACABAMENTO / PENDENTE` aparecem como "Aguardando". O Maestro mostra igual,
e para esses quatro vale SÓ o rótulo:

- `aplicarRotulosDeTela` troca o valor na saída de qualquer ferramenta antes
  de ela chegar ao modelo (`status_interno` e os mapas de contagem e soma por
  status, que somam a linha na do rótulo);
- `consultar_pedido` já devolve o rótulo em `status`, e nos três "/ PENDENTE"
  devolve também `observacao_sobre_o_status` (impressão ou acabamento em
  pausa não é falta de pagamento);
- se a resposta ainda trouxer o valor cru, a trava troca pelo rótulo — no
  lugar, mesmo com vários pedidos.

Em 02/10/2026 eram 3.560 pedidos em `APROVADO`, 102 em `LIBERADO` e nenhum
em status "/ PENDENTE".

`scripts/testes/maestro-status.test.mts` lê o documento oficial e falha se a
lista divergir; também trava a tabela de rótulos por extenso.

**Onde entra.**

- `consultar_pedido` devolve `status` (com o sufixo de arte), `status_na_tela`
  e a instrução de copiar. `propostas.status_pedido` saiu do nome
  `status_do_pedido` (virou `andamento_da_ordem_de_servico`): era apresentado
  como se fosse o status do pedido.
- O prompt recebe a lista oficial gerada da tabela.
- **Trava do status** no loop: o status que a resposta DECLARA — depois de
  "Status:"/"Situação:", de "status …" ou de "está …" — tem de ser um valor
  que as consultas desta pergunta devolveram (ou o rótulo dele). Não bateu:
  uma rodada de reescrita, sem nova consulta. Persistiu: com um pedido
  consultado, o servidor troca o trecho pelo status certo; com vários, ou sem
  pedido, acrescenta o aviso com o status de cada um.
- Não dispara em palavra solta ("aguardando a conferência", "liberado para
  produção"), em status de cobrança, boleto, nota ou setor, no próximo status
  do fluxo ("passa para LIBERADO"), nem quando nenhuma consulta da pergunta
  trouxe status (cotação, manual, conceito).
- Auditoria: `correcoes_de_status` e `trava_do_status` (`status_trocado`,
  `aviso_de_status`, `status_trocado_e_aviso`).

**Divergência entre telas (não alterada).** Só a lista de Propostas aplica
`getStatusLabel`. As telas que passam o status direto ao `StatusBadge` (lista
de Pedidos, formulário da proposta) mostram `APROVADO` como "Aprovado" e os
"/ PENDENTE" por extenso. O Maestro segue a lista de Propostas.

## 2.7 Vendas de teste fora do faturamento (02/10/2026)

**Decisão do dono.** Não somam no faturamento os pedidos nos cadastros de
teste 6, 11, 14 e 58613 ("Teste Testando"), os dos vendedores "Everton Dev" e
"TESTE AUTOMATIZADO" e os do login userteste1 (como vendedor do pedido ou como
quem o criou). Nenhuma cobrança, boleto ou status foi alterado: a exclusão é
só na soma.

**Onde está a regra.**

| Camada | Onde | Situação |
|---|---|---|
| Banco | `public.fn_venda_de_teste` + `view_pagamentos_pagos_v2` (`20261002_faturamento_exclui_vendas_de_teste.sql`) | aplicada |
| Maestro | `core/simple/maestro-venda-de-teste.ts`, usado por `calcularFaturamentoOficial` | no ar |
| Ranking e "Meu desempenho" do Dashboard | `rpc_ranking_vendedores` e `rpc_dashboard_vendedor` leem `pagamentos_v2` direto | **pendente** — migration pronta em `scratch/pendente-ranking-exclui-vendas-de-teste.sql`, aguarda autorização |

As listas do banco e do aplicativo têm de ser iguais. O total do Maestro vem
da visão e o detalhe por vendedor e por empresa é somado no aplicativo:
divergiu, `conferencia.confere` vira falso e
`scripts/testes/maestro-faturamento-gabarito.test.mts` falha.

**Efeito medido em 02/10/2026** (19 cobranças, R$ 3.052,28):

| Mês | Antes | Depois | Saiu |
|---|---|---|---|
| Junho | 627.136,71 | 627.048,71 | 88,00 (1) |
| Julho | 636.067,72 | 633.484,52 | 2.583,20 (7) |
| Agosto | 779.679,50 | 779.463,95 | 215,55 (8) |
| Setembro | 1.121.100,46 | 1.120.934,93 | 165,53 (3) |

**AUTOMATECH não é teste.** Os pedidos 19795 e 21833 estavam com vendedor
"userteste1" e são vendas da Edina Farias. Foram corrigidos antes da migration
(`propostas.vendedor` e `pagamentos_v2.atendente`); depois disso o userteste1
ficou sem nenhuma cobrança no faturamento.

**Quem atribui a venda ao vendedor.** Ranking, "Meu desempenho" e Maestro
leem só `propostas.vendedor` (texto). `pagamentos_v2.atendente` é o vendedor
no Relatório de vendas pagas. `propostas.id_vendedor` não é lido por nenhum
deles.

**Fora desta regra, de propósito.** Recebimento (caixa, por data do
pagamento), Relatório de vendas pagas, cobertura da proposta e o gráfico
"Aprovadas por tipo" continuam contando tudo.

---

# 3. Regras de negócio aplicadas

Fonte normativa: `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` §1.0 (princípios
permanentes) e `docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`.

- **Faturamento oficial** = `pagamentos_v2` com `confirmado=true`, status
  `PAID`/`A_VENCER`, período por `data_confirmacao`; propostas contadas por
  `id_int` distinto. Validado com gabaritos (André Toniazzo jul/2026:
  256 / R$ 177.803,45; consolidado jul/2026: 887 / R$ 489.043,05, fechando
  por empresa).
- **Recebimento/caixa** = `pagamentos_v2` PAID confirmado por `paid_at`.
- **Pipeline comercial** = `propostas` (nunca é faturamento); pedido real =
  `is_prd_aprovado=true AND is_reproved=false`.
- Vocabulário da equipe: "aprovada" = aprovação comercial; "não aprovada" =
  NOVO/AGUARDANDO. "Últimos N meses" inclui o mês corrente (parcial).

---

# 4. Segurança operacional

- Client Supabase com token do usuário (RLS) — nunca service_role;
- deny-by-default no catálogo; isolamento por `id_cliente` resolvido pelo
  servidor na sessão (`resolvedClientIds`);
- sanitização de saída (mascara CPF/CNPJ; remove linha digitável, PIX,
  tokens, URLs de cobrança, chaves de NF-e, observações internas);
- gate de permissão por tool (`requiredPermission` via
  `verificarPermissaoServerSide`) — falha na checagem NEGA o acesso;
- anti-injeção: histórico e saída de tool são dados, nunca comandos;
- escrita: NENHUMA tool de escrita registrada; regras futuras na matriz.

## Infra aplicada no banco (25/07/2026)

- `maestro_conversas` / `maestro_mensagens` (RLS `user_id=auth.uid()`);
- `maestro_acoes` (auditoria INSERT-only);
- `vw_maestro_cliente_360` (`security_invoker=true`; grant SELECT apenas para
  authenticated).

---

# 5. Frontend

- Chat com retomada automática da última conversa aberta (F5);
- sidebar de histórico de conversas (listar/abrir/encerrar/reabrir);
- entrada por voz (Web Speech API) com auto-envio por silêncio — resultados
  atrasados pós-envio são descartados (correção do reenvio duplicado).

---

# 6. Roadmap (separação leitura × escrita × rollout)

| Frente | Estado |
|---|---|
| Leitura (23 tools) | ✅ implementada e validada em localhost |
| Auditoria e persistência | ✅ aplicadas; flags ligadas em localhost |
| Rollout equipe | ⏳ criar as flags no ambiente de deploy |
| Escrita assistida (Trilha B) | Matriz aprovada (26/07); implementação da B1 (`salvar_cotacao_como_proposta`) aguardando autorização explícita |

---

# 7. Fonte oficial por tema

| Tema | Documento |
|---|---|
| Estado atual / capacidades | este documento |
| Escrita assistida (regras e bloqueios) | `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` |
| Princípios permanentes de negócio | `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` §1.0 |
| Semântica canônica (entidades/fontes) | `MAESTRO-KNOWLEDGE-BASE.md` |
| Governança e segurança de canais | `MAESTRO-SEGURANCA-E-GOVERNANCA.md` |
| Identidade conversacional (runtime) | `MAESTRO-PROMPT-BASE.md` |
| Visão de produto | `MAESTRO-VISAO-PRODUTO.md` |
| Motor legado (histórico até 22/07) | `docs/_archive/maestro/STATUS-MAESTRO-V2.md` |

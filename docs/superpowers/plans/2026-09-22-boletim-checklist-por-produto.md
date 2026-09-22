# Boletim montado por checklist do produto

**Data:** 22/09/2026 · **Estado:** etapas 1 a 6 aplicadas · **Sessão:** C1

Hoje o card do boletim imprime o mesmo conjunto de campos para todo produto que
não é de prateleira — numeração em cordão, gabarito no campo "NUM", tipo
SEQUENCIAL herdado por padrão. A reforma dá a cada produto um **checklist** que
decide quais campos opcionais aparecem, congelado no item da proposta no momento
da venda.

**Decisões do dono, base deste plano (não reabrir):** o que já está feito não é
corrigido; checklist por produto, não por produto × setor; a lógica de setores
não muda; o boletim lê o snapshot do item, nunca o cadastro vivo; item sem
snapshot imprime exatamente como hoje.

As sete decisões de 22/09 estão na seção 12 e já foram aplicadas ao texto.

**Etapa 1 APLICADA em 22/09/2026**, versão `20260922153331`:
`supabase/migrations/20260922_produto_boletim_campos.sql` — 521 linhas de
checklist para os 95 produtos, nada mudou no que é impresso.

**Etapa 2 APLICADA em 22/09/2026** (só código, nenhuma escrita por SQL): bloco
"Campos do boletim" no cadastro do produto — seção 8.

**Etapa 3 APLICADA em 22/09/2026**, versão `20260922173058`:
`supabase/migrations/20260922_produtos_proposta_boletim_campos.sql` — tabela do
snapshot e a coluna `produtos_proposta.boletim_campos_congelado_em`, ambas
vazias/nulas. Nenhuma carga: os 1.554 itens existentes seguem sem snapshot e
imprimem como hoje. A tabela tem **só** políticas de SELECT e INSERT, e
`authenticated` ficou com SELECT e INSERT apenas — foi preciso `revoke all ...
from authenticated` antes do grant, porque toda tabela nova em `public` nasce
com `ALL` para esse papel.

**Etapa 4 APLICADA em 22/09/2026** (só código, nenhuma migration): o
`saveProposta` congela o checklist no item recém-criado —
`src/features/orcamentos/services/boletim-snapshot.service.ts`. Uma vez só, na
criação; item que já existia nunca é reescrito. As linhas entram antes do
carimbo de propósito: toda falha parcial cai no lado que imprime como hoje. Não
é fatal — se o snapshot falhar, o save da proposta segue.

**Etapa 5 APLICADA em 22/09/2026** (só código): o card do boletim passa a montar
os campos OPCIONAIS a partir do snapshot do item, e imprime as variações, uma
por linha. Item sem carimbo imprime exatamente como antes — provado por
comparação de conteúdo dos PDFs das OS 22194 (TEXTIL e LASER), 22270 (PVC e
TEXTIL), 22393 (TEXTIL) e 22450 (FLEXO): zero diferenças. `isEstoque` continua
mandando no que não é campo opcional (conteúdo de MODELO, texto da imagem
ausente, faixa IMP/ACA/CON e o EVENTO/DESIGNER do bloco de cliente).

**Etapa 6 APLICADA em 22/09/2026** (só código): o formulário do lote do PCP
(BLOCO 3 & 4) esconde o campo opcional que o produto não tem marcado — Cor,
Frente+Verso, Tipo de Numeração, Gabarito e Faixa — e o lote novo nasce **nulo**
nesses campos, sem herdar "SEM_NUMERACAO", faixa recalculada ou gabarito. A
fonte é o CADASTRO (`produto_boletim_campos`), não o snapshot. Produto sem
nenhum registro: formulário completo, como sempre. Valor já gravado em lote
existente não é tocado — o caminho de edição do boletim não reescreve esses
campos desde 30/08.

As duas provas que a Etapa 6 não pôde fazer contra o banco (o lote novo do PCP
nascendo nulo e o lote existente intocado) foram feitas na 6b por teste sem
banco, pelo serviço de verdade: `scripts/testes/checklist-lote.test.mts`.

**Etapa 6b APLICADA em 22/09/2026** (só código): a mesma regra na grade de lotes
da aba Pedido (`LotesGrid`) e na rota `POST /api/pedidos/lotes-em-massa`. A rota
aplica a regra NO SERVIDOR — lote novo grava null na coluna escondida mesmo com
valor na requisição (inclusive `tipo_numeracao`, que não vira `SEM_NUMERACAO`);
lote existente não leva a coluna no UPDATE. O checklist é lido antes de qualquer
escrita e, se a leitura falhar, nada é gravado. A regra das três portas mora em
`src/features/orcamentos/lib/checklist-lote.ts`.

**Etapa 6c APLICADA em 22/09/2026** (só código): as duas portas que faltavam.
Os cards da aba Pedido escondem os campos sem checklist; `criarModelo` anula a
coluna escondida (o `SEQUENCIAL` fixo do card e o numerador do cadastro
inclusive) e `atualizarModeloParcial` nunca a escreve — os dois recebem o
checklist como parâmetro obrigatório e aplicam a regra DEPOIS dos defaults
próprios. `validarInput` deixou de cobrar cor e faixa escondidas (sem isso, todo
lote novo de produto sem faixa seria recusado). O `saveProposta` lê o checklist
antes de qualquer escrita e aplica a regra no INSERT (C.2) e no UPDATE (C.1).
Com isso, TODAS as portas de escrita de `pedidos_modelos` seguem o checklist.

**O limite dessa garantia:** cards e `saveProposta` gravam do navegador, e a RLS
de `pedidos_modelos` é permissiva — a regra vale para o sistema, não contra quem
escrever direto no banco com uma sessão válida. Fechar isso de verdade exigiria
um trigger em `pedidos_modelos` (que precisaria saber o produto do lote e ler o
checklist) ou levar essas escritas para rotas de servidor.

---

## 1. De onde cada campo vem hoje

Todo o card sai de `pedidos_modelos`, com duas exceções: o nome do produto e a
quantidade da faixa, que vêm do item da proposta.

| Campo no card | Origem hoje | Quem grava |
|---|---|---|
| Nome do produto | `produtos_proposta.nome_produto` (cópia de `produtos."nomeReal"`) | vendedor |
| QUANT. da faixa do produto | `produtos_proposta.qtd` | vendedor |
| QUANT. do card | `pedidos_modelos.quantidade` | PCP |
| MODELO | `pedidos_modelos.nome_modelo` | PCP |
| COR | `pedidos_modelos.padrao` (cai em `"Branco"`) | PCP |
| INICIAL/FINAL | `pedidos_modelos.numeracao_inicio` / `numeracao_fim` | PCP — **o fim é sempre recalculado pela quantidade** (`services/lotes-numeracao.ts`) |
| NUM. | `pedidos_modelos.gabarito_operacional` — **é o gabarito, não a numeração** | PCP |
| IMPRESSAO | `pedidos_modelos.frente_verso` | PCP |
| TIPO | `pedidos_modelos.tipo_numeracao` | PCP |
| Imagem | `pedidos_modelos.arte_url`, senão `amostra_arte_base64`; em prateleira, `producao_cores.preview_base64` casando pelo nome da cor | arte / PCP |
| Obs | `pedidos_modelos.descricao` | PCP |
| Variações | **não chegam ao card** | — |

Pontos de código:

| O quê | Onde |
|---|---|
| Card do modelo | `src/features/pedidos/pdf/OsPdfDocument.tsx:596` (`ModeloCard`), campos em `:627-650` |
| Ramo curto (prateleira) | mesmo componente, condição `isEstoque` — **não existe layout de FLEXO** |
| View-model do card | `src/features/pedidos/services/os-viewmodel.service.ts:704-720` |
| Prévia da cor | `os-viewmodel.service.ts:511-528` (`producao_cores.preview_base64`) |
| Mapeamento do lote | `src/features/pedidos/services/pedidos-detalhe.service.ts:232-252` |

### 1.1 As variações

Três tabelas no catálogo: `variacoes` (grupo), `tipos_variacoes` (opções do
grupo, com preço e peso) e **`produto_variacoes`** (`id_produto`, `id_variacao`,
`nome`, `is_obrigatorio`, `is_multiplo`) — que é o precedente exato do checklist:
tabela filha, uma linha por vínculo, editada no cadastro do produto.

A escolha do vendedor grava em **`produtos_proposta_variacao`**
(`id_produto_proposta`, `id_tipo_variacao`, `nome_variacao`, `v_extra`,
`peso_uni`) — já é snapshot por item, escrito em
`orcamentos.service.ts:2961-2990` (apaga as antigas do item e insere as atuais).

O PCP consolida tudo em `pedidos_modelos.variacoes_texto`, no formato
`"IMPRESSÃO: Só Frente • FURAÇÃO: E. 2 Furos (dois) • ACABAMENTO: Fosco"`
(valor real do 22270). A aba Pedido mostra; **o PDF ignora**. Por isso a variação
só aparece quando está embutida no nome do produto do catálogo.

---

## 2. Campo × origem atual × origem proposta

| Campo | Obrigatório | Origem atual | Origem proposta |
|---|---|---|---|
| Nome do produto | sim | `produtos_proposta.nome_produto` | **igual** |
| Quantidade | sim | `pedidos_modelos.quantidade` | **igual** |
| Nome do modelo | sim | `pedidos_modelos.nome_modelo` | **igual** |
| Variações | não | — (não impresso) | `produtos_proposta_variacao`, **uma linha por variação**, `"GRUPO: opção"`, quando `variacoes` estiver no snapshot |
| Cor | não | `pedidos_modelos.padrao` | igual, condicionado a `cor` |
| NUM | não | `pedidos_modelos.gabarito_operacional` | igual, **rótulo "NUM" mantido**, condicionado a `num_gabarito` |
| Nº inicial/final | não | `numeracao_inicio` / `numeracao_fim` | igual, condicionado a `numeracao_faixa` |
| Impressão | não | `frente_verso` | igual, condicionado a `impressao_fv` |
| Tipo | não | `tipo_numeracao` | igual, condicionado a `tipo_numeracao` |
| Imagem | não | `arte_url` → amostra → prévia da cor | **igual** (a foto de `fotosProdutos` fica fora), condicionado a `imagem` |

O valor de cada campo **não muda de lugar**. O que muda é só quem decide
imprimir: hoje é `isEstoque`, passa a ser o snapshot do item.

---

## 3. Estrutura de dados

### 3.1 Catálogo: `public.produto_boletim_campos`

No molde de `produto_variacoes` — presença da linha significa "marcado".

```
id          bigint      identity, PK
id_produto  smallint    FK → produtos(id_produto) ON DELETE CASCADE
campo       text        CHECK (campo IN ('variacoes','cor','num_gabarito',
                                         'numeracao_faixa','impressao_fv',
                                         'tipo_numeracao','imagem'))
UNIQUE (id_produto, campo)
INDEX (id_produto)
```

Sem coluna de ordem: a ordem dos campos é do layout do card, não do cadastro.
Sem `is_obrigatorio`: os três obrigatórios não passam pelo checklist.

### 3.2 Snapshot: `public.produtos_proposta_boletim_campos`

Mesma forma, pendurada no item da proposta — molde de
`produtos_proposta_variacao`.

```
id                   bigint  identity, PK
id_produto_proposta  bigint  FK → produtos_proposta(id) ON DELETE CASCADE
campo                text    mesmo CHECK
UNIQUE (id_produto_proposta, campo)
INDEX (id_produto_proposta)
```

Para distinguir "item anterior à virada" de "item cujo produto não tem nenhum
campo opcional marcado" — dois estados com zero linhas aqui —, o item ganha uma
coluna própria:

```
alter table public.produtos_proposta
  add column boletim_campos_congelado_em timestamptz;
```

`NULL` = sem snapshot, imprime como hoje. Preenchida = snapshot válido, mesmo
que não haja nenhuma linha filha. **Não existe linha sentinela `__nenhum__`.**

O snapshot é **gravado uma vez, na criação do item, e nunca reescrito**: salvar
o orçamento de novo não o atualiza, mesmo que o cadastro do produto tenha
mudado. É aqui que ele se afasta do molde de `produtos_proposta_variacao`, que
apaga e reinsere a cada save — e é o que "congelado" exige.

### 3.3 RLS e ACL

Medido em 22/09/2026: **toda tabela de `public` nasce com `ALL` para
`authenticated` e `service_role`** — `GRANT` não tranca nada, só a RLS.
`anon` saiu dos default privileges em 01/09 (migration
`20260901161119_default_privileges_public_sem_anon`), e as tabelas criadas depois
confirmam: `feriados` e `conta_corrente_pendencias` têm
`{authenticated, postgres, service_role}`, sem `anon`.

As duas tabelas novas devem ficar assim, e a migration precisa **provar** por
asserção, não confiar:

```sql
-- ACL: nenhum grant para anon
do $$
declare v_grantees text[];
begin
  select array_agg(distinct pg_get_userbyid(a.grantee) order by pg_get_userbyid(a.grantee))
    into v_grantees
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
         aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relname = 'produto_boletim_campos';
  if 'anon' = any(v_grantees) then
    raise exception 'ACL: anon nao pode ter grant em produto_boletim_campos (%)', v_grantees;
  end if;
  if not (v_grantees @> array['authenticated','service_role']) then
    raise exception 'ACL: faltou authenticated/service_role (%)', v_grantees;
  end if;
end $$;
```

RLS: ligada nas duas, com política de leitura para `authenticated` e escrita
para `authenticated` — o mesmo alcance que `produto_variacoes` tem hoje
(política única `geral`, permissiva para todos os comandos). O gate real de quem
pode editar o cadastro continua sendo a tela e a permissão do perfil, como já é
para produtos.

---

## 4. Carga inicial — nada muda no dia da virada

Só o **catálogo** recebe carga. O snapshot não: item anterior à virada fica sem
snapshot e imprime como hoje, por definição.

| Grupo | Campos marcados na carga | Produtos em 22/09 |
|---|---|---|
| `produtos.is_estoque = true` | `cor`, `imagem` | 19 |
| demais | `cor`, `num_gabarito`, `numeracao_faixa`, `impressao_fv`, `tipo_numeracao`, `imagem` | 76 |
| tem vínculo em `produto_variacoes` | mais `variacoes` | 27 (nenhum de prateleira) |

**`variacoes` entra marcado** em todo produto que já tem variação cadastrada.
Isso muda o boletim dos **pedidos novos** desses produtos — que é a intenção. Os
pedidos antigos não mudam, porque o item deles não tem snapshot e cai no
comportamento de hoje.

A carga roda na mesma migration da tabela, sobre **todos os 95 produtos**
(ativos ou não — a asserção exige que nenhum fique sem checklist), e é
idempotente (`on conflict do nothing`).

### 4.1 Produto criado depois da virada

Trigger `AFTER INSERT ON produtos` na mesma migration: conjunto curto se
`is_estoque`, completo nos demais. **Só `AFTER INSERT`** — produto que vira
prateleira depois mantém o checklist como estava.

O campo `variacoes` fica de fora desse seed, e não por escolha: o vínculo em
`produto_variacoes` é gravado **depois** do insert do produto, em outra
requisição (`produto-variacoes.service.ts:702`), então no instante do trigger o
produto ainda não tem variação nenhuma. Quem fecha esse buraco é a tela, não o
banco — decisão 7, seção 12.

---

## 5. Leitura no boletim

1. `montarOsPdfViewModel` passa a carregar, junto dos itens, as linhas de
   `produtos_proposta_boletim_campos` do item (uma consulta, `in` nos ids dos
   itens do pedido) e as de `produtos_proposta_variacao` quando `variacoes`
   estiver marcado.
2. `OsPdfProduto` ganha `camposBoletim: string[] | null` — `null` = sem
   snapshot, e aí vale o comportamento de hoje (curto se `isEstoque`, completo
   caso contrário).
3. `ModeloCard` deixa de perguntar `isEstoque` e passa a perguntar pelo
   conjunto. `isEstoque` continua existindo para a **imagem** (prévia da cor) e
   para o checklist IMP/ACA/CON, que não entram nesta reforma.
4. As variações entram como linhas próprias abaixo dos pares de campos, uma por
   variação, `"GRUPO: opção"`, vindas do snapshot do item — não de
   `variacoes_texto`, que é do lote e pode ter sido editado no PCP.

O documento multi-setor (maço) usa o mesmo componente e acompanha sem alteração
própria.

---

## 6. Formulário do PCP

Campo não marcado **some do formulário do lote**, e o lote **não herda padrão**
— nada de `SEQUENCIAL` nem de faixa recalculada.

| Ponto | Arquivo | O que muda |
|---|---|---|
| Grade "Lista rápida" | `src/features/orcamentos/components/LotesGrid.tsx` | colunas condicionadas ao snapshot do item; `padroes` deixa de preencher campo escondido (`:157-162`) |
| Cards do lote | `src/features/orcamentos/components/PedidoModelosTab.tsx` | mesmos campos escondidos |
| Boletim (tela) | `src/features/pedidos/BoletimFormPage.tsx` | bloco de faixa numérica só aparece com `numeracao_faixa` |
| Gravação em massa | `src/app/api/pedidos/lotes-em-massa/route.ts:244-246, 281-283` | campo escondido grava `null`, e não o default `"SEM_NUMERACAO"` / faixa |
| Recalculo do nº final | `src/features/orcamentos/services/lotes-numeracao.ts` | só roda quando `numeracao_faixa` está marcado |

A grade é renderizada por item, então dois produtos com checklists diferentes no
mesmo pedido não conflitam.

---

## 7. Trava de quantidade na liberação

**Por que a validação de hoje não barrou o 22194:** o "✓ Distribuição de lotes
válida" (`BoletimFormPage.tsx:3040-3047`) é rótulo de tela que só reage a
`isOverLimit`, isto é, soma **maior** que o total; soma menor — 8 de 1.250 — lê
como válida, e nada revalida na liberação.

A trava entra em `liberarPropostaParaProducao`
(`orcamentos.service.ts:4767`), como validação 4, depois das artes e antes do
UPDATE que liga `is_prd_aprovado` e `libera_nf`:

> Para cada item de `produtos_proposta` do pedido, `sum(pedidos_modelos.quantidade
> where id_produto_proposta_origem = item.id)` precisa ser igual a `item.qtd`.
> Item sem lote soma zero e reprova. Vale inclusive para prateleira.

A mensagem nomeia os itens divergentes, com pedido × distribuído, para o
operador saber o que corrigir. Vale **inclusive para produto de prateleira**.

**Divergência de documentação, a corrigir junto com esta etapa:** o briefing diz
que a entrada na produção é sempre manual, mas o código tem liberação
**automática** de prateleira — `/api/cobrancas/confirmar` chama
`liberarPropostaParaProducao` quando a proposta é 100% de prateleira. Como as
duas entradas passam pela mesma função, a trava vale para as duas, e o doc é
acertado nesta etapa.

Dois caminhos ficam de fora e precisam de decisão: a liberação **automática** de
prateleira chama a mesma função (Decisão 3), e `criar_pedido_complementar` copia
`is_prd_aprovado` do pedido principal dentro do banco, sem passar por ela
(Decisão 4).

---

## 8. Tela do cadastro de produto

**APLICADA em 22/09/2026.** `src/features/produtos/ProdutoFormPage.tsx` ganhou a
seção "Campos do boletim", irmã da de variações e logo abaixo dela:

- caixa fixa "Sempre impressos" com os três obrigatórios (nome do produto,
  quantidade, nome do modelo) — mostrados, não editáveis, fora do checklist;
- sete caixas de marcação, uma por campo opcional ("Variações", "Cor", "NUM",
  "Número inicial e final", "Impressão", "Tipo", "Imagem do modelo"), cada uma
  com uma linha explicando o que sai impresso;
- gravação no mesmo Salvar do produto, pela sessão do usuário
  (`getSupabaseClient`), logo antes de `saveProdutoVariacoes` — nenhum caminho
  de servidor, nenhum service_role;
- releitura logo depois de gravar: o produto **novo** passa a mostrar o
  checklist que o trigger semeou sem precisar recarregar a página.

O serviço novo é
`src/features/produtos/services/produto-boletim-campos.service.ts`. Ele grava por
**diferença** — apaga só o que saiu, insere só o que entrou —, e não pelo
apaga-tudo-e-reinsere das variações: salvar o produto sem mexer no checklist não
gera escrita nenhuma na tabela.

Validado em localhost com a sessão de um usuário real (produto 9001, inativo e
sem pedidos): desmarcar NUM → salvar → a linha some do banco → remarcar →
salvar → `SELECT` idêntico ao do começo.

---

## 9. Quem mais consome os mesmos campos

| Consumidor | Campos | Impacto |
|---|---|---|
| Grade de lotes e aba Pedido | todos | esconder campo não marcado (etapa 6) |
| Rota `lotes-em-massa` | `tipo_numeracao`, faixa, `gabarito_operacional`, `variacoes_texto` | parar de aplicar default em campo escondido |
| `numeracao-modelo-utils`, `lotes-numeracao` | faixa | só rodar com `numeracao_faixa` |
| Maestro (`core/knowledge/erp-relationships.ts`) | `tipo_numeracao`, faixa | texto de conhecimento; revisar a descrição |
| Boletim / maço | todos | etapa 5 |

**Etiquetas, Expedição, n8n e relatórios não leem `pedidos_modelos`** — leem
`propostas` e `expedicoes`. Ficam fora.

---

## 10. Etapas

Cada etapa é publicável sozinha e não muda o que sai impresso até a etapa 5.

| # | Etapa | Visível? |
|---|---|---|
| 1 | Migration: `produto_boletim_campos` + RLS + ACL + carga inicial ✅ | não |
| 2 | Tela do cadastro de produto marca o checklist ✅ | não (só cadastro) |
| 3 | Migration: `produtos_proposta_boletim_campos` + RLS + ACL ✅ | não |
| 4 | `saveProposta` grava o snapshot do checklist ao criar o item ✅ | não |
| 5 | Boletim lê o snapshot; sem snapshot, imprime como hoje ✅ | **sim** |
| 6 | Formulário do PCP esconde campo não marcado e para de herdar padrão ✅ | **sim** |
| 7 | Trava de quantidade na liberação para produção (+ correção do doc) | **sim** |
| 8 | Pedido complementar: fechar o desvio de `is_prd_aprovado` | **sim** |

### Migrations (descritas, não escritas)

**Etapa 1 — `produto_boletim_campos`**
- *Cabeçalho:* por que existe (o boletim deixa de ser fixo), o que decide
  (quais campos opcionais o produto imprime), o que **não** decide (setor,
  campos obrigatórios, IMP/ACA/CON).
- *Conteúdo:* tabela, CHECK do domínio, UNIQUE, índice, `alter table ... enable
  row level security`, políticas, carga inicial idempotente.
- *Asserções:* domínio rejeita valor fora da lista; `anon` sem grant
  (`array_agg(grantee)`); RLS ligada; contagem da carga bate com
  `produtos ativos` (curto para `is_estoque`, completo para os demais); nenhum
  produto recebeu `variacoes`.
- *Rollback:* `drop table public.produto_boletim_campos;` — nada mais depende
  dela nesta etapa.

**Etapa 3 — `produtos_proposta_boletim_campos`**
- *Cabeçalho:* o snapshot que congela o checklist no item, e por que o boletim
  nunca lê o cadastro vivo.
- *Conteúdo:* tabela, FK com `ON DELETE CASCADE`, UNIQUE, índice, RLS,
  políticas.
- *Asserções:* mesmas de ACL e RLS; FK apaga em cascata ao remover o item;
  tabela **vazia** ao final (nenhum backfill, por decisão).
- *Rollback:* `drop table public.produtos_proposta_boletim_campos;`.

**Etapa 8 — pedido complementar.** `criar_pedido_complementar` copia
`is_prd_aprovado` do pedido principal dentro do banco, sem passar pela função de
liberação, então um complementar pode nascer liberado sem a trava da Etapa 7 ter
olhado os lotes dele. A etapa fecha esse desvio; por mexer em função do banco,
ela exige autorização própria e migration própria, descrita quando chegar a vez.

Fora isso, nenhuma outra etapa toca o banco. A trava de quantidade é código de
servidor, na função que já existe.

---

## 11. Riscos

1. **Produto usado em dois setores.** O checklist é por produto, e a Credencial
   PVC (901) roda em PVC com dois lotes de gabarito igual. Como a decisão é por
   produto, um produto que precise de campos diferentes por setor ficará com a
   união dos campos. Aceito pela decisão do dono.
2. **`variacoes_texto` continua existindo** no lote e seguirá sendo mostrado na
   aba Pedido. O boletim passa a ler o snapshot do item — as duas fontes podem
   divergir se alguém editar o texto no PCP. Não é regressão: hoje o boletim não
   mostra nenhuma das duas.
3. **Gabaritos com nome contraditório.** O 22270 tem
   `gabarito_operacional = "90x140 - Frente e Verso"` com `frente_verso = false`.
   O checklist não resolve isso: são dois campos independentes, e o nome do
   gabarito é dado de cadastro. Continua como está.

---

## 12. Decisões do dono (22/09/2026)

1. **Variações na carga inicial:** marcadas em todo produto que já tem variação
   em `produto_variacoes` (27 produtos). Pedido antigo segue imprimindo como
   hoje, pelo fallback de item sem snapshot.
2. **Snapshot gravado uma vez**, na criação do item, e nunca reescrito. A
   distinção "sem snapshot" usa a coluna `produtos_proposta.boletim_campos_congelado_em`,
   não a linha sentinela.
3. **A trava de quantidade vale também para produto de prateleira.**
4. **Pedido complementar** entra como Etapa 8, depois da 7.
5. **Produto novo** nasce com a mesma regra da carga: curto se for prateleira,
   completo nos demais, mais `variacoes` se tiver variação cadastrada.
6. **Produto que vira prateleira depois** mantém o checklist como estava.

7. **`variacoes` no produto novo — opção (a), decidida em 22/09.** Quando um
   produto passa de **zero para uma** variação vinculada, a própria tela do
   cadastro já mostra "Variações" marcado no checklist, **visível e desmarcável
   antes de salvar**. Não há trigger no banco para isso. Se o produto **já
   tinha** variação e o usuário desmarcou "Variações", vincular outra **não**
   remarca.

   O que isso implica, de propósito: um vínculo criado por script ou por outra
   tela não marca nada — a regra mora na tela, e produto antigo que ganhe
   variação por fora segue com o checklist que você ajustou à mão.

   Na implementação (Etapa 2) isso é um sinalizador de "o usuário mexeu"
   (`boletimCamposTocado`): o primeiro clique em qualquer caixa congela a
   sugestão automática. Vincular a primeira variação sugere; a decisão do
   usuário manda.

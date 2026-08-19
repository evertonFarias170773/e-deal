# Parte C — Etapa 2: aplicar a recotação e gravar o frete na proposta

**Goal:** o expedidor escolhe uma opção da recotação e o sistema grava o frete novo na proposta, com trilha completa. **Sem Conta Corrente** — a diferença não vira dinheiro na conta do cliente. Isso é Etapa 3 em diante.

**Estado de entrada:** Etapa 0 aplicada (`2da336e`), Etapa 1 no ar e validada na tela (`19bb900`), CIF padrão desde 19/08/2026.

**Doc do módulo:** `docs/business/EXPEDICAO.md`, seções 5.1 e 5.2.

---

## 1. Decisões que não se reabrem

- nada entra por `cotacao_frete` — `trg_recalc_after_frete` e `trg_frete_sync_financeiro` reescrevem `propostas.valor_total` e `status_interno` e tirariam o pedido do funil logístico (seção 2 do EXPEDICAO.md);
- gravar `valor_frete` **não** atualiza `valor_total`: são escritas explícitas e separadas;
- ledger em tabela nova, não coluna em `expedicoes` — a recotação pode acontecer mais de uma vez;
- idempotência por **chave única no banco**, nunca por estado de tela;
- nesta etapa, **apenas `diferenca <= 0`**. Encarecer é Etapa 4, junto com a alçada;
- gates: sem pagamento confirmado, bloqueia; com NF-e autorizada, só o que barateia.

---

## 2. A premissa central: invariância do delta

A primeira versão deste plano escrevia `valor_total = cc__total_soberano_proposta(...)`, protegida por um gate de coerência absoluta. **Os dois saíram.**

**Por quê.** `cc__total_soberano_proposta` não conhece o desconto de tabela especial: ela soma `produtos_proposta.valor_sub_total` — que o trigger `trg_calcular_valor_sub_total` força a ser o **bruto** — e só desconta linhas de `desconto_proposta` com `tipo_desconto = 'DESCONTO_GERAL'`. O bônus do cliente (`clientes.is_bonus` + `percentual_bunus`) não é lido em ponto nenhum da função. Detalhe completo em `docs/business/CONTA-CORRENTE-CREDITO.md` §4.2.

Medido em 19/08/2026, nos status vivos: 6.610 propostas, 121 com `valor_total` nulo, 6.461 batendo, **28 divergindo de verdade (0,42%)** — **21 delas por tabela especial**. Entre clientes com bônus: 174 propostas, **47 divergem acima da tolerância de R$ 0,02 e 13 estão pagas**. Um gate de coerência absoluta barraria todas, inclusive os únicos pedidos disponíveis para teste.

**O que entra no lugar.** A Etapa 2 escreve:

```
valor_total = valor_total_atual + diferenca
```

Legítimo porque **as três fórmulas em uso são lineares no frete, com coeficiente 1**, e o frete não interage com desconto nenhum:

| Fórmula | Expressão | Coeficiente do frete |
|---|---|---|
| `cc__total_soberano_proposta`, não-avulsa | `subtotal + frete − desconto(subtotal)` | 1 |
| `cc__total_soberano_proposta`, avulsa | `valor + frete` | 1 |
| App (`calculateResumo`) | `subtotalProdutos − descontoGeral + frete` | 1 |

O bônus incide sobre itens, nunca sobre frete. Mover o total pelo delta é a única operação sobre a qual as fórmulas concordam sem exceção.

**Consequência de desenho:** a Etapa 2 não cria fórmula nova, não escolhe entre as existentes, e **não conserta nem piora** a divergência. Ela a deixa como está — e a registra.

---

## 3. A tabela do ledger

`public.expedicao_recotacoes`, aditiva. Nada em `expedicoes`, nada em `cotacao_frete`.

```sql
create table public.expedicao_recotacoes (
  id                   bigint generated always as identity primary key,
  id_int               integer     not null references public.propostas(id_int),
  chave                uuid        not null,
  aplicado_em          timestamptz not null default now(),

  autor_uid            uuid,
  autor_nome           text,
  autor_email          text,

  frete_anterior       numeric(12,2) not null,
  frete_novo           numeric(12,2) not null,
  diferenca            numeric(12,2) not null,

  -- o total como a proposta o carrega (fonte da escrita)
  total_anterior       numeric(12,2) not null,
  total_novo           numeric(12,2) not null,

  -- o total como a formula soberana o calcula, NO INSTANTE da aplicacao.
  -- Nao alimenta escrita nenhuma: existe para a divergencia entre as duas
  -- formulas ficar visivel e datada em vez de silenciosa.
  total_soberano_no_ato numeric(12,2),
  divergencia_total     numeric(12,2),

  transportadora       text        not null,
  servico              text        not null,
  prazo                text,
  peso_gramas          integer     not null,
  peso_origem          text,
  subtotal_itens       numeric(12,2) not null,
  id_endereco_entrega  uuid        references public.enderecos(id),
  cep                  text,

  modalidade           text        not null,
  status_interno       text        not null,
  tinha_nfe_autorizada boolean     not null,
  valor_pago           numeric(12,2) not null,
  ja_despachado        boolean     not null,
  codigo_rastreamento  text,

  opcoes_cotadas       jsonb,
  observacao           text,

  constraint exp_recot_chave_uk        unique (chave),
  constraint exp_recot_dif_coerente_ck check (diferenca = frete_novo - frete_anterior),
  constraint exp_recot_dif_etapa2_ck   check (diferenca <= 0),
  constraint exp_recot_total_ck        check (total_novo = total_anterior + diferenca),
  constraint exp_recot_modalidade_ck   check (modalidade = 'CIF'),
  constraint exp_recot_valores_ck      check (frete_anterior >= 0 and frete_novo >= 0 and peso_gramas > 0)
);
```

`exp_recot_total_ck` **é a invariância do delta escrita como restrição de banco**: o total só anda pelo delta do frete.

`exp_recot_dif_etapa2_ck` congela a restrição da etapa no schema — impossível encarecer, mesmo por bug ou chamada direta. A Etapa 4 remove esse CHECK por migration explícita, o que é preferível a uma regra que vive só no TypeScript.

`opcoes_cotadas` guarda a lista inteira devolvida pela cotação, não só a escolhida: é o que permite responder depois "por que ele escolheu essa" sem recotar um passado que já não existe.

### Índices

```sql
create index expedicao_recotacoes_id_int_idx      on public.expedicao_recotacoes (id_int, aplicado_em desc);
create index expedicao_recotacoes_aplicado_em_idx on public.expedicao_recotacoes (aplicado_em desc);
```

O primeiro serve o histórico por pedido; o segundo, o relatório do período.

### RLS

Molde de `expedicoes` em SELECT/INSERT, e nada além disso:

```sql
alter table public.expedicao_recotacoes enable row level security;

create policy expedicao_recotacoes_select_authenticated
  on public.expedicao_recotacoes for select to authenticated using (true);

create policy expedicao_recotacoes_insert_authenticated
  on public.expedicao_recotacoes for insert to authenticated with check (id_int is not null);

-- sem UPDATE e sem DELETE: append-only
```

O molde real de `expedicoes` é permissivo (`select using (true)`; `insert`/`update` exigindo só `id_int is not null`). Seguimos igual onde faz sentido e **mais estrito** onde não faz — um livro-razão não se edita.

---

## 4. A escrita: uma RPC, três escritas, uma transação

O PostgREST não dá transação multi-statement. Três chamadas soltas deixariam janelas em que o processo morre com **frete novo e total velho** — a incoerência que a etapa existe para evitar.

**`exp_aplicar_recotacao(...)`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`**, no molde das `cc__*`. A cotação (I/O de rede) fica **fora**: a rota cota, valida e passa números apurados.

```
BEGIN
  PERFORM cc__assert_permissao(auth.uid(), 'expedicao.processar');

  SELECT * INTO v_prop FROM propostas WHERE id_int = p_id_int FOR UPDATE;

  -- guarda otimista, sob trava de linha
  IF v_prop.valor_frete IS DISTINCT FROM p_frete_anterior THEN RAISE 'EXP_RECOT_CONCORRENCIA' END IF;
  IF v_prop.valor_total IS DISTINCT FROM p_total_anterior THEN RAISE 'EXP_RECOT_CONCORRENCIA' END IF;

  -- gates que dependem de dado, nao de rede (revalidados no banco)
  IF coalesce(v_prop.is_avulso,false)     THEN RAISE 'EXP_RECOT_AVULSA'   END IF;
  IF v_prop.status_interno <> 'EXPEDICAO' THEN RAISE 'EXP_RECOT_STATUS'   END IF;
  IF cc__valor_pago(p_id_int) <= 0        THEN RAISE 'EXP_RECOT_NAO_PAGA' END IF;

  v_soberano_antes := cc__total_soberano_proposta(p_id_int);   -- so para registro

  UPDATE propostas SET valor_frete = p_frete_novo                WHERE id_int = p_id_int;  -- 1
  UPDATE propostas SET valor_total = p_total_anterior + p_diferenca WHERE id_int = p_id_int;  -- 2

  -- ASSERCAO DE LINEARIDADE — protege a premissa da secao 2
  v_soberano_depois := cc__total_soberano_proposta(p_id_int);
  IF abs((v_soberano_depois - v_soberano_antes) - p_diferenca) > 0.01 THEN
    RAISE 'EXP_RECOT_NAO_LINEAR: a formula soberana deixou de ser linear no frete';
  END IF;

  INSERT INTO expedicao_recotacoes (…, total_soberano_no_ato, divergencia_total, …)
  VALUES (…, v_soberano_antes, p_total_anterior - v_soberano_antes, …);                    -- 3

  RETURN v_id_ledger;
END
```

Quatro pontos do desenho:

- **`FOR UPDATE` + comparação de valor.** A trava resolve concorrência; a comparação resolve tela velha. São problemas diferentes e ambos existem.
- **Duas escritas explícitas em `propostas`** — nada recalcula `valor_total` a partir de `valor_frete`. A única trigger que faria isso é `tg_propostas_valor_total_avulsa`, barrada pelo gate de avulsa.
- **A asserção de linearidade roda dentro da transação.** Se a fórmula soberana mudar e deixar de ser linear no frete, a aplicação **aborta** em vez de gravar total errado em silêncio. É a proteção real; o teste da seção 8 é a documentação executável dela.
- **O INSERT por último**, gravando `total_soberano_no_ato` medido **antes** das escritas — o retrato da divergência no momento da decisão. Violação de `unique(chave)` aqui aborta tudo, e a rota traduz o `23505` em resposta idempotente.

---

## 5. A rota — `POST /api/expedicao/recotacao/aplicar`

**Entrada**

```
{ id_int, chave (uuid), opcao_id, valor_visto, id_endereco_entrega? }
```

A rota **não confia no valor enviado**: recota no servidor pelo caminho da Etapa 1 e localiza a opção por `opcao_id`. `valor_visto` só serve para comparar — divergência acima de R$ 0,01 recusa com 409 mostrando os dois números. Frete é preço volátil; aplicar o que estava na tela há dez minutos seria gravar um número que já não existe.

### Ordem exata de validação

1. Corpo válido; `chave` é UUID; `id_int` inteiro positivo.
2. **Auth dual** — `Bearer` quando houver, senão cookie (molde da Etapa 1).
3. **Permissão `expedicao.processar`** → 403. Nada aqui toca Conta Corrente; a Etapa 3 precisará de outra.
4. **Idempotência, antes de qualquer gate de negócio.** `select … where chave = ?`; existindo, **200 idempotente** com o registro. Mesma ordem de `usar-credito/route.ts:194-226`, pelo mesmo motivo: a operação já aconteceu e o estado atual pode reprovar num gate que ela mesma mudou.
5. Carrega proposta, `expedicoes` e itens em paralelo. 404 se não achar.
6. **`is_avulso = true` → 409.**
7. **`status_interno <> 'EXPEDICAO'` → 409.**
8. **Modalidade efetiva (`expedicoes` > `propostas`) `<> 'CIF'` → 409.**
9. **Sem pagamento confirmado → 409.** Critério: `cc__valor_pago(id_int) > 0` — a definição oficial do sistema (`PAID`, ou `A_VENCER` com `confirmado = true`, nunca `CANCELADO`).
10. **Gate de despacho** — seção 6.
11. **Recota no servidor** e localiza `opcao_id`. Opção ausente na cotação de agora → 409.
12. **`abs(valor_cotado − valor_visto) > 0,01` → 409**, com os dois valores.
13. **`diferenca = valor_cotado − valor_frete` > 0 → 409.**
14. **NF-e**: havendo nota `AUTORIZADA` em `notas_fiscais`, exigir `diferenca < 0`.
15. Chama a RPC.

**Não há gate de coerência de total.** A divergência é registrada, não julgada.

### Se a escrita falhar no meio

**Não existe meio.** A transação aborta e a proposta fica byte a byte como estava.

| Falha | Estado | Resposta |
|---|---|---|
| Cotação não responde | nada escrito | 502 |
| Rota morre entre cotar e chamar a RPC | nada escrito | tela mantém a lista; aplicar de novo |
| RPC levanta num gate | abortada | 409 com o motivo |
| Rede cai depois do commit | **escrito** | repetir com a mesma chave → 200 idempotente |
| Duas chamadas, mesma chave | uma commita | a outra bate em `unique(chave)` → 200 idempotente |
| Duas chamadas, chaves diferentes | uma commita | a outra falha em `valor_frete <> p_frete_anterior` → 409 |

A última linha é o que faz a idempotência não ser a única proteção.

---

## 6. Gate de despacho

**O que o código faz hoje: deixa recotar pedido já despachado.** `propostas.status_interno` **não muda no despacho** — ele vive só em `expedicoes` (`data_despacho`, `codigo_rastreamento`, `correios_*`). O gate da Etapa 1 (`status_interno === 'EXPEDICAO'`) é cego para isso por construção. E não é hipótese: o **20916** é CIF, `EXPEDICAO`, despachado em 19/08 15:00, com rastreio `AD816558575BR` e prepostagem emitida.

| `data_despacho` | rastreio / prepostagem | Etapa 2 |
|---|---|---|
| nulo | — | **permite** |
| preenchido | ambos nulos | **permite com aviso âmbar** |
| preenchido | qualquer um preenchido | **bloqueia**, 409 |
| `data_entrega` preenchido | — | **bloqueia**, 409 |

Depois do despacho com etiqueta emitida o frete **foi contratado** — recotar oferece transportadoras que não vão levar nada, e nos Correios a prepostagem já consumiu o cartão da empresa. Sem nada emitido, o "despacho" foi só a marcação da etapa, e desfazer é trivial.

`ja_despachado` e `codigo_rastreamento` vão para o ledger de qualquer forma.

---

## 7. Autoria e trilha — três camadas

1. **`audit.logs_v2`, automático.** `trg_audit_propostas` grava os dois UPDATEs com `changed_fields`, `actor_uid`, `actor_email` e `txid`. Verificado em produção. `record_pk` é `{"id": <uuid>}` — a PK da tabela, não o `id_int`.
2. **O ledger**, com autoria e todo o contexto da decisão, inclusive os dois totais. É o único lugar onde a *razão* fica registrada.
3. **`propostas_chat`**, uma linha na timeline (`autor_uid`, `autor_nome`, `autor_email`, `setor`), no padrão de Cobranças e Produção. O texto nomeia o frete velho, o novo, a diferença, o total antes e depois, e diz que **a diferença ainda não foi lançada na conta do cliente**. Best-effort e fora da transação: falhar ali não desfaz nada, só emite `console.warn` — mesmo tratamento de `pagamentos-v2.service.ts:551-572`.

---

## 8. UI

Cada linha do painel da Etapa 1 ganha um botão:

| Opção | Botão |
|---|---|
| `diferenca < 0` | **Aplicar** — ativo |
| `diferenca = 0`, sem NF-e autorizada | **Aplicar** — ativo (trocar transportadora sem mexer no preço é legítimo) |
| `diferenca = 0`, com NF-e autorizada | desativado — "com NF-e autorizada, só o que barateia" |
| `diferenca > 0` | desativado — "encarece: precisa da alçada (Etapa 4)" |

Opções que encarecem continuam visíveis: informam a decisão, e escondê-las faria o expedidor achar que a cotação falhou.

**A chave**: uma `crypto.randomUUID()` **por opção, gerada quando o resultado chega** — não no clique. Clicar duas vezes manda a mesma chave e o banco recusa a segunda.

**Depois de aplicar**, o painel vira resumo:

```
Frete atualizado
SEDEX · Correios SEDEX · 1 dia útil
R$ 23,40  →  R$ 20,12        (−R$ 3,28)
Total do pedido: R$ 118,83  →  R$ 115,55

A diferença de R$ 3,28 ainda NÃO foi lançada na conta do cliente.
Registrado na timeline do pedido.
```

O rodapé muda de "nada foi gravado" para dizer o que **foi** e o que **não foi** — a segunda metade importa mais, porque evita o expedidor supor que o cliente já ganhou o crédito. O botão **Recotar frete** volta a ficar disponível (contra o frete novo), o modal **não fecha**, e o despacho segue seu curso.

---

## 9. Verificação

- [ ] Migration conferida por SELECT: colunas, os cinco CHECKs, `unique(chave)`, os dois índices, RLS com exatamente duas políticas, RPC com `prosecdef` e `proconfig`.
- [ ] `npx tsc --noEmit`, `npm run build`, ESLint contra o baseline do HEAD.
- [ ] **Aplicação real** num pedido CIF em `EXPEDICAO`: `valor_frete` e `valor_total` mudam **exatamente** pelo delta; uma linha no ledger; `cotacao_frete` (count, `max(created_at)`), `expedicoes` (`updated_at`) e `conta_corrente_pendencias` (count) **inalterados** — prova de que a Etapa 3 não vazou.
- [ ] **Repetição com a mesma chave**: 200 com `idempotente: true`, uma linha no ledger, e **`propostas.updated_at` inalterado** entre a primeira e a segunda chamada. É o que distingue idempotência real de "regravou o mesmo valor".
- [ ] **Chave nova sobre frete já alterado** → 409 de concorrência, ledger com uma linha.
- [ ] **Duas chamadas simultâneas com a mesma chave** → uma 200, uma idempotente, uma linha.
- [ ] Cada gate exercitado uma vez: sem pagamento; NF-e autorizada com empate; opção que encarece; despachado com rastreio; avulsa.
- [ ] **Divergência registrada**: numa proposta de cliente com tabela especial, conferir `total_soberano_no_ato` e `divergencia_total` — e que `valor_total` andou **só** pelo delta.
- [ ] Suítes existentes verdes.

### `scripts/testes/recotacao-aplicar.test.mts` — a asserção de linearidade

No molde de `modalidade-despacho.test.mts`: réplicas em TS das duas fórmulas (soberana e do app), submetidas a uma matriz de casos — sem desconto, desconto percentual, desconto nominal, avulsa, cliente com bônus, item cancelado — afirmando em cada uma que

```
soberana(frete + Δ) − soberana(frete) === Δ === app(frete + Δ) − app(frete)
```

O teste documenta e dá retorno rápido; **quem realmente protege é a asserção dentro da RPC** (seção 4), porque uma réplica em TS pode divergir do SQL sem ninguém notar. A rota leva comentário apontando para a linha de `cc__total_soberano_proposta` de onde a linearidade vem, para quem editar a função encontrar a dependência.

### Bloqueio prático conhecido

O único pedido CIF em `EXPEDICAO` em 19/08/2026 é o **20916**, que **reprova no gate de despacho** (rastreio emitido). O caminho feliz precisa de um pedido CIF novo chegando à Expedição sem despacho. Não muda o desenho — o 20916 reprovar é a prova de que o gate funciona.

---

## 10. Arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/<data>_expedicao_recotacoes.sql` | novo — tabela, CHECKs, índices, RLS, RPC, com cabeçalho o-quê/por-quê/rollback no molde da Etapa 0 |
| `src/app/api/expedicao/recotacao/aplicar/route.ts` | novo |
| `src/features/expedicao/services/recotacao.client.ts` | `aplicarRecotacao()` |
| `src/features/expedicao/components/DespacharModal.tsx` | botões, chaves por opção, painel de resultado |
| `scripts/testes/recotacao-aplicar.test.mts` | novo |
| `docs/business/EXPEDICAO.md` | §5.1 e item 6 da §10 |

Rollback: `DROP TABLE` + `DROP FUNCTION`, limpo **antes** da primeira aplicação. Depois disso, derrubar a tabela apaga a única trilha de por que os fretes mudaram — o cabeçalho da migration diz isso com todas as letras.

---

## 11. Fora desta etapa

Etapa 3+: a diferença virar crédito via `cc_abrir_pendencia` com motivo `FRETE`, a permissão própria, o caso devedor, a alçada de R$ 150 sobre o frete novo e a aprovação do Financeiro. O ledger guarda `diferenca` e nada mais; é dele que a Etapa 3 parte.

**Dependência registrada, não bloqueante:** a persistência do desconto de tabela especial (`docs/business/CONTA-CORRENTE-CREDITO.md` §4.2). Enquanto não existir, `cc_abrir_pendencia` recusa proposta de cliente com bônus — o que **a Etapa 3 vai encontrar de frente**, e a Etapa 2 contorna por não depender da fórmula soberana para escrever.

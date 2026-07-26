# Matriz de Permissões de Escrita — Maestro V2 (Trilha B)

> **STATUS: NORMATIVO, NADA LIBERADO.**
> Este documento define as regras de escrita do Maestro **antes** de qualquer
> implementação. Nesta etapa **nenhuma operação de escrita está habilitada** no
> agent loop: o catálogo permanece 100% somente leitura, não existe a flag
> `MAESTRO_AGENT_WRITE_ENABLED` e nenhuma tool de escrita foi registrada.
> Toda implementação futura DEVE se conformar a esta matriz; divergência entre
> código e matriz é bug do código.
>
> Documento relacionado: `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
> (matriz geral de escrita do ERP). Esta matriz é o recorte específico do
> Maestro e é sempre MAIS restritiva, nunca menos.

Aprovado por: Everton Farias — 26/07/2026 (definição da etapa 1 da Trilha B).

---

## 1. Princípios inegociáveis

1. **Deny-by-default.** Ação que não consta nesta matriz é PROIBIDA. Não existe
   "ação parecida": cada tool de escrita futura corresponde a exatamente uma
   linha da matriz, com o mesmo nome.
2. **O frontend nunca autoriza nada.** Toda autorização acontece no servidor,
   em três camadas independentes, todas obrigatórias:
   - RLS do usuário (client com token do usuário; nunca service_role);
   - permissão de perfil via `verificarPermissaoServerSide` (strings oficiais
     de `public.perfis.permissoes`); falha na checagem = NEGADO;
   - pré-condições da ação re-verificadas no servidor NO MOMENTO da execução
     (nunca no momento da proposta — o alvo pode ter mudado).
3. **Fluxo oficial obrigatório.** Se a operação já possui RPC ou rota de API no
   ERP, o Maestro DEVE usá-la. INSERT/UPDATE direto em tabela por tool do
   Maestro é proibido quando existe fluxo oficial — sem exceções.
4. **Propor → confirmar → executar.** Nenhuma escrita em turno único:
   - o Maestro propõe a ação com o resumo EXATO do que será gravado
     (cliente, valores, itens, efeitos);
   - o usuário confirma explicitamente no turno seguinte;
   - a execução re-verifica permissão + pré-condições e só então grava.
   Regras de validade da proposta de ação (seção 4).
5. **Auditoria obrigatória.** Toda execução (sucesso, rejeição ou erro) grava
   em `public.maestro_acoes`: autor (`auth.uid()`), data, ação, `id_cliente`,
   `id_int` afetado, resultado e payload resumido NÃO sensível — além do
   histórico que o próprio fluxo oficial já mantém. Sem registro de auditoria,
   a ação é considerada falha.
6. **Imutáveis absolutos** (valem para TODOS os perfis, inclusive super admin,
   quando a operação parte do Maestro):
   - **proposta paga não é editável** — inclusive proposta avulsa paga; o
     Maestro nunca usa `/api/orcamentos/editar-paga`, `abonar-diferenca`,
     `resolver-diferenca` ou `consolidar-total-paga`;
   - dados financeiros (cobranças, recebíveis, crédito) e fiscais (NF-e/NFS-e)
     são SOMENTE LEITURA via Maestro nesta fase;
   - tabelas `producao_*` (frente Produção/OS) permanecem intocadas.
7. **Nesta etapa** (e até nova revisão desta matriz): **nenhum UPDATE, DELETE,
   DDL ou ampliação de RLS** será feito por conta da Trilha B. As ações abaixo
   marcadas como "planejadas" só saem do papel em etapa futura, com
   autorização explícita, uma a uma.

---

## 2. Matriz por ação

### 2.1 Fase B1 — primeira candidata (PLANEJADA, NÃO LIBERADA)

#### `salvar_cotacao_como_proposta`

| Dimensão | Regra |
|---|---|
| Quem pode executar | Perfis com `propostas.create` (hoje: Vendedor, Administrador; super admin). |
| Em quais registros | Cria UMA proposta NOVA para o **cliente ativo resolvido pelo servidor** na conversa. Nunca altera proposta existente; nunca cria para cliente não resolvido/apenas citado. |
| Pré-condições obrigatórias (re-verificadas na execução) | (a) cliente ativo resolvido na sessão (`resolvedClientIds`); (b) cotação simulada NA CONVERSA com todos os itens `status='sucesso'` (produto ativo do catálogo, preço completo); (c) frete definido (calculado ou "retira no balcão" explícito); (d) valores 100% calculados no servidor — o modelo nunca fornece número; (e) cliente com `restricao=true` ou limite estourado → a proposta de ação DEVE exibir o alerta e a confirmação DEVE mencioná-lo. |
| Confirmação do usuário | Resumo exato (cliente, itens, quantidades, unitários, frete, total) apresentado pelo Maestro; o usuário confirma no turno seguinte. "Sim" genérico só vale se a última mensagem do Maestro foi ESTA proposta de ação (seção 4). |
| Registro de autor/data/histórico | `maestro_acoes` (autor, data, `id_cliente`, `id_int` criado, resumo de itens/total) + trilha padrão da proposta no ERP (created_at, vendedor). |
| Fluxo oficial | `salvarCotacaoComoPropostaReal` (`maestro-save-proposta.server.ts`) — o MESMO fluxo já usado pelo motor legado do Maestro. Proibido INSERT direto em `propostas`/`produtos_proposta`. |
| Bloqueios | Não sobrescreve nem "atualiza" proposta existente; não cria proposta retroativa (data é sempre a atual); não aplica desconto que o fluxo oficial não calcule. |

### 2.2 Fase B2 — posteriores (PLANEJADAS, NÃO LIBERADAS)

#### `cancelar_proposta`

| Dimensão | Regra |
|---|---|
| Quem pode executar | Perfis com `propostas.cancel` (hoje: Administrador, Financeiro; super admin). Vendedor comum NÃO cancela via Maestro. |
| Em quais registros | Proposta do cliente ativo, identificada por `id_int` confirmado por tool NESTE turno. |
| Pré-condições | (a) proposta SEM pagamento vinculado (nenhuma linha em `pagamentos_v2` com o `id_int`, em qualquer status exceto cancelado); (b) sem NF emitida; (c) fora da fila avançada de Produção (a rota oficial re-valida); (d) motivo textual obrigatório informado pelo usuário. |
| Confirmação | Resumo (número, cliente, valor, status atual, motivo) + confirmação explícita. |
| Registro | `maestro_acoes` (com motivo) + `motivo_reproved`/flags que a rota oficial grava. |
| Fluxo oficial | `/api/orcamentos/cancelar-proposta`. Proibido UPDATE direto. |
| Bloqueios | Proposta paga → NEGADO sempre (imutável §1.6). Proposta em produção → NEGADO (orientar módulo de Pedidos). |

#### `atualizar_observacao_pedido`

| Dimensão | Regra |
|---|---|
| Quem pode executar | Perfis com `pedidos.edit_obs` (hoje: Financeiro) ou `pedidos.edit` (Produção); super admin. |
| Em quais registros | Campo `obs_pedido` de pedido real (`pedido_real=true`) do cliente ativo, `id_int` confirmado por tool neste turno. |
| Pré-condições | Pedido não entregue/cancelado; texto ≤ limite do fluxo oficial; conteúdo novo apresentado na íntegra na proposta de ação. |
| Confirmação | Mostrar texto ANTERIOR e NOVO; confirmação explícita. |
| Registro | `maestro_acoes` com os dois textos resumidos. |
| Fluxo oficial | Serviço oficial do módulo de Pedidos (a definir na implementação; se não existir rota/serviço, a ação NÃO será implementada — nunca UPDATE direto). |
| Bloqueios | Nunca edita `obs_proposta`/observações de produção técnica; apenas `obs_pedido`. |

### 2.3 Ações do próprio Maestro (JÁ EXISTENTES — fora do agent loop)

Estas escritas já existem, não passam pelo modelo e permanecem como estão:

| Ação | Registros | Quem | Fluxo |
|---|---|---|---|
| Persistir turno de conversa | `maestro_conversas`/`maestro_mensagens` (RLS `user_id=auth.uid()`) | usuário autenticado | `persistirTurnoMaestro` |
| Encerrar/reabrir conversa | flag lógica em `maestro_conversas` própria | usuário autenticado | `POST /api/maestro/simple/conversa` |
| Auditoria | `maestro_acoes` (INSERT-only) | servidor, em nome do usuário | `registrarAcaoMaestro` |

### 2.4 BLOQUEADO — sem exceção nesta fase (mesmo para admin, via Maestro)

| Domínio | Operações | Fluxos existentes que o Maestro NÃO usa |
|---|---|---|
| Cobranças | gerar/confirmar/cancelar boleto, PIX, cartão, pagamento combinado | `/api/cobrancas/*` |
| Recebíveis | baixa, envio de e-mail de cobrança | contas a receber (`contas_receber.baixa`) |
| Crédito/conta corrente | lançar/cancelar/usar movimento de crédito, encerrar pendência | `fn_lancar_movimento_credito`, `fn_cancelar_movimento_credito`, `mc_usar_credito_avulso`, `/api/conta-corrente/*`, `/api/cobrancas/ajuste-credito`, `estorno-credito`, `usar-credito` |
| Fiscal | emitir/cancelar NF-e e NFS-e, qualquer campo fiscal | módulo fiscal (`fiscal.*`) |
| Propostas pagas | QUALQUER edição — **inclusive proposta avulsa paga, inclusive por admin** | `/api/orcamentos/editar-paga`, `abonar-diferenca`, `resolver-diferenca`, `consolidar-total-paga` |
| Produção/OS | qualquer escrita em `producao_*`, transições de OS | `/api/os-qr/*`, `/api/pedidos/*` |
| Cadastros sensíveis | campos fiscais (`cadastros.edit_fiscal`), crédito/limite (`cadastros.edit_credito`), exclusões | módulo de cadastros |
| Status de propostas | transições de `status_interno`/liberação p/ produção (`propostas.release_producao`, `release_nf`, `devolver_revisao`, `alterar_vendedor`) | status-engine / módulo de orçamentos |
| Infra | SQL livre, UPDATE/DELETE diretos, DDL, alteração de RLS/grants, service_role | — (proibidos por construção: não existe tool de SQL) |

---

## 3. Modelo de decisão em camadas (ordem de avaliação)

Toda tool de escrita futura avalia NESTA ordem — a primeira falha encerra:

1. `MAESTRO_AGENT_WRITE_ENABLED != 'true'` → NEGADO (flag global, hoje inexistente = negado);
2. ação fora desta matriz → NEGADO (deny-by-default);
3. flag específica da ação desligada → NEGADO (cada ação terá flag própria);
4. permissão de perfil ausente (ou checagem falhou) → NEGADO;
5. alvo fora do escopo (cliente não resolvido na sessão / `id_int` não confirmado por tool no turno) → NEGADO;
6. pré-condição da ação violada (re-verificada agora, no servidor) → NEGADO com explicação;
7. sem confirmação válida do usuário (seção 4) → não executa; re-propõe;
8. execução SOMENTE pelo fluxo oficial (RPC/rota) → auditoria → resposta.

## 4. Validade da confirmação (propor → confirmar → executar)

- A proposta de ação vale para **o turno imediatamente seguinte** da mesma
  conversa. Qualquer outra mensagem no meio (novo assunto, nova pergunta,
  troca de cliente) **invalida** a proposta — é preciso propor de novo.
- Confirmação natural é aceita ("sim", "pode salvar", "confirmo"), mas só
  quando a última mensagem do Maestro foi a própria proposta de ação.
- Entre a proposta e a execução, se o alvo mudou no banco (ex.: proposta
  recebeu pagamento, cliente ganhou restrição), a execução é ABORTADA e o
  Maestro re-propõe com os dados novos.
- Negativa ou silêncio nunca executa nada. Confirmações "em lote" ("pode
  fazer tudo que sugerir") são inválidas — uma confirmação por ação.

## 5. O que a próxima etapa da Trilha B fará (e esta NÃO fez)

- Criar a flag `MAESTRO_AGENT_WRITE_ENABLED` (default OFF) + flag por ação;
- implementar SOMENTE `salvar_cotacao_como_proposta` conforme §2.1, reutilizando
  o fluxo legado `salvarCotacaoComoPropostaReal`;
- estado de "ação proposta aguardando confirmação" no contexto V2 (autorado
  pelo servidor, como os candidatos de cliente);
- testes determinísticos das 8 camadas do §3 no smoke test.

Nenhuma dessas peças existe ainda. Este documento é a única entrega desta etapa.

# Cancelamento de cobrança paga na Conferência de Pagamentos

Data: 11/08/2026
Status: Design aprovado — aguardando plano de implementação
Módulo: Financeiro / Conferência de pagamentos

---

## 1. Problema

O financeiro não consegue cancelar uma cobrança já paga na tela de Conferência. Ao tentar, recebe:

```
Não é permitido cancelar cobrança paga ou com faturamento aprovado (A_VENCER).
```

O bloqueio é deliberado e existe em três camadas:

| Camada | Local | Condição |
|---|---|---|
| Frontend | `CobrancasProvider.cancelCobranca` | `status = PAID` ou `A_VENCER` |
| API | `src/app/api/cobrancas/cancelar-externo/route.ts` | `PAID`, `A_VENCER`, `confirmado`, `paid_at`, `data_confirmacao` |
| API | `src/app/api/cobrancas/cancelar-boleto/route.ts` | mesmas condições |

A regra também está escrita em `docs/business/CANCELAMENTO-COBRANCAS.md` v2.0.

Só que os casos reais existem e são legítimos: desistência do cliente com devolução do valor, engano de modalidade no lançamento, cobrança duplicada, valor errado. Hoje eles não têm saída pelo sistema.

**Evidência de que já acontece por fora:** das 214 cobranças com status `CANCELADO` em `pagamentos_v2`, **24 ainda têm `paid_at` preenchido** — foram canceladas antes de a trava existir, e o valor simplesmente desapareceu do faturamento do mês em que entrou, sem motivo registrado nem rastro de quem fez.

---

## 2. Decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | O cancelamento é **retroativo**: a cobrança vira `CANCELADO` e sai do faturamento do mês em que foi confirmada | O erro é quase sempre percebido no mesmo mês, então sai e entra no mesmo período e o total fecha igual |
| 2 | Quando a confirmação for de **mês anterior**, exigir uma confirmação extra explícita | Único caso em que um relatório já fechado muda; o usuário precisa saber disso antes, não depois |
| 3 | O valor recebido tem **três destinos possíveis**, escolhidos no ato | Cobre devolução real, crédito para compra futura e o caso em que o dinheiro fica porque a cobrança vai ser refeita |
| 4 | Só **super admin** cancela cobrança paga | Decisão do dono |
| 5 | **Rota nova e isolada**, sem tocar nas rotas existentes | A trava que protege 6.021 cobranças pagas não é afrouxada para atender um caso raro |
| 6 | **Sem chamada a provedor externo** | Cobrança paga não tem título em aberto para baixar; PIX já caiu, boleto já liquidou. A devolução acontece por fora do ERP |
| 7 | **Bloquear** quando a proposta estiver em produção, exceto em `REVISAO ATENDENTE` | O caminho oficial é o gerente devolver a proposta para a revisão do atendente e só então cancelar |

### Alternativas descartadas

- **Estorno como lançamento negativo separado** (cobrança original intacta + contrapartida): mais correto contabilmente, mas o dono optou pelo retroativo, que é o comportamento que o time já entende.
- **Flag na rota `cancelar-externo`**: mantém ponto único de cancelamento (como pede o doc oficial), mas obriga a mexer no arquivo que hoje protege todas as cobranças pagas. Risco desproporcional. Resolvido documentando a rota nova como oficial.
- **Sistema criar a cobrança substituta** herdando a data de confirmação original: só valeria se o erro fosse descoberto meses depois, o que não é o caso.

---

## 3. Escopo

### Entra

- Rota `POST /api/cobrancas/cancelar-pago`.
- Ação "Cancelar cobrança" habilitada para cobranças pagas na Conferência, visível só para super admin.
- Modal com motivo pré-definido, destino do valor e confirmação extra de mês fechado.
- Geração de crédito na conta corrente quando esse for o destino escolhido.
- Auditoria: motivo, autor, data, destino do valor.
- Atualização de `docs/business/CANCELAMENTO-COBRANCAS.md` com o novo fluxo autorizado.

### Não entra

- Criar a cobrança substituta (o financeiro refaz pela tela normal).
- Devolução automática de dinheiro via provedor — a devolução é operação bancária feita por fora.
- Cancelamento parcial de valor (é a cobrança inteira ou nada).
- A ação "devolver para REVISAO ATENDENTE" — ver premissa em §10.

---

## 4. Arquitetura

```
Conferência (CobrancasList)
   └─ CobrancaActionsMenu → "Cancelar cobrança"
        └─ modal de cancelamento
             ├─ cobrança NÃO paga  → fluxo atual (CobrancasProvider.cancelCobranca → cancelar-externo)
             └─ cobrança PAGA      → POST /api/cobrancas/cancelar-pago   ← NOVO
                                        ├─ valida sessão + super admin
                                        ├─ reconsulta a cobrança no banco
                                        ├─ aplica os bloqueios (§6)
                                        ├─ UPDATE pagamentos_v2 (status, motivo_cancela)
                                        ├─ destino do valor (§7)
                                        └─ histórico + timeline
```

O caminho da cobrança paga **não passa** pelo guard de `CobrancasProvider.cancelCobranca` — aquele guard continua valendo para todo o resto e não deve ser afrouxado.

`cancelar-externo` e `cancelar-boleto` não são alteradas.

### Contrato da rota

```
POST /api/cobrancas/cancelar-pago
Authorization: Bearer <jwt>

{
  "id": "uuid-da-cobranca",
  "motivo": "DESISTENCIA_CLIENTE",
  "motivo_texto": "...",              // obrigatório apenas quando motivo = OUTRO
  "destino_valor": "DEVOLVIDO",
  "confirma_mes_fechado": false       // obrigatório true quando a confirmação for de mês anterior
}
```

Resposta de sucesso:

```json
{ "success": true, "id_movimento_credito": 123 }
```

`id_movimento_credito` só vem quando o destino gerou crédito. O formato exato do retorno de `mc_ajuste_avulso_criar` deve ser conferido no plano; se a RPC não devolver o id, o campo sai do contrato em vez de ser inventado.

Resposta de bloqueio: `{ "success": false, "code": "...", "message": "..." }` com HTTP 403 (permissão) ou 409 (regra de negócio).

O `id` é a única informação de confiança: todo o resto (status, valor, empresa, proposta) é relido do banco. Divergência entre o enviado e o persistido bloqueia a operação — mesma regra de confiança já adotada em `cancelar-externo`.

---

## 5. Autorização

Super admin, verificado em dois lugares:

1. **Tela** — a ação não aparece no menu para quem não é super admin.
2. **Rota** — revalida pelo JWT. Se não for super admin, responde `403` com `code: "NEGADO"`, e a tela mostra o alerta NEGADO (o mesmo modal de alerta já padronizado no lugar do toast).

A verificação de tela é conveniência; a da rota é a que vale.

---

## 6. Bloqueios, na ordem em que o servidor aplica

| Ordem | Condição | Resposta |
|---|---|---|
| 1 | Usuário não é super admin | `403 NEGADO` |
| 2 | Cobrança não existe, ou os dados enviados divergem dos persistidos | `409 NAO_ENCONTRADA` |
| 3 | Cobrança já está `CANCELADO` | `200` sucesso idempotente, sem efeito (protege duplo clique) |
| 4 | Cobrança **não** está paga nem confirmada | `409 NAO_PAGA` — "use o cancelamento normal" |
| 5 | Proposta em status operacional, exceto `REVISAO ATENDENTE` | `409 PRODUCAO_ATIVA` |
| 6 | Confirmação em mês anterior e `confirma_mes_fechado != true` | `409 MES_FECHADO` |

### Detalhe do bloqueio 5

Bloqueia quando `propostas.status_interno` estiver em:

```
APROVADO, APROVADO / EM ARTE, LIBERADO, LIBERADO / EM ARTE,
REVISAO PRODUCAO, EM PRODUCAO,
EM IMPRESSAO, EM IMPRESSAO / PENDENTE,
EM ACABAMENTO, EM ACABAMENTO / PENDENTE,
EXPEDICAO, A RETIRAR, EM TRANSITO, ENTREGUE
```

É a lista `PROPOSTA_STATUS_PROTEGIDOS` (`src/features/orcamentos/services/status-protegidos.ts`) **menos `REVISAO ATENDENTE`**, que é a porta de saída. A constante existente não pode ser usada crua: a implementação deve derivar a lista removendo esse status, deixando explícito no código o porquê.

Mensagem acionável, com o número real da proposta e o status real:

```
Proposta 20493 está EM PRODUCAO.
Peça ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobrança.
```

### Detalhe do bloqueio 6

"Mês anterior" = o mês de `data_confirmacao` (ou `paid_at`, quando não houver confirmação) é anterior ao mês corrente em `America/Sao_Paulo` — o mesmo fuso que os cards de faturamento da tela já usam.

A tela detecta a condição antes de enviar e mostra o checkbox de confirmação; o `409` é a rede de segurança para quem chamar a rota direto.

---

## 7. Motivos e destino do valor

### Catálogo de motivos

| Código | Rótulo | Destino sugerido |
|---|---|---|
| `DESISTENCIA_CLIENTE` | Desistência do cliente | Devolvido |
| `ENGANO_MODALIDADE` | Engano de modalidade | Nenhum |
| `COBRANCA_DUPLICADA` | Cobrança duplicada | Devolvido |
| `VALOR_INCORRETO` | Valor incorreto | Nenhum |
| `OUTRO` | Outro motivo | Devolvido |

`OUTRO` exige `motivo_texto` não vazio. Os demais não exigem digitação — foi um pedido explícito para reduzir atrito.

### Destino do valor

| Código | Significado | O que o sistema faz |
|---|---|---|
| `DEVOLVIDO` | O dinheiro volta ao cliente por fora (PIX/transferência) | Só registra |
| `CREDITO` | O valor fica na empresa como crédito do cliente | Chama `mc_ajuste_avulso_criar` |
| `NENHUM` | O dinheiro fica porque a cobrança vai ser refeita | Nada na conta corrente |

O destino vem sugerido pelo motivo e é editável — a realidade não obedece à tabela.

### Geração do crédito

Escrita em `movimento_credito` só é permitida via RPC `SECURITY DEFINER` (INSERT direto foi revogado de `authenticated`). Usar:

```
mc_ajuste_avulso_criar(p_id_cliente, p_tipo, p_valor, p_observacao, p_chave_idempotencia)
```

com `p_tipo = 'CREDITO'`, `p_valor` = valor da cobrança e `p_chave_idempotencia` derivada do id da cobrança, para que uma repetição não gere crédito em dobro. A observação registra proposta, cobrança e motivo.

A RPC alternativa `cc_abrir_pendencia` vincula o crédito à proposta, mas recalcula a diferença a partir do valor pago no servidor — o que exigiria chamá-la antes de cancelar a cobrança e tornaria a ordem das operações frágil. `mc_ajuste_avulso_criar` é idempotente e independente dessa ordem.

Se a RPC falhar, a operação inteira falha e **nada** é gravado — não pode existir cobrança cancelada sem o crédito prometido.

---

## 8. Efeitos no sucesso

1. `pagamentos_v2`: `status = 'CANCELADO'`, `motivo_cancela` preenchido com rótulo do motivo + texto livre quando houver.
2. Crédito na conta corrente, quando `destino_valor = CREDITO`.
3. Histórico/timeline com autor real (da sessão), data, motivo, destino do valor e id do movimento de crédito quando houver.
4. Reversão de status da proposta: segue a regra que já existe em `CANCELAMENTO-COBRANCAS.md` §"Reversão do Status da Proposta". Como o bloqueio 5 já impede propostas em produção, na prática a reversão só alcança propostas em estado financeiro de espera.
5. Faturamento: a cobrança deixa de ser contada no período em que estava, por consequência da mudança de status. Nenhuma tabela de faturamento é escrita.

---

## 9. Interface

O modal é o que já existe ("Cancelar Cobrança"), com o campo de texto livre substituído por:

1. **Motivo** — select com os cinco motivos. `Outro motivo` revela a caixa de texto obrigatória.
2. **Destino do valor** — três opções, pré-marcada conforme o motivo.
3. **Confirmação de mês fechado** — checkbox que só aparece quando a confirmação for de mês anterior: *"Entendo que o faturamento de agosto/2026 será alterado."* O botão de confirmar fica desabilitado enquanto não for marcado.

Em erro: o modal permanece aberto, nada muda no banco, e cada código de erro tem mensagem própria. Nenhum detalhe técnico (payload, stack, resposta de provedor) chega à tela.

---

## 10. Premissas a validar no plano

1. **Existe uma ação de devolver a proposta para `REVISAO ATENDENTE`** acessível ao gerente. O bloqueio 5 instrui o usuário a usá-la. Se não existir, a instrução é inútil e o plano precisa tratar isso — ou criando a ação, ou trocando a mensagem por outra saída real.
2. **O menu de ações da Conferência hoje esconde ou apenas desabilita a ação para cobrança paga.** A implementação precisa exibi-la para super admin nesse caso.

---

## 11. Validação

Cenários obrigatórios antes de considerar pronto:

1. Super admin cancela cobrança paga do mês corrente, destino `DEVOLVIDO` → status `CANCELADO`, motivo gravado, faturamento do mês cai pelo valor.
2. Mesma coisa com destino `CREDITO` → crédito criado com o valor exato; saldo da conta corrente do cliente sobe.
3. Repetir a mesma requisição (duplo clique) → nenhum crédito em dobro, resposta idempotente.
4. Usuário não super admin → `403 NEGADO` na rota, mesmo chamando direto.
5. Proposta em `EM PRODUCAO` → `409 PRODUCAO_ATIVA`, nada gravado.
6. Proposta em `REVISAO ATENDENTE` → cancelamento permitido.
7. Cobrança confirmada em mês anterior sem `confirma_mes_fechado` → `409 MES_FECHADO`; com a confirmação → sucesso.
8. Cobrança `A_RECEBER` → `409 NAO_PAGA`, orientando o cancelamento normal.
9. Falha na RPC de crédito → cobrança permanece paga, nada gravado.
10. Regressão: cancelar cobrança **não paga** pelo fluxo antigo continua funcionando igual; `cancelar-externo` e `cancelar-boleto` seguem recusando cobrança paga.

---

## 12. Divergências de documentação encontradas

Registradas para correção junto com a implementação:

1. `docs/business/CANCELAMENTO-COBRANCAS.md` v2.0 afirma que cobrança paga não pode ser cancelada em nenhuma hipótese. Passa a existir uma exceção autorizada, que precisa ser descrita lá — inclusive para não ser lida como "cancelamento paralelo", que o mesmo documento proíbe.
2. `docs/business/CONTA-CORRENTE-FASE-1-PREPARACAO.md` e `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` classificam as RPCs de conta corrente como "preparadas / FUTURO". Elas **existem em produção** (`cc_abrir_pendencia`, `cc_usar_pendencia`, `cc_encerrar_pendencia`, `mc_ajuste_avulso_criar`, `mc_ajuste_avulso_estornar`, `mc_confirmar_abatimento_legado`, `mc_usar_credito_avulso`), assim como `conta_corrente_pendencias`.
3. A Matriz de Segurança precisa registrar a nova operação autorizada: `UPDATE` de `status`/`motivo_cancela` em `pagamentos_v2` para cobrança paga, restrito a super admin via `/api/cobrancas/cancelar-pago`.

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Cancelamento indevido de receita real | Restrito a super admin, motivo obrigatório, autor registrado, bloqueio de produção e confirmação extra de mês fechado |
| Relatório de mês fechado mudar sem ninguém perceber | Confirmação extra explícita nomeando o mês afetado |
| Crédito duplicado por repetição | Chave de idempotência derivada do id da cobrança |
| Cobrança cancelada sem o crédito prometido | Falha na RPC aborta a operação inteira |
| A trava geral ser afrouxada por engano | Rota separada; as rotas existentes não são tocadas, e o cenário 10 da validação cobre isso |

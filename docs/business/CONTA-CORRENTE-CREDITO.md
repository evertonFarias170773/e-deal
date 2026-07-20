# CONTA-CORRENTE-CREDITO.md

Versão: 1.3
Status: Oficial
Última atualização: 19/07/2026
Projeto: ERP Ideal

---

# Conta Corrente e E-Crédito

Este documento registra o estado oficial da Conta Corrente do cliente e do pagamento por E-Crédito no ERP Ideal.

Ele separa, de forma explícita:

- regras oficiais;
- implementações confirmadas no código;
- pendências de homologação;
- falhas ainda abertas;
- itens apenas históricos.

Nenhuma conclusão de auditoria estática deste documento deve ser interpretada como funcionalidade homologada. Homologação exige teste controlado, com propostas novas, em ambiente de Preview/Homologação, seguindo o processo de `DEVELOPMENT.md`.

---

# 1. Regras Oficiais

## 1.1 Fontes de dados

| Domínio | Fonte | Chave |
|---|---|---|
| Clientes | `public.clientes` | `id_cliente` |
| Propostas | `public.propostas` | `id_int` |
| Saldo da Conta Corrente | `public.movimento_credito` | `id_cliente` |
| Pagamentos e recebimentos (inclui E-Crédito) | `public.pagamentos_v2` | `id_int`, `id_cliente` |
| Cobranças e Contas a Receber (títulos bancários) | `public.boletos` | `id_int`, `id_cliente` |
| Pendências operacionais | `public.propostas_pendencias` | `id_int` |
| Auditoria e timeline | `public.propostas_chat` | `id_int` |

O limite faturado ou o risco de crédito cadastral do cliente **não é** o saldo da Conta Corrente. São conceitos e fontes diferentes e nunca devem ser somados ou confundidos.

## 1.2 Estrutura de `movimento_credito`

Tabela somente-inserção. Um registro existente nunca deve ser alterado — apenas cancelado logicamente.

Campos oficiais:

```text
id, id_cliente, id_int (nullable), valor, tipo (CREDITO | DEBITO),
origem, observacao, created_at, created_by,
cancelado, cancelado_em, cancelado_por
```

Saldo real do cliente:

```text
SUM(valor) onde tipo = CREDITO, cancelado = false
menos
SUM(valor) onde tipo = DEBITO, cancelado = false
```

O saldo deve ser sempre recalculado no servidor no momento de cada operação. Nenhum valor de saldo informado pelo cliente deve ser aceito como fonte da verdade.

## 1.3 Regra financeira de edição de proposta paga

- novo total menor que o valor já pago → gera **crédito** para o cliente;
- novo total maior que o valor já pago → gera **débito** ou cobrança complementar;
- a diferença deve ser recalculada no servidor a partir de `pagamentos_v2` e `propostas.valor_total`, nunca aceita apenas do payload do cliente.

## 1.4 Regra de consumo de E-Crédito

- consumir E-Crédito reduz o saldo em `movimento_credito` **uma única vez** por operação;
- todo consumo de E-Crédito deve criar um pagamento correspondente `tipo_cobranca = E-CREDITO` em `pagamentos_v2`;
- um pagamento combinado (E-Crédito + outra forma) deve criar um registro E-CREDITO já confirmado **e** um registro da forma secundária (ex.: PIX) pendente, ambos com o mesmo `id_int`.

## 1.5 Regra de quitação

Uma proposta não deve ser tratada como quitada enquanto existir saldo pendente (PIX, boleto ou outra cobrança não confirmada) vinculado ao mesmo `id_int`.

## 1.6 Regra de itens em proposta paga

- proposta paga não pode ter produto removido fisicamente (`DELETE`);
- o cancelamento de item deve ocorrer por `status_item = CANCELADO`, com restauração para `PENDENTE`;
- itens cancelados não devem entrar em subtotal, peso, frete ou `valor_total`.

---

# 2. Implementações Confirmadas no Código

Os itens abaixo foram lidos e confirmados diretamente no código-fonte. Eles representam lógica real e conectada — **não** representam homologação. Nenhum destes fluxos foi validado por teste controlado com proposta nova neste ciclo de sincronização.

| Fluxo | Rota / função | Observação |
|---|---|---|
| Ajuste manual de crédito | `src/app/api/cobrancas/ajuste-credito/route.ts` → `registrarMovimento()` | Grava `movimento_credito` real; sem simulação. |
| Estorno de movimento | `src/app/api/cobrancas/estorno-credito/route.ts` → `estornarMovimentoCredito()` | Bloqueia estorno de movimento vinculado a proposta; revalida saldo antes de reverter. |
| Uso integral de E-Crédito | `src/app/api/cobrancas/usar-credito/route.ts` | Recalcula saldo no servidor, grava `movimento_credito` (DEBITO) e `pagamentos_v2` (E-CREDITO/PAID), com rollback compensatório se o pagamento falhar após o débito. |
| Edição de proposta paga | `src/app/api/orcamentos/editar-paga/route.ts` → `saveProposta()` | Recalcula valor pago no servidor; cria pendência nova (nunca reaproveita uma antiga) quando há diferença. |
| Resolução de diferença financeira | `src/app/api/orcamentos/resolver-diferenca/route.ts` | Recalcula a diferença no servidor com tolerância de R$ 0,02; grava `movimento_credito`; conclui a pendência por `id`. |
| Consolidação de `valor_total` | `src/app/api/orcamentos/consolidar-total-paga/route.ts` | Reaproveita `getPropostaDetailById()` para recalcular o total oficial de propostas com `valor_total` nulo; exige pendência ABERTA existente. |
| Pagamento combinado (E-Crédito + forma secundária) | `src/app/api/cobrancas/pagamento-combinado/route.ts` | Implementado, mas com falha funcional conhecida — ver seção 4. |
| Cancelamento lógico de item em proposta paga | `saveProposta()` em `src/features/orcamentos/services/orcamentos.service.ts` | `status_item = CANCELADO` sem `DELETE` físico quando a edição é de proposta paga — ver limitação de acesso pela interface na seção 4. |

## 2.1 Nota sobre autenticação de teste removida nesta sincronização

As seis rotas financeiras acima possuíam um mecanismo que permitia, mediante um cabeçalho HTTP específico com um valor fixo, contornar completamente a verificação de JWT e de permissão, assumindo uma identidade de usuário fixa. Esse mecanismo foi **removido** nesta sincronização (ver commit de correções de segurança).

Consequência direta: qualquer script ou evidência de teste anterior que dependia desse cabeçalho (incluindo o script `test-fase1.mjs`, citado em walkthroughs anteriores e não mais presente no diretório do projeto) deve ser considerado **não confiável** a partir de agora. Testes futuros devem usar sessão real autenticada.

---

# 3. Pendências de Homologação

Nenhum item abaixo deve ser considerado disponível ou validado até execução de teste controlado, com propostas novas, nunca `#19359` ou `#19365`.

- Ajuste manual de crédito e débito sem proposta vinculada.
- Edição de proposta paga reduzindo o valor e gerando crédito.
- Edição de proposta paga aumentando o valor e gerando cobrança complementar.
- Cancelar e restaurar item de proposta paga sem `DELETE` físico, pela interface real.
- Fechar e reabrir pendência financeira sem duplicidade.
- E-Crédito integral como forma de pagamento.
- E-Crédito combinado com outra forma, gerando dois registros no mesmo `id_int`.
- Confirmar que uma proposta com PIX (ou outra forma) pendente não é liberada como quitada.
- E-Crédito aparecendo de forma consistente na lista, no filtro e no card da tela de Conferência.
- Atualização imediata do banner de saldo do cliente após qualquer operação de crédito.
- Fluxo completo publicado na Vercel — **bloqueado** enquanto o mecanismo de concorrência descrito na seção 4 não for substituído (ver nota de arquitetura).

---

# 4. Falhas Ainda Abertas

Falhas confirmadas por leitura do código atual.

## 4.1 Corrigidas nesta sincronização (pendentes de homologação)

As falhas abaixo foram corrigidas no código, mas **não foram homologadas**. Homologação exige teste controlado com proposta nova, em ambiente de Preview/Homologação, seguindo `DEVELOPMENT.md`, e nunca com as propostas `#19359` ou `#19365`.

1. **Pagamento combinado — consulta de saldo quebrada (corrigida).** A consulta de saldo foi ajustada para usar apenas os campos reais da tabela: `select("tipo, valor")` com `eq("cancelado", false)`, removendo as referências a `status` e `validade` que não existem em `movimento_credito`. O somatório segue a mesma semântica oficial de `CREDITO` soma e `DEBITO` subtrai, recalculado sempre no servidor.
2. **Pagamento combinado — sem rollback compensatório (corrigida).** Quando a criação do pagamento `E-CREDITO` em `pagamentos_v2` falha depois que o débito em `movimento_credito` já foi gravado, o débito agora é cancelado logicamente (`cancelado = true`, `cancelado_em`, `cancelado_por`) antes de retornar o erro, no mesmo padrão já usado em `usar-credito/route.ts`. Nenhum `DELETE` físico é realizado.
3. **Pagamento combinado — permissão desalinhada (corrigida).** Alinhado para validar a permissão `credito.usar` em vez de `financeiro.resolver_credito`.
4. **Catálogo de cobrança — tipo E-CREDITO ausente no mock (corrigido).** O tipo `E-CREDITO` foi adicionado à lista `tiposCobrancaMock` para garantir resolução visual como "E-Crédito".
5. **Atualização do saldo sem reload (corrigido).** O evento órfão `cobrancas-updated` foi substituído por um callback explícito `onRefreshProposta` em `OrcamentoFormPage.tsx` para recarregar o saldo do banner (`fetchSaldoCredito()`) e do modal de forma assíncrona após sucesso na operação.
6. **Ação Consultar crédito na lista de clientes (implementado e pendente de homologação funcional).** Conectamos a ação "Consultar crédito" ao modal `AjusteContaCorrenteModal` para Desktop e Mobile. O acesso e as APIs `/api/cobrancas/ajuste-credito` e `/api/cobrancas/estorno-credito` foram restritos a administradores reais (`is_admin` ou `is_super_adm` no banco de dados).

## 4.2 Falhas ainda abertas

Nenhuma foi corrigida nesta sincronização, além das seis listadas em 4.1.

3. **Idempotência frouxa em `usar-credito`.** A checagem de duplicidade não considera o valor da operação — um débito recente da mesma proposta, de qualquer origem ou valor, pode ser tratado como duplicata, retornando sucesso sem gravar a nova operação.
4. **Idempotência frouxa em `resolver-diferenca`.** A janela de 5 minutos identifica duplicidade por proposta e tipo de movimento, não pela pendência específica — duas resoluções legítimas do mesmo tipo em um intervalo curto podem resultar na segunda sendo descartada silenciosamente como sucesso.
5. **Cancelamento de item bloqueado pela interface.** O backend já implementa corretamente o cancelamento lógico de item em proposta paga, mas a interface bloqueia a ação de remoção sempre que existe cobrança ativa, sem verificar se a edição de proposta paga está autorizada — o caminho correto fica inacessível pelo fluxo padrão.
6. **Banner de saldo sem atualização ao vivo.** O evento usado para sinalizar atualização de saldo é disparado, mas não existe nenhum ouvinte cadastrado para ele — o banner permanece desatualizado até troca de cliente ou recarregamento da página.
7. **Causa raiz de `valor_total = null` não identificada.** Existem validação defensiva e uma rota de consolidação manual, mas nenhuma delas corrige a causa que leva o campo a ficar nulo — apenas mitigam o sintoma depois de ocorrido.
8. **`id_empresa` não resolvido no servidor em `usar-credito`.** Essa rota aceita `id_empresa` do payload enviado pelo cliente. O padrão correto (resolver a partir da proposta no servidor) já existe e está aplicado em `pagamento-combinado` — falta uniformizar.
9. **Validação incompleta na ação `ABATER_DEBITO`.** O valor informado para abater um débito específico não é conferido contra o saldo real desse débito no servidor.
10. **Permissão `financeiro.ajuste_credito` fora do catálogo editável de perfis.** Um administrador não consegue conceder essa permissão pela tela padrão de perfis; ela só existe em uma lista de fallback legado.
11. **Mecanismo de concorrência incompatível com ambiente serverless.** O lock usado nas rotas de crédito é baseado em arquivo no sistema de arquivos local. Isso não deve funcionar de forma confiável em funções serverless (ambiente sem disco persistente e compartilhado entre instâncias), o que bloqueia a publicação do fluxo completo na Vercel até que seja substituído por um mecanismo baseado em banco.
12. **`movimento_credito` sem entrada na Matriz de Segurança de Escrita.** `technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` não possui nenhuma linha para essa tabela, apesar de haver escrita real e ativa nela por múltiplas rotas. Esta lacuna documental deve ser resolvida antes de ampliar qualquer nova escrita nesse domínio.

---

# 5. Itens Apenas Históricos

- `history/IMPLEMENTACAO-PROPOSTAS-PAGAS.md` — documento de desenvolvimento que se autodeclarou "100% Homologado e Testado em Produção Simulada". Não representa o estado real confirmado nesta auditoria: várias das mesmas funcionalidades permanecem como pendência de homologação (seção 3) ou possuem falha aberta (seção 4). Preservado apenas como registro histórico do processo de implementação.
- Propostas `#19359` e `#19365` não devem ser usadas como prova em nenhuma auditoria, teste ou homologação futura — ambas possuem dados manipulados manualmente durante diagnósticos anteriores.
- Scripts de diagnóstico ad-hoc que fazem referência a essas propostas não fazem parte do código oficial da aplicação e não devem ser usados como evidência de comportamento correto.

---

# 6. Documentação Relacionada

- `../BUSINESS_RULES.md`
- `../SECURITY.md`
- `./FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `./CANCELAMENTO-COBRANCAS.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../history/IMPLEMENTACAO-PROPOSTAS-PAGAS.md`

---

# Fonte da Verdade

`public.movimento_credito` é a fonte oficial do saldo de Conta Corrente.

`public.pagamentos_v2` é a fonte oficial de pagamentos e recebimentos, incluindo E-Crédito.

`public.boletos` é a fonte oficial de Contas a Receber.

A separação entre regras oficiais, implementações confirmadas no código, pendências de homologação, falhas abertas e itens históricos definida neste documento deve ser mantida a cada nova sincronização.

Nenhuma implementação descrita como confirmada neste documento deve ser tratada como homologada sem teste controlado registrado.

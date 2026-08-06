# STATUS-INTERNO-PROPOSTAS.md

Versão: 2.0  
Status: Histórico — Estratégia de transição  
Última revisão documental: 18/07/2026  
Projeto: Vibe

---

# Estratégia Histórica de Centralização do `status_interno`

Este documento registra a estratégia criada para centralizar em `public.propostas` o acompanhamento operacional de Orçamento, Proposta e Pedido.

Ele preserva o histórico das fases de diagnóstico, modo sombra, escrita manual e preparação visual dos status.

## Regra de uso

Este arquivo não é a fonte oficial atual do fluxo de status.

Antes de implementar qualquer alteração, consultar:

- `../business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`;
- `../BUSINESS_RULES.md`;
- `../SECURITY.md`;
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`;
- código atual do módulo.

Nenhuma decisão histórica deste documento autoriza alteração de banco, automação de status ou reestruturação de `public.pedidos`.

---

# 1. Objetivo Original

A estratégia propôs utilizar `public.propostas` como entidade central do ciclo comercial e operacional.

Chave operacional:

```text
public.propostas.id_int
```

Campo de acompanhamento:

```text
public.propostas.status_interno
```

A proposta também avaliava reduzir a dependência de `public.pedidos` como indexador principal e reservar estruturas de pedido para Boletins, OS ou entidades operacionais.

Essa reorganização não deve ser aplicada automaticamente.

O papel atual de `public.pedidos`, `pedidos_modelos`, `pedidos_artes` e demais tabelas precisa ser confirmado no código e na Matriz de Segurança.

---

# 2. Limites Conceituais

`status_interno` representa acompanhamento operacional.

Ele não substitui sozinho:

- confirmação financeira;
- recebimento real;
- liberação manual para Produção;
- estado da arte;
- estado de impressão;
- estado de expedição;
- liberação fiscal;
- permissões de usuário.

A entrada oficial na fila de Produção depende da regra vigente documentada para:

```text
public.propostas.is_prd_aprovado
```

Uma proposta com `status_interno = APROVADO` não deve ser tratada automaticamente como pedido produtivo.

---

# 3. Regras de Segurança da Estratégia

## Sem migration destrutiva

Não remover colunas, tabelas ou dados legados durante uma transição sem:

- inventário completo;
- plano de migração;
- backup;
- homologação;
- rollback;
- autorização explícita.

## Sem alteração estrutural implícita

Não modificar sem necessidade confirmada:

- triggers;
- RPCs;
- views;
- policies;
- RLS;
- constraints;
- Auth.

## Escrita financeira

Cancelamentos financeiros devem seguir os fluxos oficiais.

A exclusão física só pode ocorrer quando estiver expressamente autorizada na Matriz de Segurança e no fluxo específico.

Nos demais casos, utilizar cancelamento lógico e auditoria.

## Feature flags

Comportamentos experimentais devem permanecer isolados por feature flag.

A flag não substitui:

- permissão;
- validação;
- auditoria;
- rollback;
- teste em modo sombra.

---

# 4. Fases Registradas

## Fase 0 — Mapeamento e Diagnóstico

Estado registrado: concluída.

Atividades:

- identificação do uso de `public.pedidos`;
- análise de `public.propostas`;
- levantamento de `status_interno`;
- levantamento de `etapa_operacional`;
- documentação da estratégia.

Nenhuma escrita deveria ocorrer nesta fase.

---

## Fase 1 — Motor Puro

Estado registrado: concluída.

Atividades:

- criação de feature flags;
- criação de uma engine pura para sugerir status;
- cálculo apenas em memória;
- inclusão de avisos técnicos nos pontos de bloqueio;
- ausência de escrita no banco.

A engine não deveria decidir regras fora da matriz central.

---

## Fase 2 — Modo Sombra

Estado registrado: concluída.

Objetivo:

- comparar o status gravado com o status sugerido;
- registrar divergências;
- não alterar a proposta.

Flag registrada:

```text
FEATURE_STATUS_PROPOSTAS_SHADOW_MODE
```

Comportamento documentado:

- diagnóstico exibido no detalhe da proposta;
- leitura sem alteração do estado principal;
- ausência de impacto na listagem geral;
- divergência tratada como evidência, não como erro automático.

Logs ou tabela específica de sombra foram descritos como opcionais e não devem ser criados sem autorização.

---

## Fase 3 — Ativação Visual Híbrida

Estado registrado: concluída.

Flags registradas:

```text
FEATURE_STATUS_PROPOSTAS_V2
NEXT_PUBLIC_FEATURE_STATUS_PROPOSTAS_SHADOW_MODE
```

Comportamento documentado:

- diagnóstico visual restrito a perfis autorizados;
- status oficial da aplicação continuava vindo do registro persistido;
- falha no diagnóstico não deveria quebrar a tela;
- nenhuma transição automática.

O uso exato das flags deve ser confirmado no código antes de qualquer manutenção.

---

## Fase 4A — Escrita Manual Controlada

Estado registrado: homologada localmente.

Escopo descrito:

- botão manual;
- visibilidade restrita;
- escrita em `public.propostas.status_interno`;
- log anterior e posterior em `public.propostas_chat`;
- ausência de alterações em tabelas financeiras e produtivas.

Limites:

- sem gatilho automático;
- sem ativação em produção;
- sem escrita em massa;
- sem alteração de schema;
- sem inferência autônoma.

A autorização atual dessa escrita deve ser confirmada na Matriz de Segurança.

---

## Fase 4A.1 — Malha Receptora

Estado histórico registrado: concluída e homologada.

Objetivo:

- permitir leitura e apresentação de status compostos;
- evitar regressão visual para `NOVO`;
- preparar filtros e badges;
- manter aplicação manual.

Capacidades registradas:

- diagnóstico sombra para usuários autorizados;
- aplicação manual de status;
- listagem preparada para status compostos;
- filtros por termos operacionais;
- cards agrupando etapas da fábrica;
- proteção de deleção em estados produtivos;
- cancelamento de cobrança sem regressão indevida;
- fluxo de Boletim compatível com status compostos.

Essas capacidades devem ser confirmadas no código atual antes de serem tratadas como vigentes.

---

# 5. Fase 4B — Automações Suspensas

As seguintes automações permaneceram não autorizadas:

- mudança automática ao criar cobrança;
- mudança automática ao confirmar pagamento;
- mudança automática ao enviar arte;
- mudança automática ao aprovar arte;
- mudança automática por Produção;
- mudança automática por Expedição;
- alteração em massa;
- engine autônoma de status;
- ativação em produção sem aprovação explícita.

Nenhuma dessas automações deve ser implementada apenas com base neste documento.

---

# 6. Condições para Retomar uma Automação

Qualquer automação futura precisa definir:

1. status de origem;
2. status de destino;
3. evento disparador;
4. ator autorizado;
5. condição de negócio;
6. ferramenta ou serviço oficial;
7. auditoria;
8. idempotência;
9. rollback;
10. modo sombra;
11. feature flag;
12. testes;
13. autorização de produção.

A transição deve existir na matriz central antes de qualquer escrita.

---

# 7. Regras de Escalabilidade

## Tipagem centralizada

Não usar strings soltas espalhadas nos componentes.

Preferir:

```text
constants
types
mappers
matriz de transições
```

## Fallback seguro

Status desconhecido não pode virar `NOVO` arbitrariamente.

A interface deve preservar o valor ou apresentar estado desconhecido controlado.

## Escrita restrita

Toda escrita em `status_interno` deve possuir:

- origem;
- usuário;
- horário;
- motivo;
- estado anterior;
- estado posterior;
- resultado real da operação.

## Automação protegida

Toda automação precisa de:

- feature flag;
- modo sombra;
- rollback;
- logs;
- testes;
- monitoramento.

---

# 8. Matriz Histórica de Eventos Futuros

Os exemplos abaixo eram conceituais e não representam automações autorizadas.

## Cobrança criada

Possível transição registrada:

```text
NOVO → AGUARDANDO
```

Estado:

```text
não implementado
```

## Cobrança criada com arte em andamento

Possível transição registrada:

```text
NOVO / EM ARTE → AGUARDANDO / EM ARTE
```

Estado:

```text
não implementado
```

## Pagamentos confirmados

Possível transição registrada:

```text
AGUARDANDO → LIBERADO
```

Estado:

```text
não implementado
```

A confirmação financeira não deve liberar Produção automaticamente sem regra oficial e autorização.

## Pagamentos confirmados com arte em andamento

Possível transição registrada:

```text
AGUARDANDO / EM ARTE → LIBERADO / EM ARTE
```

Estado:

```text
não implementado
```

## Artes aprovadas

Possível transição registrada:

```text
LIBERADO / EM ARTE → REVISAO ATENDENTE
```

Estado:

```text
não implementado
```

Todos esses exemplos precisam ser confrontados com o fluxo oficial atual antes de qualquer uso.

---

# 9. Refatoração Futura Registrada

A estratégia mencionava:

- reduzir o uso de `public.pedidos` como indexador principal;
- revisar campos legados;
- remover `status_producao` no futuro.

Nenhuma dessas ações está autorizada por este documento.

Antes de qualquer alteração:

- mapear dependências;
- revisar código;
- revisar dados;
- revisar RLS;
- revisar triggers;
- revisar relatórios;
- revisar integrações;
- revisar Matriz de Segurança;
- obter aprovação explícita.

---

# 10. Estratégia de Rollback

## Problema visual

Ação segura:

- desativar a feature flag correspondente;
- validar o comportamento anterior;
- realizar novo deploy;
- confirmar que nenhum dado foi alterado.

Não assumir automaticamente que o sistema voltará a usar `public.pedidos` sem confirmar o código.

## Problema no modo sombra

Ação:

```text
FEATURE_STATUS_PROPOSTAS_SHADOW_MODE=false
```

Depois:

- reiniciar ou redeployar o ambiente;
- confirmar encerramento dos diagnósticos;
- preservar logs existentes.

## Problema de escrita manual

Ação:

- desativar a feature flag de escrita;
- interromper a operação;
- comparar estado anterior e posterior;
- usar o histórico do chat;
- avaliar rollback por operação oficial;
- nunca corrigir em massa sem diagnóstico.

Rollback de deploy não substitui correção de dados já persistidos.

---

# 11. Lista Histórica de Status

A estratégia registrou os seguintes valores:

```text
NOVO
NOVO / EM ARTE
AGUARDANDO
AGUARDANDO / EM ARTE
AGUARDANDO / PENDENTE
LIBERADO
LIBERADO / EM ARTE
CANCELADO
REVISAO ATENDENTE
REVISAO PRODUCAO
EM PRODUCAO
EM IMPRESSAO
EM ACABAMENTO
EXPEDICAO
A RETIRAR
EM TRANSITO
ENTREGUE
```

Essa lista é histórica.

A lista oficial vigente, os aliases e as transições permitidas devem ser consultados no fluxo oficial e no código centralizado.

---

# 12. Critérios de Validação

Antes de evoluir o motor de status, validar:

- proposta correta por `id_int`;
- estado anterior;
- estado sugerido;
- regra de transição;
- origem do evento;
- perfil do usuário;
- permissão;
- ausência de efeito financeiro indevido;
- ausência de liberação automática para Produção;
- registro no Chat Interno;
- rollback;
- feature flag;
- testes de regressão;
- comportamento em status desconhecido;
- listagem;
- detalhe;
- filtros;
- cards;
- Produção;
- cancelamento;
- Fiscal.

---

# Documentação Relacionada

- `../business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `../business/PEDIDOS-PRODUCAO.md`
- `../business/CHECKOUT-PAGAMENTOS.md`
- `../business/CANCELAMENTO-COBRANCAS.md`
- `../business/CHAT-INTERNO.md`
- `../BUSINESS_RULES.md`
- `../SECURITY.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./DECISOES-TECNICAS.md`
- `./CHANGELOG.md`

---

# Fonte da Verdade

Este documento é histórico.

Ele registra a estratégia de transição do `status_interno`, mas não define sozinho o fluxo vigente.

O comportamento atual deve ser confirmado no código e em `FLUXO-OFICIAL-STATUS-PROPOSTAS.md`.

Nenhuma fase, flag ou exemplo deste arquivo autoriza automação, escrita em produção ou mudança estrutural sem validação atual.

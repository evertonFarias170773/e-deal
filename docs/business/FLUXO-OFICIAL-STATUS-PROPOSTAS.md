# FLUXO-OFICIAL-STATUS-PROPOSTAS.md

Versão: 3.2  
Status: Oficial  
Última atualização: 23/07/2026  
Projeto: Vibe

---

# Fluxo Oficial de Status das Propostas

Este documento define o fluxo oficial de evolução de `public.propostas.status_interno` no Vibe.

Ele organiza a relação entre:

- Comercial;
- Financeiro;
- Arte;
- Produção;
- Expedição;
- cancelamento;
- auditoria;
- entrada e retirada da fila produtiva.

Este documento não autoriza automações, triggers, migrations, RPCs, views ou alterações de RLS.

---

# 1. Princípios Fundamentais

## 1.1 Entidade central

A entidade comercial principal é:

```text
public.propostas
```

Chave operacional:

```text
public.propostas.id_int
```

## 1.2 Estado operacional global

O campo:

```text
public.propostas.status_interno
```

representa o estado operacional global exibido pela proposta.

Ele não substitui:

- status financeiro;
- confirmação de recebimento;
- situação de boleto;
- status de arte por modelo;
- status de Produção por item;
- liberação para Fiscal;
- entrada manual na fila de Produção.

## 1.3 Entrada na Produção

A entrada oficial na fila de Produção é controlada por:

```text
public.propostas.is_prd_aprovado
```

Regra:

```text
is_prd_aprovado = true
```

significa que a proposta foi explicitamente liberada para aparecer no fluxo produtivo.

`status_interno` e `is_prd_aprovado` possuem responsabilidades diferentes.

## 1.4 Evidência não é autorização

Dados de outras tabelas podem servir como evidência para recomendar ou validar uma transição.

Eles não devem alterar `status_interno` automaticamente sem uma automação oficialmente homologada.

---

# 2. Fontes Relacionadas

## Comercial

```text
public.propostas
public.produtos_proposta
```

## Financeiro

```text
public.pagamentos_v2
public.boletos
```

## Arte e Produção

```text
public.pedidos
public.pedidos_modelos
public.pedidos_artes
```

## Auditoria e comunicação

```text
public.propostas_chat
public.propostas_pendencias
```

Cada fonte mantém sua própria responsabilidade.

Não usar `public.propostas.status_interno` como prova de pagamento.

Não usar `public.pagamentos_v2` como substituto do pedido produtivo.

Não usar `public.boletos` como substituto de `public.pagamentos_v2`.

---

# 3. Lista Oficial de Status

Os status operacionais reconhecidos são:

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
EM IMPRESSAO / PENDENTE
EM ACABAMENTO
EM ACABAMENTO / PENDENTE
EXPEDICAO
A RETIRAR
EM TRANSITO
ENTREGUE
```

`EM IMPRESSAO / PENDENTE` e `EM ACABAMENTO / PENDENTE` foram ratificados em 23/07/2026 como pausas operacionais da etapa base correspondente (mesmo padrão de separador de `AGUARDANDO / PENDENTE`).

Status desconhecido não deve ser convertido automaticamente para `NOVO`.

A interface deve preservar o valor recebido e apresentar fallback controlado.

---

# 4. Agrupamento Operacional

## Comercial inicial

```text
NOVO
NOVO / EM ARTE
```

## Financeiro pendente

```text
AGUARDANDO
AGUARDANDO / EM ARTE
AGUARDANDO / PENDENTE
```

## Comercial e financeiro liberados

```text
LIBERADO
LIBERADO / EM ARTE
```

## Revisão e Produção

```text
REVISAO ATENDENTE
REVISAO PRODUCAO
EM PRODUCAO
EM IMPRESSAO
EM IMPRESSAO / PENDENTE
EM ACABAMENTO
EM ACABAMENTO / PENDENTE
```

## Expedição

```text
EXPEDICAO
A RETIRAR
EM TRANSITO
ENTREGUE
```

## Encerramento negativo

```text
CANCELADO
```

---

# 5. Fluxo Geral

```text
NOVO
+-- arte iniciada
¦   +-- NOVO / EM ARTE
¦
+-- cobrança ativa criada
    +-- AGUARDANDO
        +-- arte iniciada
        ¦   +-- AGUARDANDO / EM ARTE
        ¦
        +-- pendência operacional relevante
        ¦   +-- AGUARDANDO / PENDENTE
        ¦
        +-- condição financeira aceita
            +-- LIBERADO
                +-- arte em andamento
                ¦   +-- LIBERADO / EM ARTE
                ¦       +-- artes concluídas
                ¦           +-- REVISAO ATENDENTE
                ¦
                +-- arte não necessária ou concluída
                    +-- REVISAO ATENDENTE
                        +-- revisão do atendente concluída
                            +-- REVISAO PRODUCAO
                                +-- Produção iniciada
                                    +-- EM PRODUCAO
                                        +-- impressão iniciada
                                            +-- EM IMPRESSAO
                                                +-- acabamento iniciado
                                                    +-- EM ACABAMENTO
                                                        +-- envio para Expedição
                                                            +-- EXPEDICAO
                                                                +-- retirada
                                                                ¦   +-- A RETIRAR
                                                                ¦
                                                                +-- transporte
                                                                    +-- EM TRANSITO
                                                                        +-- ENTREGUE
```

`CANCELADO` pode encerrar o fluxo quando o cancelamento for permitido e processado oficialmente.

---

# 6. Regras por Status

## 6.1 `NOVO`

Representa proposta criada, ainda sem cobrança ativa e sem fluxo de arte em andamento.

Não significa:

- pagamento confirmado;
- pedido liberado;
- Produção iniciada;
- proposta aprovada.

Transições esperadas:

```text
NOVO ? NOVO / EM ARTE
NOVO ? AGUARDANDO
NOVO ? CANCELADO
```

## 6.2 `NOVO / EM ARTE`

Representa proposta ainda sem liberação financeira, mas com trabalho de arte iniciado.

A arte pode começar antes da confirmação financeira.

Isso não autoriza:

- impressão;
- fabricação;
- expedição;
- entrada automática na fila produtiva.

Transições esperadas:

```text
NOVO / EM ARTE ? AGUARDANDO / EM ARTE
NOVO / EM ARTE ? CANCELADO
```

## 6.3 `AGUARDANDO`

Representa proposta com cobrança ativa ou condição financeira pendente.

Cobranças canceladas não devem manter a proposta em `AGUARDANDO` apenas por existirem historicamente.

Evidências possíveis:

```text
public.pagamentos_v2.status = 'A_RECEBER'
public.pagamentos_v2.status = 'A_VENCER'
```

Transições esperadas:

```text
AGUARDANDO ? AGUARDANDO / EM ARTE
AGUARDANDO ? AGUARDANDO / PENDENTE
AGUARDANDO ? LIBERADO
AGUARDANDO ? CANCELADO
```

## 6.4 `AGUARDANDO / EM ARTE`

Representa condição financeira ainda pendente e arte em andamento.

A proposta ainda não está liberada para fabricação.

Transições esperadas:

```text
AGUARDANDO / EM ARTE ? LIBERADO / EM ARTE
AGUARDANDO / EM ARTE ? AGUARDANDO / PENDENTE
AGUARDANDO / EM ARTE ? CANCELADO
```

## 6.5 `AGUARDANDO / PENDENTE`

Representa proposta aguardando condição financeira e com pendência operacional que precisa de ação.

A pendência deve estar registrada em:

```text
public.propostas_pendencias
```

Não usar esse status como substituto de uma pendência detalhada.

Transições esperadas:

```text
AGUARDANDO / PENDENTE ? AGUARDANDO
AGUARDANDO / PENDENTE ? AGUARDANDO / EM ARTE
AGUARDANDO / PENDENTE ? LIBERADO
AGUARDANDO / PENDENTE ? CANCELADO
```

## 6.6 `LIBERADO`

Representa proposta com condição comercial e financeira considerada suficiente para avançar.

Não significa automaticamente:

```text
is_prd_aprovado = true
```

A entrada na Produção continua dependendo de ação explícita.

Transições esperadas:

```text
LIBERADO ? LIBERADO / EM ARTE
LIBERADO ? REVISAO ATENDENTE
LIBERADO ? CANCELADO
```

## 6.7 `LIBERADO / EM ARTE`

Representa proposta comercialmente liberada, mas com arte ainda em andamento.

Transições esperadas:

```text
LIBERADO / EM ARTE ? REVISAO ATENDENTE
LIBERADO / EM ARTE ? CANCELADO
```

Antes de avançar, validar a situação dos modelos e artes existentes.

## 6.8 `REVISAO ATENDENTE`

Representa proposta pronta para conferência final do atendente antes do encaminhamento produtivo.

Validar:

- cliente;
- itens;
- quantidades;
- modelos;
- arte;
- numeração;
- observações;
- frete;
- contexto financeiro;
- pendências abertas.

Transição esperada:

```text
REVISAO ATENDENTE ? REVISAO PRODUCAO
```

## 6.9 `REVISAO PRODUCAO`

Representa proposta encaminhada para análise da equipe responsável pela Produção.

Nesse estágio, validar:

- elegibilidade produtiva;
- OS ou Boletim;
- modelos;
- arte;
- numeração;
- prioridade;
- materiais;
- capacidade;
- prazo;
- liberação manual.

Transição esperada:

```text
REVISAO PRODUCAO ? EM PRODUCAO
```

A entrada na lista oficial depende também de `is_prd_aprovado = true`.

## 6.10 `EM PRODUCAO`

Representa execução produtiva iniciada.

Não deve ser atribuído somente porque a arte foi aprovada ou o pagamento foi confirmado.

Transição esperada:

```text
EM PRODUCAO ? EM IMPRESSAO
```

## 6.11 `EM IMPRESSAO`

Representa impressão em andamento.

Transições esperadas:

```text
EM IMPRESSAO ? EM ACABAMENTO
EM IMPRESSAO ? EM IMPRESSAO / PENDENTE
```

## 6.11.1 `EM IMPRESSAO / PENDENTE`

Representa impressão pausada por impedimento operacional (ex.: falta de material, aguardo de arte ou máquina indisponível).

O motivo da pausa é opcional e, quando informado, é registrado na auditoria.

Transições esperadas:

```text
EM IMPRESSAO / PENDENTE ? EM IMPRESSAO
```

A retomada da etapa base é a transição natural. Qualquer outra saída é excepcional, com motivo opcional.

## 6.12 `EM ACABAMENTO`

Representa atividades posteriores à impressão, como corte, serrilha, dobra, laminação, revisão e embalagem.

Transições esperadas:

```text
EM ACABAMENTO ? EXPEDICAO
EM ACABAMENTO ? EM ACABAMENTO / PENDENTE
```

## 6.12.1 `EM ACABAMENTO / PENDENTE`

Representa acabamento pausado por impedimento operacional.

O motivo da pausa é opcional e, quando informado, é registrado na auditoria.

Transições esperadas:

```text
EM ACABAMENTO / PENDENTE ? EM ACABAMENTO
```

A retomada da etapa base é a transição natural. Qualquer outra saída é excepcional, com motivo opcional.

## 6.13 `EXPEDICAO`

Representa produto concluído e encaminhado ao fluxo de entrega.

Transições:

```text
EXPEDICAO ? A RETIRAR
EXPEDICAO ? EM TRANSITO
```

A escolha depende do método real de entrega.

O próximo natural é determinado pela cotação de frete escolhida (`public.cotacao_frete.escolhido = true`):

- serviço de retirada (ex.: `RETIRA BALCÃO`, `RETIRADA LOCAL`) ? natural é `A RETIRAR`;
- serviço de transporte (transportadora, SEDEX, motoboy etc.) ? natural é `EM TRANSITO`;
- sem cotação escolhida ou serviço não informativo ? nenhum dos dois é natural; ambos ficam disponíveis com confirmação.

## 6.14 `A RETIRAR`

Representa pedido pronto aguardando retirada.

A confirmação da retirada deve seguir o fluxo oficial.

A transição final pode ser:

```text
A RETIRAR ? ENTREGUE
```

## 6.15 `EM TRANSITO`

Representa pedido coletado ou despachado.

Transição:

```text
EM TRANSITO ? ENTREGUE
```

A confirmação deve vir de evidência operacional válida.

## 6.16 `ENTREGUE`

Representa entrega concluída.

É estado terminal positivo, inclusive para o fluxo público de QR de produção: após `ENTREGUE`, o QR apenas informa a conclusão e não oferece transições.

Uma reabertura precisa de fluxo específico e auditoria, executado exclusivamente pelo ERP.

## 6.17 `CANCELADO`

Representa encerramento cancelado da proposta.

O cancelamento precisa considerar:

- cobrança;
- pagamento;
- boleto;
- produção iniciada;
- nota fiscal;
- expedição;
- integração externa;
- permissões;
- motivo;
- auditoria.

Não retornar automaticamente para `NOVO`.

---

# 7. Regra Financeira

## 7.1 Recebimento real

Fonte:

```text
public.pagamentos_v2
```

Recebimento efetivo:

```text
status = 'PAID'
```

Quando exigido pelo fluxo atual:

```text
confirmado = true
```

## 7.2 Recebimento futuro aprovado

Um registro:

```text
status = 'A_VENCER'
AND confirmado = true
```

representa condição futura aprovada.

Ele não deve ser descrito como dinheiro já recebido.

Pode ser aceito como condição para avanço comercial quando a regra oficial permitir.

## 7.3 Cobrança pendente

```text
status = 'A_RECEBER'
```

representa cobrança ainda não aprovada ou não concluída.

## 7.4 Cancelamento

```text
status = 'CANCELADO'
```

não conta como cobrança ativa para manter a proposta em `AGUARDANDO`.

## 7.5 Boletos

Fonte:

```text
public.boletos
```

Boletos representam contas a receber e vencimentos.

Eles não devem substituir `public.pagamentos_v2` na apuração de recebimento real.

---

# 8. Regra de Arte

Fontes:

```text
public.pedidos_modelos
public.pedidos_artes
```

A arte pode fornecer evidência para estados compostos.

Ela não deve promover o status global sem transição homologada.

Antes de avançar de `LIBERADO / EM ARTE` para `REVISAO ATENDENTE`, confirmar:

- modelos esperados;
- arte exigida;
- existência do arquivo;
- situação de cada modelo;
- ausência de pendência bloqueante;
- responsável pela aprovação.

O fluxo atual de arte precisa respeitar as permissões da Matriz de Segurança.

## 8.1 Arte dispensada — produto de prateleira

Vigente desde 10/08/2026.

Produto de prateleira é vendido pronto: não existe arte para criar, revisar ou
aprovar. O indicador é:

```text
public.produtos.is_estoque = true
```

congelado no item da proposta no momento do save:

```text
public.produtos_proposta.is_estoque
```

A dispensa vale quando a proposta **não é avulsa**, tem **ao menos um item
ativo** (`status_item <> 'CANCELADO'`) e **todos** os itens ativos são de
prateleira. Uma única linha sem o flag mantém o fluxo de arte integral.

Nesse caso a transição `LIBERADO → REVISAO ATENDENTE` ocorre sem passar por
arte — é a materialização do "ou dispensada" já previsto em §6.6 e na matriz da
§13. Não há status novo.

A dispensa **não** altera:

- a exigência financeira (cobertura integral pela regra oficial de quitação);
- a revisão do atendente;
- a liberação manual para Produção (`is_prd_aprovado`, §9.1).

Aplicada em dois pontos, para não depender da interface:

```text
src/features/orcamentos/services/status-engine.service.ts   (evidência arteDispensada)
public.check_and_promote_proposta                            (garantia no banco)
```

Ocultar a aba "Artes" na proposta é apenas apresentação.

Nenhuma pendência de arte fictícia é criada: sem modelos, `propostas.em_arte`
permanece `false` pelo próprio trigger existente, e `public.pedidos_artes` só
recebe linha quando a aba Artes é usada.

---

# 9. Entrada e Retirada da Produção

## 9.1 Liberação

A ação oficial altera:

```text
public.propostas.is_prd_aprovado
```

para:

```text
true
```

A liberação deve ser:

- manual;
- explícita;
- autorizada;
- auditável;
- executada pelo fluxo oficial;
- confirmada pelo banco.

Não existem autorizações neste documento para trigger ou sincronização automática dessa flag.

## 9.2 Consulta da fila

A lista de pedidos produtivos deve filtrar:

```text
is_prd_aprovado = true
```

Não usar somente `status_interno`.

## 9.3 Retirada da fila

A ação oficial pode alterar:

```text
is_prd_aprovado = false
```

somente quando:

- o perfil possuir permissão;
- a etapa atual permitir;
- não houver bloqueio produtivo;
- houver confirmação;
- a operação for auditada.

A retirada da fila não deve apagar o histórico nem redefinir `status_interno` automaticamente.

---

# 10. Transições Manuais e Automáticas

## Estado atual

As transições devem ser consideradas manuais ou controladas pelo fluxo oficial.

Automações descritas em documentos históricos permanecem suspensas até homologação explícita.

Não implementar automaticamente:

- mudança ao criar cobrança;
- mudança ao confirmar pagamento;
- mudança ao atribuir designer;
- mudança ao aprovar arte;
- mudança ao iniciar Produção;
- mudança ao concluir impressão;
- mudança por Expedição.

Uma automação futura exige:

1. evento;
2. origem;
3. estado anterior;
4. estado posterior;
5. condição;
6. permissão;
7. idempotência;
8. auditoria;
9. feature flag;
10. modo sombra;
11. rollback;
12. homologação.

---

# 11. Auditoria

Toda escrita real em `status_interno` deve registrar:

- `id_int`;
- status anterior;
- status novo;
- usuário;
- perfil;
- origem;
- motivo;
- data e hora;
- resultado da operação.

A timeline pode utilizar:

```text
public.propostas_chat
```

A mensagem não substitui a gravação oficial.

A falha na auditoria deve ser tratada conforme a criticidade definida pelo fluxo.

---

# 12. Proteções

Não permitir:

- regressão silenciosa para `NOVO`;
- avanço produtivo somente por pagamento;
- avanço produtivo somente por arte;
- alteração por texto do chat;
- alteração por componente sem serviço oficial;
- escrita sem permissão;
- escrita sem validação do estado anterior;
- mudança em massa sem autorização;
- automação sem feature flag;
- bypass de RLS;
- uso de `service_role` no frontend;
- sucesso visual sem confirmação do banco.

---

# 13. Matriz Resumida de Transições

| Origem | Destino | Condição mínima | Execução atual |
|---|---|---|---|
| `NOVO` | `NOVO / EM ARTE` | Arte iniciada | Controlada |
| `NOVO` | `AGUARDANDO` | Cobrança ativa | Controlada |
| `NOVO / EM ARTE` | `AGUARDANDO / EM ARTE` | Cobrança ativa | Controlada |
| `AGUARDANDO` | `AGUARDANDO / EM ARTE` | Arte iniciada | Controlada |
| `AGUARDANDO` | `AGUARDANDO / PENDENTE` | Pendência relevante | Controlada |
| `AGUARDANDO` | `LIBERADO` | Condição financeira aceita | Controlada |
| `AGUARDANDO / EM ARTE` | `LIBERADO / EM ARTE` | Condição financeira aceita | Controlada |
| `LIBERADO` | `LIBERADO / EM ARTE` | Arte ainda necessária | Controlada |
| `LIBERADO` | `REVISAO ATENDENTE` | Arte concluída ou dispensada (§8.1 — produto de prateleira) | Controlada |
| `LIBERADO / EM ARTE` | `REVISAO ATENDENTE` | Artes concluídas | Controlada |
| `REVISAO ATENDENTE` | `REVISAO PRODUCAO` | Revisão final aprovada | Manual |
| `REVISAO PRODUCAO` | `EM PRODUCAO` | Produção iniciada | Manual |
| `EM PRODUCAO` | `EM IMPRESSAO` | Impressão iniciada | Manual (ERP ou QR de Produção) |
| `EM IMPRESSAO` | `EM IMPRESSAO / PENDENTE` | Pausa (motivo opcional) | Manual (ERP ou QR de Produção) |
| `EM IMPRESSAO / PENDENTE` | `EM IMPRESSAO` | Impedimento resolvido | Manual (ERP ou QR de Produção) |
| `EM IMPRESSAO` | `EM ACABAMENTO` | Impressão concluída | Manual (ERP ou QR de Produção) |
| `EM ACABAMENTO` | `EM ACABAMENTO / PENDENTE` | Pausa (motivo opcional) | Manual (ERP ou QR de Produção) |
| `EM ACABAMENTO / PENDENTE` | `EM ACABAMENTO` | Impedimento resolvido | Manual (ERP ou QR de Produção) |
| `EM ACABAMENTO` | `EXPEDICAO` | Produção concluída | Manual (ERP ou QR de Produção) |
| `EXPEDICAO` | `A RETIRAR` | Retirada definida | Manual (ERP ou QR de Produção) |
| `EXPEDICAO` | `EM TRANSITO` | Coleta confirmada | Manual (ERP ou QR de Produção) |
| `A RETIRAR` | `ENTREGUE` | Retirada confirmada | Manual (ERP ou QR de Produção) |
| `EM TRANSITO` | `ENTREGUE` | Entrega confirmada | Manual (ERP ou QR de Produção) |

“Controlada” significa que a transição deve passar pelo serviço oficial e pelas validações do projeto.

Não significa automação autônoma.

O QR de Produção (página pública `/os`, origem `qr_producao`) é um executor oficial das transições entre os status operacionais de produção e expedição listados acima. Regras específicas do QR:

- salto, retorno, pausa e troca entre `A RETIRAR` e `EM TRANSITO` aceitam motivo **opcional** — quando informado, é registrado na auditoria e na timeline (regra vigente desde 23/07/2026; a obrigatoriedade anterior foi removida);
- `ENTREGUE` exige confirmação reforçada e é terminal (sem transições posteriores via QR);
- destino igual ao status atual é rejeitado;
- status fora da lista de produção/expedição permanecem controlados exclusivamente pelo ERP (`FORA_DO_FLUXO` no QR);
- toda transição registra `os_status_log` (status anterior, novo, tipo, motivo, origem `qr_producao`) e mensagem SISTEMA na timeline.

---

# 14. Validação Obrigatória

Antes de alterar `status_interno`, validar:

- proposta correta;
- `id_int`;
- status atual;
- transição permitida;
- usuário autenticado;
- permissão;
- empresa;
- setor;
- vendedor;
- evidências;
- pendências;
- financeiro;
- arte;
- Produção;
- Expedição;
- bloqueios;
- auditoria;
- retorno real do banco.

Depois da escrita:

- confirmar o novo valor;
- atualizar a interface;
- evitar cache antigo;
- registrar a transição;
- validar ausência de regressão.

---

# 15. Responsabilidade dos Módulos

## Comercial

Pode conduzir:

```text
NOVO
NOVO / EM ARTE
AGUARDANDO
AGUARDANDO / EM ARTE
AGUARDANDO / PENDENTE
LIBERADO
LIBERADO / EM ARTE
REVISAO ATENDENTE
```

conforme permissões.

## Financeiro

Fornece evidências de:

- cobrança;
- aprovação;
- recebimento;
- cancelamento;
- vencimento.

O Financeiro não deve alterar estados produtivos arbitrariamente.

## Arte

Fornece evidências sobre modelos e arquivos.

A Arte não libera a proposta para Produção sozinha.

## Produção

Conduz:

```text
REVISAO PRODUCAO
EM PRODUCAO
EM IMPRESSAO
EM IMPRESSAO / PENDENTE
EM ACABAMENTO
EM ACABAMENTO / PENDENTE
```

conforme permissões.

## Expedição

Conduz:

```text
EXPEDICAO
A RETIRAR
EM TRANSITO
ENTREGUE
```

conforme permissões.

---

# 16. Documentação Relacionada

- `../BUSINESS_RULES.md`
- `../PROJECT_CONTEXT.md`
- `../SECURITY.md`
- `./PEDIDOS-PRODUCAO.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `./CANCELAMENTO-COBRANCAS.md`
- `./CHAT-INTERNO.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../maestro/MAESTRO-KNOWLEDGE-BASE.md`
- `../history/STATUS-INTERNO-PROPOSTAS.md`

---

# Fonte da Verdade

`public.propostas.status_interno` representa o estado operacional global da proposta.

`public.propostas.is_prd_aprovado` controla a entrada manual na fila de Produção.

`public.pagamentos_v2` representa pagamentos e recebimentos.

`public.boletos` representa contas a receber e vencimentos.

`public.pedidos_modelos` e `public.pedidos_artes` representam evidências operacionais de modelos e arte.

Nenhuma tabela secundária deve alterar automaticamente o status global sem automação oficialmente homologada.

Qualquer alteração deste fluxo precisa ser refletida neste documento, no código central, na Matriz de Segurança e nos testes.

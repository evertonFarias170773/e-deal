# STATUS-MAESTRO-V2.md

Versão: 2.0  
Status: Oficial — Implementado com homologações pendentes  
Última atualização: 18/07/2026  
Projeto: ERP Ideal

---

# Status do Maestro V2

Este documento consolida o estado atual do Maestro V2 no fluxo de Orçamentos e Cotações Avulsas.

Seu objetivo é registrar:

- o que está implementado;
- as decisões técnicas preservadas;
- as restrições de segurança;
- os pontos ainda pendentes de homologação;
- o roteiro recomendado para retomada dos testes.

Este documento não autoriza alterações de banco, schema, RLS, triggers, RPCs ou views.

---

# 1. Resumo Executivo

O fluxo principal do Maestro V2 está funcional para montagem assistida de cotações.

A implementação atual já contempla:

- identificação do cliente;
- interpretação de produtos e quantidades;
- escolha de endereço;
- cálculo de frete;
- opção Retira no Balcão;
- aplicação de bônus do cliente;
- manutenção de uma cotação ativa em memória;
- edição e refação da cotação;
- confirmação antes da gravação definitiva.

O principal ponto pendente é a homologação completa dos cenários de edição quando existe uma cotação em `pendingSaveQuotation`.

---

# 2. Estado Atual por Capacidade

| Capacidade | Estado |
|---|---|
| Identificação do cliente | Implementado |
| Parse de produtos e quantidades | Implementado |
| Catálogo com nome comercial canônico | Implementado |
| Escolha de endereço | Implementado |
| Cálculo de frete por integrações disponíveis | Implementado |
| Retira no Balcão | Implementado |
| Aplicação de bônus do cliente | Corrigido e validado |
| Estado `pendingSaveQuotation` | Implementado |
| Confirmação antes de salvar | Implementado |
| Edição de item em cotação ativa | Corrigido, pendente de homologação completa |
| Substituição total de itens | Corrigido, pendente de homologação completa |
| Refação da cotação | Corrigido, pendente de homologação completa |
| Preservação de Retira no Balcão após edição | Implementado, pendente de homologação |
| Preservação automática de transportadora após edição | Não permitida; exige nova escolha |
| Revisão visual de nomes de produtos | Pendente |
| Agente externo de intenção | POC controlada por feature flag |

---

# 3. Fluxo Principal Implementado

O Maestro V2 processa a cotação nesta ordem:

```text
identificar cliente
↓
resolver produtos e quantidades
↓
confirmar endereço
↓
calcular frete
↓
aplicar bônus e regras comerciais
↓
apresentar resumo
↓
armazenar em pendingSaveQuotation
↓
aguardar confirmação explícita
↓
salvar somente pelo fluxo oficial
```

A proposta não deve ser salva automaticamente ao concluir o cálculo.

---

# 4. Identificação de Cliente

O Maestro identifica o cliente por código interno ou outro identificador suportado pelo fluxo atual.

A consulta deve preservar:

- sessão autenticada;
- RLS;
- escopo do usuário;
- uso do identificador interno correto;
- isolamento entre clientes.

A view `vw_cadastros_clientes_lista` pode ser utilizada como fonte de consulta homologada pelo adapter.

A fonte cadastral principal do ERP continua sendo:

```text
public.clientes
```

Não alterar RLS, schema ou views para corrigir problemas de passagem de contexto sem diagnóstico e autorização explícita.

---

# 5. Parse de Itens e Quantidades

O Maestro interpreta frases com produto e quantidade, incluindo intenções compostas.

Exemplos esperados:

```text
cotação de 3450 triband para cliente 8469
```

```text
criar cotação com 1000 MOBI e 1000 TEX
```

```text
refazer com 1000 mobi e 900 triband
```

A interpretação semântica identifica a intenção.

A resolução final de produto, preço, quantidade, bônus, peso e total permanece no código oficial do ERP.

---

# 6. Nomenclatura Canônica dos Produtos

Produtos com descrições extensas devem ser apresentados pelo nome comercial oficial.

A correção foi aplicada no fluxo de resolução do orçamento, utilizando o `nomeComercial` do catálogo oficial.

Exemplo homologado:

```text
Pulseira TexBand
```

em vez de uma descrição técnica extensa.

Arquivo relacionado:

```text
maestro-orcamento-resolver.server.ts
```

A apresentação não deve alterar o identificador real nem a regra de preço do produto.

---

# 7. Escolha de Endereço

Quando o cliente possuir mais de um endereço aplicável, o Maestro deve solicitar confirmação.

O Maestro não deve escolher endereço de entrega por suposição.

A seleção do endereço influencia:

- destino do frete;
- prazo;
- transportadora;
- valor total.

Após alteração relevante da cotação, o endereço pode ser mantido quando continuar válido.

---

# 8. Frete

O Maestro utiliza o motor oficial de frete e as integrações disponíveis no projeto.

## Retira no Balcão

A opção Retira no Balcão é uma modalidade válida:

```text
valor: R$ 0,00
prazo: A combinar
```

Ela não deve ser escolhida automaticamente apenas por ser a opção mais barata.

O usuário precisa selecioná-la explicitamente.

## Edição da cotação

Quando a cotação for alterada:

- Retira no Balcão pode permanecer selecionado;
- frete por transportadora deve ser recalculado;
- a transportadora anterior não deve ser mantida automaticamente após mudança de peso, quantidade ou valor.

---

# 9. Bônus do Cliente

## Caso homologado

Cliente de validação:

```text
8469 — LISITON
```

Campos reais:

```text
public.clientes.is_bonus = true
public.clientes.percentual_bunus = 8
```

O nome `percentual_bunus` deve ser preservado enquanto esse for o campo real do banco.

## Causa do problema

O bônus estava disponível no banco, mas se perdia durante a serialização entre:

```text
SimpleContext
↓
ConversationContext
```

Não era falha de RLS nem indisponibilidade do cadastro.

## Correção aplicada

O `ConversationContext` passou a transportar:

```text
clientIsBonus
clientPercentualBonus
```

## Exemplo validado

```text
Subtotal dos produtos: R$ 592,00
Bônus do cliente: 8%
Desconto do bônus: R$ 47,36
Subtotal com bônus: R$ 544,64
```

Todo recálculo monetário deve continuar usando o motor oficial do ERP.

---

# 10. Estado `pendingSaveQuotation`

`pendingSaveQuotation` representa uma cotação calculada e apresentada, mas ainda não persistida definitivamente.

Enquanto esse estado estiver ativo, o Maestro deve aceitar:

- confirmação para salvar;
- pergunta paralela que não destrua a cotação;
- alteração parcial de item;
- substituição completa;
- refação explícita;
- cancelamento da operação.

A presença desse estado não pode impedir a interpretação de uma nova instrução válida.

---

# 11. Edição e Refação da Cotação Ativa

A correção foi implementada, mas ainda exige homologação completa.

## Alteração parcial

Frases:

```text
900 mobi
são 900 mobi
```

Comportamento esperado:

- alterar apenas a quantidade do MOBI;
- manter os outros itens;
- recalcular totais, peso, bônus e frete;
- manter Retira no Balcão quando selecionado;
- exigir nova seleção para transportadora.

---

## Substituição explícita

Frases:

```text
só 900 mobi
apenas 900 mobi
```

Comportamento esperado:

- remover os outros itens;
- manter apenas MOBI com quantidade 900;
- recalcular toda a cotação.

---

## Lista composta em cotação ativa

Frase:

```text
1000 mobi e 900 triband
```

Comportamento esperado:

- substituir a lista ativa pela nova composição;
- recalcular toda a cotação;
- não mesclar silenciosamente com itens anteriores.

---

## Refação explícita

Frase:

```text
refazer com 1000 mobi e 900 triband
```

Comportamento esperado:

- descartar os itens anteriores;
- reconstruir a cotação;
- preservar o cliente ativo;
- preservar o endereço quando ainda aplicável;
- recalcular o frete;
- retornar ao estado de confirmação.

---

# 12. Perguntas Paralelas Durante a Cotação

O Maestro deve responder perguntas cadastrais ou comerciais compatíveis sem destruir `pendingSaveQuotation`.

Exemplo:

```text
esse cliente tem bônus?
```

Depois da resposta, a cotação ativa deve continuar disponível.

A pergunta paralela não deve:

- salvar a cotação;
- limpar o carrinho;
- trocar o cliente;
- alterar quantidades;
- perder o endereço;
- confirmar o frete automaticamente.

---

# 13. Decisões Técnicas e de Segurança

## RLS

Proibido usar client anônimo para contornar RLS.

Consultas protegidas devem usar a sessão autenticada e os adapters oficiais.

## Service Role

Proibido usar `service_role` no fluxo do usuário para forçar acesso a clientes, propostas ou dados financeiros.

## Banco

Não alterar:

- schema;
- migrations;
- policies;
- views;
- RPCs;
- triggers.

Essas alterações só podem ser consideradas após necessidade confirmada e autorização explícita.

## Cálculos

A IA não pode aplicar ajuste proporcional próprio.

Todo valor monetário deve voltar ao motor oficial do ERP.

## Integrações

O n8n e agentes externos podem interpretar intenção, mas não devem definir:

- preços;
- permissões;
- regras de negócio;
- gravações;
- status;
- totais;
- aprovação da cotação.

---

# 14. Maestro External Intent

Existe uma POC de agente externo para interpretação semântica.

Feature flag:

```text
MAESTRO_EXTERNAL_INTENT_ENABLED
```

Configuração recomendada:

```text
Production: false
Preview/Homologação: true somente durante testes controlados
```

O agente externo atua apenas como intérprete.

A validação e a execução permanecem no código do ERP.

Não considerar a POC como dependência obrigatória do fluxo principal.

---

# 15. Pendências Atuais

## Homologação funcional

Validar completamente:

- alteração parcial;
- substituição;
- refação;
- preservação de Retira no Balcão;
- nova escolha de transportadora;
- pergunta paralela durante a cotação;
- preservação do cliente e endereço;
- retorno correto ao estado de confirmação.

## Revisão visual

Verificar presenters que ainda podem exibir descrições extensas.

Prioridade:

- Triband;
- MOBI;
- TEX;
- demais itens com nomes técnicos longos.

## Regressão

Confirmar que as correções não quebraram:

- consulta cadastral;
- bônus;
- endereço;
- frete;
- cálculo oficial;
- confirmação de salvamento;
- follow-ups do cliente ativo.

---

# 16. Roteiro de Homologação

Executar no ambiente de Preview/Homologação.

Nenhuma migration ou alteração de banco deve ser realizada para esses testes.

## Cenário principal

1. Enviar:

```text
cotação de 3450 triband para cliente 8469
```

2. Confirmar que o sistema solicita endereço.

3. Selecionar um endereço válido.

4. Validar o bônus de 8%.

5. Confirmar:

```text
Desconto esperado: R$ 47,36
```

quando o subtotal for R$ 592,00.

6. Escolher Retira no Balcão.

7. Conferir o total final.

8. Confirmar que a cotação está em `pendingSaveQuotation`.

---

## Pergunta paralela

Enviar:

```text
esse cliente tem bônus?
```

Esperado:

- resposta correta;
- cotação preservada;
- nenhum salvamento;
- nenhum recálculo indevido.

---

## Nova cotação composta

Sem salvar a cotação anterior, enviar:

```text
criar cotação 1000 MOBI + 1000 TEX
```

Esperado:

- roteamento correto;
- nova composição;
- nomes comerciais;
- fluxo normal de endereço e frete.

---

## Alteração parcial

Com a cotação em `pendingSaveQuotation`, enviar:

```text
900 mobi
```

Esperado:

- MOBI atualizado para 900;
- TEX preservado;
- totais recalculados;
- Retira no Balcão preservado, quando selecionado.

---

## Substituição

Enviar:

```text
só 900 mobi
```

Esperado:

- TEX removido;
- somente MOBI com 900 unidades;
- totais recalculados.

---

## Refação

Enviar:

```text
refazer com 1000 mobi e 900 triband
```

Esperado:

- itens anteriores descartados;
- nova lista aplicada;
- cotação recalculada;
- transportadora anterior não preservada automaticamente;
- Retira no Balcão preservado somente quando essa modalidade já estava selecionada e continua válida.

---

# 17. Critérios de Aprovação

A homologação será considerada concluída quando:

- todos os cenários retornarem o resultado esperado;
- nenhum cálculo for feito pela IA fora do motor oficial;
- o cliente ativo permanecer correto;
- `pendingSaveQuotation` não bloquear edições;
- perguntas paralelas não destruírem a cotação;
- a escolha de frete seguir as regras documentadas;
- não houver salvamento automático;
- não houver alteração de banco;
- os nomes comerciais estiverem consistentes;
- não houver regressão nas consultas já homologadas.

---

# 18. Retorno Esperado da Homologação

Ao concluir os testes, registrar:

- cenários aprovados;
- cenários reprovados;
- mensagem enviada;
- comportamento observado;
- comportamento esperado;
- arquivos envolvidos;
- logs relevantes;
- risco restante.

Não declarar a fase totalmente homologada enquanto houver falha nos cenários de edição e refação.

---

# 19. Documentação Relacionada

- `./MAESTRO-VISAO-PRODUTO.md`
- `./MAESTRO-KNOWLEDGE-BASE.md`
- `./MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md`
- `./MAESTRO-FASE-2-PEDIDOS-FINANCEIRO.md`
- `./MAESTRO-PROMPT-BASE.md`
- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`

---

# Fonte da Verdade

Este documento registra o status atual e o roteiro de homologação do Maestro V2.

A implementação real define o comportamento disponível.

Os testes homologados definem o que pode ser considerado concluído.

Nenhuma correção de contexto, apresentação ou interpretação autoriza alteração de banco ou flexibilização de RLS.

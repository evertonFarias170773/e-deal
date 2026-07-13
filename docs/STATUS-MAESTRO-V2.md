# Status do Maestro V2 (Check-in Sexta-feira)

Este documento consolida o estado atual do desenvolvimento do Maestro V2 (Módulo de Orçamentos/Cotações Avulsas), detalhando o que foi concluído, decisões técnicas importantes, restrições de segurança e os próximos passos para a retomada do trabalho na segunda-feira.

## 1. O Que Está Funcionando (Concluído)

O fluxo principal do Maestro V2 está operacional e estruturado para processar cotações com os seguintes recursos integrados:
- **Identificação de Cliente**: Busca baseada por código interno ou identificadores.
- **Parse de Itens e Quantidades**: Suporta compreensão de produtos com quantidades.
- **Escolha de Endereço**: Identifica e seleciona endereços vinculados ao cliente.
- **Cálculo de Frete (APIs Múltiplas)**: Calcula opções reais com as transportadoras.
- **Retira no Balcão**: Opção de frete nativa fixa (R$ 0,00, prazo "A combinar") e plenamente selecionável. Não é escolhido de forma forçada pelo menor preço.
- **Bônus de Cliente Ativo**: Cálculo de desconto no subtotal baseado no `percentual_bunus` do cadastro.
- **Estado Transicional (`pendingSaveQuotation`)**: A cotação alcança um estágio final aguardando confirmação do usuário antes de ser salva definitivamente no banco de dados. A proposta **não é salva automaticamente**.

### 1.1 Correção do Bônus (Cliente 8469/LISITON)
- O bônus real sempre esteve corretamente na tabela `public.clientes` (campos `is_bonus` = `true` e `percentual_bunus` = `8`).
- O problema diagnosticado **não** era de RLS ou indisponibilidade no banco de dados.
- **A causa:** O bônus se perdia na fronteira de serialização entre o `SimpleContext` do backend e o contexto legado (`ConversationContext`) do frontend.
- **A solução:** A estrutura do `ConversationContext` foi atualizada para transportar `clientIsBonus` e `clientPercentualBonus`. O recálculo funciona perfeitamente: 
  *(Subtotal produtos: R$ 592,00 | Bônus cliente: 8% | Desconto bônus: -R$ 47,36 | Subtotal com bônus: R$ 544,64).*

### 1.2 Nomenclatura Canônica do Produto
- Os produtos longos como o TEX (antes mostrando a descrição gigante) agora respeitam a nomenclatura curta no Maestro.
- Solução integrada pelo `maestro-orcamento-resolver.server.ts` que força a injeção do `nomeComercial` ("Pulseira TexBand") da base do catálogo oficial.

---

## 2. Decisões Técnicas e de Segurança

As seguintes abordagens de segurança foram estritamente decididas e bloqueadas contra flexibilizações:
- **Proibido usar client Anon para burlar RLS**: Sessões não autenticadas não devem puxar detalhes sensíveis do cliente para o Maestro.
- **Proibido usar Service Role no Client Flow**: O Maestro V2 não deve injetar a chave de Service Role para forçar o carregamento de clientes, protegendo contra brechas de RLS na lógica de frente.
- **Banco e RLS Intocáveis**: Não alterar esquemas, policies, views ou RPCs para resolver falhas de UI ou passagem de contexto sem análise prévia e aprovação explícita.
- **Fontes Autorizadas**: Continuaremos respeitando as views oficiais (ex: `vw_cadastros_clientes_lista`) como fonte confiável para consultas, sem quebrar os silos já validados.
- **Ajuste Proporcional Restrito**: Nunca tentar aplicar ajuste proporcional (divisão customizada via IA) de valores; todo e qualquer recálculo monetário volta obrigatoriamente para a esteira oficial do motor do ERP.

### Maestro External Intent (Agent Service POC)
- A POC do Agente de IA terceirizado (n8n/Agente autônomo) existe mas **continua restrita e controlada** pela variável de ambiente `MAESTRO_EXTERNAL_INTENT_ENABLED`.
- Recomendação: `false` em Production; `true` apenas em Preview/Homologação.
- Arquitetura: O Agent atua apenas como intérprete semântico. A validação, segurança e efetivação da lógica do ERP ficam no código fonte da aplicação (Node/React). O n8n **não deve ser** o cérebro principal.

---

## 3. Estado Atual: Pendências para Segunda-feira

### 3.1 Refação/Edição com Cotação Ativa (O Plano Aprovado)
A falha ao editar itens de uma cotação no estado `pendingSaveQuotation` (estado em que o bot parava de interpretar a frase de edição e travava perguntando se o usuário ia salvar) foi diagnosticada e o plano foi documentado e aprovado. **O código foi corrigido**, mas precisamos retomar na segunda testando as validações:

As regras implementadas que precisamos certificar no fluxo real:
- `"900 mobi"` ou `"são 900 mobi"` -> Atualiza a quantidade apenas do MOBI (mantém demais itens se houver).
- `"só 900 mobi"` ou `"apenas 900 mobi"` -> Substituição (REPLACE) direta, limpando os outros itens do carrinho.
- `"1000 mobi e 900 triband"` (com cotação ativa) -> Substituição completa da lista.
- `"refazer com 1000 mobi e 900 triband"` -> Descarta itens velhos e refaz a simulação.
- **Frete Retira no Balcão**: Se o usuário editar a cotação e ele tivesse escolhido "Retira no Balcão", o Maestro mantém a escolha ativa. Se fosse transportadora, será necessário reescolher devido ao novo peso/valor.

### 3.2 Visual
- Alguns presenters podem ainda vazar nomes muito descritivos. Uma revisão visual deve ser feita com foco no Triband e outros itens do catálogo.

---

## 4. Roteiro de Testes Prioritários (Segunda-feira)

Ao retomar os trabalhos, execute a seguinte sequência lógica de testes no preview para certificar a fluidez completa:

1. Mandar intenção simples: `"cotação de 3450 triband para cli 8469"`.
2. O sistema deve pedir para **escolher endereço**. (Escolha um).
3. **Validar bônus 8%**: Conferir se o log reflete a matemática do bônus calculada em R$ 47,36 de desconto.
4. O sistema pedirá frete. **Escolher Retira no balcão**.
5. Validar total final exato.
6. Fazer a pergunta paralela: `"esse cliente tem bônus?"` (O Maestro deve informar corretamente sem estragar o rascunho de save).
7. Sem salvar a cotação antiga, mande uma nova intenção composta: `"criar cotação 1000 MOBI + 1000 TEX"`. (Deverá ser roteada corretamente).
8. Depois do bot chegar no final (`pendingSaveQuotation`), mande a mensagem `"900 mobi"`. (Deverá recalcular a quantidade de MOBI e manter a opção Retira no Balcão se estiver selecionada).
9. Mande `"só 900 mobi"`. (Deverá limpar o TEX e ficar só com MOBI).
10. Mande `"refazer com 1000 mobi e 900 triband"`. (Deverá repopular o carrinho e repassar pelo fluxo).

*(Nenhuma migração ou alteração de banco deve ser feita para testar isso)*.

---
**Fim de ciclo:** *Pronto para retomar os trabalhos no próximo dia útil com segurança arquitetural resguardada.*

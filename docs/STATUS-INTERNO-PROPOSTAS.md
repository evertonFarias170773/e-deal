# Estratégia de Centralização: status_interno (Propostas)

Este documento descreve a estratégia técnica reversível e faseada para a migração conceitual onde `public.propostas` passa a ser a entidade central de Orçamento / Proposta / Pedido no ERP Ideal. O andamento macro operacional do ciclo passa a ser governado pelo campo `status_interno`. A tabela `public.pedidos` será convertida no futuro em uma tabela para registrar Boletins / OS, permitindo mais de uma OS para a mesma proposta.

---

## 1. Regras de Ouro
- **Nenhuma migration destrutiva**: Não excluiremos colunas de `pedidos` enquanto não migrarmos todos os dados;
- **Sem exclusões financeiras**: O status de um pagamento segue usando cancelamento lógico (`status = CANCELADO`), a não ser no webhook remoto homologado;
- **Nada de DROP ou ALTER**: Triggers, RPCs e Views originais de status não podem ser editados sem aprovação;
- **Feature Flags**: Toda e qualquer injeção deste novo comportamento deve rodar controlada pelas Flags de ambiente (descritas abaixo).

---

## 2. Fases de Rollout

### Fase 0: Mapeamento e Diagnóstico (Concluída)
- Documentação identificando o uso de `pedidos` como entidade principal.
- Descoberta das colunas estruturais em `propostas` preparadas para absorver o ciclo (como `status_interno`, `etapa_operacional`).

### Fase 1: Motor Puro e Preparação de Código (Concluída)
- Criação deste documento.
- Criação de Flags no `src/lib/feature-flags.ts`.
- Criação da *Engine Pura* `calcularStatusRecomendado` (que recebe evidências em memória e sugere o status, sem tocar no banco de dados).
- Adicionar avisos (TODOs técnicos) nos fluxos onde ocorre bloqueio de Múltiplas OS's.

### Fase 2: Modo Sombra (Shadow Mode) (Concluída)
- **Objetivo:** Rodar a *Engine Pura* silenciosamente no ambiente real.
- **Como ativar/desativar:** Ajustar `FEATURE_STATUS_PROPOSTAS_SHADOW_MODE` (via `.env.local` ou `localStorage` dependendo da injeção client-side do Next.js se `NEXT_PUBLIC` for usado). Para desativar, basta manter como `false`.
- **Como validar:** Ao abrir o detalhe de uma proposta (`OrcamentoFormPage`), se a flag estiver `true`, um box visual "Diagnóstico Sombra" (verde ou amarelo) aparecerá discretamente relatando divergências entre o status oficial gravado e a sugestão da engine.
- **Riscos e Limitações:** Sem risco de quebra pois a consulta é leitura pura (`diagnosticarStatusShadow`) e o componente de UI não polui o estado principal. A listagem principal (`OrcamentosListPageReal`) não consome o diagnóstico para não sobrecarregar leituras (Custo de Performance). Não reflete ainda no `status_interno` real. A divergência não é erro, é um log.
- Gerar Logs/Trilhas (console, Datadog ou Tabela `logs_status_sombra`) para checar precisão (ainda opcional nesta fase).

### Fase 3: Ativação Visual / Híbrida (Concluída)
- **Objetivo:** Exibir visualmente o resultado da *Engine Pura* no painel apenas se houver permissão e se a funcionalidade estiver ativada globalmente.
- **Como ativar:** `FEATURE_STATUS_PROPOSTAS_V2=true` e `NEXT_PUBLIC_FEATURE_STATUS_PROPOSTAS_SHADOW_MODE=true`.
- **Como validar:** Componente de diagnóstico não aparece para usuários comuns. Apenas `admin`, `superAdmin` (ou `dev`) têm acesso ao diagnóstico na tela `OrcamentoFormPage`.
- **Limitações e Riscos:** Se falhar na leitura, a tela não deve quebrar e o diagnóstico simplesmente é abortado, exibindo a tela principal. O status oficial exibido globalmente na aplicação (listagens) continuará sendo `propostas.status_interno` (ou fallback), pois a Fase 3 evitou poluir *endpoints* de listagem com *queries* densas, deixando a prova de fogo visual contida no detalhe da proposta.
- **Critério para avançar à Fase 4:** O diagnóstico sombra validou satisfatoriamente o comportamento pretendido para as transições financeiras e os gestores confirmaram que a *Engine* propõe as decisões corretas de acordo com a regra de negócio.

### Fase 4A: Escrita Controlada (Homologada Localmente)
- **Status:** Testado localmente com sucesso.
- **Escopo Homologado:** Diagnóstico Sombra integrado. Botão de aplicação manual exibido apenas para `admin/superAdmin` via feature flags. Atualização persistida no banco `public.propostas.status_interno`, com logs prévios e finais no `propostas_chat`.
- **Limites (Proibidos):** Sem alteração indevida em `pagamentos_v2`, `pedidos`, `pedidos_modelos` ou `pedidos_artes`. Sem automação de gatilhos. Sem ativação em produção sem decisão explícita.

### Fase 4A.1: Malha Receptora Homologada (Estado Atual)
- **Status:** Concluída e homologada.
- **Objetivo:** Preparar o ERP para ler e proteger status compostos sem automatizar a transição.
- **O que está implementado e ativo:**
  - **Diagnóstico Sombra (Shadow Mode):** Ativo para usuários admin.
  - **Escrita Controlada:** O botão de aplicar status funciona, mas de forma 100% manual.
  - **Listagem e Badges:** Preparados para os 17 status. Sem regressão visual forçada para `NOVO`.
  - **Filtros e Busca:** Encontram propostas por termos compostos (ex: "Produção", "Expedição").
  - **Cards Superiores:** Agrupam corretamente. Aprovadas contêm etapas ativas da fábrica.
  - **Proteção de Cadastros:** Bloqueio de deleção abrange de `LIBERADO` até `ENTREGUE`.
  - **Cancelamento de Cobrança:** Protegido contra regressão. Não devolve para `NOVO` propostas que já estejam na fábrica.
  - **Boletim / Produção:** Aceita status compostos além de `LIBERADO`.

---

## 3. O Que Ainda Não Está Liberado (Fase 4B Suspensa)

As seguintes automações estão **expressamente pausadas e não liberadas** no ambiente atual:
- Automação de status por gatilhos (Engine autônoma).
- Mudança automática ao criar cobrança.
- Mudança automática ao confirmar pagamento.
- Mudança automática ao enviar/aprovar arte.
- Mudança automática por andamento da produção ou expedição.
- Alteração em massa.
- Uso dessas automações em ambiente de produção sem aprovação explícita.

---

## 4. Como Alterar o Plano no Futuro

Qualquer evolução ou reativação da Fase 4B deve, obrigatoriamente, passar pelas seguintes definições prévias documentadas:
- **Matriz de Status:** O status de destino deve estar na constante global.
- **Matriz de Transições Permitidas:** Definir regras rígidas de "De -> Para".
- **Origem do Evento:** Quem dispara (ex: Financeiro, Arte, Usuário).
- **Tipo de Gatilho:** Manual ou Automático.
- **Auditoria:** Obrigatório prever Log no `propostas_chat`.
- **Rollback:** Caminho claro para reverter a transição em caso de falha sistêmica.
- **Validação Sombra:** Toda nova regra deve rodar em modo sombra (apenas sugerindo) antes de ser autorizada a gravar na base.

---

## 5. Regra de Escalabilidade

Para manter o ERP saudável e imune a quebras:
1. **Tipagem Centralizada:** Status não devem ser tratados como strings soltas em componentes (`if status === "EM PRODUCAO"`). Use constantes e matrizes centrais (ex: `mappers.ts`, `types.ts`).
2. **Fallback Seguro:** Status desconhecido nunca pode virar `NOVO` de forma arbitrária.
3. **Escrita Restrita:** Qualquer nova transição operacional deve primeiro ser homologada na Matriz.
4. **Rastreabilidade:** Qualquer escrita real no `status_interno` precisa de uma origem (quem chamou) e registrar log.
5. **Automação Condicional:** Qualquer gatilho autônomo precisa ser governado por uma *Feature Flag* e possuir script de reversão.

---

## 6. Matriz Futura de Eventos (Exemplos não implementados)

Esta seção apenas documenta o comportamento teórico da futura automação. **Nenhuma destas automações está ativa.**

- **Cobrança criada:**
  - Origem: Financeiro
  - Possível transição: `NOVO` → `AGUARDANDO`
  - Automático: Futuro
  - Status atual: Não implementado

- **Cobrança criada com arte em andamento:**
  - Origem: Financeiro + Arte
  - Possível transição: `NOVO / EM ARTE` → `AGUARDANDO / EM ARTE`
  - Automático: Futuro
  - Status atual: Não implementado

- **Todos pagamentos confirmados:**
  - Origem: Financeiro
  - Possível transição: `AGUARDANDO` → `LIBERADO`
  - Automático: Futuro
  - Status atual: Não implementado

- **Todos pagamentos confirmados com arte em andamento:**
  - Origem: Financeiro + Arte
  - Possível transição: `AGUARDANDO / EM ARTE` → `LIBERADO / EM ARTE`
  - Automático: Futuro
  - Status atual: Não implementado

- **Todas artes aprovadas:**
  - Origem: Arte
  - Possível transição: `LIBERADO / EM ARTE` → `REVISAO ATENDENTE`
  - Automático: Futuro
  - Status atual: Não implementado

---

## 7. Refatoração Gradual e Limpeza (Fases 5 e 6)
- Eliminação do uso de `pedidos` como indexador principal das telas de produção.
- Execução de Migration futura para remover campos legados (`status_producao`). 

---

## 3. Estratégia de Rollback

A migração por Feature Flags isola os riscos, mas em caso de anomalia, o procedimento de reversão é simples e determinístico:

| Problema Encontrado | Como Reverter |
|---|---|
| Problema de interface (Filtros, Kanbans sumiram OS) | Desligar variável de ambiente `FEATURE_STATUS_PROPOSTAS_V2=false` e reiniciar Next.js. O painel volta a consultar `public.pedidos` automaticamente. |
| Motor Puro calculando errado em Produção (Shadow Mode) | Desligar a flag `FEATURE_STATUS_PROPOSTAS_SHADOW_MODE=false`. A engine não consumirá mais log ou recursos da máquina. |
| Problemas de Escrita (Fase 4: status quebrando a proposta) | Paralisar a feature flag de escrita (a implementar) ou rolar os deploys via Vercel/Ambiente para o commit anterior à virada da chave. Nenhuma Migration terá sido rodada, logo a base suporta o código antigo nativamente. |

---

## 4. Status Desejados do `status_interno`
- `NOVO`
- `NOVO / EM ARTE`
- `AGUARDANDO`
- `AGUARDANDO / EM ARTE`
- `AGUARDANDO / PENDENTE`
- `LIBERADO`
- `LIBERADO / EM ARTE`
- `CANCELADO`
- `REVISAO ATENDENTE`
- `REVISAO PRODUCAO`
- `EM PRODUCAO`
- `EM IMPRESSAO`
- `EM ACABAMENTO`
- `EXPEDICAO`
- `A RETIRAR`
- `EM TRANSITO`
- `ENTREGUE`

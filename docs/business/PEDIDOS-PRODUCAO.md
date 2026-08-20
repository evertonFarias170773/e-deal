# PEDIDOS-PRODUCAO.md

Versão: 2.2  
Status: Oficial — Implementação parcial e evolução controlada  
Última atualização: 20/08/2026  
Projeto: Vibe

---

# Pedidos e Produção

Este documento define o funcionamento atual, os limites e a evolução planejada do módulo de Pedidos e Produção do Vibe.

Ele substitui a antiga classificação de “modelagem sem tabelas”, porque o projeto já possui estruturas reais para Boletim/OS, modelos e artes.

As capacidades futuras continuam claramente separadas do que já está implementado.

---

# 1. Objetivo do Módulo

O módulo de Produção transforma uma proposta comercial em trabalho operacional de fábrica.

Ele deve permitir que a equipe acompanhe:

- briefing;
- modelos ou lotes;
- arte;
- numeração;
- Ordem de Serviço;
- impressão;
- acabamento;
- revisão;
- pesagem;
- expedição;
- pendências entre setores.

O módulo não substitui:

- Comercial;
- Financeiro;
- Contas a Receber;
- Fiscal;
- Expedição;
- regras de permissão;
- Matriz de Segurança.

---

# 2. Entidade Central e Chave Operacional

A origem do fluxo é:

```text
public.propostas
```

Chave operacional:

```text
public.propostas.id_int
```

Todo registro produtivo deve permanecer rastreável ao mesmo `id_int`.

Relações atuais relevantes:

```text
public.propostas.id_int
├── public.produtos_proposta.id_int
├── public.pagamentos_v2.id_int
├── public.boletos.id_int
├── public.cotacao_frete.id_int
├── public.propostas_chat.id_int
├── public.propostas_pendencias.id_int
├── public.propostas_os.id_int
│   └── public.propostas_os_setores.id_os
├── public.propostas_os_setores.id_int
├── public.pedidos_modelos.id_int
└── public.pedidos_artes.id_int
```

Não criar uma segunda chave operacional para representar o mesmo pedido.

---

# 3. Diferença entre Proposta, Pedido e OS

## Proposta

É a entidade comercial.

Fonte:

```text
public.propostas
```

Contém cliente, vendedor, empresa, valores, itens, frete e estado comercial.

## Pedido liberado para Produção

É uma proposta incluída oficialmente na fila produtiva.

Regra vigente:

```text
public.propostas.is_prd_aprovado = true
```

A liberação é manual e deve ocorrer pelo fluxo oficial.

`status_interno = APROVADO` sozinho não comprova entrada na Produção.

## Boletim ou OS

É o registro operacional usado para organizar briefing, modelos e instruções de fábrica.

Estrutura atual:

```text
public.pedidos
```

`public.pedidos` não substitui a proposta como origem comercial.

---

# 4. Regra Fundamental: Arte e Produção Não São a Mesma Etapa

O trabalho de arte pode começar antes da confirmação financeira.

Isso permite:

- receber referências;
- montar briefing;
- designar designer;
- criar arte;
- revisar internamente;
- preparar modelos.

Esse início antecipado não significa que o pedido esteja liberado para fabricação.

A entrada oficial na fila produtiva depende da liberação manual:

```text
is_prd_aprovado = true
```

Portanto:

```text
Arte pode começar antes do pagamento.
↓
Impressão e execução produtiva dependem da liberação oficial.
```

O sistema pode exibir alerta financeiro sem bloquear o trabalho preliminar de arte.

Ele não deve iniciar fabricação automaticamente.

---

# 5. Estruturas Atuais

## `public.propostas_os`

Era `public.pedidos` e foi renomeada — a primary key ainda se chama
`pedidos_pkey`. Documentos que citem `public.pedidos` referem-se a esta tabela;
`public.pedidos` não existe mais no banco.

Função atual:

- cabeçalho da OS: **uma linha por pedido**, nunca uma por setor;
- vínculo com a proposta por `id_int`;
- dados do pedido inteiro: cliente, endereço, valores, rastreio, forma de envio;
- armazenamento controlado de observações (`obs`).

Operações autorizadas atualmente:

- `INSERT` controlado na abertura do Boletim/OS;
- `UPDATE` de `obs` e `data_termino`;
- `DELETE` bloqueado.

Não ampliar o payload sem atualização prévia da Matriz de Segurança.

**Uma linha por pedido é premissa do código**, não convenção: duas leituras
usam `.maybeSingle()` filtrando por `id_int` (`pedidos-detalhe.service.ts` e
`boletim-propostas.service.ts`) e passariam a devolver erro; a Expedição resolve
o pedido com `Map.set(id_int, …)` e passaria a depender da ordem das linhas.

`status_pedido`, `status_arte`, `status_producao` e `status_expedicao` são
gravados no `INSERT` e nunca mais atualizados (12 de 12 linhas em `BLOQUEADO`).
Não os use como estado corrente — o status do pedido é
`propostas.status_interno`.

---

## `public.propostas_os_setores`

Criada em 13/08/2026. **Uma linha por setor de produção do pedido**
(PVC, LASER, FLEXO, TEXTIL) — é o Boletim daquele setor.

Função atual:

- prazo e hora do setor;
- `status_producao`: a fase daquele setor, no vocabulário de
  `public.osqr__status_qr()` até o acabamento, mais `CONCLUIDO`;
- conferência/revisão do setor: peso real, volumes, tipo de volume e
  responsável.

Regras:

- unicidade `(id_int, setor)` garantida por constraint;
- `id_os` liga ao cabeçalho da OS e é anulável — o vínculo obrigatório é
  `id_int`;
- expedição **não** é por setor: o pedido é despachado inteiro. Desde
  16/08/2026 a conferência de cada setor é preenchida na aba **Revisão** do
  boletim (§19), não mais num bloco dentro da aba do próprio setor — mas a
  gravação continua aqui, uma linha por setor;
- `propostas.status_interno` espelha a fase do setor **menos adiantado**;
  quando todos concluem, nada é escrito — a saída da produção segue pelo
  caminho existente.

Antes desta tabela o boletim de setor era gravado em `public.pedidos_artes`.
Isso tinha efeito real e indesejado: cada boletim aberto criava uma linha que
contava como evidência de arte em `check_and_promote_proposta` (que lê a linha
mais recente) e em `liberarPropostaParaProducao` (que exige todas em
`APROVADO`) — um boletim em `EM ARTE` travava a liberação do pedido.

---

## `public.pedidos_modelos`

Função atual:

- subdividir os itens da proposta em modelos ou lotes;
- registrar quantidade;
- registrar numeração;
- registrar instruções de impressão;
- manter vínculo com o item original da proposta.

Campo de origem atual:

```text
id_produto_proposta_origem
```

Operações autorizadas:

- `INSERT` controlado em lote;
- `UPDATE` bloqueado;
- `DELETE` bloqueado.

Uma alteração futura de modelos salvos exige fluxo específico e nova autorização.

---

## `public.pedidos_artes`

Função atual — **somente arte e briefing**:

- registrar a arte e o briefing da proposta (evento, data, local, designer);
- armazenar identificação do arquivo e a lista `arquivos` (jsonb);
- manter vínculo com Storage;
- registrar autor do envio;
- preservar rastreabilidade por `id_int`.

O vínculo é por `id_int`: **não existe coluna ligando a arte a um modelo**.

Operação atual:

- `INSERT` do briefing e das versões de arte;
- `UPDATE` do briefing, dos anexos e do `status` (o código atualiza — a
  restrição "UPDATE bloqueado" de versões anteriores deste documento não
  corresponde à implementação);
- `DELETE` bloqueado.

`status` desta tabela é evidência de ARTE e alimenta
`check_and_promote_proposta` e `liberarPropostaParaProducao`. Nada de produção
deve ser gravado aqui — o boletim de setor mora em
`public.propostas_os_setores`. As colunas `setor`, `prazo` e `hora` continuam
existindo por causa do rollback da migração de 13/08/2026, mas estão vazias e
não devem voltar a ser usadas.

Versionamento completo, reprovação, substituição e múltiplas versões ainda não estão autorizados apenas por este documento.

---

## `public.propostas_chat`

É a timeline operacional compartilhada da proposta.

O módulo de Produção deve reutilizá-la.

Tipos relevantes:

```text
SISTEMA
PRODUCAO
MENSAGEM
```

Não criar tabela paralela de histórico para o pedido.

---

## `public.propostas_pendencias`

É a estrutura oficial para pendências operacionais entre setores.

Pode registrar situações como:

- arte aguardando ajuste;
- falta de material;
- dúvida comercial;
- prazo em risco;
- divergência de produção;
- necessidade de ação da Expedição.

A criação e a atualização devem respeitar as políticas vigentes.

---

# 6. Estruturas Não Confirmadas ou Futuras

As estruturas abaixo permanecem conceituais até diagnóstico e aprovação:

```text
public.pedidos_itens
public.ordens_servico
public.pedidos_artes_aprovacoes
public.pedidos_modelos_config_impressao
public.pedidos_kanban_status
public.pedidos_pacotes
public.pedidos_pesagem
```

Este documento não autoriza:

- criação de tabelas;
- migrations;
- triggers;
- RPCs;
- views;
- policies;
- novos buckets;
- alteração das tabelas existentes.

---

# 7. Fluxo Operacional

## Etapa 1 — Proposta e contexto comercial

O Comercial registra a proposta e os itens.

Fonte:

```text
public.propostas
public.produtos_proposta
```

## Etapa 2 — Briefing e referências

O atendente reúne:

- nome do evento;
- quantidades;
- modelos;
- cores;
- logos;
- referências;
- instruções;
- dados variáveis;
- prazo esperado.

Informações técnicas não devem ser inventadas a partir do catálogo.

## Etapa 3 — Modelos ou lotes

Os itens podem ser subdivididos em modelos.

Exemplo:

```text
Item: 3.000 unidades
├── Modelo Azul: 750
├── Modelo Vermelho: 750
├── Modelo Verde: 1.000
└── Modelo Amarelo: 500
```

Regra:

```text
SUM(modelos.quantidade) <= quantidade do item original
```

Se a soma ultrapassar a quantidade do item, o salvamento deve ser bloqueado.

Se houver saldo não distribuído, a interface deve alertar claramente.

## Etapa 4 — Arte

A arte pode ser preparada antes da liberação financeira.

O fluxo atual permite o primeiro registro controlado.

Fluxos de revisão, nova versão e aprovação externa permanecem como evolução futura.

## Etapa 5 — Liberação para Produção

A proposta entra na fila produtiva somente após a ação oficial que define:

```text
is_prd_aprovado = true
```

A ação deve validar o contexto vigente, permissões e condições obrigatórias.

## Etapa 6 — Boletim ou OS

O registro pai é criado em `public.pedidos`.

Os modelos são registrados em `public.pedidos_modelos`.

As observações devem permanecer dentro do formato usado pelo serviço oficial.

## Etapa 7 — Impressão

A impressão é o núcleo da execução fabril.

Ela deve receber:

- modelo correto;
- quantidade;
- arte correta;
- numeração;
- instruções;
- prioridade;
- responsável;
- rastreabilidade por `id_int`.

## Etapa 8 — Acabamento e revisão

Após a impressão:

- corte;
- serrilha;
- dobra;
- laminação;
- conferência;
- embalagem;
- separação por volumes.

A conferência e a separação por volumes têm lugar definido no sistema desde
16/08/2026: a aba **Revisão** do boletim (§19).

## Etapa 9 — Expedição

A Produção entrega o pedido concluído ao fluxo de Expedição.

A entrega é o botão **"Confirmar revisão e liberar para Expedição"** da aba
Revisão — que não escreve status por conta própria: delega a `marcarPronto`, a
mesma função do botão "Marcar pronto" do painel `/expedicao`
(`EXPEDICAO.md` §3.4).

Ela não deve marcar recebimento financeiro nem emitir nota fiscal.

---

# 8. Status Global da Proposta

O estado global deve seguir o fluxo oficial de `status_interno`.

Estados produtivos documentados:

```text
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

As transições devem usar a matriz central do projeto.

Não espalhar comparações com strings em componentes.

Status desconhecido nunca deve virar `NOVO` automaticamente.

A liberação da fila produtiva continua separada e depende de `is_prd_aprovado`.

## Pausas e transições via QR de Produção

`EM IMPRESSAO / PENDENTE` e `EM ACABAMENTO / PENDENTE` representam pausa operacional da etapa base (falta de material, aguardo de arte, máquina indisponível). O motivo da pausa é opcional e, quando informado, fica registrado na auditoria; a retomada da etapa base é a transição natural.

A página pública `/os` (QR impresso na OS, origem `qr_producao`) é executor oficial das transições entre os status produtivos e logísticos: destaca o próximo natural, permite pausa, salto e retorno com motivo opcional (registrado quando informado), exige confirmação reforçada para `ENTREGUE` (terminal — sem transição posterior via QR) e registra tudo em `public.os_status_log` e na timeline. O próximo natural de `EXPEDICAO` segue a cotação de frete escolhida (retirada → `A RETIRAR`; transporte → `EM TRANSITO`; sem informação → nenhum natural, ambos disponíveis). Detalhes normativos: `FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §13 e Matriz de Segurança (seção QR de Produção).

Uma proposta pausada permanece na fila de `/pedidos` (o filtro da fila inclui os status `/ PENDENTE`).

### Quem escaneia logado abre o boletim (16/08/2026)

O QR impresso é um só e continua público — o celular do chão de fábrica não faz login. O que mudou é o destino de quem **já tem sessão no ERP**:

- ao abrir `/os`, o client consulta `GET /api/os-qr/sessao` **em paralelo** com a consulta do token;
- a rota lê apenas a sessão do cookie e responde `{ autenticado, podeEditar }`, onde `podeEditar` é `pedidos.view` (Produção tem no perfil; Admin e Super Admin passam pelo wildcard). Ela **nunca recebe nem devolve o token do QR**;
- com `podeEditar` e `id_int` resolvido, a página redireciona para a edição do boletim correspondente. Sem isso, permanece na página pública de troca de status — que é o comportamento útil para quem não tem permissão, melhor do que cair numa tela de acesso negado depois do redirect;
- falha na consulta de sessão nunca derruba o fluxo público: o `catch` responde não-autenticado.

Depende de `OS_QR_PUBLICO_ENABLED=true`, `OS_QR_TOKEN_SECRET` (o mesmo valor em todos os ambientes — trocar invalida os QRs já impressos) e `SUPABASE_SERVICE_ROLE_KEY`, aplicadas na Vercel em 17/08/2026.

---

# 8-A. Encerramento de Pedido de Teste (20/08/2026)

A transição do sistema antigo deixou pedidos de teste nas filas de trabalho. Eles **não são apagados** — o histórico e a trilha de auditoria são reais. O que se faz é tirá-los das listas operacionais.

## Fonte

```text
public.propostas.encerrado_teste_em   timestamptz
public.propostas.encerrado_teste_por  text
```

`encerrado_teste_em IS NULL` é o pedido normal. Preenchida, o pedido está encerrado como teste.

Migration: `supabase/migrations/20260820_propostas_encerrado_teste.sql` (aditiva, sem backfill, sem default, sem índice).

## Não é status, e não é `is_prd_aprovado`

Encerrar teste **não cria status novo**: a lista oficial de `status_interno` continua intacta, e o pedido preserva o estado operacional real que tinha (um pedido `EM TRANSITO` marcado continua `EM TRANSITO`). Ver `FLUXO-OFICIAL-STATUS-PROPOSTAS.md`, que não muda por causa desta funcionalidade.

Também **não reaproveita `is_prd_aprovado`**, que continua com um só significado: entrada oficial na fila produtiva. São ações diferentes e coexistem no menu Ações:

| Ação | O que faz | Reversão |
|---|---|---|
| **Retirar da Produção** | `is_prd_aprovado = false`. O pedido deixa de ser pedido de fábrica. | Só pelo fluxo oficial, que exige `status_interno = REVISAO ATENDENTE`. Um pedido `EM TRANSITO` não volta. |
| **Encerrar teste** | Grava `encerrado_teste_em`. Some das filas, sem tocar em status nem em `is_prd_aprovado`. | Imediata: "Reabrir", em Orçamentos. |

## Onde o pedido some — e onde não some

| Superfície | Some? | Como |
|---|---|---|
| Painel geral de Produção (`/pedidos`) | Sim | `.is("encerrado_teste_em", null)` em `listarPedidosOperacionais` |
| Kanban (`/pedidos/kanban`, `/os-producao`) | Sim | mesma função |
| Fila de impressão (`/pedidos/impressao`) | Sim | mesma função — a fila cruza `pedidos_modelos` com essa lista e descarta o modelo cujo pedido não veio; **não tem filtro próprio** |
| Painel de Expedição (`/expedicao`) | Sim | `.is("encerrado_teste_em", null)` em `listarPainelExpedicao` |
| Dashboard → bloco Produção | Sim | filtro em `rpc_dashboard_executivo` |
| **Orçamentos** (`/orcamentos`) | **Não** | continua visível, com badge `teste encerrado` |
| Busca por número, URL direta, histórico do cliente em Cadastros | **Não** | acesso preservado de propósito |
| Faturamento, relatório de vendas, ranking, Contas a Receber, Cobranças | **Não** | movidos por `pagamentos_v2`/`boletos` |

O corte é independente do auto-ocultar de `ENTREGUE` após 30 dias na Expedição: um trata de pedido que nunca foi real, o outro de pedido real que já terminou.

## Não mexe em dinheiro

Pedido de teste encerrado **segue contando no faturamento**. Todos os pedidos marcáveis hoje têm pagamento `PAID` confirmado em `pagamentos_v2`, e nenhuma soma financeira é filtrada por esta marca. Retirar pedido de teste do faturamento é tarefa à parte, com decisão própria — não presuma que encerrar o teste resolve isso.

## Reversão

O badge em Orçamentos é o caminho de volta: o pedido marcado nunca some dessa lista, justamente para poder ser reaberto. O chip **"Mostrar encerrados"** recorta a lista para só os marcados (inclusive `CANCELADO`, que o filtro padrão excluiria) — é o atalho para revisar e desfazer, não um toggle de esconder/mostrar.

"Encerrar teste" aparece no menu Ações de Produção, Expedição e Orçamentos. **"Reabrir" existe só em Orçamentos**: nas outras duas telas o pedido marcado já saiu da lista, então lá o item seria inalcançável.

## Permissão e onde ela é garantida

Chave `propostas.release_producao` — a **mesma** de "Retirar da Produção". Não há chave nova: mesma natureza (tirar pedido das listas operacionais) e mesmo alcance. Vale o fallback padrão (super admin sempre; `is_admin` por fallback).

A tranca é `POST /api/pedidos/encerrar-teste`, que revalida a permissão no servidor com `verificarPermissaoServerSide`. Esconder o item do menu **não protege nada**: a RLS de `public.propostas` é aberta para `authenticated` (política `update_all_propostas`, `qual = true`).

**Limite conhecido:** enquanto essa RLS estiver aberta, um usuário autenticado ainda consegue escrever a coluna chamando o PostgREST direto, por fora do app. Fechar isso é apertar a RLS de `propostas` — decisão maior, que afeta todos os fluxos de escrita da tabela, e continua em aberto.

## Marcação

Manual, um a um, pela tela. **Não existe critério automático** e nenhum backfill foi feito: os sinais que separam teste de operação real (cliente, valor em centavos, pagamento por E-CREDITO, e-mail do criador) coincidem com pedidos reais em parte dos casos. Toda marcação e reabertura registra linha na timeline (`propostas_chat`, `setor = PRODUCAO`) e entra na auditoria (`audit.logs_v2`, via `trg_audit_propostas`).

---

# 9. Status de Modelos e Artes

Os campos de status existentes devem ser tratados conforme o código atual.

Este documento não cria uma enumeração nova.

Possíveis estados futuros de arte, ainda conceituais:

```text
PENDENTE
EM CRIACAO
EM REVISAO INTERNA
AGUARDANDO CLIENTE
REPROVADA CLIENTE
APROVADA CLIENTE
LIBERADA
IMPRESSA
NAO NECESSARIA
```

Antes de implementar esses valores:

- confirmar os valores atuais;
- definir transições;
- definir responsáveis;
- definir auditoria;
- validar compatibilidade com dados existentes;
- atualizar a Matriz de Segurança.

---

# 10. Numeração

A numeração pode ser:

- sequencial por modelo;
- sequencial global;
- fixa;
- sem numeração;
- QR Code;
- código de barras;
- dados variáveis;
- combinação de formatos.

A implementação atual deve usar somente os campos já disponíveis em `public.pedidos_modelos`.

Configurações avançadas, como posição, fonte, rotação, QR e CSV, continuam futuras.

## Continuidade

Para numeração sequencial global:

```text
fim = início + quantidade - 1
```

O modelo seguinte inicia depois do fim anterior.

A aplicação deve impedir:

- intervalos sobrepostos;
- quantidade negativa;
- fim menor que início;
- duplicidade não autorizada.

---

# 11. Arte e Storage

O upload deve ocorrer pelo serviço oficial da Ficha de OS.

Antes de aceitar um arquivo, validar:

- modelo correto;
- usuário autenticado;
- permissão;
- tamanho;
- MIME;
- extensão;
- resposta real do Storage;
- vínculo com `id_int`;
- ausência de arte anterior quando a regra permitir somente versão 1.

Não afirmar que um tipo de arquivo é aceito apenas pela extensão.

A política do bucket, MIME permitido e tamanho máximo devem ser confirmados na implementação atual.

Falha de upload deve ser exibida ao usuário.

Nenhuma mensagem de sucesso pode aparecer antes da confirmação do Storage e do banco.

---

# 12. Chat como Timeline Operacional

O Chat Interno acompanha o mesmo `id_int`.

Eventos produtivos relevantes podem gerar mensagens como:

- Boletim aberto;
- modelo registrado;
- arte enviada;
- produção iniciada;
- impressão concluída;
- pedido encaminhado à Expedição;
- pendência criada ou concluída.

Regras:

- usar `visivel_externo = false`;
- não executar regras de negócio pelo texto da mensagem;
- não usar o chat como fonte do status;
- não gravar eventos em trigger SQL apenas para alimentar a timeline;
- evitar duplicidade;
- registrar origem e responsável.

Falha na mensagem automática não deve falsificar a operação principal.

A ação oficial permanece a fonte da verdade.

---

# 13. Menções e Pendências

Menções servem para comunicação.

Elas não concedem permissão e não executam transições.

Exemplos:

```text
@Comercial
@Producao
@Expedicao
```

Menção de setor só deve existir quando estiver implementada e homologada.

Enquanto isso, utilizar usuários reais resolvidos pelo autocomplete.

Pendências devem registrar:

- título;
- categoria;
- prioridade;
- responsável ou setor;
- prazo quando aplicável;
- origem;
- vínculo por `id_int`.

Não excluir pendências fisicamente.

---

# 14. Papéis Operacionais

## Atendente ou vendedor

Responsabilidades:

- reunir briefing;
- confirmar modelos;
- orientar numeração;
- designar designer quando o fluxo permitir;
- revisar arte;
- comunicar o cliente;
- registrar decisões;
- liberar arte conforme permissão.

## Designer

Responsabilidades:

- produzir a arte;
- usar o briefing;
- enviar o arquivo pelo fluxo oficial;
- registrar observações;
- responder ajustes.

O designer não libera Produção por conta própria.

## Gerente de Produção

Responsabilidades:

- analisar os pedidos liberados;
- organizar prioridade;
- revisar OS;
- iniciar execução;
- acompanhar impressão e acabamento;
- tratar produção parcial;
- encaminhar para Expedição.

## Financeiro

Responsabilidades:

- confirmar pagamentos;
- controlar cobranças;
- informar situação financeira.

O Financeiro não deve editar modelos ou artes apenas por confirmar pagamento.

## Administrador

Pode possuir permissões ampliadas, mas continua sujeito:

- às regras de negócio;
- à Matriz de Segurança;
- à auditoria;
- aos bloqueios estruturais.

---

# 15. Permissões

A interface deve usar permissões granulares.

Uma matriz visual de papéis neste documento não substitui `PERFIS-PERMISSOES.md`.

Antes de exibir ou executar uma ação, validar:

- sessão;
- perfil;
- permissão;
- empresa;
- setor;
- vendedor;
- estado atual;
- operação autorizada na Matriz.

Ocultar botão não substitui validação no backend ou RLS.

---

# 16. Kanban de Produção

O Kanban permanece como evolução planejada, salvo componentes já confirmados no código.

Colunas conceituais:

```text
ARTE
APROVACAO
AGUARDANDO OS
IMPRESSAO
ACABAMENTO
REVISAO
EXPEDICAO
```

Cada card pode apresentar:

- `id_int`;
- cliente;
- produto principal;
- quantidade;
- modelos;
- prazo;
- prioridade;
- estado de arte;
- responsável;
- alerta financeiro.

Antes de implementar reordenação:

- definir fonte de posição;
- definir permissão;
- definir persistência;
- definir conflito concorrente;
- definir auditoria;
- atualizar Matriz de Segurança.

Não criar `pedidos_kanban_status` sem necessidade confirmada.

---

# 17. Decisões Operacionais

## Falta de material

O sistema deve criar uma pendência e registrar a decisão.

Ele não deve substituir material automaticamente.

## Mudança de arte após liberação

A alteração exige:

- confirmação de que ainda não foi impressa;
- autorização do responsável;
- nova versão;
- rastreabilidade;
- avaliação de custo quando aplicável.

O fluxo atual de versão 1 não autoriza substituição direta.

## Produção parcial

A produção parcial precisa de regra específica por modelo.

Enquanto atualizações de `public.pedidos_modelos` estiverem bloqueadas, esse fluxo não pode ser simulado como persistência real.

## Urgência

Urgência deve ser registrada em campo oficial ou pendência.

Não inferir urgência apenas por texto no chat.

## Prazo inviável

O sistema deve dar visibilidade da fila.

Ele não deve prometer automaticamente uma nova data ao cliente.

## Financeiro pendente

Pode permitir trabalho de arte.

A impressão e a fabricação dependem da liberação oficial e das regras atuais.

---

# 18. Aprovação do Cliente

Não existe autorização neste documento para criar portal público de aprovação de arte.

Uma implementação futura exige definição de:

- rota;
- autenticação ou token;
- validade;
- uso único;
- versão da arte;
- armazenamento da decisão;
- proteção contra enumeração;
- campos públicos;
- auditoria;
- IP e privacidade;
- revogação;
- RLS;
- integração com o status;
- confirmação do atendente.

O cliente não deve acessar o Chat Interno.

A aprovação externa não substitui a liberação final interna.

---

# 19. Revisão, Pesagem e Volumes

Implementado em 16/08/2026. A aba **Expedição** do boletim foi substituída pela
aba **Revisão** (`abaExpedicao` no código, `BoletimFormPage.tsx`), e a
conferência deixou de ser feita setor a setor, espalhada pelas abas.

## Antes

Cada aba de setor tinha um "BLOCO 8 — Revisão / Conferência" com peso, volume,
tipo e responsável **daquele setor**, e a aba Expedição repetia os mesmos campos
mais frete, transportadora, prazo e CEP — os mesmos dados que o modal Despachar
do painel `/expedicao` já edita, com risco de um sobrescrever o outro.

## Agora

A aba Revisão reúne tudo em uma tela, na ordem em que a bancada trabalha:

| Bloco | Campos | Onde grava |
|---|---|---|
| Um por setor do pedido | peso estimado (derivado, somente leitura), **peso real (kg)**, **responsável pela conferência** | `propostas_os_setores`, uma linha por setor |
| Volume e peso do pedido | **qtd de volumes**, **tipo de volume**, peso líquido (derivado, somente leitura), **peso bruto total (kg)** | `expedicoes` (`qtd_volumes`, `tipo_volume`, `peso_bruto_kg`) |
| Peso por volume | peso bruto de cada volume, só quando a quantidade é maior que 1 | `expedicoes.pesos_volumes` (jsonb) |
| Fechamento | pendências listadas por setor + botão "Confirmar revisão e liberar para Expedição" | — |

Decisões que sustentam esse desenho:

- **Volume é do pedido, não do setor.** Por isso quantidade, tipo e peso bruto
  saíram dos blocos por setor e viraram um bloco único. O que continua por setor
  é o que só o setor sabe: quanto ele entregou e quem conferiu.
- **Peso líquido é referência derivada, não digitada.** É a soma do peso
  **estimado** dos produtos de cada setor — informação que existe antes de
  qualquer conferência, portanto útil no momento em que o revisor está pesando.
  Somar o peso *real* deixaria o campo vazio justamente aí.
- **Peso bruto é grandeza diferente e é digitado**: inclui embalagem e é o número
  que vai para a NF-e. Não substitui `expedicoes.peso_kg`, que continua sendo o
  aferido usado na etiqueta e na prepostagem.
- **Peso por volume existe porque a NF de múltiplos volumes exige.** Com um
  volume só, o detalhamento não é gravado; sobra de campos de uma contagem maior
  anterior é descartada no salvamento, para não virar ruído na nota.
- **Campos de frete saíram da tela.** Quem define transporte é o expedidor, no
  modal Despachar. Os estados continuam sendo lidos e regravados no salvamento,
  então nenhum dado existente foi apagado.
- **Briefing Comercial (BLOCO 2) e Configurações Técnicas e Acabamento (PCP) não
  aparecem na Revisão** — são conteúdo de cada setor e já estão nas abas de
  setor; repeti-los só alongava a rolagem até a conferência.

## Trava de liberação

O botão de confirmar fica desabilitado até não sobrar pendência
(`validarRevisao`, em `revisao-expedicao.service.ts`). Exige:

- **todos** os setores com peso real e responsável preenchidos;
- do pedido: quantidade de volumes, tipo de volume e peso bruto total;
- com mais de um volume, o peso bruto de cada um.

As pendências aparecem nomeadas por setor logo acima do botão. O critério é
deliberadamente rígido: pedido sem peso chega à Expedição sem como emitir
etiqueta nem pré-postagem, e conferência sem responsável não tem a quem
perguntar depois.

## Banco

Migration `20260816_expedicoes_peso_bruto.sql` (aplicada): adiciona
`expedicoes.peso_bruto_kg` (numeric) e `expedicoes.pesos_volumes` (jsonb), ambas
nuláveis e aditivas. Nenhuma coluna existente foi alterada.

## Continua futuro

- diferença entre previsto e aferido, com **tolerância** e regra de bloqueio;
- data e observação da pesagem como campos próprios;
- divergência de peso **não** deve alterar automaticamente quantidade,
  financeiro ou frete — isso permanece como regra a definir antes de qualquer
  automação.

---

# 20. Riscos Principais

| Risco | Controle obrigatório |
|---|---|
| Produção sem liberação | Validar `is_prd_aprovado` |
| Quantidade dos modelos acima do item | Bloquear salvamento |
| Arte vinculada ao modelo errado | Validar `id_int`, modelo e item de origem |
| Upload sem persistência | Confirmar Storage e banco |
| Sobrescrita de arte | Manter bloqueios atuais |
| Alteração indevida de modelo | Respeitar bloqueio de `UPDATE` e `DELETE` |
| Mistura entre Comercial e Produção | Preservar responsabilidades |
| Confusão entre pagamento e pedido | Consultar fontes separadas |
| Status paralelo | Usar fluxo oficial |
| Timeline duplicada | Reutilizar `propostas_chat` |
| Permissão só no frontend | Validar backend e RLS |
| Portal público inseguro | Não implementar sem projeto específico |
| Migration prematura | Exigir diagnóstico e autorização |
| Produção parcial sem modelo de dados | Manter como pendência até homologação |

---

# 21. Validação do Fluxo Atual

## Abertura de Boletim ou OS

Validar:

- proposta correta;
- `id_int`;
- elegibilidade;
- ausência de pedido pai duplicado;
- payload permitido;
- retorno real do Supabase;
- modelos vinculados;
- mensagem correta ao usuário.

## Modelos

Validar:

- vínculo com o item da proposta;
- quantidade total;
- numeração;
- ordem;
- ausência de duplicidade;
- bloqueio de edição após salvar;
- bloqueio de exclusão.

## Arte

Validar:

- modelo correto;
- versão 1;
- ausência de upload anterior;
- MIME;
- tamanho;
- Storage;
- INSERT;
- bloqueio de atualização;
- bloqueio de exclusão.

## Produção

Validar:

- `is_prd_aprovado = true`;
- status oficial;
- permissão;
- ausência de escrita financeira;
- ausência de liberação automática;
- registro de auditoria quando aplicável.

## Chat e pendências

Validar:

- mesmo `id_int`;
- isolamento entre propostas;
- `visivel_externo = false`;
- menção correta;
- nenhuma ação executada apenas pela mensagem;
- nenhuma timeline paralela.

---

# 22. Evolução Recomendada

A próxima evolução deve começar por diagnóstico do código e do banco.

Ordem segura:

1. confirmar estrutura e uso atual de `public.pedidos`;
2. confirmar services do Boletim/OS;
3. confirmar status e transições atuais;
4. homologar o fluxo atual de modelos;
5. homologar o upload da versão 1;
6. definir edição ou versionamento de artes;
7. definir aprovação do cliente;
8. definir Kanban;
9. definir pesagem e pacotes;
10. definir integração com Expedição.

Nenhuma etapa exige automaticamente nova tabela.

A IDE deve primeiro investigar se a arquitetura existente já suporta a necessidade.

---

# 23. Documentação Relacionada

- `./FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `./CHAT-INTERNO.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `./CANCELAMENTO-COBRANCAS.md`
- `../BUSINESS_RULES.md`
- `../SECURITY.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../technical/PADROES-UX-UI.md`
- `../history/STATUS-INTERNO-PROPOSTAS.md`

---

# Fonte da Verdade

Este documento define o fluxo atual e os limites do módulo de Pedidos e Produção.

As fontes principais são:

```text
public.propostas
public.pedidos
public.pedidos_modelos
public.pedidos_artes
public.propostas_chat
public.propostas_pendencias
```

A proposta permanece como origem comercial.

A entrada oficial na fila produtiva depende de `is_prd_aprovado`.

A Matriz de Segurança define quais escritas são autorizadas.

Capacidades futuras deste documento não autorizam migration, nova tabela, atualização de modelos, substituição de artes, portal público ou automação de status.

# CHAT-INTERNO.md

Versão: 2.0  
Status: Oficial  
Última atualização: 18/07/2026  
Projeto: Vibe

---

# Chat Interno — Timeline Operacional

Este documento descreve a arquitetura, a estrutura de dados, os fluxos de integração, as regras de negócio e o estado atual do módulo de Chat Interno do Vibe.

O Chat Interno é uma timeline operacional vinculada às propostas por `id_int`. Ele centraliza comunicação interna, mensagens automáticas, anexos, menções e pendências entre setores.

O módulo não substitui regras comerciais, financeiras, produtivas ou fiscais. Ele registra e distribui informações geradas pelos fluxos oficiais desses domínios.

---

# Objetivos

- manter uma timeline única por proposta;
- preservar o isolamento por `id_int`;
- centralizar comunicação entre setores;
- registrar eventos automáticos relevantes;
- oferecer anexos, menções e notificações;
- apoiar a gestão de pendências;
- evitar que falhas auxiliares bloqueiem os fluxos principais;
- preservar segurança, RLS e rastreabilidade.

---

Esta documentação descreve a arquitetura, estrutura de dados, fluxos de integração e regras de negócio do módulo **Chat Interno** (Timeline Operacional) do Vibe.

---

## 1. Visão Geral

O **Chat Interno** funciona como uma timeline operacional e de comunicação administrativa vinculada a cada proposta comercial do sistema. 

- **Escopo**: É uma ferramenta de uso estritamente interno para comunicação entre colaboradores de diferentes setores (Comercial, Financeiro, Produção, etc.) e para o registro de eventos automáticos do sistema.
- **Isolamento**: Todo o histórico do chat é isolado por proposta usando a chave operacional `id_int`. Mensagens e anexos nunca são misturados entre propostas diferentes.
- **Público Externo**: O chat **não** é acessível pelo cliente nesta fase. Toda a comunicação gravada permanece oculta no painel administrativo interno (`visivel_externo = false`).
- **Resiliência**: Falhas em consultas auxiliares, resumos e eventos automáticos da timeline não bloqueiam os fluxos principais do ERP. Falhas em ações iniciadas pelo usuário, como envio de mensagem ou upload de anexo, devem ser informadas claramente e não podem ser apresentadas como sucesso.

---

## 2. Estrutura de Dados

Toda a persistência de mensagens da timeline é realizada na tabela `public.propostas_chat` no Supabase.

### Tabela: `public.propostas_chat`

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `bigint` (PK) | Identificador único e sequencial da mensagem. |
| `id_int` | `bigint` | Chave estrangeira que referencia a proposta comercial. |
| `mensagem` | `text` | Conteúdo textual da mensagem (automática ou manual). |
| `tipo` | `text` | Categoria da mensagem: `MENSAGEM`, `SISTEMA`, `FINANCEIRO` ou `PRODUCAO`. |
| `autor_uid` | `uuid` | ID único (UID) do usuário autenticado no Supabase (ou `null` para o Sistema). |
| `autor_nome` | `text` | Nome de exibição do autor. |
| `autor_email` | `text` | E-mail do autor. |
| `setor` | `text` | Setor do autor (ex: "Comercial", "Financeiro", "Sistema"). |
| `created_at` | `timestamptz` | Data e hora de criação do registro. |
| `updated_at` | `timestamptz` | Data e hora da última modificação (se editado). |
| `editado` | `boolean` | Flag indicando se a mensagem foi editada (`default = false`). |
| `visivel_externo` | `boolean` | Indica se o cliente final pode ver a mensagem (`default = false` nesta fase). |
| `anexos` | `jsonb` | Array contendo informações de arquivos anexados (estruturado como JSONB). |
| `id_cliente` | `bigint` | ID do cliente associado à proposta (se cadastrado). |
| `avatar` | `text` | URL da foto/avatar do autor da mensagem. |
| `is_pendente` | `boolean` | Sinaliza que a mensagem registra uma pendência operacional ativa. |
| `is_recusado` | `boolean` | Sinaliza que a mensagem registra uma recusa operacional ativa. |

### Tabela: `public.propostas_chat_mentions`

Armazena as menções estruturadas geradas no chat interno para envio de notificações em tempo real.

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `bigserial` (PK) | Identificador único da menção. |
| `chat_id` | `bigint` (FK) | Referência para `public.propostas_chat` (ON DELETE CASCADE). |
| `id_int` | `bigint` | Identificador operacional da proposta. |
| `mentioned_user_id` | `uuid` | ID único do usuário mencionado. |
| `mentioned_user_name` | `text` | Nome do usuário mencionado. |
| `mentioned_user_email` | `text` | E-mail do usuário mencionado. |
| `mentioned_by_user_id` | `uuid` | ID único do autor da menção. |
| `mentioned_by_name` | `text` | Nome do autor da menção. |
| `read_at` | `timestamp with time zone` | Data e hora de leitura da notificação (ou `null` para não lidas). |
| `source_type` | `text` | Origem da menção (padrão `'CHAT'`). |
| `created_at` | `timestamp with time zone` | Data de criação da menção. |

#### Índices de Performance
- `idx_propostas_chat_mentions_user` no campo `mentioned_user_id`
- `idx_propostas_chat_mentions_id_int` no campo `id_int`
- `idx_propostas_chat_mentions_user_read` nos campos `(mentioned_user_id, read_at)` para consulta eficiente das notificações não lidas.

---

## 3. Storage e Anexos

O upload de arquivos e imagens compartilhados no chat é realizado no Supabase Storage.

- **Bucket**: `chat-ideal`
- **Padrão de Path**: `propostas/{id_int}/{timestamp}_{nomeArquivo}`
- **Tipos de Arquivos Suportados**: Imagens (JPEG, JPG, PNG, GIF, WEBP, SVG), PDFs, Documentos (Word, Excel), Textos e Arquivos Compactados (ZIP, RAR) com limite de até **10MB** por arquivo.

### Formato do JSONB `anexos`
Quando arquivos são enviados, suas referências públicas são gravadas no campo `anexos` da tabela `public.propostas_chat` seguindo a seguinte estrutura JSON:

```json
[
  {
    "url": "https://[supabase-url]/storage/v1/object/public/chat-ideal/propostas/14997/1780087568_anexo.pdf",
    "name": "documento_financeiro.pdf",
    "type": "application/pdf",
    "size": 123456
  }
]
```

---

## 4. Componentes Principais

O chat é estruturado de forma modular utilizando React, Next.js e TailwindCSS, composto por:

1. **`PropostaChatPanel`** (`src/features/orcamentos/components/PropostaChatPanel.tsx`):
   - Painel principal contendo a timeline de mensagens com distinção visual por tipo (`SISTEMA`, `FINANCEIRO`, `PRODUCAO` ou normal).
   - Gerencia a digitação de texto, seleção e envio de anexos temporários, upload para o Storage e salvamento no banco de dados.
   - Contém um callback reativo `onMessagesUpdated` que propaga métricas calculadas em tempo real após a listagem inicial ou envio.
   - Dispara a gravação no `localStorage` marcando as mensagens como lidas apenas após o carregamento bem-sucedido.
2. **`PropostaChatDrawer`** (`src/features/orcamentos/components/PropostaChatDrawer.tsx`):
   - Drawer/Sidebar deslizável lateral reutilizável.
   - Apresenta estatísticas no cabeçalho (total de mensagens, número de anexos e badges semânticas de `Pendência` ou `Recusado`).
   - Controlado via chave (`key={idInt}`) pelo pai para limpeza de ciclo de vida nativa ao alternar entre propostas rapidamente.
3. **Integração no Detalhe da Proposta** (`src/features/orcamentos/OrcamentoDetailPage.tsx`):
   - Botão/Aba "Chat interno" que exibe o número de mensagens **não lidas** em uma badge azul-destaque (ou vermelha/amarela dependendo dos alertas operacionais).
   - Aciona o drawer lateral de forma reativa e atualiza os contadores na UI do detalhe comercial ao fechar o drawer ou após ações sistêmicas.
4. **Integração na Listagem de Propostas** (`src/features/orcamentos/OrcamentosListPageReal.tsx`):
   - Batch query `getPropostaChatResumos` configurado para buscar os resumos das propostas renderizadas na tela (limitado a **100 itens** visíveis para preservar a performance).
   - Exibição de badge com total de não lidas no menu de ações rápidas com cores baseadas em status.
   - Botão reativo e badge integrada na visualização mobile (layout de cards).
   - Atualização local imediata ao fechar o drawer lateral de chat de uma linha específica.

---

## 5. Funcionalidades Implementadas

- **Mensagens Manuais**: Envio de texto livre interno com suporte a quebras de linha (`Shift + Enter`).
- **Anexos**: Seleção de arquivos múltiplos de até 10MB com sanitização automática de caracteres especiais no nome do arquivo antes do upload.
- **Preview de Imagem**: Exibição em miniatura de arquivos de imagem diretamente no balão de chat com links para abertura em nova guia.
- **Download de Arquivos**: Botão de download estilizado para arquivos de tipo texto, PDFs ou compactados anexados na mensagem.
- **Drawer Deslizável Reutilizável**: Acesso rápido ao chat sem tirar o usuário do fluxo atual (detalhe ou listagem).
- **Abertura pela Listagem**: Visualização rápida da conversa diretamente de qualquer linha da tabela principal de Orçamentos.
- **Mensagens Automáticas**: Timeline alimentada pelo sistema registrando ações do fluxo comercial e financeiro.
- **Indicadores Ricos**: Presença de ícones de clips de anexo com contagem no tooltip, totalizador histórico e cores semânticas diferenciando alertas.
- **Controle de Mensagens Não Lidas (localStorage)**: Controle granular por usuário/ambiente sem acionar migrations no banco.
- **Atualização em Tempo Real (Supabase Realtime)**: Sincronização automática das mensagens na timeline ao enviar ou receber novas interações com o drawer aberto.
- **Menções de Usuários (`@Nome`)**: Autocomplete inteligente acionado ao digitar `@` no textarea de mensagens, selecionando usuários por ID com indicação visual segura (pills) e salvamento desduplicado no banco de dados.
- **Notificações Globais na Topbar**: Contador dinâmico (Bell badge) com número de menções não lidas do usuário logado e exibição de Toasts interativos em tempo real que redirecionam e abrem o chat da proposta correspondente ao serem clicados.

---

## 6. Mensagens Automáticas do Sistema

O sistema registra automaticamente mensagens operacionais do tipo `SISTEMA` quando as seguintes ações ocorrem:
- **PDF Gerado**: Mensagem indicando qual usuário gerou o documento comercial e o link para visualização.
- **Proposta Duplicada**: Registro na nova proposta apontando a origem (ex: *"Esta proposta foi duplicada a partir da Proposta comercial #14997"*).
- **Cobrança Criada**: Registro financeiro do tipo de cobrança, valor, vencimento, situação (`A_RECEBER`) e cliente.
- **E-FATURADO Registrado**: Sinalização de faturamento interno registrado com sucesso utilizando crédito disponível do cadastro.
- **E-FATURADO Enviado para Análise**: Aviso de faturamento pendente com solicitação de aprovação de limite de crédito enviada ao financeiro.
- **Pagamento Confirmado**: Aviso de liquidação da cobrança confirmada pelo time financeiro ou gateway.
- **Proposta Cancelada**: Registro administrativo de cancelamento da proposta pelo setor responsável.

---

## 7. Controle de Mensagens Não Lidas (localStorage)

O controle de visualizações de mensagens baseia-se em armazenamento local para maior agilidade:

- **Chave Separada por Ambiente e Usuário**: Os registros de leitura são salvos sob a chave `erpideal_chat_read:${user_id_or_email}`, isolando o status de leitura por usuário autenticado. Em caso de ambiente local/mockado, o fallback é o e-mail ou a string `"mock-user"`.
- **Registro Seguro**: É gravado o ID da última mensagem lida e o timestamp `last_read_created_at` (como fallback defensivo em caso de checagem sequencial).
- **Assumir Tudo como Não Lido**: Caso o `localStorage` esteja indisponível (como em modo de navegação anônima estrita) ou ocorra falha de leitura, o sistema não quebra a interface: ele simplesmente assume todas as mensagens do chat como não lidas.
- **Filtro de Autor**: Mensagens de autoria do próprio usuário logado (`autor_uid === user.id`) **não** contam como não lidas para ele.
- **Mensagens do Sistema**: Contam como não lidas para todos os usuários comuns, permitindo alertar o atendente sobre novas cobranças geradas ou faturamentos analisados.
- **Comportamento da Badge**: O número vermelho/amarelo/azul destacado exibe **apenas a quantidade de não lidas**. O total histórico acumulado é exibido somente no tooltip para manter a clareza operacional.

---

## 8. Regras Importantes de Implementação

1. **Visibilidade Externa**: O campo `visivel_externo` deve ser mantido estritamente como `false` para todas as mensagens de propostas nesta fase.
2. **Tipos de Mensagem**:
   - Mensagens manuais escritas por colaboradores de qualquer setor usam `tipo = MENSAGEM`.
   - Mensagens de registro de eventos automáticos do ERP usam `tipo = SISTEMA`.
3. **Isolamento Completo**: Nunca faça queries de mensagens sem filtrar pelo `id_int` da proposta correspondente.
4. **Não Bloqueante**: A criação de mensagens automáticas de sistema e o fetch de resumos do chat na listagem não podem impedir o fluxo principal do ERP. Se uma consulta auxiliar falhar, a tela deve continuar funcionando com fallback seguro. Envios manuais e uploads, porém, devem exibir erro ao usuário quando não forem persistidos.
5. **Gravação Resiliente de Menções**: A inserção de menções no banco ocorre em segundo plano (fire-and-forget). Se falhar por qualquer motivo, a mensagem de texto principal é gravada normalmente e o erro é registrado apenas no console do front-end.
6. **Segurança de Dados do Localhost**: Se o usuário logado ou mencionado possuir ID mockado que não corresponde a um UUID válido, o sistema intercepta e loga a operação localmente em desenvolvimento, ignorando a gravação física no banco para evitar violações de chave estrangeira UUID no Supabase.

---

## 9. Limitações Atuais

- **Sem Gravação de Áudio**: Comunicação restrita a texto e arquivos.
- **Sem Central Global**: Não há uma tela centralizada que lista todas as conversas ativas no ERP. O chat é acessível apenas a partir de propostas.
- **Controle Local de Leitura**: O status de não lidas geral do chat é restrito ao navegador e máquina atual do usuário, não sendo persistido na nuvem (as menções estruturadas, contudo, são controladas no banco via tabela `propostas_chat_mentions`).

---

## 10. Roadmap Futuro

1. **Gestão de Pendências Operacionais**: Integrar as flags `is_pendente` e `is_recusado` a uma fila de atendimento para que gerentes visualizem gargalos de aprovação.
2. **Tabela Definitiva de Leituras**: Criar a tabela `propostas_chat_leituras` no Supabase para sincronizar as mensagens não lidas gerais entre múltiplos dispositivos e computadores de forma confiável.
3. **Central Global de Timeline**: Criar um painel consolidado para o financeiro e comercial visualizarem o histórico operacional geral das últimas propostas alteradas no ERP.
4. **Resumo Inteligente por IA**: Implementar integração com LLMs para resumir o histórico operacional e pendências comerciais das propostas com timelines extensas.
5. **Menções Expandidas**: Suporte a menções de setor (ex: `@financeiro`) ou notificações por canais externos (e-mail, WhatsApp, push externo).

---

## 11. Checklist de Validação (QA)

Use este checklist para testar a integridade operacional do módulo de Chat Interno:

- [ ] **Envio de Mensagem**: Digitar texto no painel do chat, enviar (Enter ou botão de envio) e verificar se aparece imediatamente na timeline.
- [ ] **Upload de Imagem**: Selecionar imagem (PNG/JPG), enviar e verificar se o preview em miniatura renderiza corretamente no balão do chat.
- [ ] **Upload de Documento**: Selecionar arquivo PDF/ZIP, enviar e verificar se o card de download com nome do arquivo e tamanho é exibido.
- [ ] **Abertura pelo Detalhe**: Entrar no detalhe da proposta, clicar em "Chat interno" e verificar se o Drawer abre na lateral com os dados correspondentes.
- [ ] **Abertura pela Listagem**: Clicar no botão de chat na linha da tabela de orçamentos e verificar se o Drawer exibe o histórico correto de imediato.
- [ ] **Isolamento por Proposta**: Enviar mensagens na Proposta A, abrir o chat da Proposta B e atestar que a conversa da Proposta B está vazia ou contém apenas seu histórico correspondente.
- [ ] **Mensagens Automáticas**: Gerar um PDF de proposta ou criar uma cobrança mockada e atestar que uma nova mensagem de Sistema descrevendo a ação foi criada no chat.
- [ ] **Badge de Não Lidas**: Abrir a listagem de propostas sob o perfil de um usuário diferente e atestar que a badge indica mensagens não lidas. Ao abrir o drawer do chat e aguardar a carga, fechar o drawer e constatar que a badge sumiu da linha correspondente.
- [ ] **Menções por Autocomplete**: Digitar `@` na caixa de texto, constatar a abertura do dropdown, navegar com as setas do teclado e selecionar um usuário com Enter. Confirmar que a pill estilizada renderiza no texto ao enviar e o registro é gravado em `propostas_chat_mentions` se o ID for UUID válido.
- [ ] **Descarte de Menção Deletada**: Digitar `@` e selecionar um usuário. Em seguida, deletar o `@Nome` do editor e enviar a mensagem. Confirmar que a mensagem é enviada, mas nenhum registro de menção é gravado.
- [ ] **Menção Manual sem Autocomplete**: Digitar `@Marielle` diretamente no texto sem selecionar no autocomplete e enviar a mensagem. Confirmar que a mensagem de texto é salva normalmente, mas não é criada nenhuma notificação na tabela `propostas_chat_mentions`.
- [ ] **Recebimento de Notificação em Tempo Real**: Com uma conta logada em uma aba e outra em outra aba (ou simulando o insert de menção no Supabase para o UUID correspondente), atestar que a Topbar exibe o Toast de menção instantaneamente, incrementando a Bell badge de forma pulsante. Confirmar que o clique no Toast redireciona e abre o painel do chat correspondente com `?chat=open`.

---

## 12. Balão do Chat Global (Fase 6C)

Na Fase 6C, o Vibe foi equipado com uma **Central Flutuante de Chat Unificada** (`GlobalChatBubble`), que oferece acesso rápido ao chat de qualquer módulo do sistema.

### Funcionamento e Arquitetura:
1. **Contexto Unificado**: O layout principal (`AppLayout`) monta o `GlobalChatProvider` que renderiza uma única instância do `PropostaChatDrawer` na raiz da página. Isso evita a inicialização de múltiplos listeners realtime e economiza conexões com o Supabase.
2. **Resolução de Relações Contextuais**:
   - O balão flutuante fica posicionado de forma fixa e não-obstrutiva no canto inferior direito (`fixed bottom-6 right-6 z-[60]`).
   - Ao ser aberto, ele analisa o `pathname` do Next.js para deduzir em qual módulo o usuário está:
     - `/orcamentos/[id_int]` -> Oferece acesso direto ao chat do orçamento correspondente.
     - `/cadastros/[id_cliente]` -> Consulta no banco de dados a última proposta vinculada àquele cliente.
     - `/dashboard` ou outras páginas -> Omitirá o contexto específico, mostrando apenas os chats recentes.
3. **Conversas Recentes**:
   - Exibe a lista das últimas 5 propostas com conversas ativas no sistema.
   - Para respeitar as permissões de acesso e RLS do usuário, o sistema realiza uma consulta em dois passos: busca as últimas propostas ativas em `propostas_chat` e filtra suas chaves contra a tabela `propostas`. Propostas ocultadas pelo RLS não são exibidas, garantindo segurança estrita de dados.
4. **Cache & Debounce**:
   - Para evitar chamadas repetitivas e lentidão no banco ao navegar ou reabrir o balão flutuante, o contexto e as conversas recentes são armazenados em um cache local de 30 segundos (`CACHE_TTL = 30000`).
   - Cliques rápidos e concorrentes são debotados/travados usando uma referência de carregamento síncrona (`loadingRef`), garantindo que apenas uma query por vez seja enviada ao banco de dados.
5. **Badge Contextual e Discreta**:
   - Se o usuário estiver em uma página contextual (como orçamento ativo) e possuir menções não lidas pendentes associadas àquela proposta no banco de dados (`propostas_chat_mentions`), um discreto ponto azul pulsante será exibido no balão flutuante, sinalizando novas atividades de forma elegante e discreta.

---

## 13. Gestão de Pendências Atribuídas (Fase 6D)

Na Fase 6D, o Chat Interno foi estendido com a funcionalidade de **Gestão de Pendências Atribuídas** (`public.propostas_pendencias`).

### Arquitetura de Dados:
- **Tabela**: `public.propostas_pendencias`
- **Integridade**: Chave estrangeira `id_int` simples vinculada à `public.propostas(id_int)` sem exclusão em cascata, preservando o histórico comercial.
- **Trigger Específica**: A trigger `trigger_propostas_pendencias_updated_at` aciona a função dedicada `public.set_propostas_pendencias_updated_at()` para atualizar o timestamp `updated_at = now()` a cada modificação.
- **Deleção Bloqueada**: A tabela possui RLS habilitada sem nenhuma política para `DELETE`, bloqueando qualquer tentativa de exclusão direta de pendências via cliente API.

### Políticas de Segurança RLS Estritas:
Toda a validação de acesso e permissões roda no servidor PostgreSQL associada ao `auth.uid()`, sem depender de dados manipulados pelo frontend:
1. **SELECT**: Acesso liberado apenas se o usuário autenticado for o criador, o responsável específico, admin/super admin, ou se pertence ao mesmo `id_empresa` ou `setor` (conforme registrado em `public.usuarios`).
2. **INSERT**: Exige que o criador seja o usuário logado (`criado_por_user_id = auth.uid()`), que ele exista na tabela de usuários e, se informada uma empresa, que seja a sua própria empresa (exceto admins).
3. **UPDATE**: Restrito aos mesmos perfis do SELECT. O `WITH CHECK` garante que usuários comuns só possam mover a pendência para empresas/setores que correspondam aos seus dados de cadastro (a não ser que sejam o criador, que pode delegar para outros setores).

### UI e Fluxos Integrados:
- **Aba no Drawer**: O `PropostaChatDrawer` agora conta com abas superiores deslizáveis para alternar entre "Conversa" e "Pendências", mantendo os dois painéis montados em DOM para evitar perda de dados e posição de scroll.
- **Timeline e Notificações**: Ações nas pendências (criar, iniciar resolução, concluir ou cancelar) gravam automaticamente mensagens de `SISTEMA` no chat `propostas_chat` para alertar todos os colaboradores sobre o andamento operacional, evitando duplicidades.

---

## 14. Realtime e Notificações de Pendências (Fase 6D-E)

Na Fase 6D-E, a gestão de pendências foi atualizada para um modelo dinâmico e reativo em tempo real via canais de eventos:
1. **Canal Realtime Único**: A `Topbar` estabelece uma única subscrição realtime de canal PostgreSQL escutando a tabela `public.propostas_pendencias` do Supabase. Isso centraliza e otimiza o uso de conexões Websocket.
2. **Propagação de Eventos via Custom Event**: As atualizações em tempo real são propagadas da Topbar para os demais componentes (Central de Pendências `/pendencias`, Drawer de Chat, painel de pendências lateral) através do Custom Event nativo do DOM `"propostas-pendencias-realtime"`.
3. **Toasts Operacionais Interativos**: O sistema gera alertas visuais imediatos para os operadores envolvidos:
   - **Novas Atribuições**: Notifica quando uma pendência é atribuída ao setor ou diretamente ao usuário logado.
   - **Resolução Iniciada**: Notifica quando outro operador assume uma pendência criada pelo usuário.
   - **Conclusão/Cancelamento**: Alerta quando pendências de interesse direto são concluídas ou canceladas por terceiros.
   - *Nota: O sistema impede notificações em lote/redundantes do próprio usuário logado (auto-toast).*
4. **Renomeação da Ação**: A ação "Iniciar" foi padronizada como "Assumir", gravando de maneira segura o UUID real da sessão ativa do usuário autenticado no campo `responsavel_user_id`.

---

## 15. Revisão Final e Estabilização (Fase 6F)

A Fase 6F focou no refino de desempenho e UX para mitigar sobrecargas de queries em banco de dados e processamento no cliente:
1. **Carregamento Diferido (On-Demand) de Usuários**:
   - A busca da lista completa de usuários do sistema (`listAllUsuarios`) foi removida do mount inicial do painel de chat.
   - O fetch agora é deferido para o evento de foco (`onFocus`) no campo de digitação de mensagem ou ao clicar em criar nova pendência manual. Isso evita que visualizações rápidas de mensagens na timeline façam chamadas pesadas ao banco.
2. **Renderização de Menções com Regex de Alta Performance ($O(M)$)**:
   - Substituição do algoritmo de renderização que iterava sobre a lista total de usuários em busca de menções por um processador baseado em Expressão Regular (`mentionRegex = /@([a-zA-Z0-9\u00C0-\u017F._-]+)/g`).
   - O processamento de texto cai de um custo quadrático/linear na lista total de usuários ($O(N \times L)$) para linear na quantidade de menções encontradas ($O(M)$).
   - Validação assíncrona: se a lista de usuários não estiver carregada na montagem inicial, a regex assume a marcação preventiva como pill de menção e valida o match com a lista real de usuários assim que a mesma é preenchida sob demanda.
3. **Otimização de Queries na Central de Pendências**:
   - Em `/pendencias`, a busca inicial de usuários do sistema foi desmembrada do efeito reativo de atualização. Os usuários são trazidos apenas uma vez na montagem inicial, prevenindo novas buscas a cada gatilho realtime de pendências.

---

## 16. Fechamento Operacional e Polimento Final (Fase 6G)

Na Fase 6G, a timeline do chat e o painel de pendências receberam refinos finais de usabilidade, acessibilidade e tradução:
1. **Fechamento Nativo via Teclado**: Configurada escuta ao evento de tecla `Escape` (ESC) para fechamento instantâneo do `NotificationsPopover`, do popover contextual `GlobalChatBubble` e do menu lateral móvel (`MobileSidebar`), garantindo usabilidade ergonômica.
2. **Acessibilidade por Aria-Labels**: Introduzido suporte formal de acessibilidade aos leitores de tela com a inserção de tags `aria-label` descritivas em todos os botões e links baseados unicamente em ícones (como botões de fechar, remover anexo, enviar mensagens, ir para propostas e abrir chats).
3. **Tradução Amigável de Exceções**: A camada de serviço de pendências (`createPropostaPendencia` e `updatePropostaPendenciaStatus`) intercepta erros de banco de dados e os traduz em avisos claros e diretos em português, ocultando termos técnicos como "RLS", "CHECK constraint" e chaves estrangeiras.
4. **Acabamento Visual em Dark Mode**: Revisados e ajustados backgrounds, bordas, contrastes e inputs nos painéis de timeline e formulários de pendências para herdarem o tema dark de forma integrada (`bg-white dark:bg-slate-900` e cores secundárias adequadas), evitando contrastes estourados ou flashes de fundo claro.

---

## 17. Pacote Chat + Pendências — Status Final

Esta seção consolida a arquitetura técnica, regras operacionais e o escopo funcional final do pacote Chat, Notificações e Pendências implementado no branch `erp-ideal-preview`.

### A. Tabelas Usadas no Banco de Dados (Supabase)

1. **`public.propostas_chat`**:
   - **Propósito**: Persistir o log histórico e sequencial de mensagens textuais e anexos do chat de cada proposta.
   - **Tipos de Mensagens**: `MENSAGEM` (escritas manualmente por colaboradores), `SISTEMA`, `FINANCEIRO` e `PRODUCAO` (mensagens automáticas de log).
   - **Storage**: Arquivos anexos armazenados no bucket `chat-ideal` com limite de 10MB por arquivo.

2. **`public.propostas_chat_mentions`**:
   - **Propósito**: Armazenar registros desduplicados das menções estruturadas `@` associadas às mensagens do chat para acionamento de notificações na Topbar.

3. **`public.propostas_pendencias`**:
   - **Propósito**: Controlar o ciclo de vida, prazos, setores e operadores responsáveis pelas pendências operacionais atreladas às propostas.

### B. Fluxos Principais

1. **Timeline e Comunicação da Proposta**:
   - Drawer lateral deslizável acessível a partir da listagem e do detalhe da proposta.
   - Alternância fluida via abas superiores mantendo em cache o painel de mensagens e o painel de pendências.
   - Mensagens automáticas geradas pelo sistema em marcos críticos (geração de PDF, faturamento pendente, cobrança gerada, cancelamentos).

2. **Autocomplete de Menções `@`**:
   - Carregamento assíncrono diferido da lista de usuários ativos sob demanda (no foco da caixa de texto).
   - Dropdown reativo e inserção de pills azuis estilizadas via processador regex de alta performance ($O(M)$).

3. **Notificações Globais de Menção**:
   - Contador de notificações não lidas e painel Popover associado ao sino da Topbar.
   - Exibição de Toasts interativos com redirecionamento e abertura automática do drawer do chat.

4. **Balão do Chat Global Contextual (`GlobalChatBubble`)**:
   - Flutuante de acesso rápido disponível em qualquer módulo.
   - Resolução inteligente de contexto de proposta através do `usePathname` (ou última proposta do cliente).
   - Listagem em lote das 5 conversas mais recentes autorizadas pela política de segurança RLS do usuário.

5. **Central de Pendências (`/pendencias`)**:
   - Dashboard administrativo completo com cards de controle (Minhas, Setor, Sem Responsável, Urgentes, Atrasadas, Concluídas Hoje).
   - Filtros dinâmicos e abas operacionais rápidas.
   - Paginação incremental sob demanda ("Carregar Mais").

### C. Eventos Realtime (Sincronização em Tempo Real)

1. **Canal do Chat da Proposta**: Escuta alterações na tabela `propostas_chat` e atualiza a timeline instantaneamente caso o drawer da proposta correspondente esteja aberto.
2. **Canal de Menções / Notificações**: Escuta novos registros em `propostas_chat_mentions` e atualiza o indicador da Topbar e exibe Toasts de menção.
3. **Canal de Pendências Centralizado**: Uma subscrição WebSocket única no componente `Topbar` escuta a tabela `propostas_pendencias` e distribui as atualizações localmente para a Central e para os drawers por meio do Custom Event `"propostas-pendencias-realtime"`. Reduz conexões ativas e exibe Toasts operacionais imediatos para os envolvidos.

### D. Regras de Pendências, Categorias e Prioridades

- **Ação "Assumir"**: Substitui a antiga ação "Iniciar". Ao acionar, vincula a pendência de forma segura ao UUID real do operador autenticado no Supabase no campo `responsavel_user_id`.
- **Categorias Operacionais**: `FINANCEIRO`, `PRODUCAO`, `COMERCIAL`, `CADASTRO`, `FISCAL`, `EXPEDICAO`, `OUTROS`.
- **Níveis de Prioridade**:
  - `BAIXA` / `MEDIA` / `ALTA`
  - `URGENTE`: Itens marcados como urgente são destacados com borda lateral esquerda vermelha de aviso e ping pulsante de alerta na Central de Pendências e no Drawer de Chat.
- **Atrasos**: Pendências cuja data limite (`prazo_limite`) foi ultrapassada exibem badge dinâmico de "ATRASADA" com pulsação visual e borda âmbar no card.

### E. Políticas de Segurança (Row-Level Security)

1. **Controle de Mensagens**: Mensagens e menções são filtradas de acordo com as permissões das propostas associadas.
2. **Controle de Pendências (`propostas_pendencias`)**:
   - **SELECT / UPDATE**: Acesso e escrita concedidos apenas ao criador da pendência, ao responsável atribuído, a administradores ou a colaboradores que pertençam ao mesmo setor (`setor`) ou empresa (`id_empresa`) da pendência.
   - **INSERT**: Valida se o criador corresponde ao UUID autenticado e se a empresa informada pertence ao cadastro do operador.
   - **DELETE Bloqueado**: A tabela não possui políticas de `DELETE`, impedindo qualquer tentativa de exclusão física dos dados via API cliente.

### F. Limitações Atuais (Intencionalmente Fora do Escopo)

- **Sem Kanban**: O controle é feito por listas enriquecidas responsivas e filtros focados na operação, sem suporte a cards arrastáveis (Kanban) nesta etapa.
- **Sem SLA Automático**: Não há cronômetros de contagem regressiva automáticos, cálculo de horas úteis ou regras de escalonamento de prazo.
- **Sem Automações Financeiras / Comercial**: As pendências não alteram automaticamente o status principal da proposta comercial (`status_interno`) e não controlam regras de pagamentos reais.
- **Sem Exclusão**: Não é possível excluir pendências (para auditoria e conformidade), apenas cancelá-las.
- **Dependência do Canal Realtime**: A sincronização reativa em tempo real depende estritamente de a tabela correspondente estar devidamente publicada no canal realtime padrão do Supabase no ambiente de produção.

### G. Próximos Passos Recomendados

1. **Gestão e Monitoramento de SLA**:
   - Adicionar cronômetros visuais e alarmes automáticos quando uma pendência se aproximar do prazo limite.
   - Implementar regras de alertas fora do horário comercial ou escalonamento automático de prioridade.
2. **Painel de Analytics e Produtividade**:
   - Criação de relatórios de produtividade mostrando o tempo médio de resolução de pendências por setor, operador ou tipo de proposta.
   - Identificação de gargalos operacionais no fluxo comercial/financeiro.
3. **Automações de Criação**:
   - Integração com Edge Functions para gerar pendências automatizadas (ex: quando uma cobrança faturada for enviada para análise de crédito ou quando o peso da proposta mudar e exigir recotamento de frete).
4. **Notificações Persistidas Unificadas**:
   - Criação de uma tabela unificada de notificações (`public.notificacoes`) para salvar o histórico de alertas do usuário além do `localStorage` e gerenciar status lidos/não lidos no banco de dados.
5. **Integração Móvel Nativa**:
   - Preparar a infraestrutura de notificações para suporte a Push Notifications no celular quando o aplicativo móvel do ERP for desenvolvido.

---

# Documentação Relacionada

- `../PROJECT_CONTEXT.md`
- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./PEDIDOS-PRODUCAO.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `../maestro/MAESTRO-KNOWLEDGE-BASE.md`

---

# Fonte da Verdade

Este documento representa a referência oficial do módulo de Chat Interno, Menções e Pendências do Vibe.

As tabelas `public.propostas_chat`, `public.propostas_chat_mentions` e `public.propostas_pendencias` devem continuar isoladas pelo contexto oficial da proposta e protegidas pelas políticas de acesso vigentes.

Mensagens automáticas podem ser não bloqueantes, mas ações manuais nunca devem informar sucesso quando a persistência ou o upload falharem.

Nenhum módulo deve criar timeline paralela para a mesma proposta sem decisão arquitetural explícita.

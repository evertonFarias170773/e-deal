# Chat Interno (Timeline Operacional) - Documentação Oficial

Esta documentação descreve a arquitetura, estrutura de dados, fluxos de integração e regras de negócio do módulo **Chat Interno** (Timeline Operacional) do ERP Ideal.

---

## 1. Visão Geral

O **Chat Interno** funciona como uma timeline operacional e de comunicação administrativa vinculada a cada proposta comercial do sistema. 

- **Escopo**: É uma ferramenta de uso estritamente interno para comunicação entre colaboradores de diferentes setores (Comercial, Financeiro, Produção, etc.) e para o registro de eventos automáticos do sistema.
- **Isolamento**: Todo o histórico do chat é isolado por proposta usando a chave operacional `id_int`. Mensagens e anexos nunca são misturados entre propostas diferentes.
- **Público Externo**: O chat **não** é acessível pelo cliente nesta fase. Toda a comunicação gravada permanece oculta no painel administrativo interno (`visivel_externo = false`).
- **Resiliência**: Qualquer falha na timeline (como erro de conexão ao Supabase) é tratada silenciosamente e não bloqueia a listagem ou as ações principais do ERP.

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
4. **Não Bloqueante**: A criação de mensagens de sistema ou o fetch de resumos do chat na listagem não podem, em hipótese alguma, impedir o fluxo normal do ERP. Se uma query falhar, a tela deve continuar funcionando (com fallbacks vazios ou ícones padrão).
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

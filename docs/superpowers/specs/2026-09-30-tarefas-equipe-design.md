# Tarefas da equipe — central única de pendências

Primeira versão em 30/09/2026 (commit eea6934). Etapa 1 da central única em
01/10/2026. Decisões do dono registradas nas duas datas.

## Objetivo

Uma pessoa pede algo a uma ou mais pessoas da equipe (ou a todos). Quem
recebe assume, resolve e conclui. A mesma tela guarda a lista de melhorias do
sistema, da diretoria para o DEV. Prioridade: simplicidade para o usuário
comum. A ferramenta vai substituir a Central de Pendências antiga
(`propostas_pendencias`), o que acontece na etapa 2.

## Decisões

| Tema | Decisão |
|---|---|
| Tabela | `public.tarefas_equipe`. `propostas_pendencias` vira legado na etapa 2. |
| Destinatários | Uma ou mais pessoas, ou "todos". Todos os destinatários veem e qualquer um assume. Quem assume vira o responsável e conclui. |
| Prioridade | Normal, Alta ou Urgente, escolhida ao criar. A lista ordena por prioridade e depois pela data. |
| Anexos | PDF e imagem, até 10 MB cada, na criação, ao longo da tarefa e na conclusão. Bucket privado; download só por rota, com link assinado curto. |
| Sinal de nova | Ícone da Topbar e item do menu piscam enquanto houver tarefa recebida e ainda não aberta. "Visto" é por usuário. |
| Proposta | Botão "Nova tarefa" na proposta, com pedido e cliente preenchidos, e a área "Tarefas deste pedido". |
| Melhorias | `tipo = MELHORIA`, sem destinatários, criadas e vistas só por admin; qualquer admin assume. |
| Aviso | Contador e sinal no menu e na Topbar, toast em tempo real. Sem WhatsApp. |
| Menu | Item próprio "Tarefas", fora do Financeiro. |
| Fora desta etapa | Central de Pendências antiga e pendências criadas pelo sistema (etapa 2). |

## Quem é "admin"

O mesmo critério da tela (`usuarios.service.ts`): com perfil ativo, o perfil
decide (`*` ou `admin.usuarios.view`); sem perfil, `is_admin` ou
`is_super_adm`. São os perfis Super Administrador e Administrador. No banco:
`tarefas_equipe__eh_admin(uuid)`.

"Equipe" é quem tem perfil ativo com alguma permissão
(`tarefas_equipe__eh_da_equipe(uuid)`). Fica de fora o perfil Acesso Pendente.
Só a equipe cria tarefa, recebe tarefa e enxerga tarefa "para todos".

## Dados

`public.tarefas_equipe`

| Coluna | Regra |
|---|---|
| `id` | identidade |
| `tipo` | TAREFA (padrão) ou MELHORIA |
| `titulo` | obrigatório, 1 a 200 caracteres |
| `descricao` | opcional, até 5000 |
| `prioridade` | NORMAL (padrão), ALTA, URGENTE |
| `prioridade_ordem` | gerada: 3 urgente, 2 alta, 1 normal — só para ordenar |
| `para_todos` | TAREFA para toda a equipe; MELHORIA nunca |
| `responsavel_user_id` | vazio até alguém assumir; quem assume vira o responsável |
| `id_int`, `id_cliente` | vínculo opcional a pedido e cliente; viram nulo se o pedido ou cliente for apagado |
| `data_limite` | prazo opcional |
| `status` | ABERTA, EM_ANDAMENTO, CONCLUIDA, CANCELADA |
| `criado_por_user_id`, `created_at` | automáticos |
| `assumido_*`, `concluido_*`, `observacao_conclusao`, `cancelado_*` | preenchidos pela trigger |

`public.tarefas_equipe_destinatarios` — (`tarefa_id`, `user_id`). Uma linha
por pessoa escolhida. Tarefa "para todos" não tem linhas aqui.

`public.tarefas_equipe_anexos` — `tarefa_id`, `momento` (CRIACAO, ANDAMENTO,
CONCLUSAO), `nome_arquivo`, `caminho` (no bucket, sempre
`tarefa/<id>/<uuid>.<ext>`), `tipo_mime`, `tamanho_bytes`,
`enviado_por_user_id`, `created_at`.

`public.tarefas_equipe_vistos` — (`tarefa_id`, `user_id`, `visto_em`). Gravado
quando a pessoa abre a tarefa.

Bucket `tarefas-anexos`: privado, limite de 10 MB por arquivo, tipos PDF, PNG,
JPEG, WEBP e GIF. Nenhuma policy em `storage.objects` para ele: só a service
role, dentro das rotas, lê e grava.

Título, descrição, prioridade, destinatários, prazo, vínculos, tipo e criador
não mudam depois de criados nesta etapa.

## Situações

```
ABERTA ──assumir──> EM_ANDAMENTO ──concluir──> CONCLUIDA
  │                     │
  ├──concluir───────────┘ (destinatário que conclui direto também assume)
  └──cancelar──> CANCELADA  (de ABERTA ou EM_ANDAMENTO)
```

CONCLUIDA e CANCELADA são finais. Não há reabertura.

## Quem vê e faz o quê

"Recebedor" = destinatário escolhido, ou qualquer pessoa da equipe numa tarefa
para todos.

| Ação | Quem |
|---|---|
| Ver uma TAREFA, seus destinatários e anexos | quem criou, recebedores, o responsável, admin |
| Ver uma MELHORIA | admin |
| Criar TAREFA | equipe |
| Criar MELHORIA | admin |
| Assumir | recebedor ou admin (quem assume vira o responsável); na melhoria, admin |
| Concluir | o responsável ou admin; recebedor que conclui direto da ABERTA assume junto |
| Cancelar | quem criou ou admin |
| Anexar | quem vê, enquanto a tarefa está aberta ou em andamento |
| Baixar anexo | quem vê a tarefa |
| Apagar tarefa, destinatário, anexo ou visto | ninguém |

A regra está no banco, em três camadas:

1. **RLS** decide quais linhas cada um vê e altera.
2. **Trigger `tarefas_equipe__guarda`** decide a transição e quem pode,
   preenche autor, responsável e horários pelo `auth.uid()` e trava os campos
   imutáveis.
3. **Privilégios**: `anon` sem nada; `authenticated` sem DELETE e TRUNCATE.

A criação passa pela função `tarefas_equipe_criar`, que grava a tarefa e os
destinatários na mesma transação. Não há policy de INSERT direto em
`tarefas_equipe` nem em `tarefas_equipe_destinatarios`.

## Rotas

Todas exigem a sessão do usuário. Leitura e gravação de dados usam a sessão
(RLS vale). A service role só toca o bucket, e só depois de a sessão provar
que o usuário vê a tarefa.

- `POST /api/tarefas` — cria (chama `tarefas_equipe_criar`).
- `POST /api/tarefas/[id]/situacao` — `assumir`, `concluir`, `cancelar`.
- `POST /api/tarefas/[id]/anexos/preparar` — confere acesso e situação, valida
  tipo e tamanho e devolve um link de envio assinado. O arquivo vai do
  navegador direto para o bucket (a Vercel não aceita corpo de 10 MB).
- `POST /api/tarefas/[id]/anexos` — confere que o arquivo chegou, lê tamanho e
  tipo reais do storage e grava a linha do anexo com a sessão. Se a linha não
  grava, o arquivo é removido.
- `GET /api/tarefas/anexos/[anexoId]` — se a sessão enxerga o anexo, devolve
  link assinado de 60 segundos.

## Telas

**Tarefas** (`/tarefas`). Abas:

| Aba | Conteúdo | Quem vê a aba |
|---|---|---|
| Minhas | assumidas por mim, ou recebidas por mim e ainda sem responsável | todos |
| Criadas por mim | TAREFA criada por mim | todos |
| Todas | toda TAREFA | admin |
| Melhorias | toda MELHORIA | admin |

Seletor "Em aberto / Encerradas". Ordem: prioridade, depois data (mais antiga
primeiro em aberto, mais recente primeiro nas encerradas). Linha mostra
prioridade, título, para quem, quem pediu, prazo, vínculos, situação e o
selo "Nova" se eu ainda não abri. Botão principal: Assumir (ABERTA) ou
Concluir (sou o responsável). Clicar abre o detalhe, que marca como vista:
descrição, destinatários, anexos com download, histórico, Adicionar anexo,
Cancelar.

**Nova tarefa**: o que precisa ser feito, prioridade, para quem (pessoas
marcadas numa lista com busca, ou "Todos"), detalhes, pedido, cliente, prazo e
anexos. Obrigatórios: título e destinatários.

**Proposta**: acima das abas, a área "Tarefas deste pedido" lista as tarefas
com o `id_int` da proposta (as que o usuário pode ver) e tem o botão "Nova
tarefa", que abre o mesmo formulário com pedido e cliente preenchidos.

## Aviso

- Contador = minhas tarefas em aberto (mesma regra da aba Minhas, só ABERTA e
  EM_ANDAMENTO).
- Sinal piscando = existe tarefa recebida por mim, criada por outra pessoa,
  ABERTA ou EM_ANDAMENTO, sem linha minha em `tarefas_equipe_vistos`.
- Os dois números vêm de `tarefas_equipe_resumo()` (SECURITY INVOKER, então o
  RLS vale).
- O toast de "nova tarefa" sai para recebedores; admin que só enxerga a tarefa
  por ser admin não recebe toast.

## Legado

`propostas_pendencias`, a tela `/pendencias`, a aba no chat da proposta e a
criação automática do pagamento combinado seguem intactos até a etapa 2.

## Validação da etapa 1

Dados gravados de verdade (autorizado) e apagados no fim:

1. de dentro de uma proposta, tarefa URGENTE para duas pessoas com PDF;
2. sinal piscando para as duas até cada uma abrir;
3. uma delas assume e conclui com anexo;
4. terceiro usuário sem acesso à tarefa e ao anexo;
5. tarefa para todos vista por qualquer usuário da equipe.

ACL e policies das tabelas novas e do bucket conferidos com
`array_agg(grantee)`: sem `anon`, bucket não público.

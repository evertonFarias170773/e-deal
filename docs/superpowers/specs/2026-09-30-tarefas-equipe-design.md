# Tarefas da equipe — central única de pendências

Primeira versão em 30/09/2026 (commit eea6934). Etapa 1 da central única
(964ffb4) e etapa 2 (legado e tarefa automática) em 01/10/2026. Decisões do
dono registradas em cada data.

## Objetivo

Uma pessoa pede algo a uma ou mais pessoas da equipe (ou a todos). Quem
recebe assume, resolve e conclui. A mesma tela guarda a lista de melhorias do
sistema, da diretoria para o DEV. Prioridade: simplicidade para o usuário
comum. Desde a etapa 2 ela substitui a Central de Pendências antiga
(`propostas_pendencias`), que ficou só para consulta.

## Decisões

| Tema | Decisão |
|---|---|
| Tabela | `public.tarefas_equipe`. `propostas_pendencias` é legado, somente leitura. |
| Destinatários | Uma ou mais pessoas, ou "todos". Todos os destinatários veem e qualquer um assume. Quem assume vira o responsável e conclui. |
| Prioridade | Normal, Alta ou Urgente, escolhida ao criar. A lista ordena por prioridade e depois pela data. |
| Anexos | PDF e imagem, até 10 MB cada, na criação, ao longo da tarefa e na conclusão. Bucket privado; download só por rota, com link assinado curto. |
| Sinal de nova | Ícone da Topbar e item do menu piscam enquanto houver tarefa recebida e ainda não aberta. "Visto" é por usuário. |
| Proposta | Botão "Nova tarefa" na proposta, com pedido e cliente preenchidos, e a área "Tarefas deste pedido". |
| Melhorias | `tipo = MELHORIA`, sem destinatários, criadas e vistas só por admin; qualquer admin assume. |
| Aviso | Contador e sinal no menu e na Topbar, toast em tempo real. Sem WhatsApp. |
| Menu | Item próprio "Tarefas", fora do Financeiro. |
| Tarefa automática | O pagamento combinado cria tarefa Alta para quem tem setor Financeiro e perfil de administrador; se não houver ninguém, para todos os administradores. |
| Onde criar | Menu Tarefas, proposta (área e aba do chat), Conferência (menu de ações da cobrança) e cadastro do cliente. |

## Quem é "admin"

O mesmo critério da tela (`usuarios.service.ts`): com perfil ativo, o perfil
decide (`*` ou `admin.usuarios.view`); sem perfil, `is_admin` ou
`is_super_adm`. São os perfis Super Administrador e Administrador. No banco:
`tarefas_equipe__eh_admin(uuid)`.

## Quem participa das Tarefas (01/10/2026)

Definido por perfil, em Configurações → Perfis e Permissões, grupo "Tarefas":
a permissão **Participar das Tarefas** (`tarefas.participar`).

- Participa quem tem perfil ativo com essa permissão. O Super Administrador
  passa pelo `*`.
- Contas com e-mail `@teste.com.br` nunca participam, mesmo com a permissão.
- Quem participa aparece em "Para quem", pode ser destinatário, entra em
  "Todos da equipe" (vê a tarefa, conta no contador, pisca) e cria tarefa.
- A permissão nasceu marcada em todos os perfis, menos Acesso Pendente.
- Não existe campo de usuário ativo no cadastro: "ativo" aqui é o perfil ativo.

Onde a regra mora:

| Camada | Lugar |
|---|---|
| Banco (decide) | `tarefas_equipe__eh_da_equipe(uuid)`, migration `tarefas_equipe_participar`. É a função usada pela RLS de "todos", por `tarefas_equipe_criar`, pela trigger e pelo resumo. |
| Tela | `src/features/tarefas/lib/participacao.ts` (lista "Para quem", selo, toast). |
| Catálogo | `CATALOGO_PERMISSOES` em `PerfisPermissoesPanel.tsx`; as permissões de cada perfil ficam em `perfis.permissoes`. |

Admin que não participa (ex.: conta de teste com perfil de administrador)
continua enxergando todas as tarefas por ser admin, mas não recebe as "para
todos": não conta, não pisca e não recebe toast. A tarefa automática do
pagamento combinado só escolhe administradores que participam.

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

Título, descrição, destinatários, vínculos, tipo e criador não mudam depois de
criados.

**Prazo e prioridade mudam** (02/10/2026, migrations
`20261002_tarefas_equipe_prazo_prioridade` e `..._prazo_prioridade_admin`), com
a tarefa aberta ou em andamento, por quem criou, por quem recebeu (destinatário
escolhido; em tarefa para todos, quem participa das Tarefas), pelo responsável
e pelo administrador, como nas outras ações. Não se muda prazo ou prioridade no
mesmo UPDATE que muda a situação.

- Cada campo mudado vira uma entrada em `tarefas_equipe.alteracoes` (jsonb,
  lista): `{ em, por, campo: PRAZO | PRIORIDADE, de, para }`. Só a trigger de
  guarda escreve nessa coluna; o que o cliente mandar é descartado.
- A mudança marca a novidade `ALTERADA`, de quem mudou. A regra de quem vê
  (`tarefas_equipe_novas`) é a mesma das outras novidades.
- A tela grava pela rota `POST /api/tarefas/[id]/prazo-prioridade`, com a sessão
  do usuário.

## Situações

```
ABERTA ──assumir──> EM_ANDAMENTO ──concluir──> CONCLUIDA
  │                     │
  ├──concluir───────────┘ (destinatário que conclui direto também assume)
  └──cancelar──> CANCELADA  (de ABERTA ou EM_ANDAMENTO)
```

CONCLUIDA e CANCELADA são finais. Não há reabertura.

## Quem vê e faz o quê

"Recebedor" = destinatário escolhido, ou qualquer pessoa que participa das
Tarefas numa tarefa para todos.

| Ação | Quem |
|---|---|
| Ver uma TAREFA, seus destinatários e anexos | quem criou, recebedores, o responsável, admin |
| Receber tarefa, entrar em "todos" | quem participa das Tarefas |
| Ver uma MELHORIA | admin |
| Criar TAREFA | quem participa das Tarefas |
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

## Tarefa automática (etapa 2)

Só o pagamento combinado cria tarefa sozinho: quando o crédito já foi usado e
a cobrança do restante falha, alguém precisa regularizar a proposta. Antes isso
virava pendência antiga; agora vira tarefa.

- Prioridade ALTA, com o pedido e o cliente vinculados; o texto da falha vai nos
  detalhes. Quem criou é o operador que disparou o pagamento.
- Destinatários: usuários com setor Financeiro (texto do cadastro, sem acento e
  sem diferença de maiúsculas) **e** perfil de administrador. Sem ninguém assim,
  todos os administradores.
- A regra é a função pura `escolherDestinatariosFinanceiro`, em
  `src/features/tarefas/lib/tarefa-automatica.ts`. A gravação usa
  `tarefas_equipe_criar` com a sessão do operador — sem service role e sem
  função nova no banco.
- Se a criação falhar, a rota segue: o aviso no chat da proposta continua sendo
  gravado, e o erro vai para o log.

## Criar de outras telas (etapa 2)

- **Proposta**: área "Tarefas deste pedido" (detalhe e editor) e a aba
  **Tarefas** do chat da proposta, que substituiu a aba Pendências. O selo da
  aba conta as tarefas em aberto do pedido.
- **Conferência**: item "Nova tarefa" no menu de ações de cada cobrança (lista e
  tela da cobrança). Abre com pedido e cliente preenchidos e a cobrança
  identificada nos detalhes (tipo, valor, situação, vencimento e referência).
  Não há coluna para a cobrança em `tarefas_equipe`: o vínculo é o texto.
- **Cliente**: botão "Nova tarefa" no cabeçalho do cadastro, com o cliente
  preenchido.

## Conversa e novidade

Decisão do dono em 01/10/2026. Migrations `tarefas_equipe_conversa` e
`tarefas_equipe_novidade`.

**Conversa.** Qualquer participante — quem criou, destinatários, responsável e
admin; em tarefa para todos, quem participa das Tarefas — escreve mensagens,
com anexo opcional, sem mudar a situação. É a mesma regra de quem vê a tarefa.

- Só com a tarefa aberta ou em andamento, como os anexos. Encerrada, a conversa
  fica para leitura.
- Ninguém edita nem apaga mensagem: não há policy nem privilégio de UPDATE ou
  DELETE em `tarefas_equipe_mensagens`.
- Autor e horário são preenchidos pelo banco.
- O anexo da mensagem reaproveita `tarefas_equipe_anexos` e o bucket privado:
  `momento = MENSAGEM` e `mensagem_id`. O banco só aceita apontar para mensagem
  da mesma tarefa, escrita por quem anexa.
- No detalhe, eventos (criada, assumida, concluída, cancelada) e mensagens
  aparecem juntos, em ordem, com autor e horário.

**Novidade.** Mensagem, assumir, concluir e cancelar contam como novidade. A
tarefa guarda a última (`novidade_em`, `novidade_por_user_id`, `novidade_tipo`)
e `tarefas_equipe_vistos.visto_em` passa a ser a hora da última abertura.

Há novidade para mim (`tarefas_equipe_novas()`) quando:

1. recebi a tarefa e nunca abri (regra de sempre); ou
2. a última novidade é de outra pessoa, é posterior à minha última abertura e
   estou envolvido: criei, sou o responsável, sou destinatário escolhido ou já
   escrevi na conversa.

Em tarefa **para todos** os destinatários não contam no item 2: só quem criou,
o responsável e quem já escreveu. Não pisca para a equipe inteira a cada
mensagem. Quem fez a ação nunca recebe o próprio aviso.

Enquanto houver novidade, piscam o ícone da Topbar, o item do menu e o selo da
linha (Nova, Nova mensagem, Assumida, Concluída agora, Cancelada agora), até a
pessoa abrir a tarefa. Abrir chama `tarefas_equipe_marcar_vista`. O toast em
tempo real sai para os mesmos casos: o provedor só avisa se, depois do evento,
a tarefa entrou na lista de novas — quem decide é o banco.

As colunas de novidade só mudam por dentro das triggers: um PATCH direto do
cliente não consegue forjar nem apagar uma novidade.

Rotas: `POST /api/tarefas/[id]/mensagens`; o registro de anexo aceita
`mensagem_id`.

## Legado

- `propostas_pendencias` não recebe mais nada do sistema. A tela `/pendencias`
  saiu do menu, segue acessível pelo endereço e ficou só para consulta (sem
  Assumir, Concluir e Cancelar; constante `LEGADO_SOMENTE_LEITURA`).
- Migração de 01/10/2026: só a pendência 98 (proposta 19343, R$ 27,57 pagos a
  mais) virou tarefa, a nº 16, para Marielle Fonseca. A linha antiga ficou
  CANCELADA com a nota "Migrada para a tarefa nº 16". As demais abertas (20,
  91, 99, 123, 128, 168, 169, 170) ficaram no legado por decisão do dono.
- `PropostaPendenciasPanel.tsx` não é mais usado por nenhuma tela.
- Não mexidos: `conta_corrente_pendencias` (Conta Corrente) e a rota
  `consolidar-total-paga`, que ainda lê `propostas_pendencias` e não tem tela.

## Validação da etapa 1

Dados gravados de verdade (autorizado) e apagados no fim:

1. de dentro de uma proposta, tarefa URGENTE para duas pessoas com PDF;
2. sinal piscando para as duas até cada uma abrir;
3. uma delas assume e conclui com anexo;
4. terceiro usuário sem acesso à tarefa e ao anexo;
5. tarefa para todos vista por qualquer usuário da equipe.

ACL e policies das tabelas novas e do bucket conferidos com
`array_agg(grantee)`: sem `anon`, bucket não público.

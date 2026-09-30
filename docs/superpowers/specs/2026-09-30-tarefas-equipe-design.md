# Tarefas da equipe e lista de melhorias — especificação

Data: 30/09/2026. Decisões do dono registradas na mesma data.

## Objetivo

Uma pessoa abre uma tarefa para outra pessoa (ex.: o Financeiro pede ao
vendedor a OC do cliente). Quem recebe assume, resolve e conclui. A diretoria
usa a mesma tela para a lista de melhorias do sistema, destinada ao DEV.
Prioridade: simplicidade para o usuário comum.

## Decisões

| Tema | Decisão |
|---|---|
| Tabela | Nova, `public.tarefas_equipe`. `propostas_pendencias` vira legado, somente leitura depois da fase 2. |
| Destino | Sempre uma pessoa. Sem setores nesta etapa. |
| Prioridade | Não existe na fase 1. |
| Melhorias | Mesma tela, `tipo = MELHORIA`, responsável opcional, criadas e vistas só por diretoria e admin, aba própria. |
| Aviso | Contador no menu e na Topbar, toast em tempo real. Sem WhatsApp. |
| Menu | Item próprio "Tarefas", fora do Financeiro. |

## Quem é "admin"

O mesmo critério da tela (`usuarios.service.ts`): com perfil ativo, o perfil
decide (`*` ou `admin.usuarios.view`); sem perfil, `is_admin` ou
`is_super_adm`. Em 30/09/2026 isso dá os perfis Super Administrador e
Administrador — diretoria, DEV, Financeiro (Marielle) e Expedição (Celi).
"Diretoria e admin" das melhorias é esse mesmo grupo.

No banco o critério mora em `tarefas_equipe__eh_admin(uuid)`, SECURITY
DEFINER, porque `usuarios` tem SELECT por coluna e `is_admin()` está quebrada.

## Dados

`public.tarefas_equipe`

| Coluna | Regra |
|---|---|
| `id` | identidade |
| `tipo` | TAREFA (padrão) ou MELHORIA |
| `titulo` | obrigatório, 1 a 200 caracteres |
| `descricao` | opcional, até 5000 |
| `responsavel_user_id` | obrigatório em TAREFA; opcional em MELHORIA; tem de ser usuário da equipe (perfil ativo com alguma permissão); em MELHORIA, se houver, tem de ser admin |
| `id_int` | vínculo opcional a pedido (`propostas.id_int`), vira nulo se o pedido for apagado |
| `id_cliente` | vínculo opcional a cliente, idem |
| `data_limite` | prazo opcional |
| `status` | ABERTA, EM_ANDAMENTO, CONCLUIDA, CANCELADA |
| `criado_por_user_id`, `created_at` | automáticos |
| `assumido_por_user_id`, `assumido_at` | automáticos ao assumir |
| `concluido_por_user_id`, `concluido_at`, `observacao_conclusao` | ao concluir; a observação é opcional, até 1000 |
| `cancelado_por_user_id`, `cancelado_at` | ao cancelar |
| `updated_at` | automático |

Título, descrição, prazo, vínculos, tipo e criador não mudam depois de criados
nesta fase. Não há edição, só mudança de situação.

## Situações

```
ABERTA ──assumir──> EM_ANDAMENTO ──concluir──> CONCLUIDA
  │                     │
  ├──concluir───────────┘ (concluir direto também vale)
  └──cancelar──> CANCELADA  (de ABERTA ou EM_ANDAMENTO)
```

CONCLUIDA e CANCELADA são finais. Não há reabertura.

## Quem vê e faz o quê

| Ação | Quem |
|---|---|
| Ver uma TAREFA | quem criou, quem recebeu, admin |
| Ver uma MELHORIA | admin |
| Criar TAREFA | qualquer usuário logado |
| Criar MELHORIA | admin |
| Assumir, concluir | quem recebeu, ou admin. Admin que assume uma melhoria sem responsável vira o responsável. |
| Cancelar | quem criou, ou admin |
| Apagar | ninguém |

A regra está no banco, em três camadas:

1. **RLS** decide quais linhas cada um vê, cria e altera.
2. **Trigger `tarefas_equipe__guarda`** (BEFORE INSERT/UPDATE) decide a
   transição e quem pode fazê-la, preenche autor e horário pelo `auth.uid()`
   (ignora o que o cliente mandar) e trava os campos imutáveis.
3. **Privilégios**: `anon` sem nenhum acesso; `authenticated` sem DELETE,
   TRUNCATE, REFERENCES e TRIGGER. TRUNCATE ignora RLS, por isso sai.

As rotas da aplicação gravam com a sessão do usuário (não com service role),
então as três camadas valem para elas também.

## Rotas

- `POST /api/tarefas` — cria. Corpo: `tipo`, `titulo`, `descricao`,
  `responsavel_user_id`, `id_int`, `id_cliente`, `data_limite`.
- `POST /api/tarefas/[id]/situacao` — corpo `acao`: `assumir`, `concluir`
  (com `observacao` opcional) ou `cancelar`.

As duas validam formato e traduzem a recusa do banco para uma frase simples.
A leitura é direta pelo cliente Supabase, filtrada pelo RLS.

## Tela `/tarefas`

Cabeçalho "Tarefas" com o botão **Nova tarefa** (ou **Nova melhoria** na aba
Melhorias). Abas:

| Aba | Conteúdo | Quem vê a aba |
|---|---|---|
| Minhas | TAREFA com responsável = eu | todos |
| Criadas por mim | TAREFA criada por mim | todos |
| Todas | toda TAREFA | admin |
| Melhorias | toda MELHORIA | admin |

Em cada aba, um seletor "Em aberto / Encerradas". Aba e seletor ficam na URL.

Cada linha mostra título, para quem, quem pediu, prazo (vermelho se vencido),
pedido/cliente vinculado e a situação. Um botão principal muda com o momento:
**Assumir** em ABERTA, **Concluir** em EM_ANDAMENTO, só aparece para quem pode.
Clicar na linha abre o detalhe: descrição, vínculos, histórico (criada, assumida,
concluída ou cancelada, por quem e quando) e os botões permitidos, inclusive
**Cancelar** para quem criou.

**Nova tarefa**: título, para quem (lista de pessoas da equipe), descrição,
número do pedido, código do cliente e prazo. Só título e "para quem" são
obrigatórios. Na melhoria, "para quem" é opcional e lista só admins.

## Aviso

- Contador = minhas tarefas em ABERTA ou EM_ANDAMENTO (TAREFA e MELHORIA com
  responsável = eu).
- Aparece no item "Tarefas" do menu (desktop, trilho recolhido e celular) e no
  ícone da Topbar, que passa a apontar para `/tarefas`.
- Um provedor único (`TarefasProvider`) conta, escuta `tarefas_equipe` em tempo
  real e mostra o toast: nova tarefa para mim; minha tarefa assumida, concluída
  ou cancelada por outra pessoa. O realtime respeita o RLS, então ninguém
  recebe evento de tarefa que não pode ver.
- A tabela entra na publicação `supabase_realtime` na mesma migration.

## Legado

- `propostas_pendencias` continua como está nesta entrega: tela
  `/pendencias` no Financeiro, aba no chat da proposta e criação automática do
  pagamento combinado.
- A Topbar deixa de mostrar o contador das pendências antigas e passa a mostrar
  o de tarefas. O canal de tempo real das pendências segue, para a tela antiga
  e seus toasts.
- Fase 2 (fora desta entrega): criar tarefa de dentro do pedido, pagamento
  combinado grava em `tarefas_equipe`, `/pendencias` sai do menu e fica só
  leitura.

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| 1 | Tabela, RLS, trigger, rotas, tela, menu, contador, toasts | esta entrega |
| 2 | Ligação com pedido e pagamento combinado, legado só leitura | pendente |
| 3 | Aba Melhorias (tipo MELHORIA) | esta entrega |
| 4 | Limpeza e arquivamento do legado | pendente |

## Validação

Tudo o que grava roda em transação desfeita no fim (DO-block com RAISE), com
usuários reais simulados por `request.jwt.claims`:

1. usuário comum A cria tarefa para B; B assume e conclui; A vê CONCLUIDA;
2. usuário comum C não vê a tarefa e não consegue alterá-la;
3. admin cria melhoria; usuário comum não vê;
4. recusas: C tenta assumir, A tenta concluir, B tenta cancelar, comum tenta
   criar melhoria, ninguém apaga.

ACL e policies conferidos com `array_agg(grantee)`, sem `anon`.

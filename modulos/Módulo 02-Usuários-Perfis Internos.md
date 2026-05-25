# Módulo 02 — Usuários / Perfis Internos

## Objetivo

Controlar os dados internos dos usuários do ERP depois que o login já foi validado pelo Supabase Auth.

Este módulo não faz login e não salva senha.  
Ele serve para complementar o usuário autenticado com informações operacionais do sistema, como nome, empresa, vendedor, setor e flags administrativas.

A autenticação acontece no Supabase Auth.  
O perfil interno acontece na tabela `public.usuarios`.

---

## Tabela oficial

Tabela principal:

`public.usuarios`

Esta é a tabela usada pelo ERP para identificar o usuário dentro do sistema.

A tabela `public.perfis` existe, mas não será considerada a fonte principal do ERP neste mapa, a menos que futuramente seja reaproveitada ou migrada.

---

## Relação com Supabase Auth

A coluna principal da tabela é:

`user_id`

Ela deve corresponder ao `id` do usuário autenticado no Supabase Auth.

Fluxo esperado:

1. Usuário faz login pelo Supabase Auth.
2. O sistema pega o `auth.user.id`.
3. O sistema busca em `public.usuarios` onde `user_id = auth.user.id`.
4. Se encontrar, carrega o perfil interno.
5. Se não encontrar, bloqueia o acesso ao ERP e mostra tela de acesso não liberado.

---

## Colunas reais da tabela `usuarios`

### `user_id`

Tipo: `uuid`  
Obrigatório: sim

Identificador principal do usuário.

Deve ser o mesmo UUID do usuário no Supabase Auth.

É a ligação entre autenticação e perfil interno.

---

### `email`

Tipo: `text`

E-mail do usuário.

Deve preferencialmente ser o mesmo e-mail usado no Supabase Auth.

Uso:
- exibir no perfil;
- localizar usuário;
- identificar responsável por ações;
- facilitar suporte administrativo.

---

### `nome_usuario`

Tipo: `text`

Nome exibido dentro do ERP.

Uso:
- cabeçalho do sistema;
- menu do usuário;
- registros de criação/alteração;
- identificação de atendente/vendedor;
- mensagens internas.

---

### `telefone`

Tipo: `text`

Telefone do usuário.

Uso opcional:
- contato interno;
- confirmação;
- cadastro administrativo.

---

### `documento`

Tipo: `text`

Documento do usuário.

Pode ser CPF ou outro identificador.

Uso opcional:
- cadastro interno;
- controle administrativo;
- validações futuras.

---

### `is_admin`

Tipo: `boolean`  
Default: `false`

Indica se o usuário é administrador.

Uso:
- liberar menus administrativos;
- permitir ações de gestão;
- acessar configurações;
- ver mais informações que usuários comuns.

Esta flag não deve ser usada sozinha para todas as permissões.  
Ela deve ser combinada com o módulo de permissões.

---

### `data_cadastro`

Tipo: `timestamp with time zone`  
Default: `now()`

Data em que o registro do usuário foi criado na tabela interna.

Uso:
- auditoria;
- listagem de usuários;
- histórico administrativo.

---

### `data_atualizacao`

Tipo: `timestamp with time zone`  
Default: `now()`

Data da última atualização do perfil interno.

Uso:
- auditoria;
- controle de alterações;
- identificação de perfil desatualizado.

---

### `is_vendedor`

Tipo: `boolean`  
Default: `false`

Indica se o usuário atua como vendedor/atendente comercial.

Uso:
- vincular propostas;
- filtrar clientes/propostas;
- identificar responsável comercial;
- alimentar relatórios por vendedor.

---

### `avatar`

Tipo: `text`

URL ou caminho da imagem/avatar do usuário.

Uso:
- menu do usuário;
- perfil;
- identificação visual em telas internas.

---

### `meu_vendedor`

Tipo: `text`

Campo textual relacionado ao vendedor vinculado ao usuário.

Uso provável:
- exibir nome do vendedor;
- compatibilidade com regras antigas do FlutterFlow;
- apoio em filtros ou relacionamentos comerciais.

Este campo precisa ser revisado para confirmar se continua necessário ou se será substituído por `id_vendedor`.

---

### `id_vendedor`

Tipo: `uuid`

Identificador do vendedor vinculado.

Uso:
- relacionar usuário com vendedor;
- filtrar propostas, clientes e relatórios;
- identificar responsável comercial de forma mais segura que texto.

Este campo parece mais confiável que `meu_vendedor`, por ser UUID.

---

### `clienteIdeal`

Tipo: `boolean`  
Default: `false`

Indica se o usuário tem relação com “cliente Ideal” ou alguma regra especial do sistema atual.

Uso ainda precisa ser confirmado.

Possíveis usos:
- diferenciar usuário interno de cliente;
- liberar alguma área específica;
- compatibilidade com fluxo antigo.

---

### `whats_confirmado`

Tipo: `boolean`  
Default: `false`

Indica se o WhatsApp do usuário foi confirmado.

Uso:
- validação de contato;
- fluxo de confirmação;
- segurança/comunicação.

---

### `cod_confirma`

Tipo: `text`

Código de confirmação, provavelmente usado para validar WhatsApp ou identidade.

Uso:
- confirmação de telefone/WhatsApp;
- fluxo de validação.

Deve ser tratado como dado sensível operacional.  
Não deve ser exibido livremente em telas comuns.

---

### `cus_asaas`

Tipo: `text`

Identificador de cliente no Asaas.

Uso provável:
- integração antiga ou futura com Asaas;
- relacionamento financeiro externo.

Precisa ser confirmado se ainda está em uso.

---

### `cpfCnpj`

Tipo: `text`

Documento do usuário em formato CPF/CNPJ.

Pode ser redundante com `documento`.

Uso:
- compatibilidade com integrações;
- identificação fiscal;
- cadastro antigo.

Precisa revisar se `documento` e `cpfCnpj` devem coexistir.

---

### `id_empresa`

Tipo: `bigint`

Empresa padrão ou empresa vinculada ao usuário.

Relaciona o usuário com uma empresa do sistema.

Uso:
- definir contexto inicial;
- filtrar dados por empresa;
- limitar acesso;
- personalizar cabeçalho;
- separar operação multiempresa.

Empresas conhecidas no sistema:

- `1` — Ideal Gráfica
- `2` — Ideal Birô
- `3` — E3 Brindes

---

### `is_super_adm`

Tipo: `boolean`  
Default: `false`

Indica se o usuário é super administrador.

Uso:
- acessar todas as empresas;
- trocar contexto de empresa;
- ver configurações avançadas;
- acessar áreas críticas;
- gerenciar usuários e permissões.

Esta flag deve ter prioridade maior que `is_admin`.

---

### `setor`

Tipo: `text`

Setor operacional do usuário.

Uso:
- separar permissões por área;
- controlar menu;
- personalizar dashboard;
- limitar ações.

Setores possíveis a revisar:

- COMERCIAL
- FINANCEIRO
- FISCAL
- PRODUCAO
- ADMIN
- SISTEMA

---

## O que este módulo faz

Este módulo define quem é o usuário dentro do ERP.

Ele deve permitir:

- listar usuários internos;
- visualizar perfil do usuário;
- editar dados básicos;
- vincular usuário a uma empresa;
- indicar se é vendedor;
- indicar se é admin;
- indicar se é super admin;
- definir setor;
- carregar contexto inicial após login;
- alimentar permissões em outros módulos.

---

## O que este módulo não faz

Este módulo não deve:

- autenticar senha;
- salvar senha;
- substituir Supabase Auth;
- emitir token;
- controlar diretamente todas as permissões;
- guardar chaves sensíveis;
- liberar ações críticas sozinho.

Permissões detalhadas pertencem ao:

`Módulo 03 — Permissões e Acessos`

---

## Fluxo após login

1. Usuário autentica no Supabase Auth.
2. Sistema recebe `user_id`.
3. Sistema busca `public.usuarios`.
4. Se não encontrar usuário interno:
   - bloquear acesso;
   - mostrar tela “Acesso não liberado”.
5. Se encontrar:
   - carregar nome;
   - carregar empresa;
   - carregar setor;
   - carregar flags administrativas;
   - montar menu permitido;
   - direcionar para dashboard.

---

## Fluxo de usuário sem perfil interno

Se o usuário existe no Supabase Auth, mas não existe em `public.usuarios`:

Status lógico:

`SEM_PERFIL_INTERNO`

Comportamento:

- não entra no ERP;
- não vê menus;
- não acessa dados;
- recebe mensagem amigável.

Mensagem sugerida:

> Seu login foi identificado, mas seu acesso ao ERP ainda não foi liberado. Fale com o administrador do sistema.

---

## Fluxo de usuário inativo

Atualmente, na tabela `usuarios`, não apareceu uma coluna clara como `ativo` ou `status`.

Por isso, ainda não existe uma regra explícita para usuário inativo nesta tabela.

Sugestão futura:

Criar uma coluna:

`ativo boolean default true`

ou:

`status text default 'ATIVO'`

Possíveis status:

- ATIVO
- INATIVO
- BLOQUEADO
- PENDENTE

Enquanto isso não existir, o bloqueio depende de outras regras ou do próprio Supabase Auth.

---

## Regras importantes

1. `user_id` é a ligação oficial com Supabase Auth.
2. `public.usuarios` é a tabela oficial de perfil interno do ERP.
3. Usuário autenticado sem registro em `usuarios` não deve acessar o ERP.
4. `is_super_adm` tem prioridade sobre `is_admin`.
5. `id_empresa` define empresa padrão do usuário.
6. `setor` ajuda a organizar permissões e menus.
7. `is_vendedor` indica vínculo comercial.
8. `id_vendedor` deve ser preferido em vez de nome textual quando possível.
9. Dados sensíveis não devem ser expostos em telas comuns.
10. O front nunca deve usar `service_role`.

---

## Componentes necessários no novo sistema

- UserProfileProvider
- CurrentUserContext
- UserMenu
- UserAvatar
- UserProfilePage
- UserListPage
- UserEditForm
- CompanyContextLoader
- UserStatusGuard
- InternalProfileGuard

---

## Telas necessárias

### Lista de usuários

Objetivo:

Permitir que administradores visualizem e gerenciem usuários internos.

Colunas sugeridas:

- Nome
- E-mail
- Empresa
- Setor
- Vendedor
- Admin
- Super admin
- Data cadastro
- Ações

---

### Detalhe do usuário

Objetivo:

Exibir dados completos do usuário interno.

Seções:

- Dados básicos
- Empresa e setor
- Perfil comercial
- Administração
- Integrações
- Segurança/validações

---

### Editar usuário

Objetivo:

Permitir ajustes administrativos no perfil interno.

Campos editáveis:

- nome_usuario
- telefone
- documento
- avatar
- id_empresa
- setor
- is_vendedor
- id_vendedor
- is_admin
- is_super_adm

Campos que exigem cuidado:

- user_id
- email
- cus_asaas
- cod_confirma

---

## Padrão de segurança para edição

A edição de usuário deve ser restrita.

Somente usuários autorizados devem alterar:

- `is_admin`
- `is_super_adm`
- `id_empresa`
- `setor`
- `id_vendedor`

Usuário comum pode editar apenas dados próprios, se permitido:

- nome
- telefone
- avatar

Não permitir que usuário comum se torne admin pelo front.

---

## Relação com empresas

A coluna `id_empresa` deve apontar para a empresa padrão do usuário.

Uso esperado:

- carregar empresa inicial no login;
- filtrar dados;
- exibir nome da empresa no cabeçalho;
- definir contexto operacional.

Para super admin:

- pode ver todas as empresas;
- pode trocar empresa ativa;
- pode usar visão consolidada.

Para usuário comum:

- normalmente fica limitado à sua empresa.

Esta regra final pertence ao módulo de permissões.

---

## Relação com vendedores

Campos relacionados:

- `is_vendedor`
- `id_vendedor`
- `meu_vendedor`

Uso esperado:

- identificar se o usuário atua no comercial;
- vincular propostas;
- filtrar clientes;
- montar relatórios por vendedor.

Recomendação:

Usar `id_vendedor` como referência principal.  
Usar `meu_vendedor` apenas como apoio visual ou compatibilidade, se ainda for necessário.

---

## Observações sobre colunas possivelmente redundantes

Existem alguns campos que parecem ter sobreposição:

### `documento` e `cpfCnpj`

Ambos parecem guardar documento.

Revisar:
- qual é usado atualmente;
- se um pode virar legado;
- se devemos padronizar no novo front.

### `meu_vendedor` e `id_vendedor`

`meu_vendedor` é texto.  
`id_vendedor` é UUID.

Recomendação:
- usar `id_vendedor` para regra;
- usar nome apenas para exibição.

### `clienteIdeal`

Campo precisa de revisão.

Pode ser:
- regra antiga;
- identificação especial;
- controle de portal;
- flag não usada.

---

## Melhorias sugeridas para o novo sistema

Para deixar o módulo mais robusto, avaliar futuramente:

1. Criar coluna `ativo`.
2. Criar coluna `status`.
3. Criar coluna `ultimo_login_em`.
4. Criar coluna `criado_por`.
5. Criar coluna `atualizado_por`.
6. Criar tabela separada de permissões, se necessário.
7. Padronizar documento em apenas um campo.
8. Confirmar se `public.perfis` será ignorada, removida ou migrada futuramente.

Nenhuma dessas mudanças deve ser feita sem revisão, porque o banco está em produção.

---

## Regras para Cursor/Codex

Ao trabalhar neste módulo:

- não criar tabela nova de usuários sem autorização;
- não alterar Supabase Auth diretamente;
- não salvar senha;
- não usar `service_role` no front;
- não assumir que todo usuário autenticado pode acessar o ERP;
- não alterar `is_admin` ou `is_super_adm` sem confirmação administrativa;
- não criar permissões inventadas sem mapear com o sistema;
- não apagar ou ignorar `public.usuarios`.

---

## Primeira implementação sugerida

Etapa 1:

- criar serviço `usuariosService`;
- buscar usuário interno por `user_id`;
- criar contexto `CurrentUser`;
- bloquear acesso se não encontrar perfil interno.

Etapa 2:

- criar tela de perfil do usuário;
- exibir nome, e-mail, telefone, avatar, empresa e setor.

Etapa 3:

- criar listagem administrativa de usuários;
- permitir filtro por nome, e-mail, empresa, setor e admin.

Etapa 4:

- criar formulário de edição administrativa;
- proteger alterações sensíveis.

---

## Resultado esperado

Ao final deste módulo, o sistema deve:

- identificar o usuário interno após login;
- carregar empresa padrão;
- carregar setor;
- identificar se é vendedor;
- identificar se é admin ou super admin;
- bloquear usuários sem perfil;
- fornecer base para o módulo de permissões;
- fornecer base para menus e contexto do sistema.

---

## Pendências para revisão do Everton

1. Confirmar se `public.usuarios` é definitivamente a tabela oficial.
2. Confirmar se `public.perfis` pode ser ignorada no novo sistema.
3. Confirmar se existe regra atual para usuário inativo.
4. Confirmar se devemos criar futuramente coluna `ativo` ou `status`.
5. Confirmar uso real de `clienteIdeal`.
6. Confirmar uso real de `cus_asaas`.
7. Confirmar se `documento` ou `cpfCnpj` será o campo principal.
8. Confirmar se `meu_vendedor` ainda é necessário.
9. Confirmar lista oficial de setores.
10. Confirmar regra de usuário comum, admin e super admin.
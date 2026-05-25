# Módulo 01 — Autenticação / Login

## Objetivo

Permitir que o usuário acesse o sistema com segurança usando Supabase Auth.

Este módulo cuida apenas de:

- login;
- logout;
- recuperação de senha;
- redefinição de senha;
- sessão ativa;
- sessão expirada;
- redirecionamento inicial após login.

O módulo de Login não define sozinho as permissões do usuário.  
Depois do login, o sistema consulta o módulo de Usuários/Perfis para saber quem é o usuário dentro do ERP.

---

## Fluxo principal

1. Usuário acessa o sistema.
2. Se não houver sessão ativa, vai para a tela de Login.
3. Usuário informa e-mail e senha.
4. Supabase Auth valida as credenciais.
5. Se login falhar, mostra mensagem amigável.
6. Se login funcionar, o sistema carrega a sessão.
7. Depois disso, chama o perfil interno do usuário.
8. Se o perfil existir e estiver liberado, entra no sistema.
9. Se não existir perfil, vai para tela "Sem acesso liberado".

---

## Páginas do módulo

### Login

Campos:

- e-mail;
- senha;
- botão Entrar;
- link Esqueci minha senha.

Mensagens:

- e-mail ou senha inválidos;
- usuário sem acesso liberado;
- sessão expirada;
- erro inesperado.

---

### Esqueci minha senha

Campos:

- e-mail;
- botão Enviar link.

Mensagem padrão:

> Se o e-mail estiver cadastrado, enviaremos um link para redefinição de senha.

---

### Redefinir senha

Campos:

- nova senha;
- confirmar nova senha;
- botão Salvar nova senha.

---

### Sessão expirada

Aparece quando o usuário ficou sem sessão válida.

Ações:

- voltar para login;
- entrar novamente.

---

### Sem acesso liberado

Aparece quando o login no Supabase funcionou, mas o usuário não possui perfil interno liberado no ERP.

Mensagem:

> Seu login foi identificado, mas seu acesso ao sistema ainda não foi liberado. Fale com o administrador.

---

## Dados envolvidos

### Supabase Auth

Responsável por:

- autenticar;
- manter sessão;
- recuperar senha;
- redefinir senha;
- logout.

### Tabela interna de usuários

Usada depois do login para validar se o usuário existe dentro do ERP.

Campos conhecidos:

- user_id;
- email;
- nome_usuario;
- is_admin;
- is_super_adm;
- is_vendedor;
- setor;
- id_empresa;
- id_vendedor;
- avatar.

Essa tabela não substitui o Supabase Auth.  
Ela apenas complementa os dados do usuário autenticado.

---

## Regras importantes

1. A senha nunca é salva em tabela própria.
2. O login sempre usa Supabase Auth.
3. Após login, sempre buscar o perfil interno do usuário.
4. Usuário autenticado sem perfil interno não entra no ERP.
5. O front nunca usa service_role.
6. Erros técnicos não aparecem crus para o usuário.
7. O logout deve limpar sessão e estados locais sensíveis.

---

## Componentes necessários

- LoginPage
- LoginForm
- ForgotPasswordPage
- ResetPasswordPage
- SessionExpiredPage
- UnauthorizedPage
- AuthLayout
- ProtectedRoute
- UserSessionProvider

---

## Comportamento esperado

Ao finalizar este módulo, o sistema deve permitir:

- entrar com e-mail e senha;
- sair do sistema;
- recuperar senha;
- redefinir senha;
- manter sessão ativa;
- proteger rotas privadas;
- bloquear acesso se não houver perfil interno liberado.

---

## O que este módulo NÃO faz

Este módulo não define:

- quais menus o usuário pode ver;
- quais empresas ele pode acessar;
- quais módulos ele pode usar;
- permissões de financeiro, fiscal, produção ou admin.

Essas regras pertencem ao módulo:

**Módulo 03 — Permissões e Acessos.**
# ERP Ideal — Diretrizes para Agentes de IA

Este arquivo contém as diretrizes gerais e obrigatórias para atuação de agentes de IA no ERP Ideal.

## Princípios básicos

- **Português do Brasil:** toda comunicação, diagnóstico, plano e documentação devem ser produzidos em PT-BR.
- **Segurança em primeiro lugar:** nunca execute alterações destrutivas no Supabase, banco de dados, infraestrutura ou configurações estruturais sem diagnóstico, evidências e aprovação explícita.
- **Investigar antes de alterar:** não presuma a arquitetura, os nomes dos campos ou o fluxo existente. Inspecione o código e as dependências relevantes antes de propor ou executar mudanças.
- **Preservar a arquitetura:** respeite a organização modular existente, especialmente a estrutura em `src/features`.
- **Mudança mínima:** corrija somente o necessário, evitando refatorações paralelas não solicitadas.
- **Validação obrigatória:** após qualquer alteração, execute ou indique testes objetivos que comprovem o comportamento esperado.
- **Sem invenções:** não invente arquivos, tabelas, funções, regras de negócio, resultados de testes ou comportamentos não comprovados.

## Fluxo de commit, push e deploy (OBRIGATÓRIO para qualquer agente)

Quando o usuário pedir "commit", "push", "coloca no ar" ou "sobe":

1. **Valide antes**: `npx tsc --noEmit` e `npx eslint <arquivos alterados>` — nunca commite com erro.
2. **Onde commitar**: o trabalho é editado na árvore principal (`d:\PROJETO IDEAL ANTIGRAVITY`), mas o commit de produção acontece no worktree **`D:\worktrees\maestro-agent-loop`**, que aponta para a branch **`erp-ideal-preview`**. Copie os arquivos alterados da árvore principal para o MESMO caminho no worktree antes do commit.
3. **`git add` somente dos arquivos da tarefa** (nunca `git add -A`); um commit por mudança lógica.
4. **Mensagem de commit**: `tipo(modulo): descricao` em ASCII (sem acentos), SEM aspas duplas — no PowerShell 5.1 aspas duplas quebram; use here-string com aspas simples (`@'...'@`).
5. **Push**: `git push origin erp-ideal-preview`. O push dispara o **deploy automático de produção na Vercel** — só faça quando o usuário pedir.

NUNCA:
- commitar `.env.local`, segredos ou `tsconfig.tsbuildinfo`;
- `git push --force`, `git reset --hard` em branch publicada ou rebase interativo;
- criar/alterar variáveis de ambiente do deploy (Vercel) — isso é decisão do dono do projeto; variáveis novas nascem só no `.env.local` local;
- commitar direto na árvore principal achando que é deploy — a branch de produção é a `erp-ideal-preview` via worktree.

Reversão: sempre `git revert` (novo commit), preservando o histórico — nunca apagar commits.

## Regras e skills do workspace

Consulte e aplique as regras relevantes localizadas em:

- `.agents/rules/`
- `.agents/skills/`

## Documentação detalhada

Quando a tarefa envolver decisões arquiteturais, segurança, comportamento de agentes ou regras gerais do projeto, consulte:

- [`docs/AI_AGENTS.md`](docs/AI_AGENTS.md)
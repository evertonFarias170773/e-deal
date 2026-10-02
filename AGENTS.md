# Vibe — Diretrizes para Agentes de IA

Este arquivo contém as diretrizes gerais e obrigatórias para atuação de agentes de IA no Vibe.

## Princípios básicos

- **Português do Brasil:** toda comunicação, diagnóstico, plano e documentação devem ser produzidos em PT-BR.
- **Segurança em primeiro lugar:** nunca execute alterações destrutivas no Supabase, banco de dados, infraestrutura ou configurações estruturais sem diagnóstico, evidências e aprovação explícita.
- **Investigar antes de alterar:** não presuma a arquitetura, os nomes dos campos ou o fluxo existente. Inspecione o código e as dependências relevantes antes de propor ou executar mudanças.
- **Preservar a arquitetura:** respeite a organização modular existente, especialmente a estrutura em `src/features`.
- **Mudança mínima:** corrija somente o necessário, evitando refatorações paralelas não solicitadas.
- **Validação obrigatória:** após qualquer alteração, execute ou indique testes objetivos que comprovem o comportamento esperado.
- **Sem invenções:** não invente arquivos, tabelas, funções, regras de negócio, resultados de testes ou comportamentos não comprovados.

## Fluxo de commit, push e deploy (OBRIGATÓRIO para qualquer agente)

**Modelo de BRANCH ÚNICA** (vigente desde 27/07/2026): todo o trabalho acontece
na árvore principal `d:\PROJETO IDEAL ANTIGRAVITY`, direto na branch
**`erp-ideal-preview`** — a mesma que a Vercel publica em produção
automaticamente a cada push. Não existem branches de feature, worktrees nem
cherry-picks: apenas UM desenvolvedor (o dono) trabalha no projeto.

Quando o usuário pedir "publica", "coloca no ar", "commit e push" ou "sobe":

1. **Valide antes**: `npx tsc --noEmit` (e `npx eslint` nos arquivos alterados) — nunca publique com erro.
   Rode também `node scripts/checar-manual.mjs`: ele avisa se alguma ficha do manual pode ter ficado desatualizada (ver "Manual de uso" abaixo).
2. **Publique TUDO**: `git add -A` (o `.gitignore` já exclui rascunhos, diagnósticos e segredos) — o dono quer SEMPRE o estado local completo publicado, nunca pedaços escolhidos a dedo.
3. **Mensagem de commit**: `tipo(modulo): descricao` em ASCII (sem acentos), SEM aspas duplas — no PowerShell 5.1 aspas duplas quebram; use here-string com aspas simples (`@'...'@`).
4. **Push**: `git push origin erp-ideal-preview` → deploy automático de produção na Vercel.
5. Se o usuário pedir só "commit" (sem publicar), pare antes do push.

Enquanto o usuário NÃO pedir publicação: trabalhe e valide normalmente, sem
commitar — o estado local acumula e sai completo no próximo "publica".

NUNCA:
- criar branch nova, worktree ou cherry-pick — o fluxo é branch única;
- commitar `.env.local` ou segredos (arquivos de rascunho/diagnóstico ficam fora via `.gitignore` — rascunhos novos vão na pasta `scratch/`);
- `git push --force`, `git reset --hard` em branch publicada ou rebase interativo;
- criar/alterar variáveis de ambiente do deploy (Vercel) — decisão do dono; variáveis novas nascem só no `.env.local` local.

Reversão: sempre `git revert` (novo commit), preservando o histórico — nunca apagar commits.

## Manual de uso (OBRIGATÓRIO manter atualizado)

O manual de uso do Vibe fica em [`docs/manual/`](docs/manual/README.md): uma ficha por tela ou fluxo, em linguagem de usuário. O Maestro consulta essas fichas para responder dúvidas de uso.

Toda ficha segue o formato fixo de [`docs/manual/_MODELO.md`](docs/manual/_MODELO.md), nesta ordem: última revisão, caminho no menu e endereço; para que serve; quem acessa; botões e ações da tela (nomes exatos); passo a passo; regras e bloqueios; o que não confundir; erros comuns; veja também; arquivos de origem.

- **Toda mudança que o usuário perceba** — tela, botão, aviso, fluxo ou regra visível (inclusive regra que mora em serviço, rota ou banco, mas muda o que a pessoa vê ou consegue fazer) — **atualiza a ficha correspondente NO MESMO COMMIT**, com a data nova em "Última revisão".
- **Mudança só interna** (refatoração, desempenho, teste, migration sem efeito na tela) **não precisa** mexer no manual.
- Tela ou fluxo novo ganha ficha nova, copiada do `_MODELO.md` e listada no `docs/manual/README.md`.
- Escreva só o que o sistema faz hoje, conferido no código: nomes de botões e avisos exatamente como aparecem na tela, sem nome de tabela, função ou arquivo no texto de uso.
- **Arquivos de origem:** a última seção de cada ficha lista os arquivos de código de onde ela saiu. Arquivo novo que sustenta a ficha entra na lista; arquivo removido sai.
- **Checagem:** `node scripts/checar-manual.mjs` (o hook `.githooks/pre-commit` roda a versão `--staged` a cada commit) lê as listas de "Arquivos de origem" e avisa quando um arquivo de origem mudou sem a ficha mudar junto, e quando há arquivo de tela alterado que não é origem de nenhuma ficha. `node scripts/checar-manual.mjs --origens` confere se as listas ainda apontam para arquivos que existem. **Ele só avisa, não bloqueia**: se a mudança for interna, siga; se for visível, atualize a ficha antes de commitar. O hook vale em cada cópia do repositório depois de `git config core.hooksPath .githooks`.

## Regras e skills do workspace

Consulte e aplique as regras relevantes localizadas em:

- `.agents/rules/`
- `.agents/skills/`

## Documentação detalhada

Quando a tarefa envolver decisões arquiteturais, segurança, comportamento de agentes ou regras gerais do projeto, consulte:

- [`docs/AI_AGENTS.md`](docs/AI_AGENTS.md)
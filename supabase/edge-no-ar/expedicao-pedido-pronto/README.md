# expedicao-pedido-pronto: v20 (fora de supabase/functions de propósito)

A v19 em `supabase/functions/expedicao-pedido-pronto/` usa a trava compartilhada com o Imposition. Ela só pode subir na janela da trava (docs/technical/CHATGURU-TRAVA-JANELA.md): antes da migração, ela não envia nada, porque falha fechado.

Esta pasta guarda a **v20**, que é a v18 no ar (commit 46808cb5) mais o modo homologação de 10/11/2026, sem a trava compartilhada:

- **Quando vale:** com o modo teste ligado, em pedido de cliente real (fora do #14).
- **Para onde vai:** sempre para a conversa de teste "Edison Junior - 14".
- **Como fica registrado:** com `envio_teste = true`, fora do "já enviado".
- **Regra dos 2 minutos:** se a conversa de teste foi usada há menos de 2 minutos, o aviso é recusado antes de reservar, com "Conversa de teste ocupada, tente em 2 minutos."

A v19 do repositório tem a mesma homologação.

Situação: **no ar desde 10/11/2026 13:24 (Brasília)**, versão 19 no painel da Supabase. O conteúdo foi conferido arquivo a arquivo e é igual a esta pasta. A prova foi feita no 25006 (13:25:39, diálogo executado na conversa de teste).

## Como subir

O deploy é pela ferramenta da Supabase. Os nomes dos arquivos precisam seguir a estrutura de pastas, senão o import `../../../src/...` de `logica.ts` não resolve:

| Nome no deploy | Origem |
|---|---|
| `supabase/functions/expedicao-pedido-pronto/index.ts` (entrypoint) | esta pasta |
| `supabase/functions/expedicao-pedido-pronto/logica.ts` | esta pasta |
| `src/features/orcamentos/lib/transportadoras-parceiras.ts` | a cópia de deploy de sempre, sem comentários |

Use `verify_jwt` = true.

No mesmo commit do deploy, aplique as fichas: `git apply docs/technical/CHATGURU-HOMOLOGACAO-FICHAS.patch` e troque `{DATA DO DEPLOY}` pela data.

Teste de tipos: `npx tsc -p scratch/tc-fn-v20/tsconfig.json`.

# expedicao-pedido-pronto: v24 no ar (fora de supabase/functions de propósito)

**v24 no ar desde 11/11/2026 (versão 24 no painel da Supabase), conferida arquivo a arquivo igual a esta pasta (index.ts, logica.ts e a cópia de transportadoras-parceiras.ts):** conversa escolhida na aba Artes (`propostas.chatguru_chat_id`, o Comprador da arte).
- Nos dois avisos (pedido em produção e pedido pronto), se a proposta tem conversa escolhida e ela ainda é do cliente no Guru, o aviso vai direto para ela, sem casar o telefone do contato.
- Sem conversa escolhida, ou se ela saiu do cliente, vale a regra de antes. A escolha feita na tela (chat_ids/todas) continua vencendo.
- O "Ver conversas do cliente" (ação `conversas`) também mostra a escolhida como a decisão.
- Regra pura: `logica.conversaDaProposta`. Teste: caso D de `scripts/testes/expedicao-aviso-pronto-v23.test.mts`.
- Prova sem envio, depois do deploy: preparar do 24880 (pedido pronto e pedido em produção) devolveu a conversa "Edison Junior - 14", a gravada na proposta; nenhuma linha de aviso criada. No 24880 o WhatsApp do contato também casa com essa conversa, então a prova de que a escolha vence o telefone é o caso D do teste.
- A v19 da janela (`supabase/functions/`) também não tem a v24: levar junto com a v23.

**v23 ficou no ar de 10/11/2026 17:53 (Brasília) até a v24**, versão 23 no painel da Supabase, conferida arquivo a arquivo igual a esta pasta (index.ts, logica.ts e a cópia de transportadoras-parceiras.ts). É a v22 com o aviso de pedido pronto no clique do "Confirmar despacho".
- `enviar` e `reenviar` aceitam o pedido em EXPEDICAO, A RETIRAR ou EM TRANSITO (`logica.STATUS_AVISO_PRONTO`), porque o despacho já mudou o status quando o aviso sai.
- Ação nova `preparar` (só leitura): para a caixa da janela do despacho, o último aviso, o modelo pela forma de envio que está na tela (`logica.despachoDaTela`), a conversa ou a escolha e o motivo de bloqueio. Nada é gravado.
- Aviso de produção e trava: sem mudança. A v19 da janela (`supabase/functions/`) **não** tem a v23: antes da janela da trava, levar estas duas mudanças para ela.
- Teste: `node --experimental-strip-types scripts/testes/expedicao-aviso-pronto-v23.test.mts`.

A v19 em `supabase/functions/expedicao-pedido-pronto/` usa a trava compartilhada com o Imposition. Ela só pode subir na janela da trava (docs/technical/CHATGURU-TRAVA-JANELA.md): antes da migração, ela não envia nada, porque falha fechado.

Esta pasta guarda a **v21**, que é a v18 (commit 46808cb5) mais o modo homologação de 10/11/2026 e o Link_do_Cliente só com o final, sem a trava compartilhada:

- **Quando vale:** com o modo teste ligado, em pedido de cliente real (fora do #14).
- **Para onde vai:** sempre para a conversa de teste "Edison Junior - 14".
- **Como fica registrado:** com `envio_teste = true`, fora do "já enviado".
- **Regra dos 2 minutos:** se a conversa de teste foi usada há menos de 2 minutos, o aviso é recusado antes de reservar, com "Conversa de teste ocupada, tente em 2 minutos."

- **Link_do_Cliente (v21):** grava só o final do link, `numero_pedido-token` (ex.: 24880-30b9b9), como o envio de arte do Imposition; o começo `https://imposition.ai-ideal.com.br/cliente/` é fixo no template. Vale para o envio real e para a homologação. A v20 (commit 2ecbc78b) gravava o link inteiro.

A v19 do repositório tem a mesma homologação e o mesmo formato do link.

Histórico: a **v22 ficou no ar de 10/11/2026 15:30 a 17:53 (Brasília)**, versão 21 no painel da Supabase, conferida arquivo a arquivo igual a esta pasta. A v22 é a v21 sem o bloqueio "Envio de aviso de produção em ajuste": decisão da diretoria de 10/11, antes da trava compartilhada, assumindo o risco de colisão de campos com o envio de arte do Imposition. Com o modo teste desligado, o Pedido em Produção vai para o cliente real como o aviso da Expedição. A v21 (Link_do_Cliente só com o final) ficou no ar de 14:59 a 15:30 (versão 20 no painel); a v20 de 13:24 a 14:59.

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

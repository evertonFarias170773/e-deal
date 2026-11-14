# expedicao-pedido-pronto: v28 no ar (fora de supabase/functions de propósito)

**v28 no ar desde 14/11/2026 (versão 28 no painel da Supabase).** Deploy autorizado pelo Everton só desta versão. Antes do deploy, a v27 do painel foi conferida igual a esta pasta. É a v27 com uma mudança: pedido com conversa principal não exige mais contato da tabela contatos (o ChatGuru virou a fonte dos contatos do pedido em 8fe7afe9).
- `contatoDoAviso` (logica.ts), usado no pedido pronto (`contextoDoPedido`) e no Colocando em Produção (`contextoProducao`): com `propostas.chatguru_chat_id` preenchido (espelho da principal de `propostas_contatos_chatguru`), `id_contato` vazio, contato apagado, inativo ou de outro cliente deixam o aviso seguir sem contato; o registro em `expedicao_aviso_pronto` fica com `id_contato` vazio (a coluna aceita). Contato válido continua sendo lido. Sem principal, as recusas de antes.
- Destino sem mudança: a principal, se ainda é do cliente no Guru. Sem contato e com a principal fora do cliente, recusa (`PRINCIPAL_FORA_DO_CLIENTE`) em vez de abrir a lista de conversas.
- Diálogos, campos e o Orçamento Whatsapp sem mudança. "Testar modelo" segue a regra de antes (não usa a principal).
- Teste: caso H de `scripts/testes/expedicao-aviso-pronto-v23.test.mts`.
- Depois do deploy, a v28 do painel foi conferida arquivo a arquivo igual a esta pasta. Leitura: 25172 (com contato e principal) vai para Edison Junior - 14; 18353 (sem contato e sem principal) segue recusado como antes.
- Prova (autorizada pelo Everton, escrita temporária só no 25172): linha guardada (md5 sem updated_at ff0dc093), gatilhos de propostas conferidos (nenhum cita id_contato nem repassa a mudança), id_contato gravado vazio, Colocando em Produção reenviado em 14/11/2026 20:25 (UTC) para Edison Junior - 14: campos salvos e Diálogo Executado, registro seq 2 com id_contato vazio. id_contato voltou a 64813; md5 sem updated_at igual antes e depois (só updated_at mudou, pelo gatilho).

**v27 ficou no ar em 13/11/2026 e 14/11/2026, até a v28 (versão 27 no painel da Supabase), conferida arquivo a arquivo igual a esta pasta.** Deploy autorizado pelo Everton só desta versão. É a v26 com uma ação nova, sem mudar as existentes:
- `orcamento_preparar` (só leitura) e `orcamento_enviar`: diálogo "Orçamento Whatsapp" (`DIALOGO_ORCAMENTO`, 6aef91d13ce8e563d886694f), campo `Orcamento` com `propostas.texto_whatsapp` (o texto do box 9 gravado no Salvar), com as quebras de linha (`textoDoOrcamento`; limite 1.024).
- Só envia quem enxerga a proposta pela própria sessão (RLS). Conversa: a escolhida no Comprador (`propostas.chatguru_chat_id`); sem ela, a do WhatsApp do contato, como os avisos. Conversa travada, envio em andamento ou diálogo executado há menos de 120 s recusam antes de gravar campo; a recusa dos 120 s do próprio Guru também aparece.
- Não grava em `expedicao_aviso_pronto`: o evento de lá só aceita `pedido_pronto` e `pedido_em_producao` (ampliar exige DDL). Por isso o envio do orçamento não fica no histórico e um resultado desconhecido dele não trava a conversa.
- Envio de teste em 13/11/2026 19:51 (UTC): 25197 para Edison Junior - 14, campos salvos e Diálogo Executado. Botão do box 9 ainda não ligado: espera a conferência de como o texto chegou no WhatsApp.
- A v19 da janela (`supabase/functions/`) não tem esta ação: levar junto com a v23 a v26.
- Teste: caso G de `scripts/testes/expedicao-aviso-pronto-v23.test.mts`.

**v26 ficou no ar em 13/11/2026, até a v27 (versão 26 no painel da Supabase), conferida arquivo a arquivo igual a esta pasta (index.ts, logica.ts e a cópia de transportadoras-parceiras.ts, igual à da v24).** Deploy autorizado pelo Everton, só desta versão. É a v25 com os modelos alterados pelo Edinão em 13/11:
- Antes do deploy, a v25 do painel foi conferida igual a esta pasta.
- Diálogo Transportadora (6aef36a7eab83021c5d20230): campo novo `Transportadora`, o nome curto da transportadora (despacho vence orçamento) pela lista `NOMES_CURTOS_TRANSPORTADORA` de logica.ts; fora da lista, a fantasia gravada no despacho. Sem nome, recusa com SEM_TRANSPORTADORA. Nota_Fiscal continua gravada. Veppo, Azul e os outros diálogos sem mudança.
- Colocando em Produção (DIALOGO_PRODUCAO, 6071c6dbe34a18c2cc684747): Link_do_Cliente com `#arte` no fim (`linkDoAvisoProducao`). Só nesse aviso; o envio de arte do Imposition não muda. O portal do cliente só abre na aba Arte se a arte ainda não foi aprovada (secaoDeAbertura em cliente-shell.js do Imposition); com a arte aprovada, vai à próxima etapa pendente, com ou sem a âncora.
- IDs dos dois diálogos conferidos: são os informados pelo Edinão.
- Teste: caso F de `scripts/testes/expedicao-aviso-pronto-v23.test.mts`.
- Prova de envio, só na conversa de teste Edison Junior - 14 (pedido de teste 24880), em 13/11/2026: Colocando em Produção (seq 25) e aviso pronto com o diálogo Transportadora e a Troca (seq 26), os dois com Diálogo Executado. Para o Transportadora, o despacho do 24880 foi trocado para a Troca (796) só em tipo_frete, transportadora_nome e id_transportadora_cliente, com autorização do Everton, e voltou ao valor guardado: resumo md5 da linha igual antes e depois (7afe52bf...). Nenhum gatilho de expedicoes repassa essas colunas para a proposta ou o frete.
- A mesma mudança foi levada à v19 da janela (`supabase/functions/`).

**v25 ficou no ar de 11/11/2026 até 13/11/2026 (versão 25 no painel da Supabase), conferida arquivo a arquivo igual a esta pasta (index.ts, logica.ts e a cópia de transportadoras-parceiras.ts, esta igual à da v24).** É a v24 com a Azul reconhecida pelo cadastro.
- Antes do deploy, a v24 do painel foi conferida igual a esta pasta.
- `formaDoDespacho` e `formaDoOrcamento`: `id_transportadora_cliente` = `TRANSPORTADORAS_PARCEIRAS.AZUL` (808) dá o diálogo Azul. O cadastro 808 é "SVT PROVEDOR LOGISTICO LTDA" (no despacho, "SVT TRANSPORTES"), sem AZUL no nome: até a v24 o despacho pela Azul saía com o diálogo Transportadora.
- Avisos que saíram com o diálogo Transportadora em pedidos da 808, não reenviados: 24881 (2x) e 25023 no modo teste (10/11); 25011, 24655 e 24838 para o cliente (11/11).
- Teste: caso E de `scripts/testes/expedicao-aviso-pronto-v23.test.mts`, com as entradas reais de expedicoes do 25011 (Azul) e do 24952 (São Miguel, continua Transportadora). Sem a mudança, o caso E falha com Transportadora.
- A mesma mudança foi levada à v19 da janela (`supabase/functions/`).

**v24 ficou no ar em 11/11/2026, até a v25 (versão 24 no painel da Supabase), conferida arquivo a arquivo igual a esta pasta (index.ts, logica.ts e a cópia de transportadoras-parceiras.ts):** conversa escolhida na aba Artes (`propostas.chatguru_chat_id`, o Comprador da arte).
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

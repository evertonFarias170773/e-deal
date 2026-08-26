-- O payload da NF-e passa a levar o e-mail do destinatario
--
-- POR QUE
--   A Focus envia XML + DANFE ao destinatario quando o corpo da emissao traz o
--   campo `email`. O `fn_montar_payload_nfe` nunca montou esse campo: medido em
--   25/08/2026, a palavra "email" nao aparecia uma vez nos 15.747 bytes da
--   funcao, e nenhum dos 13 `payload_envio` gravados a continha. Ou seja: a
--   Focus nunca enviou o documento a ninguem, e o ERP nao tinha como saber -
--   o retorno dela tambem nao diz nada sobre envio de e-mail.
--
-- POR QUE AQUI, E NAO NO TYPESCRIPT
--   O payload nunca passa pela aplicacao. `fn_preparar_envio_nfe` chama
--   `fn_montar_payload_nfe` DENTRO do banco e grava `payload_envio` na mesma
--   transacao; o TypeScript so le o resultado. Remendar o JSON depois do
--   preparo seria apagado no preparo seguinte, que reescreve a coluna inteira.
--
-- ESCOPO: DOIS NIVEIS, decidido pelo dono em 25/08/2026
--   1. `clientes.email_financeiro` do pagador
--   2. `clientes.email` do pagador
--   Um terceiro nivel - um e-mail escolhido por nota - exigiria coluna nova em
--   `notas_fiscais` e tornar editavel o input "E-mail" da aba Destinatario, que
--   hoje e `disabled` e nao persiste em lugar nenhum. Ficou de fora.
--   `nf.id_cliente` E o pagador desde a Etapa C, entao o join existente ja
--   aponta para quem deve receber o documento.
--
-- CADA NIVEL E VALIDADO SOZINHO, de proposito
--   Assim lixo num nivel CAI para o proximo em vez de vencer o coalesce. Ha
--   cadastro com a string literal NULL gravada nas duas colunas (cliente 6, da
--   NFE-20916-001). Validando so no fim, esse lixo seria "o e-mail escolhido".
--
-- A CHAVE E OMITIDA quando nao ha e-mail valido
--   Falta de e-mail NAO pode barrar emissao. Quem omite e o `jsonb_strip_nulls`,
--   e ele age SO neste objeto isolado, antes do `||`. Aplicado ao payload
--   inteiro ele QUEBRARIA a nota: `cnpj_destinatario`, `cpf_destinatario` e
--   `inscricao_estadual_destinatario` sao null POR REGRA, e a Focus conta com
--   isso para saber se o destinatario e PF ou PJ.
--
-- POR QUE ESTA MIGRATION NAO CARREGA UMA COPIA DA FUNCAO
--   Mesmo desenho da 20260822_payload_nfe_endereco_do_pedido: um CREATE OR
--   REPLACE com o corpo copiado regride producao em silencio se o corpo vivo
--   tiver mudado desde a revisao. Esta migration le a definicao viva com
--   pg_get_functiondef, INSERE o bloco novo imediatamente antes do cabecalho do
--   grupo Transportadora, e reaplica. Se a ancora nao aparecer exatamente uma
--   vez, ABORTA sem escrever.
--
--   Efeito colateral util: rodar duas vezes falha na segunda, porque a guarda
--   de idempotencia recusa uma funcao que ja monta a chave `email`.
--
-- MEDIDO NO BANCO VIVO EM 25/08/2026, ANTES DE APLICAR
--   definicao viva ......... 15.747 bytes, md5 a2a9b2732878a1d2a793c39fd91caf5f
--   uma sobrecarga so ...... fn_montar_payload_nfe(p_ref text), SECURITY DEFINER
--   ancora ................. cabecalho do grupo Transportadora, 1 ocorrencia
--   ocorrencias de "email" . 0
--   ocorrencias de strip ... 0
--
-- O QUE MUDA NAS NOTAS EXISTENTES
--   Nada e reescrito. `payload_envio` so e remontado quando alguem prepara o
--   envio daquela nota de novo. Notas AUTORIZADAS nao sao tocadas.
--   Projetado sobre as 19 notas com payload montavel: 16 resolvem pelo
--   email_financeiro, 2 pelo email, e 1 (NFE-20916-001) sai SEM a chave.
--
-- O REGEX NAO USA BARRA INVERTIDA
--   `[.]` no lugar de `\.` - mesma semantica, e evita a camada extra de escape
--   que um literal E'' dentro de PL/pgSQL exigiria para sobreviver ao
--   pg_get_functiondef.
--
-- NAO FAZ
--   Nao cria coluna. Nao altera nenhuma outra chave do payload. Nao mexe no
--   filtro `forma_pagamento = '15'` das duplicatas. Nao toca dado, RLS,
--   permissao ou historico. Nao emite, nao cancela, nao altera nota.
--
-- REVERSAO
--   O mesmo desenho ao contrario: le a definicao viva, remove o bloco do e-mail
--   junto com o separador que o precede, e reaplica.
--
-- SOBRE begin/commit
--   Ausentes de proposito: o bloco DO ja e atomico (qualquer `raise exception`
--   desfaz o `execute`), e esta migration foi aplicada pelo apply_migration, que
--   abre a transacao por fora. Um `begin` aninhado aqui seria no-op com warning
--   e o `commit` fecharia a transacao externa antes da hora.

do $migracao$
declare
  v_def       text;
  v_novo_def  text;
  v_ocorrencias int;

  -- Literais E'' ficam em UMA linha cada: em PL/pgSQL literais E'' em linhas
  -- adjacentes NAO se concatenam.

  -- Cabecalho do grupo Transportadora, byte a byte, com os CRLF que a funcao
  -- usa. Serve de ancora e de trava: se nao casar, nada e escrito.
  v_ancora constant text := E'      -- =====================================================\r\n      -- Transportadora\r\n';

  -- O bloco do e-mail, seguido do separador e da propria ancora - ou seja, uma
  -- INSERCAO antes do grupo Transportadora, que segue intacto.
  v_novo constant text := E'      -- =====================================================\r\n      -- E-mail do destinatario\r\n      --\r\n      -- A Focus usa este campo para enviar XML + DANFE ao destinatario.\r\n      -- Ordem: email_financeiro do pagador, senao email do pagador.\r\n      -- nf.id_cliente E o pagador desde a Etapa C, entao o join existente\r\n      -- ja aponta para quem deve receber o documento.\r\n      --\r\n      -- CADA NIVEL E VALIDADO SOZINHO: assim lixo num nivel CAI para o\r\n      -- proximo em vez de vencer o coalesce. Ha cadastro com a string\r\n      -- literal NULL nas duas colunas (cliente 6, da NFE-20916-001).\r\n      --\r\n      -- A CHAVE E OMITIDA quando nao ha e-mail valido: falta de e-mail nao\r\n      -- pode barrar emissao. O jsonb_strip_nulls age SO neste objeto\r\n      -- isolado, antes do ||. Aplicado ao payload inteiro ele QUEBRARIA a\r\n      -- nota: cnpj_destinatario, cpf_destinatario e\r\n      -- inscricao_estadual_destinatario sao null POR REGRA.\r\n      -- =====================================================\r\n      jsonb_strip_nulls(jsonb_build_object(\r\n        ''email'',\r\n        coalesce(\r\n          (case when btrim(coalesce(c.email_financeiro, '''')) ~* ''^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$''\r\n                then btrim(c.email_financeiro) end),\r\n          (case when btrim(coalesce(c.email, '''')) ~* ''^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$''\r\n                then btrim(c.email) end)\r\n        )\r\n      ))\r\n\r\n      ||\r\n\r\n      -- =====================================================\r\n      -- Transportadora\r\n';
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'fn_montar_payload_nfe';

  if v_def is null then
    raise exception 'fn_montar_payload_nfe nao existe em public. Nada foi alterado.';
  end if;

  -- Idempotencia: se a funcao ja monta a chave email, esta migration ja rodou.
  if position(E'''email'',' in v_def) <> 0 then
    raise exception 'fn_montar_payload_nfe ja monta a chave email. Nada foi alterado.';
  end if;

  v_ocorrencias := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);

  if v_ocorrencias <> 1 then
    raise exception
      'A ancora do grupo Transportadora aparece % vez(es) na funcao viva, e nao 1. O corpo divergiu desde a revisao: nada foi alterado.',
      v_ocorrencias;
  end if;

  v_novo_def := replace(v_def, v_ancora, v_novo);

  -- Cinto e suspensorio.
  if position(v_novo in v_novo_def) = 0 then
    raise exception 'A substituicao nao produziu o bloco novo. Nada foi alterado.';
  end if;

  -- A ancora tem de SOBREVIVER: isto e insercao, nao troca. Ela reaparece uma
  -- vez dentro do bloco novo, entao segue com exatamente 1 ocorrencia.
  if (length(v_novo_def) - length(replace(v_novo_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'O grupo Transportadora nao sobreviveu intacto a insercao. Nada foi alterado.';
  end if;

  execute v_novo_def;

  raise notice 'fn_montar_payload_nfe atualizada: % -> % bytes.', length(v_def), length(v_novo_def);
end
$migracao$;

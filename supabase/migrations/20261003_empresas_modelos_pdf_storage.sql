-- Modelos do PDF da proposta saem do servidor antigo (storage do FlutterFlow)
-- e vão para o bucket privado `modelos-pdf` do projeto (03/10/2026).
--
-- A Edge Function `proposta_comencial` lê estas colunas e baixa o arquivo com a
-- service role; o bucket não tem leitura pública nem política para anon ou
-- authenticated.
--   url_pdf_base_prop: modelo do orçamento ("Gerar PDF da proposta");
--   url_pdf_base_oc:   modelo da OC, autorização de faturamento ("Gerar OC").
-- Os modelos destas colunas vêm sem os rótulos (CLIENTE:, QTD, Produto...):
-- a função escreve os rótulos e a linha da empresa por cima.
--
-- Valores anteriores de url_pdf_base_prop (ninguém lia; o da empresa 1 já
-- respondia 403):
--   1 .../assets/g47lqppbw2ea/FATURA_PROPOSTA_IDEAL_MODELO_LIMPO.pdf
--   2 .../assets/ms1r78xuqse4/FATURA_PROPOSTA_BIRO_MODELO_LIMPO.pdf
--   3 .../assets/f9g8etb1gyv9/FATURA_PROPOSTA_E3_MODELO_LIMPO.pdf
-- (prefixo https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/calc-flex-ia-mt3r5v)

alter table public.empresas
  add column if not exists url_pdf_base_oc text;

comment on column public.empresas.url_pdf_base_oc is
  'Modelo do PDF da OC (autorizacao de faturamento) gerado pela Edge Function proposta_comencial com documento=oc. Fundo sem rotulos; arquivo no bucket privado modelos-pdf.';

update public.empresas e
   set url_pdf_base_prop = 'https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/authenticated/modelos-pdf/orcamento/empresa_' || e.id || '.pdf',
       url_pdf_base_oc   = 'https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/authenticated/modelos-pdf/oc/empresa_' || e.id || '.pdf'
 where e.id in (1, 2, 3);

do $$
declare
  v_qtd int;
begin
  select count(*) into v_qtd
    from public.empresas
   where id in (1, 2, 3)
     and url_pdf_base_prop like 'https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/authenticated/modelos-pdf/orcamento/empresa_%'
     and url_pdf_base_oc   like 'https://vwbtitjlpelrcnsytzqw.supabase.co/storage/v1/object/authenticated/modelos-pdf/oc/empresa_%';
  if v_qtd <> 3 then
    raise exception 'esperava 3 empresas com os modelos novos, achou %', v_qtd;
  end if;
end $$;

-- ROLLBACK de 20261006_nfse_codigo_municipio_tomador — ultimo passo: a funcao de apoio.
-- Rodar DEPOIS dos dois arquivos de funcao desta pasta (as funcoes novas a chamam).
drop function if exists public.fn_nfse_codigo_municipio(text, text);

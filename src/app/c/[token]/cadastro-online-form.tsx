"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CONSENTIMENTO_TEXTO } from "@/features/cadastros/lib/consentimento";
import { validateDocumentByTipo } from "@/features/cadastros/utils/documento";

/**
 * Formulario publico do cadastro online.
 *
 * A validacao de digito verificador roda AQUI e TAMBEM no servidor. Aqui e para
 * a pessoa saber do erro sem esperar; la e onde a validacao vale, porque o corpo
 * da requisicao nao precisa passar por esta tela.
 *
 * O PREENCHIMENTO PELA RECEITA
 * ----------------------------
 * Completado um CNPJ VALIDO, a tela consulta os dados publicos e preenche o que
 * vier. Tres regras que nao podem ser afrouxadas:
 *
 *   1. o que a pessoa digitou VENCE. Campo que ela editou nunca e sobrescrito,
 *      nem numa reconsulta — cadastro na Receita as vezes esta desatualizado, e
 *      quem esta preenchendo sabe mais que o registro publico;
 *   2. o que veio da Receita fica MARCADO na tela, campo a campo, e a marca some
 *      quando a pessoa edita aquele campo. Sem isso ninguem sabe o que conferir;
 *   3. falha NUNCA trava. Consulta fora do ar, CNPJ ausente ou limite estourado
 *      caem em preenchimento manual, e o botao de enviar nunca depende disso.
 *
 * CPF nao consulta nada: a API de CPF e paga, e nao ha motivo de negocio para
 * gastar chamada num formulario aberto.
 *
 * O HONEYPOT
 * ----------
 * Campo `site`, real, do tipo text, escondido por CSS. Nao e `type="hidden"` de
 * proposito: robo de formulario ignora campo hidden, e e justamente o robo que
 * se quer pegar. Fora do fluxo do teclado (`tabIndex={-1}`), fora do
 * preenchimento automatico (`autoComplete="off"`) e anunciado como escondido
 * para leitor de tela (`aria-hidden`), para que humano nenhum caia nele.
 *
 * Preenchido, o servidor responde exatamente como responderia a um envio bom.
 */

type Situacao =
  | { tipo: "RECEBIDO" }
  | { tipo: "JA_CADASTRADO"; nomeMascarado: string }
  | { tipo: "ERRO"; mensagem: string };

type RespostaEnvio = {
  ok?: boolean;
  situacao?: string;
  mensagem?: string;
  nomeMascarado?: string;
};

/** Exatamente os campos que a rota de consulta devolve — nada alem disso. */
type CamposDaReceita = Partial<Record<CampoPreenchivel, string>>;

type RespostaConsulta = { ok?: boolean; encontrado?: boolean; campos?: CamposDaReceita };

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const ESTADO_INICIAL = {
  tipoPessoa: "JURIDICA" as "FISICA" | "JURIDICA",
  documento: "",
  nome: "",
  fantasia: "",
  email: "",
  whatsapp: "",
  telefoneFixo: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: ""
};

type CampoDoForm = keyof typeof ESTADO_INICIAL;

/** Os que a Receita pode preencher. `documento` e `tipoPessoa` nunca. */
type CampoPreenchivel = Exclude<CampoDoForm, "documento" | "tipoPessoa" | "whatsapp">;

const CAMPOS_DA_RECEITA: CampoPreenchivel[] = [
  "nome", "fantasia", "email", "telefoneFixo",
  "cep", "endereco", "numero", "complemento", "bairro", "cidade", "uf"
];

export function CadastroOnlineForm({
  token,
  primeiroNomeVendedor
}: {
  token: string;
  primeiroNomeVendedor: string;
}) {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [honeypot, setHoneypot] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDocumento, setErroDocumento] = useState("");
  const [erroGeral, setErroGeral] = useState("");
  const [situacao, setSituacao] = useState<Situacao | null>(null);

  const [consultando, setConsultando] = useState(false);
  /** Campos preenchidos pela Receita e ainda nao tocados pela pessoa. */
  const [daReceita, setDaReceita] = useState<CampoPreenchivel[]>([]);
  const [avisoConsulta, setAvisoConsulta] = useState("");

  /** Campos que a pessoa editou. O que esta aqui nunca e sobrescrito. */
  const editados = useRef(new Set<CampoPreenchivel>());
  /**
   * Cache da sessao: o mesmo CNPJ nao e consultado duas vezes nesta aba, nem
   * quando a pessoa apaga e redigita. `null` guarda "consultado e nao achado",
   * para que insistir no mesmo CNPJ inexistente tambem nao gaste chamada.
   */
  const jaConsultados = useRef(new Map<string, CamposDaReceita | null>());

  const pessoaFisica = form.tipoPessoa === "FISICA";
  const rotuloDocumento = pessoaFisica ? "CPF" : "CNPJ";
  const rotuloNome = pessoaFisica ? "Nome completo" : "Razão social";

  const documentoDigitos = useMemo(() => form.documento.replace(/\D/g, ""), [form.documento]);

  function alterar(campo: CampoDoForm, valor: string) {
    // Edicao da pessoa: some a marca da Receita e o campo fica protegido de
    // qualquer preenchimento futuro.
    if (campo !== "documento" && campo !== "tipoPessoa") {
      editados.current.add(campo as CampoPreenchivel);
      setDaReceita((atual) => atual.filter((c) => c !== campo));
    }
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  function aplicarDaReceita(campos: CamposDaReceita) {
    // A lista sai daqui, ANTES do setForm, e nao de dentro do updater.
    //
    // Monta-la dentro do `setForm(atual => ...)` parecia natural e estava errado:
    // o React so executa o updater na fase de render, entao o `setDaReceita`
    // logo abaixo recebia o array ainda VAZIO, e nenhuma marca "da Receita"
    // aparecia na tela. Preencher o array depois nao ajuda — e a mesma
    // referencia, mas mutacao tardia nao dispara render. Em StrictMode ainda
    // duplicaria as entradas, porque o updater roda duas vezes.
    //
    // Da para calcular antes porque a regra nao depende do valor atual do campo,
    // so de quem o editou.
    const preenchidos = CAMPOS_DA_RECEITA.filter(
      (campo) => (campos[campo] ?? "").trim() !== "" && !editados.current.has(campo)
    );

    if (preenchidos.length > 0) {
      setForm((atual) => {
        const novo = { ...atual };
        for (const campo of preenchidos) novo[campo] = (campos[campo] ?? "").trim();
        return novo;
      });
    }

    setDaReceita(preenchidos);
    setAvisoConsulta(
      preenchidos.length > 0
        ? "Preenchemos com os dados públicos da Receita Federal. Confira e corrija o que estiver desatualizado."
        : ""
    );
  }

  /**
   * Consulta ao completar um CNPJ valido. Debounce de 500 ms para nao disparar a
   * cada tecla enquanto a pessoa ainda digita os ultimos numeros.
   *
   * A IIFE assincrona e o padrao aceito pelo lint deste projeto: setState
   * sincrono no corpo do efeito dispara render em cascata.
   */
  useEffect(() => {
    if (pessoaFisica) return;
    if (documentoDigitos.length !== 14) return;
    if (!validateDocumentByTipo(documentoDigitos, "CNPJ").isValid) return;

    let ativo = true;
    const temporizador = window.setTimeout(() => {
      void (async () => {
        const guardado = jaConsultados.current.get(documentoDigitos);
        if (guardado !== undefined) {
          if (ativo && guardado) aplicarDaReceita(guardado);
          return;
        }

        setConsultando(true);
        setAvisoConsulta("");
        try {
          const resposta = await fetch("/api/cadastro-online/consultar-cnpj", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, documento: documentoDigitos })
          });
          const dados = (await resposta.json().catch(() => null)) as RespostaConsulta | null;
          if (!ativo) return;

          if (dados?.encontrado && dados.campos) {
            jaConsultados.current.set(documentoDigitos, dados.campos);
            aplicarDaReceita(dados.campos);
          } else {
            jaConsultados.current.set(documentoDigitos, null);
            setAvisoConsulta("Não encontramos este CNPJ na Receita. Preencha os dados abaixo.");
          }
        } catch {
          // Sem rede, sem servidor, o que for: o formulario continua. Nao guarda
          // no cache — falha de rede e passageira e merece nova tentativa.
          if (ativo) setAvisoConsulta("Não foi possível consultar a Receita agora. Preencha os dados abaixo.");
        } finally {
          if (ativo) setConsultando(false);
        }
      })();
    }, 500);

    return () => {
      ativo = false;
      window.clearTimeout(temporizador);
    };
    // `token` e estavel durante toda a vida da pagina.
  }, [documentoDigitos, pessoaFisica, token]);

  function conferirDocumento(): boolean {
    const resultado = validateDocumentByTipo(form.documento, pessoaFisica ? "CPF" : "CNPJ");
    setErroDocumento(resultado.isValid ? "" : (resultado.message ?? "Documento inválido."));
    return resultado.isValid;
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErroGeral("");

    if (!conferirDocumento()) return;
    if (!form.nome.trim()) {
      setErroGeral(`Informe o ${rotuloNome.toLowerCase()}.`);
      return;
    }
    if (!form.email.trim() && !form.whatsapp.trim()) {
      setErroGeral("Informe pelo menos um e-mail ou um WhatsApp para o contato.");
      return;
    }
    if (!consentimento) {
      setErroGeral("É preciso aceitar o uso dos dados para continuar.");
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch("/api/cadastro-online/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          ...form,
          documento: documentoDigitos,
          consentimento: true,
          site: honeypot
        })
      });

      const dados = (await resposta.json().catch(() => null)) as RespostaEnvio | null;

      if (dados?.situacao === "JA_CADASTRADO") {
        setSituacao({ tipo: "JA_CADASTRADO", nomeMascarado: dados.nomeMascarado ?? "" });
        return;
      }
      if (dados?.ok) {
        setSituacao({ tipo: "RECEBIDO" });
        return;
      }
      if (dados?.situacao === "DOCUMENTO_INVALIDO") {
        setErroDocumento(dados.mensagem ?? "Documento inválido.");
        return;
      }
      setErroGeral(dados?.mensagem ?? "Não foi possível enviar agora. Tente de novo em instantes.");
    } catch {
      setErroGeral("Não foi possível enviar agora. Verifique sua conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const veioDaReceita = (campo: CampoPreenchivel) => daReceita.includes(campo);

  if (situacao?.tipo === "RECEBIDO") {
    return (
      <Cartao>
        <h1 className="text-lg font-semibold text-slate-800">Cadastro enviado</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Recebemos seus dados. {primeiroNomeVendedor || "Seu atendente"} vai falar com você para
          concluir o atendimento.
        </p>
        <p className="mt-4 text-xs text-slate-500">Você já pode fechar esta página.</p>
      </Cartao>
    );
  }

  if (situacao?.tipo === "JA_CADASTRADO") {
    return (
      <Cartao>
        <h1 className="text-lg font-semibold text-slate-800">Você já tem cadastro</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Já existe um cadastro com este documento
          {situacao.nomeMascarado ? (
            <>
              , em nome de <span className="font-medium text-slate-800">{situacao.nomeMascarado}</span>
            </>
          ) : null}
          . Não criamos um novo — {primeiroNomeVendedor || "seu atendente"} vai falar com você.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          Se o nome acima não parece o seu, fale com seu atendente antes de tentar de novo.
        </p>
      </Cartao>
    );
  }

  return (
    <Cartao>
      <header className="border-b border-slate-100 pb-4">
        <h1 className="text-lg font-semibold text-slate-800">Cadastro de cliente</h1>
        {primeiroNomeVendedor ? (
          <p className="mt-1 text-sm text-slate-600">
            Você está sendo atendido por{" "}
            <span className="font-medium text-slate-800">{primeiroNomeVendedor}</span>.
          </p>
        ) : null}
      </header>

      <form onSubmit={enviar} className="mt-5 space-y-5" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Identificação
          </legend>

          <div className="flex gap-2">
            {(["JURIDICA", "FISICA"] as const).map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => {
                  setForm((atual) => ({ ...atual, tipoPessoa: tipo, documento: "", fantasia: "" }));
                  setErroDocumento("");
                  setDaReceita([]);
                  setAvisoConsulta("");
                }}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  form.tipoPessoa === tipo
                    ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {tipo === "JURIDICA" ? "Empresa (CNPJ)" : "Pessoa física (CPF)"}
              </button>
            ))}
          </div>

          <Campo
            id="documento"
            rotulo={rotuloDocumento}
            valor={form.documento}
            aoMudar={(v) => {
              alterar("documento", v);
              if (erroDocumento) setErroDocumento("");
            }}
            aoSair={conferirDocumento}
            inputMode="numeric"
            autoComplete="off"
            obrigatorio
            erro={erroDocumento}
            apoio={
              pessoaFisica
                ? undefined
                : consultando
                  ? "Consultando a Receita Federal…"
                  : "Ao digitar o CNPJ completo, buscamos os dados públicos para adiantar o preenchimento."
            }
          />

          {avisoConsulta ? (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
              {avisoConsulta}
            </p>
          ) : null}

          <Campo
            id="nome"
            rotulo={rotuloNome}
            valor={form.nome}
            aoMudar={(v) => alterar("nome", v)}
            autoComplete="organization"
            obrigatorio
            daReceita={veioDaReceita("nome")}
          />

          {!pessoaFisica ? (
            <Campo
              id="fantasia"
              rotulo="Nome fantasia"
              valor={form.fantasia}
              aoMudar={(v) => alterar("fantasia", v)}
              autoComplete="off"
              daReceita={veioDaReceita("fantasia")}
            />
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Contato
          </legend>
          <p className="text-xs text-slate-500">Informe pelo menos um e-mail ou um WhatsApp.</p>

          <Campo
            id="email"
            rotulo="E-mail"
            valor={form.email}
            aoMudar={(v) => alterar("email", v)}
            tipo="email"
            autoComplete="email"
            daReceita={veioDaReceita("email")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              id="whatsapp"
              rotulo="WhatsApp"
              valor={form.whatsapp}
              aoMudar={(v) => alterar("whatsapp", v)}
              inputMode="tel"
              autoComplete="tel"
            />
            <Campo
              id="telefoneFixo"
              rotulo="Telefone fixo"
              valor={form.telefoneFixo}
              aoMudar={(v) => alterar("telefoneFixo", v)}
              inputMode="tel"
              autoComplete="tel"
              daReceita={veioDaReceita("telefoneFixo")}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Endereço
          </legend>

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo
              id="cep"
              rotulo="CEP"
              valor={form.cep}
              aoMudar={(v) => alterar("cep", v)}
              inputMode="numeric"
              autoComplete="postal-code"
              daReceita={veioDaReceita("cep")}
            />
            <div className="sm:col-span-2">
              <Campo
                id="endereco"
                rotulo="Endereço"
                valor={form.endereco}
                aoMudar={(v) => alterar("endereco", v)}
                autoComplete="street-address"
                daReceita={veioDaReceita("endereco")}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              id="numero"
              rotulo="Número"
              valor={form.numero}
              aoMudar={(v) => alterar("numero", v)}
              autoComplete="off"
              daReceita={veioDaReceita("numero")}
            />
            <Campo
              id="complemento"
              rotulo="Complemento"
              valor={form.complemento}
              aoMudar={(v) => alterar("complemento", v)}
              autoComplete="off"
              daReceita={veioDaReceita("complemento")}
            />
          </div>

          <Campo
            id="bairro"
            rotulo="Bairro"
            valor={form.bairro}
            aoMudar={(v) => alterar("bairro", v)}
            autoComplete="address-level3"
            daReceita={veioDaReceita("bairro")}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Campo
                id="cidade"
                rotulo="Cidade"
                valor={form.cidade}
                aoMudar={(v) => alterar("cidade", v)}
                autoComplete="address-level2"
                daReceita={veioDaReceita("cidade")}
              />
            </div>
            <div>
              <label htmlFor="uf" className="block text-sm font-medium text-slate-700">
                UF
                {veioDaReceita("uf") ? <MarcaReceita /> : null}
              </label>
              <select
                id="uf"
                value={form.uf}
                onChange={(evento) => alterar("uf", evento.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b2f4a]"
              >
                <option value="">—</option>
                {UFS.map((sigla) => (
                  <option key={sigla} value={sigla}>
                    {sigla}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/*
          HONEYPOT. Escondido por CSS, nunca `type="hidden"`. Fora do teclado,
          fora do autocomplete e invisivel para leitor de tela.
        */}
        <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="site">Site</label>
          <input
            id="site"
            name="site"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(evento) => setHoneypot(evento.target.value)}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consentimento}
              onChange={(evento) => setConsentimento(evento.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
            />
            <span className="leading-relaxed">{CONSENTIMENTO_TEXTO}</span>
          </label>
          <p className="mt-3 text-xs text-slate-500">
            <a
              href="/privacidade"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[#0b2f4a] underline underline-offset-2"
            >
              Ler o aviso de privacidade
            </a>
          </p>
        </div>

        {erroGeral ? (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {erroGeral}
          </p>
        ) : null}

        {/* `enviando` e a UNICA coisa que desabilita o envio. A consulta a Receita
            nunca bloqueia: ela e conveniencia, nao pre-requisito. */}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? "Enviando…" : "Enviar cadastro"}
        </button>
      </form>
    </Cartao>
  );
}

function Cartao({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>;
}

/** A marca de origem. Some sozinha quando a pessoa edita o campo. */
function MarcaReceita() {
  return (
    <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
      da Receita
    </span>
  );
}

function Campo({
  id,
  rotulo,
  valor,
  aoMudar,
  aoSair,
  tipo = "text",
  inputMode,
  autoComplete,
  obrigatorio,
  erro,
  apoio,
  daReceita
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  aoSair?: () => void;
  tipo?: string;
  inputMode?: "numeric" | "tel" | "text";
  autoComplete?: string;
  obrigatorio?: boolean;
  erro?: string;
  apoio?: string;
  daReceita?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {rotulo}
        {obrigatorio ? <span className="ml-1 text-rose-500">*</span> : null}
        {daReceita ? <MarcaReceita /> : null}
      </label>
      <input
        id={id}
        name={id}
        type={tipo}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        onBlur={aoSair}
        aria-invalid={erro ? true : undefined}
        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#0b2f4a] ${
          erro ? "border-rose-400" : daReceita ? "border-sky-200 bg-sky-50/40" : "border-slate-200"
        }`}
      />
      {erro ? (
        <p role="alert" className="mt-1 text-xs text-rose-600">
          {erro}
        </p>
      ) : apoio ? (
        <p className="mt-1 text-xs text-slate-500">{apoio}</p>
      ) : null}
    </div>
  );
}

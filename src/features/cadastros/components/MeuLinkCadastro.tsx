"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Link2, RefreshCw, Users } from "lucide-react";

import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * O link fixo de cadastro de um vendedor: gerar, copiar e trocar.
 *
 * O LINK E DO VENDEDOR, NAO DE QUEM ESTA LOGADO
 * ---------------------------------------------
 *   - admin escolhe a PESSOA numa lista e opera o link dela;
 *   - vendedor comum opera o proprio, sem escolher nada;
 *   - ninguem alem de admin alcanca token de outra pessoa — e quem tenta recebe a
 *     mesma recusa exista o outro vendedor ou nao, para que a tela nao vire
 *     oraculo de quem tem link.
 *
 * A escolha e por PESSOA (`user_id`), nao por codigo. Precisa ser: duas pessoas
 * podem dividir o mesmo `id_vendedor`, e escolher pelo codigo nao diria qual das
 * duas se quis dizer — nem permitiria montar o aviso de compartilhamento.
 *
 * POR QUE AQUI, E NAO EM "MINHA CONTA"
 * ------------------------------------
 * /minha-conta se declara temporaria no proprio texto ("Area de Diagnostico e
 * Homologacao... Esta tela e temporaria") e mostra flags cruas como
 * `is_super_adm`. Um link do qual o vendedor depende no dia a dia nao pode morar
 * numa tela marcada para sair. Alem disso o link e o resultado dele sao a mesma
 * tarefa: quem quer "meu link" e quem quer "o que caiu pelo meu link" e a mesma
 * pessoa no mesmo assunto.
 *
 * O TOKEN NAO E GUARDADO NO CLIENTE
 * ---------------------------------
 * Vem da rota a cada carga e fica so em memoria. `cadastro_links` continua
 * inalcancavel por `authenticated`, e o segredo nunca vai para o bundle.
 *
 * A URL e montada com `window.location.origin` de proposito: o link nasce
 * apontando para o mesmo dominio em que o vendedor esta usando o ERP, sem
 * depender de variavel de ambiente que pode estar errada no deploy.
 */

type LinkAtivo = {
  token: string;
  versao: number;
  criadoEm: string;
  usos: number;
  descartesHoneypot: number;
  nomeVendedor: string;
  idVendedor: string;
  alvoEhVendedor: boolean;
};

type Pessoa = {
  userId: string;
  idVendedor: string | null;
  /** O nome da PESSOA. */
  nome: string;
  /** O nome que o cliente ve (`meu_vendedor`). Nem sempre e o nome da pessoa. */
  nomeComercial: string;
  ehVendedor: boolean;
};

export function MeuLinkCadastro() {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [alvoUserId, setAlvoUserId] = useState("");
  const [link, setLink] = useState<LinkAtivo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);

  const ehAdmin = Boolean(user?.isAdmin || user?.isSuperAdmin);

  const chamar = useCallback(async (acao: "OBTER" | "ROTACIONAR", idVendedor: string) => {
    const client = getSupabaseClient();
    if (!client) return { erro: "Cliente Supabase indisponível." };

    const sessao = await client.auth.getSession();
    const bearer = sessao.data.session?.access_token ?? "";
    if (!bearer) return { erro: "Sessão expirada. Entre novamente." };

    const resposta = await fetch("/api/cadastro-online/link", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ acao, ...(idVendedor ? { idVendedor } : {}) })
    });
    const json = await resposta.json().catch(() => null);
    if (!resposta.ok || !json?.ok) return { erro: json?.mensagem ?? "Não foi possível obter o link." };
    return { link: json as LinkAtivo };
  }, []);

  /**
   * Uma leitura so, de `usuarios`, que serve a tres coisas: descobrir o meu
   * proprio codigo, montar a lista de vendedores e montar o mapa de quem divide
   * codigo com quem. Testado: `authenticated` le esta tabela nas duas sessoes.
   *
   * O admin comum tambem consegue esta leitura — sao nomes, nao tokens. O que a
   * sessao NAO alcanca e `cadastro_links`, e e por isso que o token so vem pela
   * rota.
   */
  useEffect(() => {
    if (!user) return;
    let ativo = true;

    void (async () => {
      const client = getSupabaseClient();
      if (!client) {
        if (ativo) {
          setAviso("Cliente Supabase indisponível.");
          setCarregando(false);
        }
        return;
      }

      const { data, error } = await client
        .from("usuarios")
        .select("user_id,id_vendedor,nome_usuario,meu_vendedor,is_vendedor");

      if (!ativo) return;

      if (error) {
        setAviso("Não foi possível carregar a lista de vendedores.");
        setCarregando(false);
        return;
      }

      const lista: Pessoa[] = (data ?? []).map((linha) => ({
        userId: String(linha.user_id),
        idVendedor: linha.id_vendedor ? String(linha.id_vendedor) : null,
        nome: String(linha.nome_usuario || linha.meu_vendedor || "sem nome"),
        nomeComercial: String(linha.meu_vendedor || linha.nome_usuario || ""),
        ehVendedor: linha.is_vendedor === true
      }));
      setPessoas(lista);

      // Vendedor comum ja abre com o proprio link pronto — o requisito era que
      // ele achasse sozinho, sem clicar em nada para descobrir que existe.
      // Admin espera a escolha: gerar sem escolher criaria link para a pessoa
      // errada.
      if (!ehAdmin) {
        const resultado = await chamar("OBTER", "");
        if (!ativo) return;
        if (resultado.erro) setAviso(resultado.erro);
        else setLink(resultado.link ?? null);
      }
      setCarregando(false);
    })();

    return () => {
      ativo = false;
    };
  }, [user, ehAdmin, chamar]);

  const minhaLinha = useMemo(
    () => pessoas.find((pessoa) => pessoa.userId === user?.id) ?? null,
    [pessoas, user?.id]
  );

  const vendedores = useMemo(
    () =>
      pessoas
        .filter((pessoa) => pessoa.ehVendedor && pessoa.idVendedor)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [pessoas]
  );

  /** A pessoa de quem o link e: a escolhida (admin) ou eu mesmo. */
  const pessoaAlvo = useMemo(() => {
    if (!ehAdmin) return minhaLinha;
    return pessoas.find((pessoa) => pessoa.userId === alvoUserId) ?? null;
  }, [ehAdmin, minhaLinha, pessoas, alvoUserId]);

  /**
   * Quem MAIS usa o mesmo codigo. E daqui que sai o aviso: `cadastro_links` e
   * chaveada por `id_vendedor` com um ativo por codigo, entao duas pessoas com o
   * mesmo codigo dividem literalmente o mesmo link — e rotacionar para uma
   * derruba o da outra.
   */
  const outrosNoMesmoCodigo = useMemo(() => {
    if (!pessoaAlvo?.idVendedor) return [];
    return pessoas.filter(
      (pessoa) => pessoa.idVendedor === pessoaAlvo.idVendedor && pessoa.userId !== pessoaAlvo.userId
    );
  }, [pessoas, pessoaAlvo]);

  const nomesDosOutros = outrosNoMesmoCodigo.map((pessoa) => pessoa.nome);
  const urlCompleta = link ? `${typeof window === "undefined" ? "" : window.location.origin}/c/${link.token}` : "";

  async function copiar() {
    if (!urlCompleta) return;
    try {
      await navigator.clipboard.writeText(urlCompleta);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      showToast({
        type: "error",
        title: "Não foi possível copiar",
        description: "Selecione o endereço no campo e copie manualmente."
      });
    }
  }

  async function acionar(acao: "OBTER" | "ROTACIONAR") {
    setTrabalhando(true);
    setAviso("");
    const resultado = await chamar(acao, ehAdmin ? (pessoaAlvo?.idVendedor ?? "") : "");
    setTrabalhando(false);
    setConfirmandoTroca(false);

    if (resultado.erro) {
      setAviso(resultado.erro);
      showToast({ type: "error", title: "Não foi possível", description: resultado.erro });
      return;
    }
    setLink(resultado.link ?? null);
    showToast({
      type: "success",
      title: acao === "ROTACIONAR" ? "Link novo gerado" : "Link pronto",
      description:
        acao === "ROTACIONAR"
          ? "O link anterior parou de funcionar neste instante."
          : "Copie e envie para o cliente."
    });
  }

  const podeAcionar = ehAdmin ? Boolean(pessoaAlvo?.idVendedor) : Boolean(minhaLinha?.idVendedor);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[#0b2f4a]" />
        <h2 className="text-sm font-semibold text-slate-800">Link de cadastro</h2>
      </header>
      <p className="mt-1 text-xs text-slate-500">
        {ehAdmin
          ? "Escolha o vendedor e gere o link dele. O que entrar por esse endereço fica atribuído a esse vendedor."
          : "Envie este endereço para o cliente preencher o próprio cadastro. Ele é fixo: pode ser reutilizado quantas vezes quiser, e o que entrar por ele fica atribuído a você."}
      </p>

      {ehAdmin ? (
        <div className="mt-4">
          <label htmlFor="vendedor" className="block text-xs font-medium text-slate-600">
            Vendedor
          </label>
          <select
            id="vendedor"
            value={alvoUserId}
            onChange={(evento) => {
              setAlvoUserId(evento.target.value);
              setLink(null);
              setAviso("");
              setConfirmandoTroca(false);
            }}
            className="mt-1 w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b2f4a]"
          >
            <option value="">Selecione o vendedor…</option>
            {vendedores.map((vendedor) => (
              <option key={vendedor.userId} value={vendedor.userId}>
                {vendedor.nome}
                {vendedor.nomeComercial && vendedor.nomeComercial !== vendedor.nome
                  ? ` — aparece para o cliente como ${vendedor.nomeComercial}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* AVISO DE CODIGO COMPARTILHADO. Sem ele, alguem rotaciona o link de um
          vendedor e mata o do outro sem entender por quê. */}
      {pessoaAlvo && outrosNoMesmoCodigo.length > 0 ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Users className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Este código de vendedor é compartilhado.</p>
            <p>
              <strong>{pessoaAlvo.nome}</strong> usa o mesmo código de vendedor que{" "}
              <strong>{listar(nomesDosOutros)}</strong>. As {outrosNoMesmoCodigo.length + 1} pessoas
              dividem <strong>um único link</strong> — não há como dar um link separado para cada
              uma.
            </p>
            <p>
              Isso significa que gerar um link novo aqui <strong>troca o link de todas</strong>, e
              que os cadastros que entrarem não distinguem quem atendeu.
            </p>
          </div>
        </div>
      ) : null}

      {link && !link.alvoEhVendedor ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Este link <strong>não vai funcionar</strong>: o usuário não está marcado como vendedor
            (<code>is_vendedor</code>). Quem abrir verá apenas &ldquo;link indisponível&rdquo;.
            Ajuste o cadastro do usuário antes de enviar.
          </p>
        </div>
      ) : null}

      {carregando ? (
        <p className="mt-4 text-sm text-slate-500">Carregando…</p>
      ) : link ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={urlCompleta}
              onFocus={(evento) => evento.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800"
            />
            <button
              type="button"
              onClick={copiar}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123f61]"
            >
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Versão {link.versao} · {link.usos} {link.usos === 1 ? "cadastro" : "cadastros"} por este
            link
            {link.descartesHoneypot > 0
              ? ` · ${link.descartesHoneypot} ${link.descartesHoneypot === 1 ? "envio automático descartado" : "envios automáticos descartados"}`
              : ""}
            {link.nomeVendedor ? ` · o cliente vê: ${link.nomeVendedor}` : ""}
          </p>

          {confirmandoTroca ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Gerar um link novo?</p>
              <p className="mt-1">
                O link atual <strong>para de funcionar imediatamente</strong>. Quem já o tiver salvo
                ou recebido no WhatsApp vai ver apenas &ldquo;link indisponível&rdquo;. Os cadastros
                que já entraram não são afetados.
              </p>
              {nomesDosOutros.length > 0 ? (
                <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2">
                  <strong>Atenção:</strong> este link não é só de{" "}
                  {pessoaAlvo?.nome ?? "quem está selecionado"}.{" "}
                  <strong>{listar(nomesDosOutros)}</strong>{" "}
                  {nomesDosOutros.length === 1 ? "também perde" : "também perdem"} o link atual neste
                  momento, e {nomesDosOutros.length === 1 ? "vai precisar" : "vão precisar"} reenviar
                  o novo para os clientes.
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmandoTroca(false)}
                  disabled={trabalhando}
                  className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void acionar("ROTACIONAR")}
                  disabled={trabalhando}
                  className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {trabalhando ? "Gerando…" : "Sim, trocar o link"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoTroca(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700"
            >
              <RefreshCw className="h-3 w-3" />
              Gerar link novo e invalidar o atual
            </button>
          )}
        </div>
      ) : ehAdmin && !pessoaAlvo ? (
        <p className="mt-4 text-sm text-slate-500">Selecione um vendedor para ver ou gerar o link.</p>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void acionar("OBTER")}
            disabled={trabalhando || !podeAcionar}
            className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {trabalhando ? "Gerando…" : ehAdmin ? "Ver ou gerar o link deste vendedor" : "Gerar meu link"}
          </button>
        </div>
      )}

      {aviso ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {aviso}
        </p>
      ) : null}
    </section>
  );
}

/** "A", "A e B", "A, B e C" — o "e" antes do último, como se escreve. */
function listar(nomes: string[]): string {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

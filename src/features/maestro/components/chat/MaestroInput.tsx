'use client';
import { Send, Mic } from 'lucide-react';
import { useRef, useEffect, useState, useCallback } from 'react';
import { APP_NAME } from '@/constants/brand';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (v: string) => void;
  isLoading: boolean;
}

// Tipos mínimos da Web Speech API (sem tipos nativos no TS)
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
}

// Helper para compor fragmentos de texto garantindo o espaçamento correto entre palavras e pontuações
function safeConcat(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  
  const lastCharLeft = left.slice(-1);
  const firstCharRight = right.charAt(0);
  
  // Se o lado direito começar com pontuação, removemos espaços sobrando à esquerda
  if (/^[.,!?;:]/.test(firstCharRight)) {
     return left.replace(/\s+$/, '') + right;
  }
  
  const hasSpaceLeft = /\s/.test(lastCharLeft);
  const hasSpaceRight = /\s/.test(firstCharRight);
  
  // Evitar duplicação de espaço
  if (hasSpaceLeft && hasSpaceRight) {
     return left + right.replace(/^\s+/, '');
  }
  
  // Se já há separador natural
  if (hasSpaceLeft || hasSpaceRight) {
     return left + right;
  }
  
  // Se não tem separador de nenhum lado, inserimos um espaço em branco
  return left + ' ' + right;
}

export function MaestroInput({ value, onChange, onSend, isLoading }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  
  // States para o Speech-to-Text
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  
  // Controles de texto acumulado entre sessões automáticas
  const originalValueRef = useRef<string>('');
  const finalTranscriptRef = useRef<string>('');
  const isManualStopRef = useRef<boolean>(false);
  // Após um ENVIO, resultados atrasados do recognition devem ser DESCARTADOS —
  // sem isto eles repõem o transcript no input e rearmam o auto-envio,
  // reenviando a mesma pergunta.
  const descartarResultadosRef = useRef<boolean>(false);
  
  // Timer de auto-envio por silêncio
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Guardamos a referência das props para não termos stale closure no timer e instância do recognition
  const onChangeRef = useRef(onChange);
  const onSendRef = useRef(onSend);
  const isLoadingRef = useRef(isLoading);
  
  useEffect(() => {
    onChangeRef.current = onChange;
    onSendRef.current = onSend;
    isLoadingRef.current = isLoading;
  }, [onChange, onSend, isLoading]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Encerra a sessão de voz de forma DEFINITIVA para um envio: descarta
  // qualquer resultado pendente (abort) e zera o texto acumulado, para que
  // nada re-popule o input depois que a mensagem já foi enviada.
  const encerrarVozParaEnvio = useCallback(() => {
    clearSilenceTimer();
    descartarResultadosRef.current = true;
    isManualStopRef.current = true;
    finalTranscriptRef.current = '';
    originalValueRef.current = '';
    const rec = recognitionRef.current;
    if (rec) {
      try {
        // abort() descarta resultados pendentes; stop() ainda os entregaria
        if (typeof rec.abort === 'function') rec.abort();
        else rec.stop();
      } catch {
        // já parado — ignorar
      }
    }
  }, [clearSilenceTimer]);

  useEffect(() => {
    return () => clearSilenceTimer(); // Limpa timer se componente desmontar
  }, [clearSilenceTimer]);

  // Setup da Web Speech API
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      const SpeechRecognition = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
        | (new () => SpeechRecognitionLike)
        | undefined;
      if (!SpeechRecognition) {
        // Detecção de recurso só existe no client (SSR-safe); setState único pós-mount
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsSupported(false);
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'pt-BR';
      
      recognition.onstart = () => {
        setIsListening(true);
      };
      
      recognition.onend = () => {
        // Se o usuário não parou manualmente, significa que o navegador encerrou por excesso de silêncio (pausa para pensar).
        // Nesse caso, nós reiniciamos o motor sem limpar o texto acumulado.
        if (isManualStopRef.current) {
          setIsListening(false);
        } else {
          try {
            recognition.start();
          } catch {
            setIsListening(false); // Fallback caso não seja possível reiniciar
          }
        }
      };

      recognition.onerror = (event: { error: string }) => {
        if (event.error === 'aborted') {
          // Disparado pelo NOSSO abort() no envio (descarte de resultados
          // pendentes) — encerramento esperado, não é erro
          clearSilenceTimer();
          setIsListening(false);
          isManualStopRef.current = true;
          return;
        }
        console.error("Erro no reconhecimento de voz:", event.error);
        if (event.error === 'not-allowed') {
          clearSilenceTimer();
          setIsListening(false);
          isManualStopRef.current = true;
          alert('Permissão de microfone negada. Libere o acesso ao microfone no navegador e tente novamente.');
        } else if (event.error === 'no-speech') {
          // Ignora erro de "sem fala", o onend irá lidar com o reinício automático (o timer continua contando até os 4s normais)
        } else {
          clearSilenceTimer();
          setIsListening(false);
          isManualStopRef.current = true;
        }
      };
      
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        // Sessão já enviada → resultado atrasado é lixo: não pode re-popular
        // o input nem rearmar o auto-envio (causa de mensagem duplicada)
        if (descartarResultadosRef.current) return;

        let interimTranscript = '';
        let sessionFinalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
             sessionFinalTranscript = safeConcat(sessionFinalTranscript, chunk);
          } else {
             interimTranscript = safeConcat(interimTranscript, chunk);
          }
        }
        
        // Se houve confirmação final da frase, acumulamos na nossa referência de longo prazo (permanente)
        if (sessionFinalTranscript) {
           finalTranscriptRef.current = safeConcat(finalTranscriptRef.current, sessionFinalTranscript);
        }
        
        let textComposto = safeConcat(originalValueRef.current, finalTranscriptRef.current);
        textComposto = safeConcat(textComposto, interimTranscript);
        
        // A visualização do input na tela compõe o texto consolidado com os resultados provisórios
        onChangeRef.current(textComposto);
        
        // Trata o temporizador de auto-envio:
        clearSilenceTimer();

        // Re-engatilha a bomba relógio para enviar após 4 segundos de inatividade
        // da voz — somente enquanto a sessão de escuta estiver viva (um resultado
        // final atrasado após parada manual não pode agendar envio)
        if (!isManualStopRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            // Parada definitiva + descarte de pendências ANTES do envio
            encerrarVozParaEnvio();

            // O envio automático ocorre apenas se tiver conteúdo e não estiver processando
            if (textComposto.trim() && !isLoadingRef.current) {
              onSendRef.current(textComposto);
            }
          }, 4000);
        }
      };
      
      recognitionRef.current = recognition;
    }
    // useCallbacks estáveis (só refs) — o setup roda uma única vez
  }, [encerrarVozParaEnvio, clearSilenceTimer]);

  const toggleListening = () => {
    if (!isSupported) {
      alert("Seu navegador não possui suporte nativo para gravação de voz (Web Speech API). Tente utilizar o Google Chrome, Edge ou Safari mais recentes.");
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      // Encerra permanentemente a pedido do usuário
      isManualStopRef.current = true;
      clearSilenceTimer();
      recognition.stop();
    } else {
      // Inicia nova gravação a pedido do usuário
      isManualStopRef.current = false;
      descartarResultadosRef.current = false;
      finalTranscriptRef.current = '';
      originalValueRef.current = value;
      clearSilenceTimer();
      
      // Garante espaço se já existir texto antes de anexar a fala
      if (value && !value.endsWith(' ') && !value.endsWith('\n')) {
        originalValueRef.current += ' ';
      }
      try {
        recognition.start();
      } catch (e) {
        console.warn("SpeechRecognition falhou ao iniciar", e);
      }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Focus input when loading finishes
  useEffect(() => {
    if (!isLoading && ref.current) {
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) {
        // Parada definitiva + descarte de resultados pendentes de voz:
        // nada pode re-popular o input depois deste envio
        encerrarVozParaEnvio();
        onSend(value);
      }
    }
  };

  const handleSendClick = () => {
    if (value.trim() && !isLoading) {
      // Parada definitiva + descarte de resultados pendentes de voz
      encerrarVozParaEnvio();
      onSend(value);
    }
  };

  return (
    <div className="bg-[var(--card)] dark:bg-[#0d1b2a] px-6 py-4">
      <div className="max-w-4xl mx-auto relative">
        <div
          className="flex flex-col rounded-[24px] border-2 bg-[var(--background)] dark:bg-white/5 transition-all duration-300 focus-within:border-[var(--secondary)] focus-within:shadow-[0_0_20px_rgba(var(--secondary-rgb),0.1)] focus-within:bg-[var(--card)]"
          style={{
            borderColor: 'var(--border)',
          }}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte qualquer coisa sobre clientes, propostas, pedidos, produção, financeiro, notas fiscais..."
            rows={1}
            disabled={isLoading}
            className="resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] text-[var(--foreground)] dark:text-white placeholder-[var(--muted)]/70 dark:placeholder-white/30 outline-none w-full min-h-[56px] max-h-[200px] disabled:opacity-60 leading-relaxed scrollbar-thin"
          />
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Left actions */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isLoading || !isSupported}
                onClick={toggleListening}
                className={`p-2 rounded-lg transition-all ${
                  isListening
                    ? 'bg-red-500/10 text-red-500 dark:bg-red-500/20'
                    : 'text-[var(--muted)] dark:text-white/40 hover:bg-[var(--border)] dark:hover:bg-white/10 hover:text-[var(--foreground)] dark:hover:text-white'
                } ${(isLoading || !isSupported) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                title={!isSupported ? 'Microfone não suportado no navegador' : (isListening ? 'Parar gravação' : 'Gravar áudio (Fala para Texto)')}
              >
                <div className={isListening ? 'animate-pulse' : ''}>
                  <Mic size={18} />
                </div>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSendClick}
              disabled={!value.trim() || isLoading}
              className="flex items-center justify-center w-8 h-8 rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-md"
              style={{ background: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--muted-subtle)] mt-2 font-medium">
          Maestro {APP_NAME} · Inteligência Assistida
        </p>
      </div>
    </div>
  );
}

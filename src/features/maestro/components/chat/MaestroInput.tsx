'use client';
import { Send, Plus, Wrench, Mic } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (v: string) => void;
  isLoading: boolean;
}

export function MaestroInput({ value, onChange, onSend, isLoading }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  
  // States para o Speech-to-Text
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  
  // Controles de texto acumulado entre sessões automáticas
  const originalValueRef = useRef<string>('');
  const finalTranscriptRef = useRef<string>('');
  const isManualStopRef = useRef<boolean>(false);
  
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

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearSilenceTimer(); // Limpa timer se componente desmontar
  }, []);

  // Setup da Web Speech API
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
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
          } catch (e) {
            setIsListening(false); // Fallback caso não seja possível reiniciar
          }
        }
      };
      
      recognition.onerror = (event: any) => {
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
      
      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let sessionFinalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
             sessionFinalTranscript += event.results[i][0].transcript;
          } else {
             interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Se houve confirmação final da frase, acumulamos na nossa referência de longo prazo (permanente)
        if (sessionFinalTranscript) {
           finalTranscriptRef.current += sessionFinalTranscript;
        }
        
        const textComposto = originalValueRef.current + finalTranscriptRef.current + interimTranscript;
        
        // A visualização do input na tela compõe o texto consolidado com os resultados provisórios
        onChangeRef.current(textComposto);
        
        // Trata o temporizador de auto-envio:
        clearSilenceTimer();
        
        // Re-engatilha a bomba relógio para enviar após 4 segundos de inatividade da voz
        silenceTimerRef.current = setTimeout(() => {
          // Forçamos a parada permanente da gravação
          isManualStopRef.current = true;
          recognitionRef.current?.stop();
          
          // O envio automático ocorre apenas se tiver conteúdo e não estiver processando
          if (textComposto.trim() && !isLoadingRef.current) {
            onSendRef.current(textComposto);
          }
        }, 4000);
      };
      
      recognitionRef.current = recognition;
    }
  }, []);

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
        clearSilenceTimer();
        // Se estiver gravando ao enviar (por atalho), forçamos parada definitiva
        if (isListening && recognitionRef.current) {
          isManualStopRef.current = true;
          recognitionRef.current.stop();
        }
        onSend(value);
      }
    }
  };

  const handleSendClick = () => {
    if (value.trim() && !isLoading) {
      clearSilenceTimer();
      // Força parada definitiva antes de enviar
      if (isListening && recognitionRef.current) {
        isManualStopRef.current = true;
        recognitionRef.current.stop();
      }
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
              className="flex items-center justify-center w-8 h-8 rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-md"
              style={{ background: 'var(--secondary)' }}
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--muted)]/60 dark:text-white/20 mt-2 font-medium">
          Maestro ERP Ideal · Inteligência Assistida
        </p>
      </div>
    </div>
  );
}

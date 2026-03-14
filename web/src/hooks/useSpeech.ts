import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSpeechReturn {
  /** Whether the browser supports SpeechSynthesis */
  isSupported: boolean;
  /** Currently speaking (including paused state) */
  speaking: boolean;
  /** Currently paused */
  paused: boolean;
  /** Start speaking text */
  speak: (text: string) => void;
  /** Pause current speech */
  pause: () => void;
  /** Resume paused speech */
  resume: () => void;
  /** Stop and cancel speech */
  stop: () => void;
}

export default function useSpeech(): UseSpeechReturn {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    utteranceRef.current = null;
  }, [isSupported]);

  const speak = useCallback((text: string) => {
    if (!isSupported || !text.trim()) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;

    utterance.onstart = () => {
      setSpeaking(true);
      setPaused(false);
    };
    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setPaused(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [isSupported]);

  const pause = useCallback(() => {
    if (!isSupported || !speaking) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [isSupported, speaking]);

  const resume = useCallback(() => {
    if (!isSupported || !paused) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [isSupported, paused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  return { isSupported, speaking, paused, speak, pause, resume, stop };
}

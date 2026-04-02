import { useCallback, useRef } from 'react';

// Finds the best Chinese voice available, falls back to default
function findChineseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  // Prefer zh-CN, then zh-TW, then any zh
  return (
    voices.find(v => v.lang === 'zh-CN') ??
    voices.find(v => v.lang === 'zh-TW') ??
    voices.find(v => v.lang.startsWith('zh')) ??
    null
  );
}

export function useCallSound() {
  const speakingRef = useRef(false);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 0.9;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // Voices may not be loaded yet — retry after voiceschanged
    const trySpeak = () => {
      const voice = findChineseVoice();
      if (voice) utter.voice = voice;
      speakingRef.current = true;
      utter.onend = () => { speakingRef.current = false; };
      utter.onerror = () => { speakingRef.current = false; };
      window.speechSynthesis.speak(utter);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', trySpeak, { once: true });
    }
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  return { speak, cancel };
}

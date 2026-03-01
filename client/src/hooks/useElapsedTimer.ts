import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook für die Verwaltung eines elapsed time Timers.
 * Gibt die verstrichene Zeit in Sekunden zurück und Funktionen zum Starten/Stoppen.
 * 
 * @returns {Object} elapsedSeconds - Die verstrichene Zeit in Sekunden
 * @returns {Function} startTimer - Startet den Timer
 * @returns {Function} stopTimer - Stoppt den Timer
 * @returns {Function} resetTimer - Stoppt und setzt den Timer zurück
 */
export function useElapsedTimer() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Startet den Timer. Falls bereits ein Timer läuft, wird dieser zuerst gestoppt.
   */
  const startTimer = useCallback(() => {
    const startTime = Date.now();
    setElapsedSeconds(0);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, []);

  /**
   * Stoppt den Timer ohne die Zeit zurückzusetzen.
   */
  const stopTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  /**
   * Stoppt den Timer und setzt die Zeit auf 0 zurück.
   */
  const resetTimer = useCallback(() => {
    stopTimer();
    setElapsedSeconds(0);
  }, [stopTimer]);

  /**
   * Cleanup bei Unmount um Memory Leaks zu vermeiden.
   */
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, []);

  return {
    elapsedSeconds,
    startTimer,
    stopTimer,
    resetTimer,
  };
}

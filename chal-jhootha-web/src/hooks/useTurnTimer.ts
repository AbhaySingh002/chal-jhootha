import { useState, useEffect } from 'react';

export function useTurnTimer(deadlineMs?: number | null, durationMs = 45000) {
  const [progress, setProgress] = useState(1);
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    if (!deadlineMs) {
      setProgress(1);
      setIsUrgent(false);
      return;
    }

    let animId: number;
    const update = () => {
      const remaining = Math.max(0, deadlineMs - Date.now());
      const p = Math.min(1, Math.max(0, remaining / durationMs));
      setProgress(p);
      setIsUrgent(remaining > 0 && remaining <= 10000);

      if (remaining > 0) {
        animId = requestAnimationFrame(update);
      }
    };

    update();
    return () => cancelAnimationFrame(animId);
  }, [deadlineMs, durationMs]);

  return { progress, isUrgent };
}

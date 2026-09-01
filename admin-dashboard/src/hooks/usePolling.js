import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Polls `fetchFn` every `intervalMs` and exposes { data, loading, error, refetch }.
 * Not a websocket subscription - Layer 3's "real-time" analytics is achieved
 * via short-interval polling against REST endpoints, which is simpler to
 * reason about and sufficient for admin-dashboard-grade freshness (a few
 * seconds of staleness on user counts/room lists is fine). If sub-second
 * updates are ever needed, this is the place to swap in a socket
 * subscription instead.
 */
export function usePolling(fetchFn, { intervalMs = 5000, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const refetch = useCallback(async () => {
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function tick() {
      if (cancelled) return;
      await refetch();
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    }

    setLoading(true);
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refetch, ...deps]);

  return { data, loading, error, refetch };
}

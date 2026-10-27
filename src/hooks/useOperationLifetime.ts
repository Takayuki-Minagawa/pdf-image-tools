import { useCallback, useEffect, useRef } from 'react';

/** Captured signals stay aborted after their mounted tool is replaced. */
export function useOperationLifetime() {
  const controllerRef = useRef(new AbortController());
  useEffect(() => {
    // StrictMode can set up the effect again after its first cleanup.
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);
  return useCallback(() => controllerRef.current.signal, []);
}

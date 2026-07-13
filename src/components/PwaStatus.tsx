import { useEffect, useRef, useState } from 'react';
import { CloudOff, RefreshCw, X } from 'lucide-react';

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

    let disposed = false;
    let isReloading = false;

    const handleControllerChange = () => {
      if (isReloading) return;
      isReloading = true;
      window.location.reload();
    };

    const watchInstallingWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingWorker(worker);
        }
      });
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        if (disposed) return;
        registrationRef.current = registration;
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
      })
      .catch((error) => {
        console.warn('Service Workerの登録に失敗しました。', error);
      });

    const updateTimer = window.setInterval(() => {
      registrationRef.current?.update().catch(() => undefined);
    }, UPDATE_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(updateTimer);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const applyUpdate = () => {
    if (!waitingWorker) return;
    setIsApplyingUpdate(true);
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  };

  if (isOnline && !waitingWorker) return null;

  return (
    <div className="border-b border-gray-200 bg-white" aria-live="polite">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-2">
        {!isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              オフラインです。読み込み済みの画面は使えますが、新しいファイルの一部処理が制限される場合があります。
            </span>
          </div>
        )}

        {waitingWorker && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-950" role="status">
            <RefreshCw className={`h-4 w-4 shrink-0 ${isApplyingUpdate ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="mr-auto">新しいバージョンを利用できます。</span>
            <button
              type="button"
              onClick={applyUpdate}
              disabled={isApplyingUpdate}
              className="rounded-md bg-blue-700 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {isApplyingUpdate ? '更新中...' : '今すぐ更新'}
            </button>
            <button
              type="button"
              onClick={() => setWaitingWorker(null)}
              disabled={isApplyingUpdate}
              className="rounded-md p-1.5 text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="更新通知を閉じる"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

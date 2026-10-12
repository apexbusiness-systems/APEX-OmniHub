/**
 * Offline support and data persistence utilities
 */

export function isOnline(): boolean {
  return navigator.onLine;
}

export function setupOfflineListeners(
  onOnline?: () => void,
  onOffline?: () => void
): () => void {
  const handleOnline = () => {
    if (import.meta.env.DEV) console.log('Connection restored');
    onOnline?.();
  };

  const handleOffline = () => {
    if (import.meta.env.DEV) console.log('Connection lost');
    onOffline?.();
  };

  globalThis.addEventListener('online', handleOnline);
  globalThis.addEventListener('offline', handleOffline);

  return () => {
    globalThis.removeEventListener('online', handleOnline);
    globalThis.removeEventListener('offline', handleOffline);
  };
}

/**
 * Queue failed requests for retry when online
 */
interface QueuedRequest {
  id: string;
  timestamp: number;
  request: () => Promise<unknown>;
  retries: number;
  nextRetryTime?: number;
}

const STORAGE_KEY = 'offline_request_queue';
const requestQueue: QueuedRequest[] = [];
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 50;

function persistQueue() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requestQueue));
  } catch {
    // Non-fatal: continue in-memory
  }
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as QueuedRequest[];
    requestQueue.push(...parsed);
  } catch {
    // ignore parse errors
  }
}

loadQueue();

export function _clearQueueForTests(): void {
  requestQueue.length = 0;
}

export function queueOfflineRequest(request: () => Promise<unknown>): string {
  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    console.warn('Request queue is full, removing oldest request');
    requestQueue.shift();
  }

  const id = crypto.randomUUID();
  requestQueue.push({
    id,
    timestamp: Date.now(),
    request,
    retries: 0,
  });

  persistQueue();
  return id;
}

export async function processQueuedRequests(): Promise<void> {
  if (!isOnline() || requestQueue.length === 0) return;

  if (import.meta.env.DEV) console.log(`Processing ${requestQueue.length} queued requests...`);

  const now = Date.now();
  const requests = requestQueue.filter(req => !req.nextRetryTime || req.nextRetryTime <= now);
  
  if (requests.length === 0) return;

  // Remove processed requests from queue, keep future retries
  const futureRequests = requestQueue.filter(req => req.nextRetryTime && req.nextRetryTime > now);
  requestQueue.length = 0;
  requestQueue.push(...futureRequests);
  persistQueue();

  // Process requests with concurrency limit for better performance
  const CONCURRENCY_LIMIT = 3;

  for (let i = 0; i < requests.length; i += CONCURRENCY_LIMIT) {
    const batch = requests.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map(item => item.request())
    );

    results.forEach((result, index) => {
      const item = batch[index];
      if (result.status === 'fulfilled') {
        if (import.meta.env.DEV) console.log(`Successfully processed queued request ${item.id}`);
      } else {
        console.error(`❌ Failed to process request ${item.id}:`, result.reason);

        if (item.retries < MAX_RETRIES) {
          item.retries++;
          
          // Exponential backoff + secure jitter
          const randomBuffer = new Uint32Array(1);
          crypto.getRandomValues(randomBuffer);
          const jitter = (randomBuffer[0] / 0xffffffff) * 1000;
          const backoff = Math.pow(2, item.retries) * 1000 + jitter;
          
          item.nextRetryTime = Date.now() + backoff;
          requestQueue.push(item);
        }
      }
    });
  }
  persistQueue();
}

/**
 * Local storage with quota management
 */
export function saveToLocalStorage<T>(key: string, data: T): boolean {
  try {
    const serialized = JSON.stringify({
      data,
      timestamp: Date.now(),
    });
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('LocalStorage quota exceeded');
      // Clear old data
      clearOldLocalStorageData();
      // Try again
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function loadFromLocalStorage<T>(key: string, maxAge?: number): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const { data, timestamp } = JSON.parse(item);

    if (maxAge && Date.now() - timestamp > maxAge) {
      localStorage.removeItem(key);
      return null;
    }

    return data as T;
  } catch {
    return null;
  }
}

function clearOldLocalStorageData(): void {
  try {
    const keys = Object.keys(localStorage);
    const itemsWithTimestamp: { key: string; timestamp: number }[] = [];

    // ⚡ Bolt: Replaced multiple .map() and .filter() passes with a single loop
    // to reduce garbage collection overhead and intermediate array allocations.
    for (const key of keys) {
      try {
        const data = localStorage.getItem(key);
        if (data !== null) {
          const { timestamp } = JSON.parse(data);
          itemsWithTimestamp.push({ key, timestamp: timestamp || 0 });
        }
      } catch {
        itemsWithTimestamp.push({ key, timestamp: 0 });
      }
    }

    // Sort by timestamp and remove oldest 25%
    itemsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);

    const removeCount = Math.ceil(itemsWithTimestamp.length * 0.25);
    for (let i = 0; i < removeCount; i++) {
      try {
        localStorage.removeItem(itemsWithTimestamp[i].key);
      } catch {
        // Ignore errors when removing items
      }
    }
  } catch (error) {
    console.error('Error clearing old localStorage data:', error);
  }
}

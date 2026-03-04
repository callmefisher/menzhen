/** SSE streaming utility for AI queries */

export interface SSECallbacks {
  onChunk: (text: string) => void;
  onDone: (data: unknown) => void;
  onCached: (data: unknown) => void;
  onError: (error: string) => void;
}

/** Internal: parse SSE stream from a fetch response */
function parseSSEStream(
  response: Response,
  callbacks: SSECallbacks,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('无法读取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const read = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;

        try {
          const evt = JSON.parse(dataStr);
          switch (evt.type) {
            case 'chunk':
              callbacks.onChunk(evt.content || '');
              break;
            case 'done':
              callbacks.onDone(evt);
              break;
            case 'cached':
              callbacks.onCached(evt);
              break;
            case 'error':
              callbacks.onError(evt.error || 'AI 查询失败');
              break;
          }
        } catch {
          // ignore parse errors for malformed events
        }
      }
    }
  };

  read();
}

/** Internal: create SSE fetch request */
function fetchSSE(
  url: string,
  body: unknown,
  callbacks: SSECallbacks,
  controller: AbortController,
) {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          callbacks.onError(json.message || `HTTP ${response.status}`);
        } catch {
          callbacks.onError(`HTTP ${response.status}`);
        }
        return;
      }
      parseSSEStream(response, callbacks);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message || '网络请求失败');
      }
    });
}

/**
 * Stream a wuyun-liuqi query via SSE.
 * Returns an AbortController so the caller can cancel the request.
 */
export function streamWuyunLiuqiQuery(
  year: number,
  force: boolean,
  callbacks: SSECallbacks,
): AbortController {
  const controller = new AbortController();
  fetchSSE('/api/v1/wuyun-liuqi/query-stream', { year, force }, callbacks, controller);
  return controller;
}

/**
 * Stream an AI diagnosis analysis via SSE.
 * Returns an AbortController so the caller can cancel the request.
 */
export function streamAiAnalysis(
  diagnosis: string,
  recordId: number | undefined,
  force: boolean,
  callbacks: SSECallbacks,
): AbortController {
  const controller = new AbortController();
  fetchSSE(
    '/api/v1/ai/analyze-diagnosis-stream',
    { diagnosis, record_id: recordId || 0, force },
    callbacks,
    controller,
  );
  return controller;
}

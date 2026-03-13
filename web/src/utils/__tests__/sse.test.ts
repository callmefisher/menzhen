import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamWuyunLiuqiQuery, streamAiAnalysis, streamTongueAnalysis } from '../sse';
import type { SSECallbacks } from '../sse';

// Helper to create mock SSE callbacks
function mockCallbacks(): SSECallbacks {
  return {
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onCached: vi.fn(),
    onError: vi.fn(),
  };
}

// Helper to create a mock ReadableStream from SSE lines
function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map((l) => l + '\n').join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

describe('SSE utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('streamWuyunLiuqiQuery', () => {
    it('returns an AbortController', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
      const cb = mockCallbacks();
      const controller = streamWuyunLiuqiQuery(2026, false, cb);
      expect(controller).toBeInstanceOf(AbortController);
    });

    it('sends POST to correct URL with year and force', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStream([]), { status: 200 }),
      );
      localStorage.setItem('token', 'my-jwt');
      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, true, cb);

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/wuyun-liuqi/query-stream');
      expect(opts?.method).toBe('POST');
      expect(JSON.parse(opts?.body as string)).toEqual({ year: 2026, force: true });
      expect((opts?.headers as Record<string, string>)['Authorization']).toBe('Bearer my-jwt');
    });
  });

  describe('streamAiAnalysis', () => {
    it('returns an AbortController', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
      const cb = mockCallbacks();
      const controller = streamAiAnalysis('头痛', 1, false, cb);
      expect(controller).toBeInstanceOf(AbortController);
    });

    it('sends correct body with record_id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStream([]), { status: 200 }),
      );
      const cb = mockCallbacks();
      streamAiAnalysis('头痛发热', 42, true, cb);

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toEqual({ diagnosis: '头痛发热', record_id: 42, force: true });
    });

    it('defaults record_id to 0 when undefined', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStream([]), { status: 200 }),
      );
      const cb = mockCallbacks();
      streamAiAnalysis('test', undefined, false, cb);

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.record_id).toBe(0);
    });
  });

  describe('streamTongueAnalysis', () => {
    it('sends correct URL and body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStream([]), { status: 200 }),
      );
      const cb = mockCallbacks();
      streamTongueAnalysis('舌红苔黄', 5, false, cb);

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/ai/analyze-tongue-stream');
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toEqual({ description: '舌红苔黄', record_id: 5, force: false });
    });
  });

  describe('parseSSEStream via fetch', () => {
    it('parses chunk events and calls onChunk', async () => {
      const stream = createSSEStream([
        'data: {"type":"chunk","content":"hello "}',
        'data: {"type":"chunk","content":"world"}',
        'data: {"type":"done"}',
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());
      expect(cb.onChunk).toHaveBeenCalledTimes(2);
      expect(cb.onChunk).toHaveBeenCalledWith('hello ');
      expect(cb.onChunk).toHaveBeenCalledWith('world');
    });

    it('parses cached events', async () => {
      const stream = createSSEStream([
        'data: {"type":"cached","content":"cached data"}',
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onCached).toHaveBeenCalled());
      expect(cb.onCached).toHaveBeenCalledWith(expect.objectContaining({ type: 'cached' }));
    });

    it('parses error events', async () => {
      const stream = createSSEStream([
        'data: {"type":"error","error":"AI 服务不可用"}',
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
      expect(cb.onError).toHaveBeenCalledWith('AI 服务不可用');
    });

    it('ignores non-data lines', async () => {
      const stream = createSSEStream([
        ': comment',
        '',
        'event: ping',
        'data: {"type":"chunk","content":"ok"}',
      ]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onChunk).toHaveBeenCalled());
      expect(cb.onChunk).toHaveBeenCalledTimes(1);
      expect(cb.onChunk).toHaveBeenCalledWith('ok');
    });
  });

  describe('HTTP error handling', () => {
    it('calls onError on HTTP error with JSON message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: '认证失败' }), { status: 401 }),
      );

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
      expect(cb.onError).toHaveBeenCalledWith('认证失败');
    });

    it('calls onError on HTTP error with non-JSON body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
      expect(cb.onError).toHaveBeenCalledWith('HTTP 500');
    });

    it('silently handles AbortError', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      // Wait a tick, onError should NOT be called
      await new Promise((r) => setTimeout(r, 50));
      expect(cb.onError).not.toHaveBeenCalled();
    });

    it('calls onError on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
      expect(cb.onError).toHaveBeenCalledWith('Network error');
    });
  });

  describe('token handling', () => {
    it('uses sessionStorage token when localStorage is empty', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStream([]), { status: 200 }),
      );
      sessionStorage.setItem('token', 'session-jwt');
      const cb = mockCallbacks();
      streamWuyunLiuqiQuery(2026, false, cb);

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer session-jwt');
    });
  });
});

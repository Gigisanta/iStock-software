import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withStorefrontDb: vi.fn(),
}));

vi.mock('../../../../_lib/storefront-db', () => ({
  withStorefrontDb: mocks.withStorefrontDb,
}));

const { POST } = await import('./route');

const MAX_BODY_BYTES = 6144;
const SLUG = 'nortecel';
const params = Promise.resolve({ slug: SLUG });

function formBody(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    customer_name: 'Gimena Paredes',
    customer_wa_phone: '+54 9 299 415-3388',
    model_text: 'iPhone 12',
    ...overrides,
  }).toString();
}

function requestFromStream(
  stream: ReadableStream<Uint8Array>,
  extraHeaders: Record<string, string> = {},
): Request {
  return {
    headers: new Headers({
      'content-type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    }),
    body: stream,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ count: 1 });
  mocks.withStorefrontDb.mockImplementation(
    async (_slug: string, callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
      callback({ execute: mocks.execute }),
  );
});

describe('POST /s/[slug]/api/tradein: límite de bytes', () => {
  it('rechaza Content-Length oversized antes de consumir el body y conserva el 303 de reintento', async () => {
    const getReader = vi.fn(() => {
      throw new Error('el body no debe tocarse cuando Content-Length ya excede el techo');
    });
    const request = {
      headers: new Headers({
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(MAX_BODY_BYTES + 1),
      }),
      body: { getReader },
    } as unknown as Request;

    const response = await POST(request, { params });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/canje/reintentar');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.withStorefrontDb).not.toHaveBeenCalled();
  });

  it('rechaza un body chunked oversized sin Content-Length cancelando al superar el límite', async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('a'.repeat(MAX_BODY_BYTES)));
      },
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode('b'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = requestFromStream(stream);

    expect(request.headers.get('content-length')).toBeNull();
    const response = await POST(request, { params });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/canje/reintentar');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
    expect(mocks.withStorefrontDb).not.toHaveBeenCalled();
  });

  it('acepta un body válido debajo del límite y mantiene el insert/303 de éxito', async () => {
    const request = new Request(`https://${SLUG}.maat.work/api/tradein`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(new TextEncoder().encode(formBody()).byteLength),
      },
      body: formBody(),
    });

    const response = await POST(request, { params });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/canje/listo');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.withStorefrontDb).toHaveBeenCalledWith(SLUG, expect.any(Function));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

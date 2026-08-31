import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exchange, redirect } = vi.hoisted(() => ({
  exchange: vi.fn(),
  redirect: vi.fn((target: string): never => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('../../../(app)/_lib/auth/supabase-driver', () => ({
  exchangeSupabaseCodeForSession: exchange,
}));

const { GET } = await import('./route');

const request = (query: string): Request =>
  new Request(`https://app.example.com/api/auth/callback${query}`);

beforeEach(() => {
  exchange.mockReset();
  exchange.mockResolvedValue(undefined);
  redirect.mockClear();
});

describe('GET /api/auth/callback', () => {
  it('canjea el código y lleva a billing con el plan validado', async () => {
    await expect(GET(request('?code=magic-code&plan=base'))).rejects.toThrow(
      'redirect:/billing/suscribirse?plan=base',
    );

    expect(exchange).toHaveBeenCalledWith('magic-code');
    expect(redirect).toHaveBeenCalledWith('/billing/suscribirse?plan=base');
  });

  it('si el plan es inválido termina en el panel, sin aceptar un destino libre', async () => {
    await expect(GET(request('?code=magic-code&plan=https%3A%2F%2Fevil.example'))).rejects.toThrow(
      'redirect:/app',
    );

    expect(exchange).toHaveBeenCalledWith('magic-code');
  });

  it('rechaza códigos repetidos antes de canjearlos', async () => {
    await expect(GET(request('?code=one&code=two&plan=negocio'))).rejects.toThrow(
      'redirect:/ingresar?error=link_invalido',
    );

    expect(exchange).not.toHaveBeenCalled();
  });

  it('si Supabase no puede canjear el código vuelve al ingreso', async () => {
    exchange.mockRejectedValue(new Error('expired'));

    await expect(GET(request('?code=expired-code'))).rejects.toThrow(
      'redirect:/ingresar?error=link_invalido',
    );
  });
});

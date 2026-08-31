import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFormState } from './form-state';

vi.mock('server-only', () => ({}));

const { redirect, signIn } = vi.hoisted(() => ({
  redirect: vi.fn((target: string): never => {
    throw new Error(`redirect:${target}`);
  }),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('./driver', () => ({
  authDriver: () => ({ signIn }),
}));

const { signInAction } = await import('./actions');

const IDENTITY = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'dueno@test.local',
  fullName: 'Dueño',
};

function form(...plans: string[]): FormData {
  const data = new FormData();
  data.set('email', 'dueno@test.local');
  for (const plan of plans) data.append('plan', plan);
  return data;
}

const state: AuthFormState = { error: null, status: 'idle', email: '', selectedPlan: null };

beforeEach(() => {
  signIn.mockReset();
  redirect.mockClear();
});

describe('signInAction · plan elegido', () => {
  it('redirige a billing con base después de entrar', async () => {
    signIn.mockResolvedValue({ ok: true, status: 'signed_in', identity: IDENTITY });

    await expect(signInAction(state, form('base'))).rejects.toThrow(
      'redirect:/billing/suscribirse?plan=base',
    );
    expect(signIn).toHaveBeenCalledWith({ email: 'dueno@test.local', selectedPlan: 'base' });
    expect(redirect).toHaveBeenCalledWith('/billing/suscribirse?plan=base');
  });

  it('redirige a billing con negocio después de entrar', async () => {
    signIn.mockResolvedValue({ ok: true, status: 'signed_in', identity: IDENTITY });

    await expect(signInAction(state, form('negocio'))).rejects.toThrow(
      'redirect:/billing/suscribirse?plan=negocio',
    );
    expect(redirect).toHaveBeenCalledWith('/billing/suscribirse?plan=negocio');
  });

  it('un plan inventado se rechaza antes de autenticar y no abre un redirect', async () => {
    const result = await signInAction(state, form('premium'));

    expect(result).toEqual({
      error: 'Elegí un plan válido.',
      status: 'idle',
      email: 'dueno@test.local',
      selectedPlan: null,
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('valores repetidos también se rechazan antes de autenticar', async () => {
    const result = await signInAction(state, form('base', 'negocio'));

    expect(result).toEqual({
      error: 'Elegí un plan válido.',
      status: 'idle',
      email: 'dueno@test.local',
      selectedPlan: null,
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('sin plan conserva el login existente y entra al panel', async () => {
    signIn.mockResolvedValue({ ok: true, status: 'signed_in', identity: IDENTITY });

    await expect(signInAction(state, form())).rejects.toThrow('redirect:/app');
    expect(redirect).toHaveBeenCalledWith('/app');
  });

  it('devuelve link_sent sin identidad ni redirect inmediato', async () => {
    signIn.mockResolvedValue({ ok: true, status: 'link_sent' });

    const result = await signInAction(state, form('negocio'));

    expect(result).toEqual({
      error: null,
      status: 'link_sent',
      email: 'dueno@test.local',
      selectedPlan: 'negocio',
    });
    expect(signIn).toHaveBeenCalledWith({ email: 'dueno@test.local', selectedPlan: 'negocio' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

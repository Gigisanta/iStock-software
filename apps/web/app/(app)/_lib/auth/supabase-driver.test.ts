import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => {
  const auth = {
    exchangeCodeForSession: vi.fn(),
    getSession: vi.fn(),
    getUser: vi.fn(),
    signInWithOtp: vi.fn(),
    signOut: vi.fn(),
  };
  const serverClient = { auth };
  const adminUpdateUserById = vi.fn();
  const adminClient = { auth: { admin: { updateUserById: adminUpdateUserById } } };
  return {
    adminClient,
    adminUpdateUserById,
    auth,
    cookies: vi.fn(),
    createClient: vi.fn(() => adminClient),
    createServerClient: vi.fn(() => serverClient),
    serverEnv: vi.fn(),
  };
});

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('../env', () => ({ serverEnv: mocks.serverEnv }));

const { exchangeSupabaseCodeForSession, supabaseAuthDriver } = await import('./supabase-driver');

const CONFIG = {
  NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
};

const USER_ID = '11111111-2222-4333-8444-555555555555';
const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeEach(() => {
  mocks.auth.exchangeCodeForSession.mockReset();
  mocks.auth.getSession.mockReset();
  mocks.auth.getUser.mockReset();
  mocks.auth.signInWithOtp.mockReset();
  mocks.auth.signOut.mockReset();
  mocks.adminUpdateUserById.mockReset();
  mocks.cookies.mockReset();
  mocks.cookies.mockResolvedValue({ getAll: vi.fn(() => []), set: vi.fn() });
  mocks.createClient.mockClear();
  mocks.createServerClient.mockClear();
  mocks.serverEnv.mockReturnValue(CONFIG);
});

describe('supabaseAuthDriver · sesión SSR', () => {
  it('valida la identidad con getUser y proyecta sólo los campos públicos', async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          email: 'dueno@example.com',
          user_metadata: { full_name: 'Dueño del local', tenant_id: 'no-se-usa' },
        },
      },
      error: null,
    });

    const identity = await supabaseAuthDriver().currentIdentity();

    expect(identity).toEqual({
      userId: USER_ID,
      email: 'dueno@example.com',
      fullName: 'Dueño del local',
    });
    expect(mocks.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.auth.getSession).not.toHaveBeenCalled();
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      CONFIG.NEXT_PUBLIC_SUPABASE_URL,
      CONFIG.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });

  it('trata la ausencia de sesión como anónimo sin inventar identidad', async () => {
    const missing = new Error('Auth session missing');
    missing.name = 'AuthSessionMissingError';
    mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: missing });

    await expect(supabaseAuthDriver().currentIdentity()).resolves.toBeNull();
  });
});

describe('supabaseAuthDriver · magic link', () => {
  it('manda el link, devuelve link_sent y conserva sólo el plan permitido en el callback', async () => {
    mocks.auth.signInWithOtp.mockResolvedValue({ error: null });

    const result = await supabaseAuthDriver().signIn({
      email: '  DUENO@EXAMPLE.COM ',
      selectedPlan: 'negocio',
    });

    expect(result).toEqual({ ok: true, status: 'link_sent' });
    expect(mocks.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'dueno@example.com',
      options: {
        emailRedirectTo: 'https://app.example.com/api/auth/callback?plan=negocio',
      },
    });
  });

  it('rechaza un plan adulterado antes de mandar el correo', async () => {
    const result = await supabaseAuthDriver().signIn({
      email: 'dueno@example.com',
      selectedPlan: 'premium' as never,
    });

    expect(result).toMatchObject({ ok: false, code: 'BACKEND_UNAVAILABLE' });
    expect(mocks.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it('canjea el código del callback en el cliente SSR', async () => {
    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'fake-access-token' } },
      error: null,
    });

    await expect(exchangeSupabaseCodeForSession('code-from-email')).resolves.toBeUndefined();
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith('code-from-email');
  });

  it('rechaza un código vacío antes de tocar Supabase', async () => {
    await expect(exchangeSupabaseCodeForSession('  ')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('no filtra la configuración faltante en el resultado visible del login', async () => {
    mocks.serverEnv.mockReturnValue({ NEXT_PUBLIC_APP_URL: CONFIG.NEXT_PUBLIC_APP_URL });

    await expect(
      supabaseAuthDriver().signIn({ email: 'dueno@example.com', selectedPlan: null }),
    ).resolves.toEqual({
      ok: false,
      code: 'DRIVER_NOT_CONFIGURED',
      message: 'No pudimos mandar el link. Probá de nuevo en un minuto.',
    });
  });
});

describe('supabaseAuthDriver · operaciones servidor', () => {
  it('cierra sesión usando el cliente SSR', async () => {
    mocks.auth.signOut.mockResolvedValue({ error: null });

    await expect(supabaseAuthDriver().signOut()).resolves.toBeUndefined();
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
  });

  it('sincroniza tenant_id con service role en app_metadata, nunca user_metadata', async () => {
    mocks.adminUpdateUserById.mockResolvedValue({ data: { user: null }, error: null });

    await expect(supabaseAuthDriver().syncTenantClaim(USER_ID, TENANT_ID)).resolves.toBeUndefined();

    expect(mocks.createClient).toHaveBeenCalledWith(
      CONFIG.NEXT_PUBLIC_SUPABASE_URL,
      CONFIG.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith(USER_ID, {
      app_metadata: { tenant_id: TENANT_ID },
    });
    expect(mocks.adminUpdateUserById.mock.calls[0]?.[1]).not.toHaveProperty('user_metadata');
  });

  it('no intenta sincronizar IDs que no son UUID', async () => {
    await expect(supabaseAuthDriver().syncTenantClaim('not-an-id', TENANT_ID)).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

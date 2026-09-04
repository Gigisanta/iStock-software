import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => {
  const auth = {
    getSession: vi.fn(),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  };
  const execute = vi.fn();
  const withServiceDb = vi.fn();
  return { auth, execute, neonAuth: vi.fn(() => auth), withServiceDb };
});

vi.mock('./neon-server', () => ({ neonAuth: mocks.neonAuth }));
vi.mock('../db/session', () => ({ withServiceDb: mocks.withServiceDb }));

const { neonAuthDriver } = await import('./neon-driver');

const USER_ID = '11111111-2222-4333-8444-555555555555';
const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER = { id: USER_ID, email: 'dueno@example.com', name: 'Dueño del local' };

beforeEach(() => {
  mocks.auth.getSession.mockReset();
  mocks.auth.signIn.email.mockReset();
  mocks.auth.signUp.email.mockReset();
  mocks.auth.signOut.mockReset();
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue([]);
  mocks.withServiceDb.mockReset();
  mocks.withServiceDb.mockImplementation(async (fn: (tx: { execute: typeof mocks.execute }) => unknown) =>
    fn({ execute: mocks.execute }),
  );
});

describe('neonAuthDriver · sesión', () => {
  it('trata la ausencia de sesión como anónimo', async () => {
    mocks.auth.getSession.mockResolvedValue({ data: null, error: null });

    await expect(neonAuthDriver().currentIdentity()).resolves.toBeNull();
    expect(mocks.withServiceDb).not.toHaveBeenCalled();
  });

  it('proyecta una sesión válida y garantiza el espejo local de identidad', async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { user: USER }, error: null });

    await expect(neonAuthDriver().currentIdentity()).resolves.toEqual({
      userId: USER_ID,
      email: USER.email,
      fullName: USER.name,
    });

    expect(mocks.withServiceDb).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('rechaza una identidad malformada sin crear un perfil', async () => {
    mocks.auth.getSession.mockResolvedValue({
      data: { user: { id: 'not-a-uuid', email: USER.email } },
      error: null,
    });

    await expect(neonAuthDriver().currentIdentity()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    expect(mocks.withServiceDb).not.toHaveBeenCalled();
  });
});

describe('neonAuthDriver · credenciales', () => {
  it('ingresa con mail normalizado y contraseña', async () => {
    mocks.auth.signIn.email.mockResolvedValue({ data: { user: USER }, error: null });

    await expect(
      neonAuthDriver().signIn({
        email: '  DUENO@EXAMPLE.COM ',
        password: 'secreto-largo',
        mode: 'sign_in',
        selectedPlan: 'base',
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'signed_in',
      identity: { userId: USER_ID, email: USER.email, fullName: USER.name },
    });

    expect(mocks.auth.signIn.email).toHaveBeenCalledWith({
      email: 'dueno@example.com',
      password: 'secreto-largo',
    });
    expect(mocks.auth.signUp.email).not.toHaveBeenCalled();
  });

  it('crea cuenta y limita el nombre enviado al proveedor', async () => {
    mocks.auth.signUp.email.mockResolvedValue({ data: { user: USER }, error: null });

    await expect(
      neonAuthDriver().signIn({
        email: 'dueno@example.com',
        password: 'secreto-largo',
        mode: 'sign_up',
        selectedPlan: null,
      }),
    ).resolves.toMatchObject({ ok: true, status: 'signed_in' });

    expect(mocks.auth.signUp.email).toHaveBeenCalledWith({
      email: 'dueno@example.com',
      password: 'secreto-largo',
      name: 'dueno',
    });
  });

  it('traduce el límite del proveedor a un error accionable', async () => {
    mocks.auth.signIn.email.mockResolvedValue({
      data: null,
      error: { status: 429, code: 'TOO_MANY_REQUESTS' },
    });

    await expect(
      neonAuthDriver().signIn({
        email: 'dueno@example.com',
        password: 'secreto-largo',
        mode: 'sign_in',
        selectedPlan: null,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Demasiados intentos. Esperá un rato y probá de nuevo.',
    });
  });
});

describe('neonAuthDriver · operaciones', () => {
  it('cierra sesión sin tragar un error real', async () => {
    mocks.auth.signOut.mockResolvedValue({ error: null });

    await expect(neonAuthDriver().signOut()).resolves.toBeUndefined();
    expect(mocks.auth.signOut).toHaveBeenCalledOnce();
  });

  it('valida IDs y no intenta escribir metadata de tenant en Neon Auth', async () => {
    await expect(neonAuthDriver().syncTenantClaim(USER_ID, TENANT_ID)).resolves.toBeUndefined();
    expect(mocks.withServiceDb).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();

    await expect(neonAuthDriver().syncTenantClaim('not-a-uuid', TENANT_ID)).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
  });
});

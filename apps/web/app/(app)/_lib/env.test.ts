import { describe, expect, it } from 'vitest';
import { isLocalRootDomain } from './local-domain';

describe('isLocalRootDomain', () => {
  it('reconoce los apex locales con y sin puerto', () => {
    expect(isLocalRootDomain('localhost:3000')).toBe(true);
    expect(isLocalRootDomain('127.0.0.1.nip.io:3100')).toBe(true);
    expect(isLocalRootDomain('127-0-0-1.nip.io')).toBe(true);
    expect(isLocalRootDomain('tenant.localhost')).toBe(true);
    expect(isLocalRootDomain('tenant.192.168.0.10.sslip.io')).toBe(true);
  });

  it('no trata el dominio productivo ni una configuración inválida como local', () => {
    expect(isLocalRootDomain('maat.work')).toBe(false);
    expect(isLocalRootDomain('https://maat.work')).toBe(false);
    expect(isLocalRootDomain('')).toBe(false);
  });
});

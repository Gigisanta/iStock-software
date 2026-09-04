/**
 * Los dos entornos locales soportan wildcard (`*.localhost` y `*.nip.io`/`*.sslip.io`) sin TLS.
 * No alcanza con mirar `startsWith('localhost')`: el arnés de Playwright usa
 * `127.0.0.1.nip.io:3100`, y mandar ese link a HTTPS deja el botón de vidriera muerto.
 */
export function isLocalRootDomain(domain: string): boolean {
  try {
    const hostname = new URL(`http://${domain}`).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.nip.io') ||
      hostname.endsWith('.sslip.io')
    );
  } catch {
    return false;
  }
}

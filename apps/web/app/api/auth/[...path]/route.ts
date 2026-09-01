import { neonAuth } from '../../../(app)/_lib/auth/neon-server';

type AuthRouteContext = { params: Promise<{ path: string[] }> };

// El build de Next evalúa los Route Handlers sin cargar el entorno de producción. La instancia se
// crea por request para que un build local no necesite secretos, y Vercel la reutiliza dentro del
// ciclo de vida de la función gracias al singleton de `neon-server`.
export async function GET(request: Request, context: AuthRouteContext): Promise<Response> {
  return neonAuth().handler().GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext): Promise<Response> {
  return neonAuth().handler().POST(request, context);
}

export async function PUT(request: Request, context: AuthRouteContext): Promise<Response> {
  return neonAuth().handler().PUT(request, context);
}

export async function DELETE(request: Request, context: AuthRouteContext): Promise<Response> {
  return neonAuth().handler().DELETE(request, context);
}

export async function PATCH(request: Request, context: AuthRouteContext): Promise<Response> {
  return neonAuth().handler().PATCH(request, context);
}

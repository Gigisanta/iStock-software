import { serve } from 'inngest/next';
import { inngestConfig } from '../../(app)/_lib/env';
import { functions, inngest } from '../../../inngest/functions';

export const maxDuration = 300;

const config = inngestConfig();

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  ...(config.serveOrigin === undefined ? {} : { serveOrigin: config.serveOrigin }),
});

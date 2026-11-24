import serverless from 'serverless-http';
import { createApiApp } from '../../server/apiApp';

let cachedHandler: ReturnType<typeof serverless> | null = null;
let cachedInitError: Error | null = null;

function getHandler() {
  if (cachedHandler) return cachedHandler;
  if (cachedInitError) throw cachedInitError;
  try {
    const app = createApiApp({ isServerless: true });
    cachedHandler = serverless(app);
    return cachedHandler;
  } catch (err) {
    cachedInitError = err instanceof Error ? err : new Error(String(err));
    throw cachedInitError;
  }
}

export const handler = async (event: unknown, context: unknown) => {
  try {
    const fn = getHandler();
    return await fn(event as any, context as any);
  } catch (err) {
    console.error('Netlify API function error:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Server API initialization failed. Check Netlify Function logs and environment variables.',
        code: 'FUNCTION_INIT_ERROR',
      }),
    };
  }
};

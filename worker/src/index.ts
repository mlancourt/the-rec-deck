// Worker entry. Only the handler is exported here (workerd rejects other named exports).
import { handle } from './app';
import type { Env } from './types';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};

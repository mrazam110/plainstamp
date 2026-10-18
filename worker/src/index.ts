import { allowedOrigins, getDeps, type Env } from "./deps";
import { createGuard } from "./guard";
import { handle } from "./handler";

export default {
  fetch: (request: Request, env: Env) =>
    handle(request, () => getDeps(env), { allowedOrigins: allowedOrigins(env), guard: createGuard(env) }),
};

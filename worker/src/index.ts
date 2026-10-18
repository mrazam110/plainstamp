import { handle } from "./handler";
import { allowedOrigins, getDeps, type Env } from "./deps";

export default {
  fetch: (request: Request, env: Env) => handle(request, () => getDeps(env), { allowedOrigins: allowedOrigins(env) }),
};

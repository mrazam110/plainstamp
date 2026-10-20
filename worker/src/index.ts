import { allowedOrigins, getDeps, questionCounter, voteRecorder, type Env } from "./deps";
import { createGuard } from "./guard";
import { handle } from "./handler";

export { DailyCounter } from "./counter";

export default {
  fetch: (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => {
    const counter = questionCounter(env);
    return handle(request, () => getDeps(env), {
      allowedOrigins: allowedOrigins(env), guard: createGuard(env), recordVote: voteRecorder(env),
      countQuestion: counter ? () => ctx.waitUntil(counter.count()) : undefined, questionsToday: counter?.today,
    });
  },
};

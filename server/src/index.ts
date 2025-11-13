import { handleRequest } from './router';
import { RoomDurableObject } from './room-do';
import { handleWebSocketRequest } from './ws-handler';

export interface Env {
  ROOM: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    void ctx; // まだ利用しないが、将来のTick処理で使用予定。
    const wsResponse = await handleWebSocketRequest(request, env);
    if (wsResponse) {
      return wsResponse;
    }

    return handleRequest(request, env);
  },
};

export default handler;
export { RoomDurableObject };

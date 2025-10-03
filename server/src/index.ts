import { handleRequest } from './router';
import { RoomDurableObject } from './room-do';

export interface Env {
  ROOM: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    void ctx; // まだ利用しないが、将来のTick処理で使用予定。
    return handleRequest(request, env);
  },
};

export default handler;
export { RoomDurableObject };

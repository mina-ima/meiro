import { createFetchHandler } from './router';
import { RoomDurableObject } from './room-do';

export interface Env {
  ROOM: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  fetch(request, env) {
    return createFetchHandler(env)(request);
  },
};

export default handler;
export { RoomDurableObject };

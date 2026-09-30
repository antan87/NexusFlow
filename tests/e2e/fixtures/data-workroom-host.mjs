import { WorkroomManager } from '../../../dist/workrooms/manager.js';

const manager = new WorkroomManager(process.argv[2]);
const allowed = new Set(['startHost', 'createInvite', 'decideJoin', 'snapshot', 'exportRoom', 'stopOrLeave']);
process.on('message', async ({ id, method, args }) => {
  try {
    if (!allowed.has(method)) throw new Error('Unsupported fixture operation');
    const result = await manager[method](...args);
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: String(error) });
  }
});
process.on('disconnect', async () => { await manager.stopOrLeave(); process.exit(0); });

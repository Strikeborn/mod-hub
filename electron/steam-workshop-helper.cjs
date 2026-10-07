// Child-process helper: talk to the running Steam client about Workshop items.
// Usage: node steam-workshop-helper.cjs <subscribe|unsubscribe|download> <appId> <id> [id ...]
//   download = subscribe if needed, ask Steam for the newest version (high priority) and wait
//              until it is installed; prints installInfo (folder, timestamp).
// One JSON line per item on stdout: {"id","ok","error"?,"folder"?,"timestamp"?}
// Separate process because steamworks.js can only init one app id per process.
const [, , action, appIdArg, ...ids] = process.argv;

const STATE = { Subscribed: 1, Installed: 4, NeedsUpdate: 8, Downloading: 16, DownloadPending: 32 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
}

(async () => {
  let client;
  try {
    if (!['subscribe', 'unsubscribe', 'download'].includes(action)) throw new Error(`bad action ${action}`);
    client = require('steamworks.js').init(Number(appIdArg));
  } catch (err) {
    for (const id of ids) out({ id, ok: false, error: String((err && err.message) || err) });
    setTimeout(() => process.exit(1), 50);
    return;
  }
  const ws = client.workshop;
  for (const id of ids) {
    const item = BigInt(id);
    try {
      if (action === 'subscribe') await withTimeout(ws.subscribe(item), 20_000, 'subscribe');
      else if (action === 'unsubscribe') {
        // Steam can resolve the call yet keep the subscription (seen with a pending update queued),
        // so read the state back and retry before reporting success.
        let attempt = 0;
        for (;;) {
          await withTimeout(ws.unsubscribe(item), 20_000, 'unsubscribe');
          await sleep(1500);
          if (!(ws.state(item) & STATE.Subscribed)) break;
          attempt += 1;
          if (attempt >= 3) throw new Error('Steam still lists the item as subscribed after 3 tries');
        }
      }
      else {
        if (!(ws.state(item) & STATE.Subscribed)) await withTimeout(ws.subscribe(item), 20_000, 'subscribe');
        ws.download(item, true);
        const started = Date.now();
        for (;;) {
          const s = ws.state(item);
          const busy = s & (STATE.NeedsUpdate | STATE.Downloading | STATE.DownloadPending);
          if (s & STATE.Installed && !busy) break;
          if (Date.now() - started > 10 * 60_000) throw new Error('download timed out after 10 minutes');
          await sleep(1000);
        }
        const info = ws.installInfo(item);
        out({ id, ok: true, folder: info && info.folder, timestamp: info && info.timestamp });
        continue;
      }
      out({ id, ok: true });
    } catch (err) {
      out({ id, ok: false, error: String((err && err.message) || err) });
    }
  }
  setTimeout(() => process.exit(0), 50);
})();

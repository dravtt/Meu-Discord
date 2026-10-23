import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { initRealtime } from './realtime.js';

await migrate();
const httpServer = createServer(createApp());
initRealtime(httpServer);
httpServer.listen(config.port, () => console.log(`Voka API em http://localhost:${config.port}`));

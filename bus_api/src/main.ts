import { createApp } from './app.bootstrap.js';

const app = await createApp();
await app.listen(process.env.PORT ?? 3000);

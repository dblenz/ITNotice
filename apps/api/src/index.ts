import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { migrate } from './db.js';
import { startDispatcher } from './dispatch.js';
import { startSyncInterval } from './sync.js';
import router from './routes.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: corsOrigin.split(',').map((origin) => origin.trim()) }));
app.use(express.json({ limit: '256kb' }));
app.use(router);

// Central error handler.
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error', error);
  res.status(500).json({ message: 'Internal server error.' });
});

async function main() {
  await migrate();
  await startDispatcher();
  startSyncInterval();

  app.listen(port, () => {
    console.log(`ITNotice API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start API', error);
  process.exit(1);
});

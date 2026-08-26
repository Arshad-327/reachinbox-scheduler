import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerShutdownHandlers } from './lib/shutdown.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.routes.js';
import { campaignRouter } from './routes/campaign.routes.js';
import { emailRouter } from './routes/email.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import { systemRouter } from './routes/system.routes.js';

const app = express();

// Order matters: correlation id first so every downstream log line has it.
app.use(requestId);
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

// Public, deliberately outside auth so infra probes never need a token.
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api/emails', emailRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/system', systemRouter);

// NOTE: the API deliberately does NOT run boot reconciliation. The worker owns
// the queue; it is the only process that repairs it. If both reconciled, two
// processes would scan and re-add the same rows concurrently. The jobId dedupe
// would probably absorb it, but leaning on that instead of having one clear
// owner is exactly the kind of thing that breaks when a second API replica is
// added. One writer, by design.

// Terminal handlers, always last.
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `API listening on http://localhost:${env.PORT}`,
  );
});

registerShutdownHandlers({ name: 'api', server });

export { app };

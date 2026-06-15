import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env.server') });
// Also load .env.local (non-overriding) so the NVIDIA key for the AI analyst is available
loadEnv({ path: join(__dirname, '..', '.env.local') });

import express from 'express';
import cors from 'cors';

import kpisRouter from './routes/kpis.js';
import salesRouter from './routes/sales.js';
import customersRouter from './routes/customers.js';
import movementsRouter from './routes/movements.js';
import analyticsRouter from './routes/analytics.js';
import anomalyRouter from './routes/anomaly.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: 'BusyFY2026', ts: new Date().toISOString() });
});

app.use('/api/kpis', kpisRouter);
app.use('/api/sales', salesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/movements', movementsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/anomaly', anomalyRouter);

app.listen(PORT, () => {
  console.log(`[server] BUSY API running on http://localhost:${PORT}`);
});

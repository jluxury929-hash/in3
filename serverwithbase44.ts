import express, { Application, Request, Response } from 'express';
import { Server } from 'http';
import { base44Connector } from '../index';
import logger from '../utils/logger';
import { config } from '../config';
import mevRouter from './mev'; // Import the MEV router

class ApiServer {
    private app: Application;
    private server: Server | null = null;

    constructor() {
        this.app = express();
        // Allow cross-origin requests for easier development (optional but helpful)
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
        this.app.use(express.json());
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // --- 1. System Health Check ---
        this.app.get('/health', (req: Request, res: Response) => {
            // A simplified check; the actual Base44 status check is done on application startup in index.ts
            res.status(200).send({ 
                status: 'ok', 
                base44Status: 'initialized',
                mevStatus: 'check /mev/status'
            });
        });

        // --- 2. Trading API (Base44 Integration) ---
        this.app.post('/trade', async (req: Request, res: Response) => {
            try {
                // Execute a trade through the Base44 connector
                const tradeResult = await base44Connector.executeTrade(req.body);
                res.status(200).json(tradeResult);
            } catch (error) {
                logger.error('Trade execution error:', error);
                res.status(500).json({ success: false, message: 'Trade failed' });
            }
        });
        
        // --- 3. MEV API Router Integration ---
        // All MEV-related endpoints will now be accessible under /mev
        this.app.use('/mev', mevRouter);
        logger.info('MEV Router mounted at /mev');
    }

    public start(): void {
        const port = config.server.port;
        this.server = this.app.listen(port, () => {
            logger.info(`API Server listening on port ${port}`);
        });
    }

    public stop(): void {
        if (this.server) {
            this.server.close(() => {
                logger.info('API Server gracefully stopped.');
            });
        }
    }
}

export const apiServerWithBase44 = new ApiServer();

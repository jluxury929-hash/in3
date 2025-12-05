import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Server as WebSocketServer } from 'ws';
import { config } from '../config';
import { tradingEngine } from '../engine/tradingEngine';
import { strategyRegistry } from '../strategies/strategyRegistry';
import { priceFeedAggregator } from '../market/priceFeeds';
import { flashLoanEngine } from '../flashloan/flashLoanEngine';
import { walletManager } from '../blockchain/wallet';
import { blockchainProvider } from '../blockchain/provider';
import logger from '../utils/logger';
import mevRouter from './mev'; // Import the MEV router

export class APIServer {
    private app: express.Application;
    private wsServer: WebSocketServer | null = null;
    private wsClients: Set<any> = new Set();

    constructor() {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.setupEventListeners();
    }

    private setupMiddleware(): void {
        this.app.use(helmet());
        // Configure CORS to allow all origins for development ease
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));
        this.app.use(compression());
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        this.app.use((req: Request, res: Response, next: NextFunction) => {
            logger.info(`${req.method} ${req.path}`);
            next();
        });
    }

    private setupRoutes(): void {
        // --- System Routes ---
        // Health check
        this.app.get('/health', (req: Request, res: Response) => {
            res.json({
                status: 'ok',
                timestamp: Date.now(),
                uptime: process.uptime()
            });
        });

        // System status
        this.app.get('/api/status', async (req: Request, res: Response) => {
            try {
                const status = tradingEngine.getSystemStatus();
                const balances = await walletManager.getAllBalances();
                
                res.json({
                    ...status,
                    balances,
                    providerHealth: blockchainProvider.getHealthStatus()
                });
            } catch (error) {
                logger.error('Error getting status:', error);
                res.status(500).json({ error: 'Failed to get status' });
            }
        });

        // --- Engine Control Routes ---
        // Start trading engine
        this.app.post('/api/start', async (req: Request, res: Response) => {
            try {
                if (tradingEngine.isEngineRunning()) {
                    return res.status(400).json({ error: 'Engine already running' });
                }

                await tradingEngine.start();
                flashLoanEngine.startScanning();

                res.json({
                    success: true,
                    message: 'Trading engine started',
                    timestamp: Date.now()
                });
            } catch (error) {
                logger.error('Error starting engine:', error);
                res.status(500).json({ error: 'Failed to start engine' });
            }
        });

        // Start UHF engine
        this.app.post('/api/start-uhf', async (req: Request, res: Response) => {
            try {
                // Dynamic import to avoid circular dependency or initial load issues
                const { ultraHighFrequencyEngine } = await import('../engine/ultraHighFrequencyEngine');
                const { autoWithdrawSystem } = await import('../profit/autoWithdraw');

                await ultraHighFrequencyEngine.start();
                autoWithdrawSystem.start(60);

                res.json({
                    success: true,
                    message: 'Ultra-high-frequency engine started',
                    timestamp: Date.now()
                });
            } catch (error) {
                logger.error('Error starting UHF engine:', error);
                res.status(500).json({ error: 'Failed to start UHF engine' });
            }
        });

        // Stop trading engine
        this.app.post('/api/stop', async (req: Request, res: Response) => {
            try {
                if (!tradingEngine.isEngineRunning()) {
                    return res.status(400).json({ error: 'Engine not running' });
                }

                await tradingEngine.stop();
                flashLoanEngine.stopScanning();

                res.json({
                    success: true,
                    message: 'Trading engine stopped',
                    timestamp: Date.now()
                });
            } catch (error) {
                logger.error('Error stopping engine:', error);
                res.status(500).json({ error: 'Failed to stop engine' });
            }
        });

        // --- Data/Metrics Routes ---
        // Get metrics
        this.app.get('/api/metrics', (req: Request, res: Response) => {
            try {
                const metrics = tradingEngine.getPerformanceMetrics();
                res.json(metrics);
            } catch (error) {
                logger.error('Error getting metrics:', error);
                res.status(500).json({ error: 'Failed to get metrics' });
            }
        });

        // Get strategies
        this.app.get('/api/strategies', (req: Request, res: Response) => {
            try {
                const { type, risk, active } = req.query;
                
                let strategies = strategyRegistry.getAllStrategies();

                if (type) {
                    strategies = strategies.filter(s => s.type === type);
                }

                if (risk) {
                    strategies = strategies.filter(s => s.riskLevel === risk);
                }

                if (active === 'true') {
                    strategies = strategies.filter(s => s.enabled);
                }

                res.json({
                    total: strategies.length,
                    strategies: strategies.map(s => ({
                        id: s.id,
                        name: s.name,
                        type: s.type,
                        riskLevel: s.riskLevel,
                        enabled: s.enabled,
                        priority: s.priority,
                        successRate: s.successRate,
                        totalTrades: s.totalTrades,
                        totalProfitUSD: s.totalProfitUSD
                    }))
                });
            } catch (error) {
                logger.error('Error getting strategies:', error);
                res.status(500).json({ error: 'Failed to get strategies' });
            }
        });

        // Get prices
        this.app.get('/api/prices', (req: Request, res: Response) => {
            try {
                const { token, source } = req.query;

                if (token) {
                    const price = priceFeedAggregator.getPrice(token as string, source as string);
                    return res.json(price);
                }

                const allPrices = priceFeedAggregator.getAllPrices();
                const pricesArray = Array.from(allPrices.values());

                res.json({
                    total: pricesArray.length,
                    prices: pricesArray
                });
            } catch (error) {
                logger.error('Error getting prices:', error);
                res.status(500).json({ error: 'Failed to get prices' });
            }
        });

        // Get flash loan opportunities
        this.app.get('/api/flashloans', (req: Request, res: Response) => {
            try {
                const opportunities = flashLoanEngine.getOpportunities();
                const best = flashLoanEngine.getBestOpportunity();
                const stats = flashLoanEngine.getStatistics();

                res.json({
                    total: opportunities.length,
                    opportunities,
                    best,
                    statistics: stats
                });
            } catch (error) {
                logger.error('Error getting flash loan opportunities:', error);
                res.status(500).json({ error: 'Failed to get flash loan opportunities' });
            }
        });

        // --- Wallet/Fund Routes ---
        // Get wallet balance
        this.app.get('/api/wallet/balance', async (req: Request, res: Response) => {
            try {
                const balances = await walletManager.getAllBalances();
                
                res.json({
                    address: walletManager.getAddress(),
                    balances
                });
            } catch (error) {
                logger.error('Error getting balance:', error);
                res.status(500).json({ error: 'Failed to get balance' });
            }
        });

        // Get fund stats
        this.app.get('/api/funds/stats', async (req: Request, res: Response) => {
            try {
                const { fundManager } = await import('../profit/fundManager');
                const stats = fundManager.getStatistics();
                res.json(stats);
            } catch (error) {
                logger.error('Error getting fund stats:', error);
                res.status(500).json({ error: 'Failed to get fund stats' });
            }
        });

        // Withdraw all profits
        this.app.post('/api/withdraw-all', async (req: Request, res: Response) => {
            try {
                const { autoWithdrawSystem } = await import('../profit/autoWithdraw');
                await autoWithdrawSystem.withdrawAll();
                res.json({
                    success: true,
                    message: 'All profits withdrawn'
                });
            } catch (error) {
                logger.error('Error withdrawing all:', error);
                res.status(500).json({ error: 'Failed to withdraw all' });
            }
        });
        
        // --- MEV Router Integration ---
        // Integrate the MEV specific endpoints under /api/mev
        this.app.use('/api/mev', mevRouter);
        logger.info('MEV Router mounted at /api/mev');


        // --- Global Error Handler ---
        this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
            logger.error('Unhandled error:', err);
            res.status(500).json({
                error: 'Internal server error',
                message: err.message
            });
        });
    }

    private setupWebSocket(): void {
        this.wsServer = new WebSocketServer({ port: config.server.wsPort });

        this.wsServer.on('connection', (ws) => {
            logger.info('WebSocket client connected');
            this.wsClients.add(ws);

            ws.on('close', () => {
                logger.info('WebSocket client disconnected');
                this.wsClients.delete(ws);
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error:', error);
                // Clean up client on error
                this.wsClients.delete(ws);
            });
        });

        this.wsServer.on('listening', () => {
            logger.info(`WebSocket Server listening on port ${config.server.wsPort}`);
        });

        this.wsServer.on('error', (error) => {
            logger.error('WebSocket Server startup error:', error);
        });
    }

    private setupEventListeners(): void {
        // Event listeners to push real-time data to connected clients
        tradingEngine.on('performance_update', (metrics) => {
            this.broadcast({
                type: 'performance',
                data: metrics
            });
        });

        // Add an event listener for trading activity
        tradingEngine.on('trade_executed', (trade) => {
            this.broadcast({
                type: 'trade',
                data: trade
            });
        });

        // Add an event listener for new flash loan opportunities
        flashLoanEngine.on('new_opportunity', (opportunity) => {
            this.broadcast({
                type: 'flashloan_opportunity',
                data: opportunity
            });
        });
    }

    private broadcast(message: any): void {
        const data = JSON.stringify(message);
        
        this.wsClients.forEach((client: any) => {
            // Check if connection is open (readyState === 1)
            if (client.readyState === 1) {
                try {
                    client.send(data);
                } catch (error) {
                    logger.error('Error broadcasting to client:', error);
                }
            }
        });
    }

    public start(): void {
        this.app.listen(config.server.port, () => {
            logger.info(`API Server started on port ${config.server.port}`);
            logger.info(`Environment: ${config.server.environment}`);
        });
    }

    public stop(): void {
        if (this.wsServer) {
            this.wsServer.close();
            logger.info('WebSocket server stopped');
        }
        // Graceful shutdown of the HTTP server (if it was stored) is typically handled 
        // by the process manager (like the index.ts setupGracefulShutdown function),
        // but adding a hook here is good practice if possible.
        logger.info('API Server shutdown initiated.');
    }
}

export const apiServer = new APIServer();

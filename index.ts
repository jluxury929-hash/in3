import { apiServerWithBase44 } from './api/serverWithBase44';
import { config } from './config';
import logger from './utils/logger';
import { FlashbotsMEVExecutor } from './mev/flashbots';
import axios from 'axios';
import { ethers } from 'ethers'; // Import ethers for types and utilities

// ---------------- Base44 Connector ----------------
class Base44Connector {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.BASE44_API_KEY || 'demo-key';
    this.baseURL = process.env.BASE44_API_URL || 'https://api.base44.com/v1';
  }

  async connect(): Promise<boolean> {
    try {
      await axios.get(`${this.baseURL}/health`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      logger.info('Base44 connected successfully');
      return true;
    } catch (error) {
      // Added error logging for debugging
      logger.warn('Base44 connection failed - using demo mode', { error: error });
      return false;
    }
  }

  async getMarketData(token: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseURL}/market/${token}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error) {
      // Added error logging for debugging
      logger.warn(`Base44 market data unavailable for ${token} - using simulated data`, { error: error });
      return {
        token,
        price: Math.random() * 1000,
        volume: Math.random() * 1000000,
        change24h: (Math.random() - 0.5) * 10,
      };
    }
  }

  async executeTrade(params: {
    token: string;
    amount: string;
    side: 'buy' | 'sell';
    price?: string;
  }): Promise<any> {
    try {
      const response = await axios.post(`${this.baseURL}/trade`, params, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      logger.info(`Trade executed: ${params.side} ${params.amount} ${params.token}`);
      return response.data;
    } catch (error) {
      // Added error logging for debugging
      logger.warn('Base44 trade failed - simulating trade execution', { error: error });
      return {
        success: true,
        orderId: `demo_${Date.now()}`,
        executedPrice: params.price || Math.random() * 1000,
        executedAmount: params.amount,
        status: 'filled',
      };
    }
  }
}

export const base44Connector = new Base44Connector();

// ---------------- Flashbots MEV Integration ----------------
export let flashbotsExecutor: FlashbotsMEVExecutor | null = null;

const MEV_SCAN_INTERVAL = 5000; // 5 seconds

/**
 * Recursive function to continuously scan for MEV opportunities.
 */
async function mevScanLoop() {
  if (!flashbotsExecutor) {
    // Stop if the executor hasn't been initialized
    return;
  }

  try {
    const opportunities = await flashbotsExecutor.scanMEVOpportunities();
   
    if (opportunities.length > 0) {
      logger.info(`Found ${opportunities.length} MEV opportunities.`);

      // Focus on the first opportunity found
      const firstOpportunity = opportunities[0];
     
      if (firstOpportunity.type === 'sandwich') {
          const profit = firstOpportunity.profit;
          logger.info(`Attempting sandwich execution for Target Tx with calculated profit ${profit} ETH.`);

          // The MEV executor creates the two front-run and back-run transactions
          // The opportunity object contains all necessary data, including the target transaction.
          const bundleRequest = await flashbotsExecutor.createSandwichBundle(firstOpportunity);

          if (bundleRequest) {
              // Execute the bundle (sends it to the Flashbots relay)
              const success = await flashbotsExecutor.executeBundle(bundleRequest);
              if (success) {
                  logger.info(`MEV Bundle submitted and included successfully for profit: ${profit} ETH!`);
              } else {
                  logger.warn('MEV Bundle submission failed after simulation/execution.');
              }
          } else {
              logger.warn('Failed to create sandwich bundle.');
          }
      }
    }
  } catch (error) {
    logger.error('Error during MEV scan loop:', error);
    // Continue loop even if one scan fails
  }

  // Schedule the next run after the interval
  setTimeout(mevScanLoop, MEV_SCAN_INTERVAL);
}

async function initializeFlashbots() {
  try {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    // NOTE: In a real-world scenario, you MUST use a private RPC that supports eth_call and has a high rate limit.
    const rpcUrl = process.env.ETHEREUM_RPC_1 || 'https://eth-mainnet.g.alchemy.com/v2/demo';

    if (privateKey && privateKey !== 'your_private_key_here') {
      flashbotsExecutor = new FlashbotsMEVExecutor(rpcUrl, privateKey);
      await flashbotsExecutor.initializeFlashbots();
      logger.info('Flashbots MEV executor initialized');

      // Start the recursive scanning loop
      mevScanLoop();
    } else {
      logger.warn('Flashbots MEV disabled - no valid private key provided. Set WALLET_PRIVATE_KEY.');
    }
  } catch (error) {
    logger.error('Failed to initialize Flashbots MEV:', error);
  }
}

// ---------------- Graceful shutdown ----------------
function setupGracefulShutdown(stopFn: () => void) {
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    stopFn();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    stopFn();
    process.exit(0);
  });
}

setupGracefulShutdown(() => apiServerWithBase44.stop());

// ---------------- Start Application ----------------
async function startApp() {
  try {
    logger.info('Starting Massive Trading Engine...');

    // Connect to Base44
    const base44Connected = await base44Connector.connect();
    if (!base44Connected) {
      logger.warn('Base44 connection failed, continuing with limited functionality');
    }

    // Initialize Flashbots MEV
    await initializeFlashbots();

    // Start API server with Base44
    apiServerWithBase44.start();

    logger.info('Massive Trading Engine started successfully!');
    logger.info(`API Server: http://localhost:${config.server.port}`);
    logger.info(`WebSocket Server: ws://localhost:${config.server.wsPort}`);
    logger.info(`Environment: ${config.server.environment}`);
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

startApp();

import { Router } from 'express';
import { flashbotsExecutor } from '../index';
import logger from '../utils/logger';

const router = Router();

// Get MEV opportunities
router.get('/opportunities', async (req, res) => {
  try {
    if (!flashbotsExecutor) {
      return res.status(503).json({
        success: false,
        error: 'Flashbots MEV executor not available'
      });
    }

    const opportunities = await flashbotsExecutor.scanMEVOpportunities();
    res.json({
      success: true,
      data: opportunities,
      count: opportunities.length
    });
  } catch (error) {
    logger.error('MEV opportunities endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to scan MEV opportunities'
    });
  }
});

// Create sandwich bundle from a selected opportunity
router.post('/sandwich', async (req, res) => {
  try {
    // The createSandwichBundle function now expects a single MEVOpportunity object
    const opportunity = req.body; 
    
    if (!flashbotsExecutor) {
      return res.status(503).json({
        success: false,
        error: 'Flashbots MEV executor not available'
      });
    }

    // Validate the incoming opportunity structure
    if (!opportunity || !opportunity.profit || !opportunity.transactions || opportunity.transactions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'A valid MEV Opportunity object (with profit and transactions) is required'
      });
    }

    // Pass the entire opportunity object
    const bundle = await flashbotsExecutor.createSandwichBundle(opportunity);
    
    if (!bundle) {
      return res.status(400).json({
        success: false,
        error: 'Failed to create sandwich bundle (Opportunity may be invalid or unprofitable)'
      });
    }

    res.json({
      success: true,
      data: bundle
    });
  } catch (error) {
    logger.error('Sandwich bundle endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create sandwich bundle'
    });
  }
});

// Execute bundle
router.post('/execute', async (req, res) => {
  try {
    const { transactions, blockNumber } = req.body;
    
    if (!flashbotsExecutor) {
      return res.status(503).json({
        success: false,
        error: 'Flashbots MEV executor not available'
      });
    }

    const success = await flashbotsExecutor.executeBundle({
      transactions, // Array of signed transaction strings
      blockNumber
    });

    res.json({
      success,
      message: success ? 'Bundle executed successfully' : 'Bundle execution failed'
    });
  } catch (error) {
    logger.error('Bundle execution endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute bundle'
    });
  }
});

// Get bundle stats
router.get('/bundle/:bundleHash/stats', async (req, res) => {
  try {
    const { bundleHash } = req.params;
    
    if (!flashbotsExecutor) {
      return res.status(503).json({
        success: false,
        error: 'Flashbots MEV executor not available'
      });
    }

    const stats = await flashbotsExecutor.getBundleStats(bundleHash);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Bundle stats endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bundle stats'
    });
  }
});

// MEV status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      mevEnabled: flashbotsExecutor !== null,
      service: 'Flashbots MEV',
      version: '1.0.0'
    }
  });
});

export default router;

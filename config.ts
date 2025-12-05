// Define configuration settings for the Massive Trading Engine.
export const config = {
    // ---------------- API Server Configuration ----------------
    server: {
        port: 8080,
        wsPort: 8081,
        // Environment variable for production/development mode
        environment: process.env.NODE_ENV || 'development'
    },

    // ---------------- Ethereum Network Configuration ----------------
    ethereum: {
        // Main RPC URL for block monitoring and general reads
        rpcUrl: process.env.ETHEREUM_RPC_1 || 'http://localhost:8545',
    },

    // ---------------- MEV/Flashbots Configuration ----------------
    flashbots: {
        // Official Flashbots relay endpoint
        relayUrl: process.env.FLASHBOTS_RELAY || 'https://relay.flashbots.net',
        // Minimum profit (in ETH) required for the engine to submit a bundle
        minProfitThreshold: 0.001 
    }
};

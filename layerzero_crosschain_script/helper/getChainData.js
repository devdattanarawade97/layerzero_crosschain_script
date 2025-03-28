// --- Helper Functions ---

// Ensure this file maps network names to LayerZero Endpoint IDs (eid) and RPC URLs
const lzEndpoints = require("../lz_config/lz_endpoints.json");
// Function to get the LayerZero endpoint ID (eid) & RPC for a given network name


  function getChainData(network) {
    // Assuming lz_endpoints.json looks like: [{ "network": "sepolia", "eid": 40161, "rpcUrl": "..." }, ...]
    const networkData = lzEndpoints.find(n => n.network.toLowerCase() === network.toLowerCase());
    if (!networkData) {
        throw new Error(`Network ${network} not found in lz_endpoints.json`);
    }
    if (!networkData.eid || !networkData.rpcUrl) {
        throw new Error(`Network ${network} data in lz_endpoints.json is missing 'eid' or 'rpcUrl'`);
    }
    return networkData;
}


module.exports={getChainData}
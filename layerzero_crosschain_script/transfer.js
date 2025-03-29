const ethers = require("ethers");
const fs = require("fs");
require("dotenv").config();
const { Options } = require('@layerzerolabs/lz-v2-utilities');
const { getChainData } = require('./helper/getChainData'); // Assuming this function works correctly

// --- Configuration Loading ---
// Function to load config safely
function loadConfig(network, type) {
    // type should be 'Adapter' or 'Tokens'
    // network should be e.g., 'holesky', 'amoy'
    const path = `./abis/${type}/${network}_${type === 'Adapter' ? 'Adapter' : 'My_Token'}_ABI.json`; // Construct path dynamically
    try {
        if (fs.existsSync(path)) {
            const config = require(path);
            if (!config.address || !config.abi) {
                throw new Error(`Missing address or abi in ${path}`);
            }
            // Add decimals if it's a token config and exists
            if (type === 'Tokens' && config.decimals !== undefined) {
                 return { ...config, decimals: config.decimals };
             }
            return config;
        } else {
            throw new Error(`Config file not found at ${path}`);
        }
    } catch (error) {
        console.error(`Error loading config from ${path}: ${error.message}`);
        // Return null or throw, depending on how you want to handle missing configs
        // Throwing is safer to prevent running with invalid setup.
        throw error; // Re-throw to stop execution if essential config is missing
    }
}

// --- Wallet Configuration ---
if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env file. Please ensure it is set.");
}

// --- Main Transfer Logic ---
async function initiateOftTransfer(srcNetwork, destNetwork, destAddress, tokenAmountString) {
    try {
        console.log(`\n--- Initiating OFT Adapter Transfer ---`);
        console.log(`🌍 Source Network: ${srcNetwork}`);
        console.log(`🚀 Destination Network: ${destNetwork}`);
        console.log(`📬 Destination Address: ${destAddress}`);
        console.log(`🔢 Amount: ${tokenAmountString}`);

        // 1. Get Network & Contract Details
        const srcData = getChainData(srcNetwork);
        const destData = getChainData(destNetwork);
        const sourceEid = srcData.eid;
        const destinationEid = destData.eid;

        // Load configs dynamically and safely
        const sourceAdapterConfig = loadConfig(srcNetwork, 'Adapter');
        const destinationAdapterConfig = loadConfig(destNetwork, 'Adapter');
        const sourceTokenConfig = loadConfig(srcNetwork, 'Tokens');
        const destinationTokenConfig = loadConfig(destNetwork, 'Tokens');
        const { address: sourceAdapterAddress, abi: sourceAdapterAbi } = sourceAdapterConfig;
        const { address: destinationAdapterAddress } = destinationAdapterConfig; // Only need address for peer setting/checking here
        const { address: sourceTokenAddress, abi: sourceTokenAbi } = sourceTokenConfig;
        const { address: destinationTokenAddress, abi: destinationTokenAbi } = destinationTokenConfig;
        console.log(`\n🔗 Using Source OFT Adapter: ${sourceAdapterAddress} on ${srcNetwork}`);
        console.log(`🪙 Source Underlying Token: ${sourceTokenAddress}`);
        console.log(`🎯 Destination LayerZero EID: ${destinationEid}`);
        console.log(`🔗 Target Destination OFT Adapter: ${destinationAdapterAddress}`);

        // 2. Setup Provider & Wallet
        const provider = new ethers.JsonRpcProvider(srcData.rpcUrl);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const sourceAdapterContract = new ethers.Contract(sourceAdapterAddress, sourceAdapterAbi, wallet);
        console.log(`👤 Sender Address: ${wallet.address}`);

        // 3. Get Token Decimals & Format Amount
        let decimals;
        try {
            decimals = await sourceAdapterContract.decimals();
            console.log(`🪙 Token Decimals (from Adapter): ${decimals}`);
        } catch (e) {
            console.error(`❌ Failed to get decimals from Adapter: ${e.message}. Trying underlying token...`);
            try {
                const underlyingTokenContract = new ethers.Contract(sourceTokenAddress, sourceTokenAbi, provider);
                decimals = await underlyingTokenContract.decimals();
                console.log(`🪙 Token Decimals (from Token): ${decimals}`);
            } catch (e2) {
                const fallbackDecimals = 18n; // Use BigInt
                console.error(`❌ Failed to get decimals from underlying token. Assuming ${fallbackDecimals}. Error: ${e2.message}`);
                decimals = fallbackDecimals;
            }
        }

        const amountLD = ethers.parseUnits(tokenAmountString, decimals);
        console.log(`🔢 Amount in Local Decimals (amountLD): ${amountLD.toString()}`);

        // 4. Approve Token Spend
        console.log(`\n🛡️ Approving Source Adapter (${sourceAdapterAddress}) to spend ${tokenAmountString} of Token (${sourceTokenAddress})...`);
        const underlyingTokenContract = new ethers.Contract(sourceTokenAddress, sourceTokenAbi, wallet);
        try {
            const existingAllowance = await underlyingTokenContract.allowance(wallet.address, sourceAdapterAddress);
            if (existingAllowance < amountLD) {
                 console.log(`⏳ Current allowance ${existingAllowance.toString()} is less than ${amountLD.toString()}. Approving...`);
                 const approveTx = await underlyingTokenContract.approve(sourceAdapterAddress, amountLD);
                 console.log(`📜 Approval Tx Hash: ${approveTx.hash}`);
                 await approveTx.wait();
                 console.log(`✅ Approval successful!`);
             } else {
                 console.log(`✅ Allowance sufficient: ${existingAllowance.toString()}`);
             }
        } catch (error) {
            console.error(`❌ Approval failed: ${error.message}`);
            throw new Error("Approval failed, cannot proceed.");
        }

        // 5. Set Peer (Optional - Recommended as separate setup)
        // Requires PRIVATE_KEY to be owner of BOTH Adapters
        try {
            const peerBytes32Source = ethers.zeroPadValue(sourceAdapterAddress, 32);
            const peerBytes32Destination = ethers.zeroPadValue(destinationAdapterAddress, 32);

            console.log(`\nℹ️ Checking/Setting Peers...`);

            // Check/Set Peer on Source Adapter
            let needsSourceUpdate = true;
            try {
                const currentPeer = await sourceAdapterContract.peers(destinationEid);
                if (currentPeer.toLowerCase() === peerBytes32Destination.toLowerCase()) {
                    console.log(`✅ Peer already set on Source Adapter for Dest EID ${destinationEid}.`);
                    needsSourceUpdate = false;
                }
            } catch (viewError) { /* Assume update needed */ }

             if (needsSourceUpdate) {
                 console.log(`⏳ Attempting to set peer on SOURCE Adapter (${sourceAdapterAddress})...`);
                 const setPeerTx = await sourceAdapterContract.setPeer(destinationEid, peerBytes32Destination);
                 await setPeerTx.wait();
                 console.log(`✅ Peer set on Source Adapter! Hash: ${setPeerTx.hash}`);
             }

             // Check/Set Peer on Destination Adapter
             let needsDestUpdate = true;
             let destinationAdapterContractInstance; // Define higher for potential use in setPeer
             const destProvider = new ethers.JsonRpcProvider(destData.rpcUrl);
             const destWallet = new ethers.Wallet(process.env.PRIVATE_KEY, destProvider);
             // Use destination config loaded earlier
             destinationAdapterContractInstance = new ethers.Contract(destinationAdapterAddress, destinationAdapterConfig.abi, destWallet);

             try {
                 const currentPeer = await destinationAdapterContractInstance.peers(sourceEid);
                 if (currentPeer.toLowerCase() === peerBytes32Source.toLowerCase()) {
                     console.log(`✅ Peer already set on Destination Adapter for Source EID ${sourceEid}.`);
                     needsDestUpdate = false;
                 }
             } catch (viewError) { /* Assume update needed */ }

             if (needsDestUpdate) {
                console.log(`⏳ Attempting to set peer on DESTINATION Adapter (${destinationAdapterAddress})...`);
                // destinationAdapterContractInstance is already created and connected to destWallet
                const setPeerTx = await destinationAdapterContractInstance.setPeer(sourceEid, peerBytes32Source);
                await setPeerTx.wait();
                console.log(`✅ Peer set on Destination Adapter! Hash: ${setPeerTx.hash}`);
             }
         } catch (error) {
             console.error(`❌ Failed during peer configuration: ${error.message}`);
             console.warn("Proceeding, but transfer might fail if peers are not correctly set.");
             // Optionally throw error here if peer setting is mandatory for the script run
         }

        // 6. Prepare Send Parameters
        console.log(`\n📦 Preparing Send Parameters...`);
        let optionsBuilder = Options.newOptions();
        const executorGas = 350000; // TUNABLE: Start around 300k-500k for Adapter
        console.log(`   - Setting Executor Gas Option: ${executorGas}`);
        optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(executorGas, 0);
        const options = optionsBuilder.toBytes();
        const receiverBytesAddressZeroPad = ethers.zeroPadValue(destAddress, 32);

        const sendParam = {
            dstEid: destinationEid,
            to: receiverBytesAddressZeroPad,
            amountLD: amountLD,
            minAmountLD: amountLD,
            extraOptions: options,
            composeMsg: '0x',
            oftCmd: '0x',
        };

        // 7. Estimate LayerZero Fees
        console.log(`\n💰 Estimating LayerZero fees using 'quoteSend'...`);
        let nativeFee, lzTokenFee;
        try {
            const fees = await sourceAdapterContract.quoteSend(sendParam, false);
            nativeFee = fees.nativeFee;
            lzTokenFee = fees.lzTokenFee;
            console.log(`   ✅ Fee estimation successful.`);
            console.log(`   💰 Estimated Native Fee (wei): ${nativeFee.toString()} (${ethers.formatEther(nativeFee)} Ether)`);
        } catch (quoteError) {
            console.error(`❌ Fee estimation failed: ${quoteError.message}`);
            throw new Error("Fee estimation failed, cannot proceed.");
        }
        
        // 8. Precondition Checks & Send Transaction
        console.log("\n🔍 Verifying Preconditions for send...");
        let preCheckOk = true;
        try {
            const allowance = await underlyingTokenContract.allowance(wallet.address, sourceAdapterAddress);
            const balance = await underlyingTokenContract.balanceOf(wallet.address);
            //mint some tokens using underlying token contract of destination to adapter 
            const destinationProvider = new ethers.JsonRpcProvider(destData.rpcUrl);
            const destinationWallet = new ethers.Wallet(process.env.PRIVATE_KEY, destinationProvider);
            const destinationUnderlyingTokenContract = new ethers.Contract(destinationTokenAddress, destinationTokenAbi, destinationWallet);
            const amountToMint = ethers.parseUnits("100000", 18);
            const mint = await destinationUnderlyingTokenContract.mint(destinationAdapterAddress, amountToMint);
            console.log("   ✅ amount minted successfully for adapter: ", amountToMint)
            console.log(`   - Amount to Send (amountLD): ${sendParam.amountLD.toString()}`);
            console.log(`   - Underlying Token Allowance: ${allowance.toString()}`);
            console.log(`   - Underlying Token Balance:   ${balance.toString()}`);
            if (allowance < sendParam.amountLD) { console.error("   🚨 Allowance insufficient!"); preCheckOk = false; }
            if (balance < sendParam.amountLD) { console.error("   🚨 Balance insufficient!"); preCheckOk = false; }

            const peerCheck = await sourceAdapterContract.peers(sendParam.dstEid);
            const expectedPeerBytes32 = ethers.zeroPadValue(destinationAdapterAddress, 32);
            if (peerCheck.toLowerCase() !== expectedPeerBytes32.toLowerCase()) {
                 console.error("   🚨 Peer configuration incorrect!"); preCheckOk = false;
             }
             if (preCheckOk) console.log("   ✅ Preconditions look OK.");
        } catch (preCheckError) {
            console.error("   ⚠️ Error during precondition checks:", preCheckError.message);
            preCheckOk = false;
        }

        if (!preCheckOk) {
            throw new Error("Precondition checks failed. Aborting send.");
        }

        console.log(`\n🚀 Sending transaction via OFT Adapter 'send' function...`);
        const messagingFee = { nativeFee, lzTokenFee };
        const refundAddress = wallet.address;
        const tx = await sourceAdapterContract.send(
            sendParam, messagingFee, refundAddress, { value: nativeFee }
        );
        console.log(`📜 Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ OFT Adapter Transfer initiated successfully! Block: ${receipt.blockNumber}`);
        console.log(`🔗 Track on LayerZero Scan (replace domain if needed): https://layerzeroscan.com/tx/${tx.hash}`);

    } catch (error) {
        console.error(`\n🚨🚨🚨 Error during transfer initiation: ${error.message}`);
        // Log detailed revert reason if available
        if (error.data && typeof error.data === 'string' && error.message.includes('execution reverted')) {
             console.error("   Possible Revert Data:", error.data);
             // Add specific contract interface parsing here if needed and possible
         }
         console.error("   Stack:", error.stack); // Log stack for debugging
         // Ensure the script exits with an error code if something fails critically
         process.exitCode = 1;
    }
}

// --- Listener Logic (Corrected for OFT Adapter & Dynamic Config) ---
// --- Listener Logic (Using WebSocketProvider) ---
async function receiveTransferListener(listeningNetwork, expectedSourceNetwork) {
    let provider = null; // Define provider outside try block for potential cleanup
    let underlyingTokenContract = null;

    // Define the listener callback function separately for easier add/remove
    const handleTransferEvent = (from, to, value, event) => {
        // Filter: We expect the transfer 'from' the Adapter contract 'to' the final recipient
        // Need listenerAdapterAddress defined in the outer scope or passed in
        if (listenerAdapterConfig && from.toLowerCase() === listenerAdapterConfig.address.toLowerCase()) {
            console.log(`\n🎉✅ Potential OFT Transfer Received!`);
            console.log(`   Network: ${listeningNetwork}`);
            console.log(`   Token: ${event.address}`);
            console.log(`   From (Adapter): ${from}`);
            console.log(`   To (Recipient): ${to}`);
            try {
                const formattedValue = ethers.formatUnits(value, listenerTokenConfig?.decimals ?? 18); // Use loaded decimals or fallback
                console.log(`   Value: ${value.toString()} (raw) / ${formattedValue} (formatted)`);
            } catch (formatError) {
                console.log(`   Value: ${value.toString()} (raw) - Error formatting: ${formatError.message}`);
            }
            console.log(`   Tx Hash: ${event.log.transactionHash}`);
            console.log(`   Block #: ${event.log.blockNumber}`);
            console.log("-----------------------------------------");
            // Add any further actions needed upon receiving funds
        }
        // Optional: Log other transfers for debugging
        // else { console.log(`ℹ️ Non-Adapter Transfer detected: From ${from} To ${to}`); }
    };

    // Define a function to setup or reset the listener
    async function setupListener() {
        try {
            console.log(`\nAttempting to set up listener on ${listeningNetwork}...`);

            // 1. Get Network Data & Load Configs
            const listenerData = getChainData(listeningNetwork);
            // Ensure getChainData returns a wssUrl field for the listening network
            if (!listenerData.wssUrl) {
                 throw new Error(`WebSocket URL (wssUrl) not found for network ${listeningNetwork} in getChainData`);
             }

            // Load configs dynamically
            // Make listenerAdapterConfig and listenerTokenConfig accessible in handleTransferEvent scope
            global.listenerAdapterConfig = loadConfig(listeningNetwork, 'Adapter');
            global.listenerTokenConfig = loadConfig(listeningNetwork, 'Tokens');

            const { address: listenerAdapterAddress } = global.listenerAdapterConfig;
            const { address: listenerTokenAddress, abi: listenerTokenAbi } = global.listenerTokenConfig;

            console.log(`🔗 Listening Adapter Contract: ${listenerAdapterAddress}`);
            console.log(`🪙 Listening Underlying Token: ${listenerTokenAddress}`);

            // 2. Setup WebSocket Provider
            console.log(`🔌 Connecting via WebSocket: ${listenerData.wssUrl}`);
            // Use 'provider' variable defined in the outer scope
            provider = new ethers.WebSocketProvider(listenerData.wssUrl);

            // Optional: Basic connection monitoring
             provider.websocket.on('open', () => {
                 console.log(`✅ WebSocket connection opened for ${listeningNetwork}.`);
             });
             provider.websocket.on('close', (code, reason) => {
                 console.warn(`❌ WebSocket connection closed. Code: ${code}, Reason: ${reason?.toString()}. Attempting reconnect...`);
                 // Simple immediate retry. More robust logic might use backoff.
                 cleanupListener(); // Clean up old listener before retrying
                 setTimeout(setupListener, 5000); // Retry after 5 seconds
             });
             provider.websocket.on('error', (err) => {
                 // This catches errors with the websocket connection itself
                 console.error('❌ WebSocket Error:', err);
                 // Consider attempting reconnect here too
                 // cleanupListener();
                 // setTimeout(setupListener, 10000); // Longer delay after error
             });

            // 3. Create Contract Instance for UNDERLYING TOKEN
            underlyingTokenContract = new ethers.Contract(listenerTokenAddress, listenerTokenAbi, provider);

            // 4. Remove any previous listeners before attaching a new one
            underlyingTokenContract.off("Transfer", handleTransferEvent); // Use the named function

            // 5. Setup Listener on the UNDERLYING TOKEN
            console.log(`🎧 Attaching 'Transfer' event listener on Token ${listenerTokenAddress}...`);
            underlyingTokenContract.on("Transfer", handleTransferEvent); // Use the named function

            console.log(`\n[Listener active on ${listeningNetwork}. Press Ctrl+C to stop.]`);

        } catch (error) {
            console.error(`\n🚨🚨🚨 Error during listener setup on ${listeningNetwork}: ${error.message}`);
            console.error("   Stack:", error.stack);
            console.log("Retrying setup in 15 seconds...");
            cleanupListener(); // Clean up potential partial setup
            setTimeout(setupListener, 15000); // Retry after a delay
        }
    }

    // Function to clean up resources
    function cleanupListener() {
         console.log("🧹 Cleaning up listener resources...");
         if (underlyingTokenContract) {
             try {
                 underlyingTokenContract.off("Transfer", handleTransferEvent);
                 console.log("   - Removed Transfer listener.");
             } catch (e) { console.warn("   - Warn: Error removing listener", e.message); }
         }
         if (provider && provider.websocket) {
             try {
                 provider.websocket.terminate(); // Force close WebSocket
                 console.log("   - Terminated WebSocket connection.");
             } catch (e) { console.warn("   - Warn: Error terminating WebSocket", e.message); }
         }
         provider = null;
         underlyingTokenContract = null;
     }

    // Initial setup call
    await setupListener();

    // Keep the process alive explicitly if needed (often WebSocket auto-keeps alive)
    // await new Promise(() => {}); // Usually not needed with WebSocket, but uncomment if script exits

    // Handle graceful shutdown
    process.on('SIGINT', () => {
         console.log("\nReceived SIGINT (Ctrl+C). Shutting down listener...");
         cleanupListener();
         process.exit(0);
     });
     process.on('SIGTERM', () => {
         console.log("\nReceived SIGTERM. Shutting down listener...");
         cleanupListener();
         process.exit(0);
     });
}


// --- Script Execution Router ---
async function run() {
    const args = process.argv.slice(2);

    // Print Help / Usage
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printUsage();
        process.exit(0);
    }

    // Listener Mode
    if (args[0] === '--listen') {
        if (args.length !== 3) {
            console.error("❌ Invalid arguments for listener mode.");
            printUsage();
            process.exit(1);
        }
        const [, listenNetwork, expectedSourceNetwork] = args;
        console.log(`Starting listener on ${listenNetwork} for transfers expected from ${expectedSourceNetwork}...`);
        // No need to await here unless you want the run() function to wait indefinitely
        receiveTransferListener(listenNetwork, expectedSourceNetwork);
    }
    // Sender Mode (Default)
    else {
        if (args.length !== 4) {
            console.error("❌ Invalid arguments for sending mode.");
            printUsage();
            process.exit(1);
        }
        const [srcNetwork, destNetwork, destAddress, tokenAmountString] = args;
        // Validate address format (basic check)
        if (!ethers.isAddress(destAddress)) {
             console.error(`❌ Invalid destination address format: ${destAddress}`);
             process.exit(1);
         }
         // Validate amount format (basic check)
         if (isNaN(parseFloat(tokenAmountString)) || parseFloat(tokenAmountString) <= 0) {
             console.error(`❌ Invalid or non-positive token amount: ${tokenAmountString}`);
             process.exit(1);
         }

        console.log(`Initiating transfer from ${srcNetwork} to ${destNetwork}...`);
        await initiateOftTransfer(srcNetwork, destNetwork, destAddress, tokenAmountString);
        // The initiateOftTransfer function handles its own errors and sets process.exitCode
    }
}

function printUsage() {
    console.log("\n-----------------------------------------");
    console.log("OFT Adapter Cross-Chain Transfer Script");
    console.log("-----------------------------------------");
    console.log("\nUsage for Sending:");
    console.log("  node <script_name.js> <sourceNetwork> <destinationNetwork> <destinationAddress> <tokenAmount>");
    console.log("Example:");
    console.log("  node transfer.js holesky amoy 0xRecipientAddress 10.5");
    console.log("\nUsage for Listening:");
    console.log("  node <script_name.js> --listen <listeningNetwork> <expectedSourceNetwork>");
    console.log("Example:");
    console.log("  node transfer.js --listen amoy holesky");
    console.log("\nHelp:");
    console.log("  node <script_name.js> --help");
    console.log("\nPrerequisites:");
    console.log("  - Network details configured via getChainData()");
    console.log("  - Adapter ABIs/Addresses in ./abis/Adapter/<network>_Adapter_ABI.json");
    console.log("  - Underlying Token ABIs/Addresses/Decimals in ./abis/Tokens/<network>_My_Token_ABI.json");
    console.log("  - .env file with PRIVATE_KEY");
    console.log("-----------------------------------------");
}

// --- Start Execution ---
run().catch(error => {
    // Catch any top-level unhandled errors from run() itself, although most errors
    // should be caught within the specific send/listen functions.
    console.error("\n🚨🚨🚨 Unhandled error during script execution:", error);
    process.exit(1);
});
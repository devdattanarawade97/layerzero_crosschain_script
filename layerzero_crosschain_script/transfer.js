const ethers = require("ethers");
const fs = require("fs");
require("dotenv").config();
const { Options } = require('@layerzerolabs/lz-v2-utilities');
const { getChainData } = require('./helper/getChainData')
// Or potentially check console.log(lzUtils) to see what is exported


const holeksyABI = require('./abis/Holesky_OFT_ABI.json')
const amoyABI = require('./abis/Amoy_OFT_ABI.json')
// --- Configuration ---
// Ensure your .env file has MNEMONIC=your_mnemonic_phrase
if (!process.env.MNEMONIC) {
    throw new Error("MNEMONIC not found in .env file");
}


// --- Main Transfer Logic ---

async function initiateOftTransfer(srcNetwork, destNetwork, destAddress, tokenAmountString) {
    try {
        console.log(`\n--- Initiating OFT Transfer ---`);
        console.log(`🌍 Source Network: ${srcNetwork}`);
        console.log(`🚀 Destination Network: ${destNetwork}`);
        console.log(`📬 Destination Address: ${destAddress}`);
        console.log(`🔢 Amount: ${tokenAmountString}`);

        // 1. Get Network & Contract Details
        const srcData = getChainData(srcNetwork);
        const destData = getChainData(destNetwork);
        const expectedSourceEid = srcData.eid; // Use LayerZero Endpoint ID
        const destinationEid = destData.eid; // LayerZero Endpoint ID


        const { address: sourceOftContractAddress, abi: sourceOftAbi } = holeksyABI;
        const { address: destinationOftContractAddress, abi: destinationOftAbi } = amoyABI;

        if (!sourceOftContractAddress || !sourceOftAbi) {
            throw new Error(`OFT Contract address or ABI not found for ${srcNetwork}`);
        }

        console.log(`\n🔗 Using OFT Contract: ${sourceOftContractAddress} on ${srcNetwork}`);
        console.log(`🎯 Destination LayerZero EID: ${destinationEid}`);

        // 2. Setup Provider & Wallet
        const provider = new ethers.JsonRpcProvider(srcData.rpcUrl);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const sourceOftContract = new ethers.Contract(sourceOftContractAddress, sourceOftAbi, wallet);

        console.log(`👤 Sender Address: ${wallet.address}`);

        // 3. Get Token Decimals & Format Amount
        // Assuming the OFT contract itself implements decimals() or wraps a token that does
        let decimals;
        try {
            decimals = await sourceOftContract.decimals();
            console.log(`🪙 Token Decimals: ${decimals}`);
        } catch (e) {
            console.warn(`⚠️ Could not fetch decimals from OFT contract. Assuming underlying token is separate.`);
            // If OFT is an adapter, you might need the underlying token address to get decimals
            // For this example, let's assume 18 if not found on OFT
            try {
                // Try to get the underlying token address (adjust if method name is different)
                const underlyingTokenAddress = await sourceOftContract.token();
                const underlyingTokenContract = new ethers.Contract(underlyingTokenAddress, sourceOftAbi, provider);
                decimals = await underlyingTokenContract.decimals();
                console.log(`🪙 Underlying Token Decimals: ${decimals}`);
            } catch (e2) {
                console.error(`❌ Could not determine token decimals. Please check contract or provide manually.`);
                console.warn(`Proceeding with assumption of 18 decimals.`);
                decimals = 18n; // Use BigInt for decimals
            }
        }

        const amountLD = ethers.parseUnits(tokenAmountString, decimals); // amount in Local Decimals
        console.log(`🔢 Amount in Local Decimals (amountLD): ${amountLD.toString()}`);

        // 4. Approve Token Spend
        // Check if the OFT contract is an adapter/proxy that needs approval
        // You might need to inspect the contract type or add logic here.
        // For simplicity, we'll attempt approval. If it's a native OFT, this might fail harmlessly or isn't needed.
        // Determine the actual token address to approve (might be the OFT itself or an underlying token)
        let tokenToApproveAddress = ""; // Default assumption
        try {
            // If the OFT contract has a 'token()' function, it's likely an adapter/proxy
            const underlying = await sourceOftContract.token();
            console.log('token : ', underlying)
            if (underlying && underlying !== ethers.ZeroAddress) {
                tokenToApproveAddress = underlying;
                console.log(`🛡️ Identified underlying token for approval: ${tokenToApproveAddress}`);
            } else {
                console.log(`🛡️ Assuming OFT contract itself manages tokens (or native burn/mint). Approving OFT address.`);
            }
        } catch (e) {
            console.log(`🛡️ No 'token()' function found. Assuming OFT contract itself manages tokens. Approving OFT address.`);
        }

        const tokenContract = new ethers.Contract(tokenToApproveAddress, sourceOftAbi, wallet);
        console.log(`\n⏳ Approving OFT contract (${sourceOftContractAddress}) to spend ${tokenAmountString} tokens...`);
        try {
            const approveTx = await tokenContract.approve(sourceOftContractAddress, amountLD);
            console.log(`📜 Approval Tx Hash: ${approveTx.hash}`);
            await approveTx.wait();
            console.log(`✅ Approval successful!`);
        } catch (error) {
            console.error(`❌ Approval failed: ${error.message}`);
            // Decide if you want to proceed without approval (e.g., if it's known to be native OFT)
            if (error.message.includes("insufficient allowance")) { // Check common errors
                throw new Error("Approval failed due to allowance issue. Cannot proceed.");
            }
            console.warn("⚠️ Approval failed, but continuing. This might fail later if approval was required.");
        }
        // 4. Set peer ON SOURCE CONTRACT ONLY

        try {
            // Target: Source Contract (oftContractAddress)
            // Action: Tell it about its peer on the Destination Chain (destinationEid)

            // Convert the destination contract address to bytes32 format
            const peerBytes32Source = ethers.zeroPadValue(sourceOftContractAddress, 32);
            console.log(`   - Peer Address source (Bytes32): ${peerBytes32Source}`);
            const peerBytes32Destination = ethers.zeroPadValue(destinationOftContractAddress, 32);
            console.log(`   - Peer Address destination (Bytes32): ${peerBytes32Destination}`);
            console.log(`\nℹ️ Preparing to configure peer on SOURCE contract (${sourceOftContractAddress})...`);
            console.log(`   - Target Source EID: ${expectedSourceEid}`);
            console.log(`   - Peer Address (Source Contract): ${sourceOftContractAddress}`);
            // Optional: Check if peer is already set to avoid unnecessary transaction
            let needsSourceUpdate = true;
            try {
                // Call the 'peers' view function WITH the destination EID
                // *** Adjust this function name/signature if your contract differs ***
                const currentPeer = await sourceOftContract.peers(destinationEid);
                console.log('current peer : ', currentPeer)

                if (currentPeer.toLowerCase() === peerBytes32Destination.toLowerCase()) {
                    console.log(`✅ Peer for Source EID ${expectedSourceEid} is already correctly set on the source contract.`);
                    needsSourceUpdate = false;
                } else {
                    console.log(`   Current peer value on source: ${currentPeer}. Needs update.`);
                }
            } catch (viewError) {
                // Log specific error if helpful: console.warn(`   (Peer check failed: ${viewError.message})`);
                console.warn(`⚠️ Could not check current peer setting on source contract (view function 'peers(${destinationEid})' might differ or fail). Proceeding with setPeer call.`);
            }
            console.log(`\nℹ️ Preparing to configure peer on SOURCE contract (${sourceOftContractAddress})...`);
            console.log(`   - Target Destination EID: ${destinationEid}`);
            console.log(`   - Peer Address (Destination Contract): ${destinationOftContractAddress}`);

            let needDestinationUpdate = true;
            try {
                // Call the 'peers' view function WITH the destination EID
                // *** Adjust this function name/signature if your contract differs ***
                const provider = new ethers.JsonRpcProvider(destData.rpcUrl);
                const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
                const destinationOftContract = new ethers.Contract(destinationOftContractAddress, destinationOftAbi, wallet);
                const currentPeer = await destinationOftContract.peers(expectedSourceEid);
                if (currentPeer.toLowerCase() === peerBytes32Source.toLowerCase()) {
                    console.log(`✅ Peer for Destination EID ${destinationEid} is already correctly set on the source contract.`);
                    needDestinationUpdate = false;
                } else {
                    console.log(`   Current peer value on source: ${currentPeer}. Needs update.`);
                }
            } catch (viewError) {
                // Log specific error if helpful: console.warn(`   (Peer check failed: ${viewError.message})`);
                console.warn(`⚠️ Could not check current peer setting on source contract (view function 'peers(${destinationEid})' might differ or fail). Proceeding with setPeer call.`);
            }

            if (needsSourceUpdate) {
                // Execute the setPeer transaction ON THE SOURCE contract
                console.log(`\n⏳ Attempting to set peer on SOURCE contract (${sourceOftContractAddress})...`);
                // Ensure your wallet (signer) has permission!
                const setPeerTx = await sourceOftContract.setPeer(
                    destinationEid,         // The EID of the chain where the peer lives
                    peerBytes32Destination  // The address of the peer contract (on the destination chain) in bytes32
                );
                console.log(`📜 SetPeer Transaction Hash (Source): ${setPeerTx.hash}`);
                // Wait for the transaction to be mined
                const receipt = await setPeerTx.wait();
                console.log(`✅ Peer set successfully on source contract for source EID ${expectedSourceEid}! Block: ${receipt.blockNumber}`);
            }

            if (needDestinationUpdate) {
                // Execute the setPeer transaction ON THE destination contract
                console.log(`\n⏳ Attempting to set peer on destination contract (${destinationOftContractAddress})...`);
                // Ensure your wallet (signer) has permission!
                const provider = new ethers.JsonRpcProvider(destData.rpcUrl);
                const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
                const destinationOftContract = new ethers.Contract(destinationOftContractAddress, destinationOftAbi, wallet);
                const setPeerTx = await destinationOftContract.setPeer(
                    expectedSourceEid,         // The EID of the chain where the peer lives
                    peerBytes32Source  // The address of the peer contract (on the destination chain) in bytes32
                );
                console.log(`📜 SetPeer Transaction Hash (destination): ${setPeerTx.hash}`);
                // Wait for the transaction to be mined
                const receipt = await setPeerTx.wait();
                console.log(`✅ Peer set successfully on destination contract for Destination EID ${destinationEid}! Block: ${receipt.blockNumber}`);
            }

        } catch (error) {
            console.error(`❌ Failed during peer configuration for SOURCE contract: ${error.message}`);
            // Decide if you should stop the script if setting the peer fails
            throw new Error(`Setting peer on SOURCE failed, cannot proceed. Reason: ${error.message}`);
        }



        // 5. Prepare Send Parameters
        // Pad the 20-byte address to bytes32 as expected by LayerZero OFT contracts
        const peerBytes32Destination = ethers.zeroPadValue(destinationOftContractAddress, 32);
        console.log(`📦 Recipient Address (Bytes32): ${peerBytes32Destination}`);

        // Set standard options for LZ V2 (version 1, 200k gas) - adjust gas if needed
        // You can use AdapterParams library for more complex options
        let optionsBuilder = Options.newOptions();

        // Add the desired options (e.g., executor gas limit)
        // Based on your previous code: addExecutorLzReceiveOption(65000, 0)
        // The '0' likely means native value for the call is 0 (gas paid via nativeFee)
        optionsBuilder = optionsBuilder.addExecutorLzReceiveOption(65000000, 0);

        // You could chain other options here if needed, e.g.:

        // Finalize and get the bytes string
        const options = optionsBuilder.toBytes(); // Use the instance method

        const receiverBytesAddressZeroPad = ethers.zeroPadValue(destAddress, 32);
        // console.log('bytes address solidity : ', receiverBytesAddressSolidity)
        console.log("zero pad ", receiverBytesAddressZeroPad)

        const sendParam = {
            dstEid: destinationEid,          // Destination Endpoint ID
            to: receiverBytesAddressZeroPad,     // Recipient address bytes32 encoded
            amountLD: amountLD,              // Amount in local decimals
            minAmountLD: amountLD,           // Minimum amount to receive (can be less for slippage)
            extraOptions: options,           // Additional options (e.g., destination gas)
            composeMsg: '0x',                // For composability, usually '0x'
            oftCmd: '0x',      // Specific OFT commands, usually '0x'

        };

        // 6. Estimate LayerZero Fees using `quoteSend`
        console.log(`\n⏳ Estimating LayerZero fees using 'quoteSend'...`);
        let fees; // This will hold the returned MessagingFee struct
        const quoteFunctionName = "quoteSend";

        try {
            if (!sourceOftContract.interface.hasFunction(quoteFunctionName)) {
                throw new Error(`Function '${quoteFunctionName}' not found in the ABI...`);
            }
            fees = await sourceOftContract[quoteFunctionName](sendParam, false);
            console.log(`✅ Fee estimation successful using 'quoteSend'.`);

        } catch (quoteError) {
            // ... (Error handling remains the same) ...
            console.log('error while estimating fee : ', quoteError)
            throw new Error(`Fee estimation failed using '${quoteFunctionName}'.`);
        }

        // --- CORRECTED FEE ACCESS ---
        // Access properties of the returned MessagingFee struct
        const nativeFee = fees.nativeFee;
        const lzTokenFee = fees.lzTokenFee;
        // -----------------------------

        // Ethers v6 returns BigInts directly. If using older ethers, you might need .toString()
        console.log(`💰 Estimated Native Fee (wei): ${nativeFee.toString()}`);
        console.log(`💰 Estimated LZ Token Fee (wei): ${lzTokenFee.toString()}`); // Should be 0


        // 7. Execute the `send` Transaction
        // --- Add these checks before Step 7's try...catch ---

        console.log("\n🔍 Verifying Preconditions for send...");
        try {
            // Ensure 'tokenContract' is defined earlier, representing the ERC20 being sent
            const underlyingTokenAddress = await sourceOftContract.token(); // Get underlying token address from OFT
            const tokenContract = new ethers.Contract(underlyingTokenAddress, sourceOftAbi, wallet); // Assuming erc20Abi is available

            const senderAddress = wallet.address;
            const oftContractAddress = sourceOftContract.target;

            const allowance = await tokenContract.allowance(senderAddress, oftContractAddress);
            const balance = await tokenContract.balanceOf(senderAddress);

            console.log(`   - Amount to Send (amountLD): ${sendParam.amountLD.toString()}`);
            console.log(`   - Amount in Error Data:    10000000000000`); // From 0x...9184e72a000
            console.log(`   - Token Allowance:         ${allowance.toString()}`);
            console.log(`   - Token Balance:           ${balance.toString()}`);
            const amountToMint = ethers.parseUnits("10000", 18);
            // const mintTx = await tokenContract.mint(destAddress, amountToMint);
            console.log(`   - Token Balance:           ${balance.toString()}`);
            if (allowance < sendParam.amountLD) {
                console.error("   🚨 CRITICAL: Allowance is LESS than the amount to send!");
            } else {
                console.log("   ✅ Allowance seems sufficient.");
            }
            if (balance < sendParam.amountLD) {
                console.error("   🚨 CRITICAL: Balance is LESS than the amount to send!");
            } else {
                console.log("   ✅ Balance seems sufficient.");
            }

            // Check Peer again explicitly
            const peerCheck = await sourceOftContract.peers(sendParam.dstEid);
            const expectedPeer = ethers.zeroPadValue(destinationOftContractAddress, 32); // Ensure destinationOftContractAddress is correct
            console.log(`   - Expected Peer Address:   ${expectedPeer}`);
            console.log(`   - Configured Peer Address: ${peerCheck}`);
            if (peerCheck.toLowerCase() !== expectedPeer.toLowerCase()) {
                console.error("   🚨 CRITICAL: Configured Peer Address does NOT match expected destination contract!");
            } else {
                console.log("   ✅ Peer configuration seems correct.");
            }

        } catch (preCheckError) {
            console.error("   ⚠️ Error during precondition checks:", preCheckError.message);
        }

        const messagingFee = {
            nativeFee: nativeFee,
            lzTokenFee: lzTokenFee
        };
        const refundAddress = wallet.address; // Address to refund excess gas/fees

        console.log(`\n🚀 Sending transaction to OFT contract 'send' function...`);
        const tx = await sourceOftContract.send(
            sendParam,      // The SendParam struct
            messagingFee,   // The MessagingFee struct
            refundAddress,  // Refund address
            { value: nativeFee }
        );

        console.log(`📜 Transaction Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ OFT Transfer initiated successfully! Block: ${receipt.blockNumber}`);

        // You can potentially parse logs from the receipt to get the LayerZero guid if needed
        // Look for the OFTSent event emission

    } catch (error) {
        console.log('error while sending tx : ', error)
        // console.error("\n❌❌❌ Error initiating OFT transfer:", error.message);
        if (error.data) { // Log revert reason if available
            // console.error("❌ Revert Reason:", await provider.call({ ...error.transaction, data: error.data }).catch(e => e.message));
        }
        console.error(error.stack); // Print stack trace for debugging
    }
}


// --- Simulation for Receiving (Keep separate or comment out if only sending) ---
// --- Simulation for Receiving (Corrected Suggestion) ---
async function receiveTransferListener(destNetwork, srcNetwork) {
    try {
        console.log(`\n--- Listening for OFT Transfers ---`);
        console.log(`\n📩 Listening on network: ${destNetwork}`);

        const srcData = getChainData(srcNetwork);
        const destData = getChainData(destNetwork);
        const expectedSourceEid = srcData.eid; // Use LayerZero Endpoint ID

        // Assuming amoyABI contains the correct address and ABI for the destination OFT
        const { address: contractAddress, abi: contractAbi } = amoyABI;
        if (!contractAddress || !contractAbi) {
            throw new Error(`Contract address or ABI not found for ${destNetwork}`);
        }
        console.log(`🔗 Using contract: ${contractAddress}`);

        const provider = new ethers.JsonRpcProvider(destData.rpcUrl);
        const contract = new ethers.Contract(contractAddress, contractAbi, provider);

        console.log("⏳ Waiting for incoming 'Transfer' events...");

        // Listen for the standard ERC20 Transfer event
        // signature: Transfer(address indexed from, address indexed to, uint256 value)
        contract.on("transfer", (from, to, value, event) => {
            console.log(`\n🎉 Event Received: Transfer`);
            console.log(`   From: ${from}`);
            console.log(`   To: ${to}`);
            console.log(`   Value: ${value.toString()}`); // Value is in token's decimals

            // Add filtering logic here:
            // 1. Check if 'to' is the address you expect to receive tokens.
            // 2. Check if 'from' corresponds to a mint operation (often address(0))
            //    or the OFT contract itself, depending on implementation.
            //    This requires knowing how your specific OFT contract handles crediting.
            // 3. You cannot directly get the source EID from a standard Transfer event.
            //    You might need more complex off-chain logic or rely on LayerZero Scan
            //    if you strictly need to confirm the source chain via events.

            // Example filter (adapt as needed):
            const expectedRecipient = to; // Replace with the actual recipient
            const zeroAddress = ethers.ZeroAddress;

            if (to.toLowerCase() === expectedRecipient.toLowerCase() && from === zeroAddress) {
                console.log(`✅ >>> Matched Transfer (potential OFT mint) to ${to}! <<<`);
                // Add logic here if you need to do something upon receiving
            } else if (to.toLowerCase() === expectedRecipient.toLowerCase()) {
                console.log(`ℹ️  >>> Matched Transfer to ${to} (From: ${from}) <<<`);
                // Potentially relevant, but might not be the mint from _lzReceive
            } else {
                // console.log(`   (Ignoring event, recipient is ${to})`);
            }
        });

        provider.on('error', (err) => {
            console.error("Provider Error:", err);
            // Implement reconnection logic if needed
        });

    } catch (error) {
        console.error("❌ Error setting up listener:", error);
    }
}

// --- Script Execution ---

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 4 || args.includes('--help')) {
        console.log("Usage: node transfer.js <sourceNetwork> <destinationNetwork> <destinationAddress> <tokenAmount>");
        console.log("Example: node transfer.js sepolia optimism-sepolia 0xRecipientAddress 10.5");
        console.log("\nEnsure networks exist in lz_endpoints.json and contracts in deployed_addresses.json.");
        console.log("Ensure .env file has MNEMONIC.");
        process.exit(1);
    }

    const [srcNetwork, destNetwork, destAddress, tokenAmountString] = args;

    // Initiate the transfer
    await initiateOftTransfer(srcNetwork, destNetwork, destAddress, tokenAmountString);

    // Optional: Start listening on the destination chain. Run this in a separate process
    // or manage async execution carefully if run together.
    // console.log("\n---");
    // To listen, run separately: node transfer.js --listen <destinationNetwork> <sourceNetwork>
    // await receiveTransferListener(destNetwork, srcNetwork); // Be cautious running send & listen together
}

// Check for a listen flag, e.g., node transfer.js --listen sepolia fuji
if (process.argv[2] === '--listen') {
    if (process.argv.length !== 5) {
        console.log("Usage for listener: node transfer.js --listen <listeningNetwork> <expectedSourceNetwork>");
        process.exit(1);
    }
    const [, , , listenNetwork, expectedSourceNetwork] = process.argv;
    receiveTransferListener(listenNetwork, expectedSourceNetwork)
        .catch(error => {
            console.error("Listener failed:", error);
            process.exit(1);
        });
} else {
    // Default to sending
    main().catch(error => {
        console.error("Script failed:", error);
        process.exit(1);
    });
}
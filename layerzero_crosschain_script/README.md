# LayerZero OFT Adapter Cross-Chain Transfer Script

This repository provides a Node.js script for initiating cross-chain transfers of existing ERC20 tokens using LayerZero v2 and the OFT Adapter pattern (`OFTAdapter.sol`). It also includes functionality to listen for incoming transfers on the destination chain.

**Note:** This script is designed for bridging **existing ERC20 tokens**. If you want to create a new token that is inherently omnichain (managed via burn/mint), you would typically use LayerZero's standard `OFT.sol` or `OFTWithFee.sol` contracts, which have different operational requirements.

## Key Concept: Standard `OFT` vs. `OFTAdapter`

Understanding the difference between LayerZero's standard `OFT` and `OFTAdapter` contracts is crucial for using this script correctly, especially regarding token supply management on the destination chain.

### Standard OFT (e.g., `OFT.sol`, `OFTWithFee.sol`) - Burn & Mint

* **Supply Management:** These contracts manage the token supply *themselves*. They are often used for tokens created specifically to be omnichain.
* **Mechanism:**
    1.  Tokens are **burned** (destroyed) on the source chain from the sender's wallet.
    2.  A LayerZero message is sent to the destination chain.
    3.  Tokens are **minted** (newly created) by the destination OFT contract and sent to the recipient.
* **Destination Funding:** Since the destination contract *creates* new tokens upon arrival, it **does not need to hold a pre-existing balance** of the token.

### OFT Adapter (`OFTAdapter.sol`) - Lock & Transfer/Release

* **Supply Management:** This contract acts as a wrapper or "adapter" for an *existing, independent* ERC20 token (e.g., your custom `My_Token`). It does *not* control the total supply of the underlying token; it simply facilitates its movement across chains.
* **Mechanism:**
    1.  The underlying ERC20 token on the source chain is **transferred from the sender's wallet to the source Adapter contract** (effectively locking it).
    2.  A LayerZero message is sent to the destination chain.
    3.  The destination Adapter contract **transfers the underlying ERC20 token (which it *must already possess* on the destination chain)** from its *own balance* to the final recipient.
* **Destination Funding:** Because the destination Adapter needs to *transfer* tokens from its own balance, it **MUST be pre-funded with a sufficient balance** of the underlying token on the destination chain *before* a transfer can be successfully received. **This is the most common point of failure if not done correctly.**

---

## How the `OFTAdapter` Transfer Flow Works (Implemented by this Script)

This script executes the `OFTAdapter` flow. Here's a typical sequence when sending 100 `My_Token` from Chain A (e.g., Holesky) to Chain B (e.g., Amoy):

**Prerequisites:**

1.  `My_Token` ERC20 contract deployed on both Chain A and Chain B.
2.  `OFTAdapter` contract deployed on Chain A, configured with the Chain A `My_Token` address.
3.  `OFTAdapter` contract deployed on Chain B, configured with the Chain B `My_Token` address.
4.  Peers correctly set between the Chain A and Chain B `OFTAdapter` contracts using `setPeer()`.
5.  **Crucially:** The Chain B `OFTAdapter` contract address holds a balance of at least 100 `My_Token` (on Chain B).

**Transfer Flow:**

1.  **User Approval (Chain A):** The user (or script acting on their behalf) calls `My_Token_ChainA.approve(AdapterAddress_ChainA, 100)`. This allows the source Adapter to pull tokens.
2.  **User Initiation (Chain A):** The user/script calls `Adapter_ChainA.send(...)` with parameters:
    * `dstEid`: LayerZero Endpoint ID of Chain B.
    * `to`: Final recipient address (bytes32 padded).
    * `amountLD`: Amount in underlying token's decimals (e.g., equivalent of 100 tokens).
    * `minAmountLD`: Minimum amount to receive (often same as `amountLD`).
    * `extraOptions`: LayerZero options (e.g., executor gas limit).
    * `nativeFee`: The estimated LayerZero fee is sent as `msg.value` with the transaction.
3.  **Source Adapter Action (Chain A):**
    * The `send()` function verifies parameters.
    * It calls `My_Token_ChainA.transferFrom(userAddress, AdapterAddress_ChainA, 100)`. Tokens move from the user to the Adapter on Chain A ("locked").
    * It calls the LayerZero endpoint (`lzSend`) to dispatch the cross-chain message.
4.  **LayerZero Relaying:** The message is processed and relayed by the LayerZero network to Chain B.
5.  **Destination Execution Trigger (Chain B):** A LayerZero Executor calls `Adapter_ChainB.lzReceive(...)` with the relayed message payload.
6.  **Destination Adapter Action (Chain B):**
    * `lzReceive()` verifies the message origin (checks peer).
    * It decodes the recipient address and amount (100) from the payload.
    * It calls `My_Token_ChainB.transfer(recipientAddress, 100)`. This attempts to send 100 `My_Token` (on Chain B) **from the Chain B Adapter's current balance** to the final recipient.
    * **(Potential Failure Point):** If the Chain B Adapter holds less than 100 `My_Token`, this `transfer` call reverts, causing the LayerZero destination transaction to show as failed or reverted (e.g., `SIMULATION_REVERTED`).
7.  **Result (if successful):** The recipient receives 100 `My_Token` on Chain B. The Chain B Adapter's balance of `My_Token` decreases by 100.

---

## Repository Contents

* `transfer.js` (or similar): The main Node.js script for sending and listening.
* `helper/getChainData.js`: Example helper function to retrieve network RPC URLs, LayerZero Endpoint IDs, and WebSocket URLs. (You need to implement or configure this).
* `abis/Adapter/`: Directory to store JSON files containing the `OFTAdapter` ABI and deployed address for each supported network (e.g., `holesky_Adapter_ABI.json`).
* `abis/Tokens/`: Directory to store JSON files containing the underlying ERC20 token ABI, deployed address, and decimals for each supported network (e.g., `holesky_My_Token_ABI.json`).
* `.env.example`: Template for required environment variables.
* `package.json`: Project dependencies.
* `README.md`: This file.

## Prerequisites

1.  **Node.js:** Version 18 or higher recommended.
2.  **npm** or **yarn:** Package manager for Node.js.
3.  **Git:** For cloning the repository.
4.  **Environment File (`.env`):** Containing your wallet's `PRIVATE_KEY`.
5.  **Deployed Contracts:**
    * Your custom ERC20 token contract deployed on both source and destination chains.
    * `OFTAdapter` contracts deployed on both source and destination chains, correctly linked to your ERC20 token contracts during deployment.
6.  **Funds:** The wallet associated with `PRIVATE_KEY` needs sufficient native currency (e.g., ETH on Holesky, MATIC on Amoy) on the source chain to pay for gas and LayerZero fees.
7.  **Destination Adapter Funding:** The destination `OFTAdapter` contract address **must hold a sufficient balance** of the underlying token on the destination chain.

## Setup & Configuration

1.  **Clone Repository:**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Configure Environment:**
    * Copy `.env.example` to `.env`.
    * Edit `.env` and add your wallet's private key:
        ```env
        PRIVATE_KEY=0xyour_private_key_here
        ```
4.  **Configure Contract Information:**
    * Create JSON files inside `abis/Adapter/` for each network (e.g., `holesky_Adapter_ABI.json`, `amoy_Adapter_ABI.json`). Each file must contain `{ "address": "0x...", "abi": [...] }`.
    * Create JSON files inside `abis/Tokens/` for each network (e.g., `holesky_My_Token_ABI.json`, `amoy_My_Token_ABI.json`). Each file must contain `{ "address": "0x...", "abi": [...], "decimals": 18 }`. Ensure the `decimals` field is correct.
    * The script uses filenames like `<network>_Adapter_ABI.json` and `<network>_My_Token_ABI.json`. Adjust the `loadConfig` function in the script if your naming convention differs.
5.  **Configure Network Data:**
    * Implement or configure the `helper/getChainData.js` file to return correct RPC URLs (HTTP for sending), WebSocket URLs (`wssUrl`, for listening), and LayerZero Endpoint IDs (`eid`) for your desired networks (e.g., 'holesky', 'amoy').
6.  **Fund Destination Adapter:**
    * **This is critical!** Manually transfer your underlying token (on the destination chain) to the destination `OFTAdapter` contract address. Ensure it holds enough balance to cover anticipated incoming transfers.
7.  **Set Contract Peers:**
    * The `OFTAdapter` contracts on the source and destination chains must be configured to recognize each other. This is done by calling the `setPeer(destinationEid, destinationAdapterAddressBytes32)` function on the source adapter and `setPeer(sourceEid, sourceAdapterAddressBytes32)` on the destination adapter.
    * This requires the **owner** of the adapter contracts to make the calls.
    * While the provided script *attempts* to check and set peers, it's **highly recommended** to perform this as a separate, one-time setup step using the owner wallet after deploying the adapters, to ensure it's done correctly.

## Usage

### Sending Tokens

Use the following command structure :

```bash
node transfer.js <sourceNetwork> <destinationNetwork> <destinationAddress> <tokenAmount>

```bash
node transfer.js --listen <listeningNetwork> <expectedSourceNetwork>
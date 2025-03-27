# Cross-Chain Transfer using LayerZero

This project enables cross-chain transfers using **LayerZero**. It consists of a Solidity smart contract for handling the transfers and a Node.js backend script for executing transactions.

## 📂 Directory Structure
```
/crosschain-transfer/
│── contracts/
│   ├── CrossChainTransfer.sol       # Smart contract for cross-chain transfers
│── test/
│   ├── crossChainTransfer.test.js  # Hardhat tests
│── backend/
│   ├── transfer.js                  # Backend script for executing transfers
│── hardhat.config.js                 # Hardhat configuration
│── .env                              # Environment variables
│── README.md                         # Project documentation
```

## 🛠 Setup Instructions

### 1️⃣ Install Dependencies
```sh
npm install
dotenv hardhat ethers chai
```

### 2️⃣ Configure Environment Variables
Create a `.env` file and set the following:
```env
RPC_URL=<your_rpc_url>
MNEMONIC=<your_wallet_mnemonic>
CONTRACT_ADDRESS=<deployed_contract_address>
```

### 3️⃣ Deploy the Contract
```sh
npx hardhat compile
npx hardhat run scripts/deploy.js --network <network_name>
```

### 4️⃣ Run Tests
```sh
npx hardhat test
```

### 5️⃣ Execute a Cross-Chain Transfer
```sh
node backend/transfer.js <destinationChainId> <destinationAddress> <amount>
```
Example:
```sh
node backend/transfer.js 100 0xReceiverAddress 0.1
```

## 🔍 Explanation
- The **Solidity contract** allows users to send native tokens across chains using LayerZero.
- The **backend script** interacts with the contract using `ethers.js`.
- The **tests** ensure correctness before deployment.

### 🚀 Next Steps:
- Deploy the contract on both chains.
- Set trusted remote addresses.
- Perform test transactions.


# OFT vs OFTAdapter: Understanding Cross-Chain Transfers with LayerZero

## Overview
This repository provides a detailed comparison between using a standard OFT contract and an OFTAdapter when bridging tokens across chains using LayerZero. The key distinction lies in how each contract manages token supply and cross-chain transfers.

## Standard OFT (Burn & Mint) vs OFTAdapter (Lock & Transfer/Release)
### Standard OFT
- Manages token supply itself.
- Tokens are **burned** on the source chain and **minted** on the destination chain.
- The destination contract does **not** require pre-funding.

### OFTAdapter
- Wraps an existing ERC20 token and does **not** control total supply.
- Tokens are **locked** on the source chain and **released** on the destination chain.
- The destination contract **must be pre-funded** with enough tokens.

## Detailed Cross-Chain Flow Comparison

### Scenario 1: Using OFTAdapter (Bridging an Existing ERC20 Token)
#### Prerequisites
- `My_Token` contract deployed on **Holesky** & **Amoy**.
- `OFTAdapter` contract deployed on **Holesky** (linked to `My_Token` on Holesky).
- `OFTAdapter` contract deployed on **Amoy** (linked to `My_Token` on Amoy).
- **Peers are set** between the two `OFTAdapter` contracts.
- **Amoy `OFTAdapter` contract must hold** >= `100 My_Token` (on Amoy).

#### Flow
1. **User Approval (Holesky)**
   - Call `My_Token_Holesky.approve(HoleskyAdapterAddress, 100)`. This allows the `HoleskyAdapter` to pull `100 My_Token` from the user's wallet.
2. **User Initiation (Holesky)**
   - Call `HoleskyAdapter.send(..., amountLD=100, ...)` providing recipient, destination EID, and LayerZero fee.
3. **Source Adapter Action (Holesky)**
   - Calls `My_Token_Holesky.transferFrom(user, HoleskyAdapter, 100)`, locking `100 My_Token`.
   - Triggers `LayerZero` to send a message to `AmoyAdapter`.
4. **LayerZero Relaying**
   - Message travels via LayerZero network.
5. **Destination Execution (Amoy)**
   - `LayerZero Executor` calls `AmoyAdapter.lzReceive(...)` with the message payload.
6. **Destination Adapter Action (Amoy)**
   - Calls `My_Token_Amoy.transfer(recipient, 100)` to release `100 My_Token`.
   - **Fails if `AmoyAdapter` has < `100 My_Token` in balance**.

**Result:** If successful, recipient receives `100 My_Token` on Amoy. The Amoy Adapter's balance decreases by `100`.

---

### Scenario 2: Using Standard OFT (Bridging an OFT-Managed Token)
#### Prerequisites
- `MyOFT` contract (based on `OFT.sol`) deployed on **Holesky** & **Amoy**.
- **Peers are set** between `MyOFT` contracts.
- User holds `>= 100 MyOFT` on Holesky.
- **No pre-funding of Amoy contract required.**

#### Flow
1. **User Initiation (Holesky)**
   - Call `HoleskyMyOFT.send(..., amountLD=100, ...)` providing recipient, destination EID, and LayerZero fee.
2. **Source OFT Action (Holesky)**
   - Calls `_burn(user, 100)`, burning `100 MyOFT`.
   - Triggers `LayerZero` to send a message to `AmoyMyOFT`.
3. **LayerZero Relaying**
   - Message travels via LayerZero network.
4. **Destination Execution (Amoy)**
   - `LayerZero Executor` calls `AmoyMyOFT.lzReceive(...)` with the message payload.
5. **Destination OFT Action (Amoy)**
   - Calls `_mint(recipient, 100)`, minting `100 MyOFT`.

**Result:** Recipient receives `100 MyOFT` on Amoy. The total circulating supply of `MyOFT` remains consistent across both chains.

---

## Key Takeaways
- **OFT (Burn & Mint):** More flexible, does not require pre-funding.
- **OFTAdapter (Lock & Release):** Requires pre-funding on the destination chain.
- **Use Case Consideration:**
  - If bridging a **new** token, use **OFT**.
  - If bridging an **existing ERC20**, use **OFTAdapter** but ensure pre-funding.

## License
This project is licensed under the MIT License.

## Contact
For further inquiries, reach out via email or open an issue in this repository.


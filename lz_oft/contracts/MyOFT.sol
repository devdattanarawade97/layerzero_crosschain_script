// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";

contract MyOFT is OFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    /**
     * @notice Allows the owner to mint new tokens.
     * @dev Only callable by the owner. Marked virtual to allow overriding.
     */
    function mint(address _to, uint256 _amount)
        public
        virtual
        onlyOwner // Keep onlyOwner for the main contract
    {
        _mint(_to, _amount); // Use internal _mint from base ERC20/OFT
    }
}

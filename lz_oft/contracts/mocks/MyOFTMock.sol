// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { MyOFT } from "../MyOFT.sol";

// @dev WARNING: This is for testing purposes only
contract MyOFTMock is MyOFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) MyOFT(_name, _symbol, _lzEndpoint, _delegate) {}

   /**
     * @notice Mock mint function, overrides the base function.
     * @dev Removes onlyOwner for testing purposes. Marked override.
     */
    function mint(address _to, uint256 _amount)
        public
        override // <<< ADD 'override' HERE
    {
        _mint(_to, _amount); // Call internal _mint from base OFT/ERC20
    }
}

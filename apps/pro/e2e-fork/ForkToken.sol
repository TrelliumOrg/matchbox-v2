// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Stands in for Mezo's MEZO and BTC token precompiles on an Anvil fork,
/// which cannot run them. Installed with anvil_setCode at 0x7b7c…0001 and
/// 0x7b7c…0000. Approvals are enforced, so Pro's approve steps are tested;
/// a sender's balance saturates at zero instead of reverting, so escrows and
/// reward contracts that hold real balances on mainnet need no seeding.
contract ForkToken {
    mapping(address => uint256) public balanceOf; // slot 0
    mapping(address => mapping(address => uint256)) public allowance; // slot 1

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function symbol() external view returns (string memory) {
        return address(this) == address(0x7b7C000000000000000000000000000000000000) ? "BTC" : "MEZO";
    }

    function name() external view returns (string memory) {
        return address(this) == address(0x7b7C000000000000000000000000000000000000) ? "Bitcoin" : "Mezo";
    }

    function totalSupply() external pure returns (uint256) {
        return 1e27;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 held = balanceOf[from];
        balanceOf[from] = held > amount ? held - amount : 0;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

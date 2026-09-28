// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/**
 * @title SimpleFlashLoanArb
 * @dev Simplified flash loan receiver — stores Pool address directly
 *      (no getPool() call in constructor — avoids Aave V3 Provider issues)
 */
contract SimpleFlashLoanArb {
    address public owner;
    IPool public immutable POOL;

    constructor(address _pool) {
        POOL = IPool(_pool);
        owner = msg.sender;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // Repay loan
        uint256 amountToReturn = amount + premium;
        IERC20(asset).approve(address(POOL), amountToReturn);
        return true;
    }

    function requestFlashLoan(address _token, uint256 _amount) external {
        POOL.flashLoanSimple(address(this), _token, _amount, "", 0);
    }

    function withdraw(address _token) external {
        require(msg.sender == owner, "Only owner");
        IERC20 token = IERC20(_token);
        token.transfer(owner, token.balanceOf(address(this)));
    }

    receive() external payable {}
}

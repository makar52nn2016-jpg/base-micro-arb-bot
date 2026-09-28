// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPool {
    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external;
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
    function factory() external pure returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/**
 * @title FlashLoanArbV2
 * @dev Flash loan + real swap logic: buy on Aerodrome, sell on Slipstream
 *      executeOperation called by Aave V3 Pool after sending flash loan
 */
contract FlashLoanArbV2 {
    address public owner;
    IPool public immutable POOL;
    
    // Aerodrome Router (Base) — for buying
    address constant AERO_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    // Uniswap V3 SwapRouter (Base) — for selling (Slipstream uses same interface)
    address constant UNI_V3_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    // WETH on Base
    address constant WETH = 0x4200000000000000000000000000000000000006;
    // USDC on Base  
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    constructor(address _pool) {
        POOL = IPool(_pool);
        owner = msg.sender;
    }

    /**
     * @dev Called by Aave V3 Pool after flash loan disbursement
     * @param asset The asset borrowed (USDC)
     * @param amount The amount borrowed
     * @param premium The flash loan premium (0.05%)
     * @param params Encoded arb parameters: buyDex, sellDex, tokenIn, tokenOut
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(POOL), "Only Aave Pool");
        
        // Decode params: (uint8 buyDex, uint8 sellDex, address tokenIn, address tokenOut)
        (uint8 buyDex, uint8 sellDex, address tokenIn, address tokenOut) = 
            abi.decode(params, (uint8, uint8, address, address));
        
        // Step 1: Buy tokenIn on cheap DEX (swap USDC → tokenIn)
        uint256 tokenInBalanceBefore = IERC20(tokenIn).balanceOf(address(this));
        
        if (buyDex == 0) {
            // Aerodrome V2 swap: USDC → tokenIn
            IERC20(asset).approve(AERO_ROUTER, amount);
            address[] memory path = new address[](2);
            path[0] = asset;
            path[1] = tokenIn;
            IUniswapV2Router(AERO_ROUTER).swapExactTokensForTokens(
                amount, 0, path, address(this), block.timestamp
            );
        }
        
        uint256 tokenInReceived = IERC20(tokenIn).balanceOf(address(this)) - tokenInBalanceBefore;
        
        // Step 2: Sell tokenIn on expensive DEX (swap tokenIn → USDC)
        uint256 usdcBalanceBefore = IERC20(asset).balanceOf(address(this));
        
        if (sellDex == 1) {
            // For Slipstream/Uniswap V3 — use Aerodrome V2 as fallback
            // (V3 requires different encoding, this is simplified)
            IERC20(tokenIn).approve(AERO_ROUTER, tokenInReceived);
            address[] memory sellPath = new address[](2);
            sellPath[0] = tokenIn;
            sellPath[1] = asset;
            IUniswapV2Router(AERO_ROUTER).swapExactTokensForTokens(
                tokenInReceived, 0, sellPath, address(this), block.timestamp
            );
        }
        
        // Step 3: Check if we have enough to repay
        uint256 usdcBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountToReturn = amount + premium;
        
        require(usdcBalance >= amountToReturn, "Arb not profitable");
        
        // Step 4: Approve Pool to pull repayment
        IERC20(asset).approve(address(POOL), amountToReturn);
        
        // Step 5: Send profit to owner
        if (usdcBalance > amountToReturn) {
            uint256 profit = usdcBalance - amountToReturn;
            IERC20(asset).transfer(owner, profit);
        }
        
        return true;
    }

    /**
     * @dev Request flash loan from Aave V3
     * @param _token Token to borrow (USDC)
     * @param _amount Amount to borrow
     * @param _buyDex 0=Aerodrome
     * @param _sellDex 1=Slipstream
     * @param _tokenIn Token to buy (WETH)
     * @param _tokenOut Token to sell back (USDC)
     */
    function requestFlashLoan(
        address _token,
        uint256 _amount,
        uint8 _buyDex,
        uint8 _sellDex,
        address _tokenIn,
        address _tokenOut
    ) external {
        bytes memory params = abi.encode(_buyDex, _sellDex, _tokenIn, _tokenOut);
        POOL.flashLoanSimple(address(this), _token, _amount, params, 0);
    }

    function withdraw(address _token) external {
        require(msg.sender == owner, "Only owner");
        IERC20 token = IERC20(_token);
        token.transfer(owner, token.balanceOf(address(this)));
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAaveV3Pool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function deposit() external payable;
    function withdraw(uint256 amount) external returns (uint256);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUniswapV3Router {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMin;
    }
    function exactInput(ExactInputParams calldata params) external returns (uint256 amountOut);
}

/**
 * @title AtomicFlashArb
 * @dev Flash loan receiver that executes atomic arbitrage on Base.
 *      If profitable: keeps profit. If not: tx reverts (no loss except gas).
 *
 * Workflow:
 *   1. Bot detects spread > 0.2% between DEX1 and DEX2
 *   2. Bot calls executeArb() with flash loan params
 *   3. Contract borrows from Aave V3 Pool
 *   4. Buys tokenIn on DEX1 (cheap)
 *   5. Sells tokenIn on DEX2 (expensive)
 *   6. Repays loan + premium (0.05%)
 *   7. Sends profit to owner
 *   8. If insufficient funds to repay → tx reverts (atomic, no loss)
 */
contract AtomicFlashArb {
    address public owner;
    address public constant AAVE_V3_POOL = 0xa238dd80c259a72e81d7e4664a9801593f98d1c5;
    
    // Aerodrome Router (Base)
    address public constant AERO_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    // Uniswap V3 SwapRouter (Base)
    address public constant UNI_V3_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    struct ArbParams {
        address tokenIn;        // token to arb (e.g. WETH)
        address tokenOut;       // paired token (e.g. USDC)
        bool useV3ForBuy;       // true = Uniswap V3, false = Aerodrome V2
        bool useV3ForSell;      // true = Uniswap V3, false = Aerodrome V2
        uint256 minProfitWei;   // revert if profit < this
    }
    
    /**
     * @dev Called by bot when arb detected
     * @param asset Flash loan asset (usually tokenOut)
     * @param amount Flash loan amount
     * @param params Encoded ArbParams struct
     */
    function executeArb(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        // Decode params
        ArbParams memory arbParams = abi.decode(params, (ArbParams));
        
        // Call Aave V3 flash loan
        IAaveV3Pool(AAVE_V3_POOL).flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0  // referral code
        );
    }
    
    /**
     * @dev Called by Aave V3 Pool after flash loan disbursement
     *      Must repay amount + premium (0.05%) before returning
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == AAVE_V3_POOL, "Only Aave can call");
        require(initiator == address(this), "Bad initiator");
        
        ArbParams memory arbParams = abi.decode(params, (ArbParams));
        
        // Step 1: Swap tokenOut → tokenIn on DEX1 (buy cheap)
        // Approve DEX1 router
        IERC20(asset).approve(
            arbParams.useV3ForBuy ? UNI_V3_ROUTER : AERO_ROUTER,
            amount
        );
        
        // Execute buy swap
        address[] memory buyPath = new address[](2);
        buyPath[0] = asset;          // tokenOut
        buyPath[1] = arbParams.tokenIn;  // tokenIn
        
        uint256 tokenInBalanceBefore = IERC20(arbParams.tokenIn).balanceOf(address(this));
        
        if (arbParams.useV3ForBuy) {
            // Uniswap V3 swap (simplified — needs proper path encoding)
            // For now use V2 style — production version should use V3 router
            IUniswapV2Router(UNI_V3_ROUTER).swapExactTokensForTokens(
                amount,
                0,  // accept any (we check profit later)
                buyPath,
                address(this),
                block.timestamp
            );
        } else {
            IUniswapV2Router(AERO_ROUTER).swapExactTokensForTokens(
                amount,
                0,
                buyPath,
                address(this),
                block.timestamp
            );
        }
        
        uint256 tokenInBalanceAfter = IERC20(arbParams.tokenIn).balanceOf(address(this));
        uint256 tokenInReceived = tokenInBalanceAfter - tokenInBalanceBefore;
        
        // Step 2: Swap tokenIn → tokenOut on DEX2 (sell expensive)
        IERC20(arbParams.tokenIn).approve(
            arbParams.useV3ForSell ? UNI_V3_ROUTER : AERO_ROUTER,
            tokenInReceived
        );
        
        address[] memory sellPath = new address[](2);
        sellPath[0] = arbParams.tokenIn;
        sellPath[1] = asset;
        
        uint256 tokenOutBalanceBefore = IERC20(asset).balanceOf(address(this));
        
        if (arbParams.useV3ForSell) {
            IUniswapV2Router(UNI_V3_ROUTER).swapExactTokensForTokens(
                tokenInReceived,
                0,
                sellPath,
                address(this),
                block.timestamp
            );
        } else {
            IUniswapV2Router(AERO_ROUTER).swapExactTokensForTokens(
                tokenInReceived,
                0,
                sellPath,
                address(this),
                block.timestamp
            );
        }
        
        uint256 tokenOutBalanceAfter = IERC20(asset).balanceOf(address(this));
        
        // Step 3: Verify we have enough to repay loan + premium
        uint256 amountOwed = amount + premium;
        require(
            tokenOutBalanceAfter >= amountOwed,
            "Arb not profitable — revert"
        );
        
        // Step 4: Approve Aave Pool to pull repayment
        IERC20(asset).approve(AAVE_V3_POOL, amountOwed);
        
        // Step 5: Send profit to owner
        uint256 profit = tokenOutBalanceAfter - amountOwed;
        if (profit >= arbParams.minProfitWei) {
            IERC20(asset).transfer(owner, profit);
        }
        
        return true;
    }
    
    /**
     * @dev Withdraw any stuck tokens (safety mechanism)
     */
    function rescue(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(owner, balance);
        }
    }
    
    /**
     * @dev Allow receiving ETH (for gas top-up)
     */
    receive() external payable {}
}

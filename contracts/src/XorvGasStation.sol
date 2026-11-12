// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITestDollar {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function faucet() external;
}

/// @title XorvGasStation: test funds for a brand-new wallet, in one tap.
/// @notice A judge who opens Xorv with an empty wallet has no tUSD to pay x402 with and no AVAX for the eERC
///         transactions of the private lane. Xorv's sponsor (a relayer key held by the gateway) calls `drip` for
///         the wallet, and the station sends a fixed amount of tUSD, plus a sip of AVAX when the wallet has none.
///         It pays only a wallet that:
///           - signed this exact request (station, chain, wallet, deadline) with its own key,
///           - has never been dripped before,
///           - is not a contract,
///         and only while today's cap and the per-requester cap (a keyed hash of the requester's IP, computed by the
///         relayer, never the IP itself) have room. The limits live here, on-chain, so they hold across restarts and
///         anyone can audit them on Snowtrace. When its tUSD runs low the station draws the test dollar's own faucet
///         (100 tUSD per hour per address), so it keeps going without anyone topping it up. Same design as
///         KumiGasStation (Kumi on Avalanche), with the tUSD leg added.
contract XorvGasStation {
    ITestDollar public immutable tusd;
    address public owner;
    address public relayer;
    uint256 public dripAmount; // AVAX (wei), sent only to a wallet that holds none
    uint256 public tusdAmount; // tUSD base units (6 decimals)
    uint32 public dailyCap; // drips per UTC day, all wallets
    uint16 public perTagDaily; // drips per UTC day per requester tag
    uint256 public totalDrips;

    uint256 public constant MAX_DEADLINE = 1 hours;

    mapping(address => bool) public dripped;
    mapping(uint256 => uint32) public dripsOnDay; // day => drips
    mapping(uint256 => mapping(bytes32 => uint16)) public tagOnDay; // day => tag => drips

    event Dripped(address indexed to, bytes32 indexed tag, uint256 avax, uint256 tusd, uint256 day);
    event Configured(uint256 dripAmount, uint256 tusdAmount, uint32 dailyCap, uint16 perTagDaily);
    event RelayerSet(address relayer);
    event Withdrawn(address to, uint256 amount);
    event Refilled(uint256 balance);

    error NotOwner();
    error NotRelayer();
    error Expired();
    error DeadlineTooFar();
    error BadSignature();
    error AlreadyDripped();
    error NotWallet();
    error DailyCapReached();
    error TagCapReached();
    error Empty();
    error NoTusd();
    error TransferFailed();
    error BadConfig();

    constructor(address tusd_, address relayer_, uint256 dripAmount_, uint256 tusdAmount_, uint32 dailyCap_, uint16 perTagDaily_) {
        tusd = ITestDollar(tusd_);
        owner = msg.sender;
        relayer = relayer_;
        _config(dripAmount_, tusdAmount_, dailyCap_, perTagDaily_);
        emit RelayerSet(relayer_);
    }

    receive() external payable {}

    /// @notice The 32-byte digest a wallet signs (EIP-191 personal_sign of these raw bytes) to ask for test funds.
    function digest(address to, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encodePacked("Xorv test funds", block.chainid, address(this), to, deadline));
    }

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice What is left today: total drips, drips for one tag, and the AVAX sips the balance can still pay.
    function room(bytes32 tag) external view returns (uint256 dayLeft, uint256 tagLeft, uint256 funded) {
        uint256 d = today();
        dayLeft = dailyCap - dripsOnDay[d];
        tagLeft = perTagDaily - tagOnDay[d][tag];
        funded = address(this).balance / dripAmount;
    }

    /// @notice Anyone may top the station's tUSD up from the test dollar's faucet (once per hour).
    function refill() public {
        tusd.faucet();
        emit Refilled(tusd.balanceOf(address(this)));
    }

    function drip(address payable to, uint256 deadline, bytes calldata sig, bytes32 tag) external {
        if (msg.sender != relayer) revert NotRelayer();
        if (block.timestamp > deadline) revert Expired();
        if (deadline > block.timestamp + MAX_DEADLINE) revert DeadlineTooFar();
        if (_recover(digest(to, deadline), sig) != to) revert BadSignature();
        if (dripped[to]) revert AlreadyDripped();
        if (to.code.length != 0) revert NotWallet();
        uint256 d = today();
        if (dripsOnDay[d] >= dailyCap) revert DailyCapReached();
        if (tagOnDay[d][tag] >= perTagDaily) revert TagCapReached();
        uint256 avax = to.balance == 0 ? dripAmount : 0;
        if (address(this).balance < avax) revert Empty();
        if (tusd.balanceOf(address(this)) < tusdAmount) {
            // The faucet reverts during its cooldown; then the station really is out of tUSD for now.
            try tusd.faucet() {} catch {}
            if (tusd.balanceOf(address(this)) < tusdAmount) revert NoTusd();
        }

        dripped[to] = true;
        dripsOnDay[d]++;
        tagOnDay[d][tag]++;
        totalDrips++;
        emit Dripped(to, tag, avax, tusdAmount, d);
        if (!tusd.transfer(to, tusdAmount)) revert TransferFailed();
        if (avax != 0) {
            (bool ok,) = to.call{value: avax, gas: 10_000}("");
            if (!ok) revert TransferFailed();
        }
    }

    // ---------------------------------------------------------------- owner
    function configure(uint256 dripAmount_, uint256 tusdAmount_, uint32 dailyCap_, uint16 perTagDaily_) external onlyOwner {
        _config(dripAmount_, tusdAmount_, dailyCap_, perTagDaily_);
    }

    function setRelayer(address r) external onlyOwner {
        relayer = r;
        emit RelayerSet(r);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        emit Withdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function transferOwnership(address o) external onlyOwner {
        owner = o;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function _config(uint256 a, uint256 t, uint32 cap, uint16 perTag) internal {
        // A sip of zero, or more than 0.01 AVAX, is a mistake on a gas faucet; so is more than 100 tUSD.
        if (a == 0 || a > 0.01 ether || t == 0 || t > 100e6 || cap == 0 || perTag == 0) revert BadConfig();
        dripAmount = a;
        tusdAmount = t;
        dailyCap = cap;
        perTagDaily = perTag;
        emit Configured(a, t, cap, perTag);
    }

    /// @dev EIP-191 personal_sign recovery with low-s and v in {27, 28}; returns address(0) on anything malformed.
    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        return ecrecover(m, v, r, s);
    }
}

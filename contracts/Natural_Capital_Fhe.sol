pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract NaturalCapitalFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchOpen;
    mapping(uint256 => uint256) public assetCountInBatch;

    struct AssetData {
        euint32 encryptedArea;
        euint32 encryptedHealthIndex;
        euint32 encryptedCarbonSequestration;
        euint32 encryptedBiodiversityIndex;
        address ownerAddress;
    }

    mapping(uint256 => mapping(uint256 => AssetData)) public batchAssets;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsChanged(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event AssetSubmitted(address indexed provider, uint256 indexed batchId, uint256 assetIndex);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalArea, uint256 totalCarbonSequestration);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error InvalidBatchId();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown(address _address, mapping(address => uint256) storage _lastTime) {
        if (block.timestamp < _lastTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        currentBatchId = 1;
        isBatchOpen[currentBatchId] = true;
        emit BatchOpened(currentBatchId);
        cooldownSeconds = 60; // Default 60 seconds cooldown
    }

    function transferOwnership(address newOwner) public onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) public onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) public onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) public onlyOwner {
        if (_paused) {
            paused = true;
            emit Paused(msg.sender);
        } else {
            paused = false;
            emit Unpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) public onlyOwner {
        require(newCooldownSeconds > 0, "Cooldown must be positive");
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsChanged(oldCooldown, newCooldownSeconds);
    }

    function openNewBatch() public onlyOwner whenNotPaused {
        currentBatchId++;
        isBatchOpen[currentBatchId] = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) public onlyOwner {
        if (!isBatchOpen[batchId]) revert BatchClosedOrInvalid();
        isBatchOpen[batchId] = false;
        emit BatchClosed(batchId);
    }

    function submitAsset(
        euint32 encryptedArea,
        euint32 encryptedHealthIndex,
        euint32 encryptedCarbonSequestration,
        euint32 encryptedBiodiversityIndex
    ) external onlyProvider whenNotPaused respectCooldown(msg.sender, lastSubmissionTime) {
        if (!isBatchOpen[currentBatchId]) revert BatchClosedOrInvalid();

        uint256 assetIndex = assetCountInBatch[currentBatchId];
        batchAssets[currentBatchId][assetIndex] = AssetData({
            encryptedArea: encryptedArea,
            encryptedHealthIndex: encryptedHealthIndex,
            encryptedCarbonSequestration: encryptedCarbonSequestration,
            encryptedBiodiversityIndex: encryptedBiodiversityIndex,
            ownerAddress: msg.sender
        });
        assetCountInBatch[currentBatchId]++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit AssetSubmitted(msg.sender, currentBatchId, assetIndex);
    }

    function requestBatchSummaryDecryption(uint256 batchId) external whenNotPaused respectCooldown(msg.sender, lastDecryptionRequestTime) {
        if (assetCountInBatch[batchId] == 0) revert InvalidBatchId();

        euint32 totalEncryptedArea;
        euint32 totalEncryptedCarbonSequestration;
        bool initialized = false;

        for (uint256 i = 0; i < assetCountInBatch[batchId]; i++) {
            AssetData storage asset = batchAssets[batchId][i];
            if (!FHE.isInitialized(totalEncryptedArea)) {
                totalEncryptedArea = asset.encryptedArea;
                totalEncryptedCarbonSequestration = asset.encryptedCarbonSequestration;
                initialized = true;
            } else {
                totalEncryptedArea = FHE.add(totalEncryptedArea, asset.encryptedArea);
                totalEncryptedCarbonSequestration = FHE.add(totalEncryptedCarbonSequestration, asset.encryptedCarbonSequestration);
            }
        }
        if (!initialized) { // Should be caught by assetCountInBatch check, but defensive
            revert InvalidBatchId();
        }

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(totalEncryptedArea);
        cts[1] = FHE.toBytes32(totalEncryptedCarbonSequestration);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection ensures this callback is processed only once for a given requestId.

        DecryptionContext storage ctx = decryptionContexts[requestId];
        uint256 batchId = ctx.batchId;

        euint32 totalEncryptedArea;
        euint32 totalEncryptedCarbonSequestration;
        bool initialized = false;

        for (uint256 i = 0; i < assetCountInBatch[batchId]; i++) {
            AssetData storage asset = batchAssets[batchId][i];
            if (!FHE.isInitialized(totalEncryptedArea)) {
                totalEncryptedArea = asset.encryptedArea;
                totalEncryptedCarbonSequestration = asset.encryptedCarbonSequestration;
                initialized = true;
            } else {
                totalEncryptedArea = FHE.add(totalEncryptedArea, asset.encryptedArea);
                totalEncryptedCarbonSequestration = FHE.add(totalEncryptedCarbonSequestration, asset.encryptedCarbonSequestration);
            }
        }
        if (!initialized) { // Should not happen if batchId was valid
            revert InvalidBatchId();
        }

        bytes32[] memory currentCts = new bytes32[](2);
        currentCts[0] = FHE.toBytes32(totalEncryptedArea);
        currentCts[1] = FHE.toBytes32(totalEncryptedCarbonSequestration);

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != ctx.stateHash) {
            revert StateMismatch();
        }
        // Security: State hash verification ensures that the contract state (specifically the ciphertexts
        // that were intended for decryption) has not changed between the requestDecryption call and this callback.
        // This prevents scenarios where an attacker might alter the data after a decryption was requested
        // but before it was processed.

        FHE.checkSignatures(requestId, cleartexts, proof); // Will revert on failure
        // Security: Proof verification ensures the cleartexts are authentic and correspond to the original ciphertexts.

        (uint32 totalAreaCleartext, uint32 totalCarbonCleartext) = abi.decode(cleartexts, (uint32, uint32));

        ctx.processed = true;
        emit DecryptionCompleted(requestId, batchId, totalAreaCleartext, totalCarbonCleartext);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage target, euint32 value) internal {
        if (!FHE.isInitialized(target)) {
            target = value;
        }
    }

    function _requireInitialized(euint32 storage target) internal view {
        if (!FHE.isInitialized(target)) {
            revert("FHE value not initialized");
        }
    }
}
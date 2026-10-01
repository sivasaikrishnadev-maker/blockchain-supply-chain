// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SupplyChain {
    struct Product {
        string productId;
        string productHash;
        uint256 registeredAt;
        bool exists;
    }

    struct EventRecord {
        string eventType;
        string eventHash;
        uint256 timestamp;
    }

    mapping(bytes32 => Product) private products;
    mapping(bytes32 => EventRecord[]) private productEvents;

    event ProductRegistered(
        string productId,
        string productHash,
        uint256 timestamp
    );
    event SupplyChainEventAdded(
        string productId,
        string eventType,
        string eventHash,
        uint256 timestamp
    );

    function registerProduct(
        string calldata productId,
        string calldata productHash
    ) external {
        bytes32 key = keccak256(bytes(productId));
        require(!products[key].exists, "Product already registered");

        products[key] = Product({
            productId: productId,
            productHash: productHash,
            registeredAt: block.timestamp,
            exists: true
        });

        emit ProductRegistered(productId, productHash, block.timestamp);
    }

    function addEvent(
        string calldata productId,
        string calldata eventType,
        string calldata eventHash
    ) external {
        bytes32 key = keccak256(bytes(productId));
        require(products[key].exists, "Product is not registered");

        productEvents[key].push(
            EventRecord({
                eventType: eventType,
                eventHash: eventHash,
                timestamp: block.timestamp
            })
        );

        emit SupplyChainEventAdded(
            productId,
            eventType,
            eventHash,
            block.timestamp
        );
    }

    function getProduct(
        string calldata productId
    )
        external
        view
        returns (
            string memory storedProductId,
            string memory productHash,
            uint256 registeredAt,
            bool exists
        )
    {
        Product storage product = products[keccak256(bytes(productId))];
        return (
            product.productId,
            product.productHash,
            product.registeredAt,
            product.exists
        );
    }

    function getEvents(
        string calldata productId
    ) external view returns (EventRecord[] memory) {
        return productEvents[keccak256(bytes(productId))];
    }
}
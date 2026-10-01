const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SupplyChain", function () {
  async function deploy() {
    const contract = await ethers.deployContract("SupplyChain");
    await contract.waitForDeployment();
    return contract;
  }

  it("registers a product and records tamper-evident events", async function () {
    const contract = await deploy();
    const id = "HNY001";
    const productHash = "sha256:product";
    const eventHash = "sha256:event";

    await expect(contract.registerProduct(id, productHash))
      .to.emit(contract, "ProductRegistered")
      .withArgs(id, productHash, await timeOfNextBlock());

    const product = await contract.getProduct(id);
    expect(product[0]).to.equal(id);
    expect(product[1]).to.equal(productHash);
    expect(product[3]).to.equal(true);

    await expect(contract.addEvent(id, "Received by Distributor", eventHash))
      .to.emit(contract, "SupplyChainEventAdded");

    const events = await contract.getEvents(id);
    expect(events).to.have.length(1);
    expect(events[0].eventType).to.equal("Received by Distributor");
    expect(events[0].eventHash).to.equal(eventHash);
  });

  it("rejects duplicate product registrations", async function () {
    const contract = await deploy();
    await contract.registerProduct("HNY001", "hash-one");
    await expect(
      contract.registerProduct("HNY001", "hash-two"),
    ).to.be.revertedWith("Product already registered");
  });

  async function timeOfNextBlock() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 1;
  }
});
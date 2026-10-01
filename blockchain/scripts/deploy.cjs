async function main() {
  const contract = await ethers.deployContract("SupplyChain");
  await contract.waitForDeployment();
  console.log(`SupplyChain deployed at ${await contract.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
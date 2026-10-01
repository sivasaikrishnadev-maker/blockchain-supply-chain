import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  type JsonRpcSigner,
  type Provider,
} from "ethers";
import { logger } from "./logger";

interface TransactionResponse {
  hash: string;
  wait(): Promise<unknown>;
}

interface ChainProduct {
  productId: string;
  productHash: string;
  registeredAt: bigint;
  exists: boolean;
}

interface ChainEvent {
  eventType: string;
  eventHash: string;
  timestamp: bigint;
}

interface SupplyChainContract {
  registerProduct(productId: string, productHash: string): Promise<TransactionResponse>;
  addEvent(
    productId: string,
    eventType: string,
    eventHash: string,
  ): Promise<TransactionResponse>;
  getProduct(productId: string): Promise<readonly [string, string, bigint, boolean]>;
  getEvents(productId: string): Promise<ChainEvent[]>;
}

let provider: JsonRpcProvider | undefined;
let supplyChain: SupplyChainContract | undefined;

export async function initializeBlockchain(): Promise<boolean> {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
  provider = new JsonRpcProvider(rpcUrl);
  const artifactPath = path.resolve(
    process.cwd(),
    "../../blockchain/artifacts/contracts/SupplyChain.sol/SupplyChain.json",
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    abi: unknown[];
    bytecode: string;
  };

  let signer: Wallet | JsonRpcSigner;
  if (process.env.PRIVATE_KEY) {
    signer = new Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    const accounts = (await provider.send("eth_accounts", [])) as string[];
    if (!accounts.length) {
      throw new Error(
        "The configured blockchain has no unlocked signer. Set PRIVATE_KEY for an external RPC or use the local Hardhat node.",
      );
    }
    signer = await provider.getSigner(accounts[0]);
  }

  let address = process.env.CONTRACT_ADDRESS;
  const deployedHere = !address;
  if (address) {
    const code = await provider.getCode(address);
    if (code === "0x") {
      throw new Error(
        "CONTRACT_ADDRESS has no contract code on the configured blockchain.",
      );
    }
  } else {
    const deployed = await new ContractFactory(
      artifact.abi as never[],
      artifact.bytecode,
      signer,
    ).deploy();
    await deployed.waitForDeployment();
    address = await deployed.getAddress();
    process.env.CONTRACT_ADDRESS = address;
  }

  supplyChain = new Contract(
    address,
    artifact.abi as never[],
    signer,
  ) as unknown as SupplyChainContract;
  logger.info(
    { contractAddress: address, deployedHere },
    "SupplyChain contract ready",
  );
  return deployedHere;
}

function contract(): SupplyChainContract {
  if (!supplyChain) {
    throw new Error("Blockchain connection has not been initialized.");
  }
  return supplyChain;
}

export async function registerProductOnChain(
  productId: string,
  productHash: string,
): Promise<string> {
  const tx = await contract().registerProduct(productId, productHash);
  await tx.wait();
  return tx.hash;
}

export async function addEventOnChain(
  productId: string,
  eventType: string,
  eventHash: string,
): Promise<string> {
  const tx = await contract().addEvent(productId, eventType, eventHash);
  await tx.wait();
  return tx.hash;
}

export async function readProductFromChain(
  productId: string,
): Promise<ChainProduct> {
  const [storedProductId, productHash, registeredAt, exists] =
    await contract().getProduct(productId);
  return { productId: storedProductId, productHash, registeredAt, exists };
}

export async function readEventsFromChain(
  productId: string,
): Promise<ChainEvent[]> {
  return contract().getEvents(productId);
}

export async function closeBlockchain(): Promise<void> {
  await provider?.destroy();
  provider = undefined;
  supplyChain = undefined;
}
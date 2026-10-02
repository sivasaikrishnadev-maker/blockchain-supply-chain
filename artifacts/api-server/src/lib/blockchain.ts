import { readFile } from "node:fs/promises";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  type JsonRpcSigner,
} from "ethers";
import { logger } from "./logger";
import { resolveContractArtifactPath } from "./paths";

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

/**
 * Resolve the JSON-RPC endpoint.
 *
 * `BLOCKCHAIN_RPC_URL` is the production configuration. When it is not set the
 * application falls back to a local Hardhat node on 127.0.0.1:8545, which only
 * works when that node is running as a managed child process (see
 * `scripts/start.mjs`). Production deployments should always set the variable.
 */
function resolveRpcUrl(): string {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
  if (rpcUrl) {
    return rpcUrl;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BLOCKCHAIN_RPC_URL must be set in production. Refusing to start with the local development chain, whose state is in-memory only and would be lost on every restart.",
    );
  }
  return "http://127.0.0.1:8545";
}

/**
 * Connect to the chain and make sure a SupplyChain contract is available.
 *
 * Two supported modes, both driven by environment variables only:
 *
 *  - `CONTRACT_ADDRESS` set  -> attach to an already-deployed contract. This is
 *    the mode to use on a persistent EVM network (e.g. a testnet) so that
 *    already-recorded products keep their history.
 *  - `CONTRACT_ADDRESS` unset -> deploy a fresh contract from the compiled
 *    artifact. Only safe on an ephemeral local chain; `restoreBlockchainState`
 *    then replays the PostgreSQL records onto the new ledger.
 */
export async function initializeBlockchain(): Promise<boolean> {
  const rpcUrl = resolveRpcUrl();
  provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });

  const artifactPath = resolveContractArtifactPath();
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    abi: unknown[];
    bytecode: string;
  };
  logger.info({ artifactPath }, "Loaded compiled SupplyChain contract artifact");

  let signer: Wallet | JsonRpcSigner;
  if (process.env.PRIVATE_KEY) {
    signer = new Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    // No private key means we rely on the RPC exposing an unlocked account.
    // A public testnet never does this, so require the key in production.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PRIVATE_KEY must be set in production so the server can sign SupplyChain transactions.",
      );
    }
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
    { contractAddress: address, deployedHere, rpcUrl },
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

/**
 * Upper bound on a single ledger read/write.
 *
 * `transitionProduct` holds an open database transaction while it awaits the
 * chain. If the RPC hangs, that transaction keeps a pooled connection checked
 * out indefinitely and the pool (capped small on a free tier) is exhausted,
 * turning one unreachable endpoint into a full outage. Failing fast keeps the
 * existing "no status change was saved" behaviour instead.
 */
const RPC_TIMEOUT_MS = Number(process.env.BLOCKCHAIN_TIMEOUT_MS ?? 20_000);

async function withRpcTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`The blockchain did not respond within ${RPC_TIMEOUT_MS}ms (${label}).`)),
          RPC_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function registerProductOnChain(
  productId: string,
  productHash: string,
): Promise<string> {
  return withRpcTimeout(
    (async () => {
      const tx = await contract().registerProduct(productId, productHash);
      await tx.wait();
      return tx.hash;
    })(),
    "registerProduct",
  );
}

export async function addEventOnChain(
  productId: string,
  eventType: string,
  eventHash: string,
): Promise<string> {
  return withRpcTimeout(
    (async () => {
      const tx = await contract().addEvent(productId, eventType, eventHash);
      await tx.wait();
      return tx.hash;
    })(),
    "addEvent",
  );
}

export async function readProductFromChain(
  productId: string,
): Promise<ChainProduct> {
  return withRpcTimeout(
    (async () => {
      const [storedProductId, productHash, registeredAt, exists] =
        await contract().getProduct(productId);
      return { productId: storedProductId, productHash, registeredAt, exists };
    })(),
    "getProduct",
  );
}

export async function readEventsFromChain(
  productId: string,
): Promise<ChainEvent[]> {
  return withRpcTimeout(
    (async () => contract().getEvents(productId))(),
    "getEvents",
  );
}

export async function closeBlockchain(): Promise<void> {
  provider?.destroy();
  provider = undefined;
  supplyChain = undefined;
}

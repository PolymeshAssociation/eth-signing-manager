import { EthTransactionRequest, HexString } from '@polymeshassociation/signing-manager-types';

/**
 * Re-exported from `@polymeshassociation/signing-manager-types`, which is where these interfaces
 * are defined. They appear in this package's own public signatures — `getEthSigner()` returns an
 * `EthSigner`, and {@link EthLocalAccount} is handed an `EthTransactionRequest` — so re-exporting
 * them lets a consumer name those types without adding a direct dependency of its own
 */
export type {
  EthSigner,
  EthSignerCapabilities,
  EthSigningManager,
  EthTransactionRequest,
} from '@polymeshassociation/signing-manager-types';

/**
 * Callback returned by the subscription methods. Call it to stop receiving updates
 */
export type UnsubCallback = () => void;

/**
 * Minimal shape of an [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) provider.
 *
 * `window.ethereum` (MetaMask, Rabby, Coinbase Wallet), a WalletConnect
 * `EthereumProvider` and the Coinbase Wallet SDK provider all satisfy it structurally, so no
 * wallet library needs to be a dependency of this package
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Minimal structural shape of a local (in-process) Ethereum account.
 *
 * A viem `LocalAccount` (`privateKeyToAccount(...)`) and an ethers `Wallet` both satisfy it, so
 * neither library needs to be a dependency of this package. See the README for adapter snippets
 *
 * @note a local account signs but does not broadcast, so the SDK always broadcasts for it
 */
export interface EthLocalAccount {
  /** the account's 0x-prefixed H160 address */
  address: string;
  /** sign a transaction, returning the raw signed (RLP encoded) bytes */
  signTransaction(tx: EthTransactionRequest): Promise<HexString>;
}

/**
 * Details of the network the wrapped EIP-1193 provider is currently connected to
 */
export interface NetworkInfo {
  /** the 0x-prefixed hex chain ID reported by `eth_chainId` */
  chainId: HexString;
}

/**
 * What `EthSigningManager.create` resolved a wallet to be able to do, from its conservative
 * defaults plus any {@link EthSignerCapabilityOverrides}.
 *
 * This is a *construction time* concern, deliberately separate from the runtime
 * `EthSignerCapabilities` contract. At runtime, whether a signer can sign or broadcast is expressed
 * by which of `signTransaction` / `sendTransaction` the returned `EthSigner` defines — a flag
 * saying the same thing beside an optional method could only ever contradict it. These booleans
 * exist only because that decision has to be *made* somewhere, before the signer is built
 */
export interface ResolvedCapabilities {
  /** whether the signer can return raw signed bytes, letting the SDK broadcast and track it */
  signTransaction: boolean;
  /** whether the signer broadcasts the transaction itself, and so owns the nonce */
  sendTransaction: boolean;
  /** `false` for signers that can only encode legacy (type 0) transactions */
  eip1559: boolean;
}

/**
 * Capability overrides passed to `EthSigningManager.create`.
 *
 * `eth_signTransaction` support cannot be feature-detected without sending a request to the wallet,
 * so the defaults are conservative and every field can be overridden explicitly
 */
export type EthSignerCapabilityOverrides = Partial<ResolvedCapabilities>;

export interface EthSigningManagerBaseArgs {
  /**
   * (optional) SS58 format in which the derived Polymesh addresses will be encoded.
   *
   * Defaults to 42. The Polymesh SDK calls `setSs58Format` with the connected chain's format before
   * calling `getAccounts`, so this only matters when the manager is used standalone
   */
  ss58Format?: number;
  /**
   * (optional) explicit capability overrides. See {@link EthSignerCapabilityOverrides}
   */
  capabilities?: EthSignerCapabilityOverrides;
}

export interface EthSigningManagerProviderArgs extends EthSigningManagerBaseArgs {
  /** an EIP-1193 provider, e.g. `window.ethereum` */
  provider: Eip1193Provider;
  /**
   * (optional) whether to call `eth_requestAccounts` (prompting the user to connect) when resolving
   * accounts. Defaults to `true`. Pass `false` to only read already authorized accounts via
   * `eth_accounts`
   */
  requestAccounts?: boolean;
}

export interface EthSigningManagerLocalArgs extends EthSigningManagerBaseArgs {
  /** one or more local accounts (viem/ethers adapters). See {@link EthLocalAccount} */
  accounts: EthLocalAccount[];
}

export type EthSigningManagerArgs = EthSigningManagerProviderArgs | EthSigningManagerLocalArgs;

/**
 * Error thrown by an EIP-1193 provider. `code` is a
 * [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193#provider-errors) or JSON-RPC error code
 */
export interface ProviderRpcError extends Error {
  code?: number;
  data?: unknown;
}

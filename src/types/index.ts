import { EthTransactionRequest, HexString } from '@polymeshassociation/signing-manager-types';

/**
 * Re-exported so consumers can name the types this package's signatures use without depending on
 * `@polymeshassociation/signing-manager-types` directly
 */
export type {
  EthSigner,
  EthSignerCapabilities,
  EthSigningManager,
  EthTransactionRequest,
} from '@polymeshassociation/signing-manager-types';

/** Callback returned by the subscription methods. Call it to stop receiving updates */
export type UnsubCallback = () => void;

/**
 * Minimal shape of an [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) provider, satisfied by
 * `window.ethereum`, WalletConnect and the Coinbase Wallet SDK, so no wallet library is a
 * dependency here
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Minimal shape of a local (in-process) Ethereum account. Build one with {@link fromViemAccount} /
 * {@link fromEthersWallet} — viem and ethers do not accept the hex encoded request as is
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
 * Minimal shape of a viem `LocalAccount` or an ethers `Wallet`. The transaction parameter is left
 * untyped because each library declares its own, and neither is a dependency here
 */
export interface EthAccountLike {
  /** the account's 0x-prefixed H160 address */
  address: string;
  signTransaction: (tx: never, ...rest: never[]) => Promise<string>;
}

/** An {@link EthTransactionRequest} as viem's `TransactionSerializable` expects it */
export interface ViemTransactionRequest {
  to: HexString;
  data: HexString;
  value: bigint;
  gas: bigint;
  chainId: number;
  type: 'legacy' | 'eip1559';
  nonce?: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

/**
 * An {@link EthTransactionRequest} as ethers' `TransactionRequest` expects it
 *
 * @note ethers ignores a `gas` key and signs with a zero gas limit, so it must be `gasLimit`
 */
export interface EthersTransactionRequest {
  from: HexString;
  to: HexString;
  data: HexString;
  value: bigint;
  gasLimit: bigint;
  chainId: bigint;
  type: number;
  nonce?: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

/** Details of the network the wrapped EIP-1193 provider is currently connected to */
export interface NetworkInfo {
  /** the 0x-prefixed hex chain ID reported by `eth_chainId` */
  chainId: HexString;
}

/**
 * What `EthSigningManager.create` resolved a wallet to be able to do.
 *
 * Construction time only — at runtime the capability is expressed by which of `signTransaction` /
 * `sendTransaction` the built `EthSigner` defines, never by a flag
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
 * Capability overrides passed to `EthSigningManager.create`. Needed because `eth_signTransaction`
 * support cannot be feature detected without sending a request to the wallet
 */
export type EthSignerCapabilityOverrides = Partial<ResolvedCapabilities>;

export interface EthSigningManagerBaseArgs {
  /**
   * (optional) SS58 format for the derived Polymesh addresses. Defaults to 42, and only matters
   * standalone — the SDK overrides it before calling `getAccounts`
   */
  ss58Format?: number;
  /** (optional) explicit capability overrides. See {@link EthSignerCapabilityOverrides} */
  capabilities?: EthSignerCapabilityOverrides;
}

export interface EthSigningManagerProviderArgs extends EthSigningManagerBaseArgs {
  /** an EIP-1193 provider, e.g. `window.ethereum` */
  provider: Eip1193Provider;
  /**
   * (optional) whether to call `eth_requestAccounts`, prompting the user to connect. Defaults to
   * `true`. Pass `false` to read only already authorized accounts
   */
  requestAccounts?: boolean;
}

export interface EthSigningManagerLocalArgs extends EthSigningManagerBaseArgs {
  /** one or more local accounts, built with {@link fromViemAccount} / {@link fromEthersWallet} */
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

import { hexToU8a, u8aConcat, u8aEq } from '@polkadot/util';
import {
  decodeAddress,
  encodeAddress,
  ethereumEncode,
  isEthereumAddress,
} from '@polkadot/util-crypto';

import { EthTransactionRequest, ProviderRpcError } from '../types';

/** SS58 format used when none is supplied. The SDK overrides it before calling `getAccounts` */
export const DEFAULT_SS58_FORMAT = 42;

/** The 12 bytes appended to an H160 to form the `AccountId32` `revive` dispatches as */
export const ETH_ACCOUNT_SUFFIX = new Uint8Array(12).fill(0xee);

const ACCOUNT_ID_LENGTH = 32;
const H160_LENGTH = 20;

/**
 * Whether an address is Ethereum derived, i.e. its decoded `AccountId32` ends in 12 `0xEE` bytes
 *
 * @note the SDK implements this, {@link ethAddressFromSs58} and {@link ss58FromEthAddress}
 * separately in its `src/utils/eth.ts`, since it depends on `signing-manager-types` for types
 * only. The `DEV_ACCOUNTS` vectors are mirrored there, so drift fails a test. Its `ss58Format` is
 * required rather than optional by design: the SDK always knows the chain's format
 *
 * @param ss58Format - (optional) expected format. Any format is accepted when omitted
 *
 * @note never throws — a malformed address returns `false`
 */
export function isEthDerivedAddress(address: string, ss58Format?: number): boolean {
  let decoded: Uint8Array;

  try {
    decoded = decodeAddress(address, false, ss58Format ?? -1);
  } catch (err) {
    return false;
  }

  return (
    decoded.length === ACCOUNT_ID_LENGTH && u8aEq(decoded.subarray(H160_LENGTH), ETH_ACCOUNT_SUFFIX)
  );
}

/**
 * Convert an Ethereum derived Polymesh address into the checksummed H160 that controls it
 *
 * @param ss58Format - (optional) expected format. Any format is accepted when omitted
 *
 * @throws if the address is malformed, or is not Ethereum derived
 */
export function ethAddressFromSs58(address: string, ss58Format?: number): string {
  let decoded: Uint8Array;

  try {
    decoded = decodeAddress(address, false, ss58Format ?? -1);
  } catch (err) {
    throw new Error(`"${address}" is not a valid SS58 encoded address`);
  }

  if (
    decoded.length !== ACCOUNT_ID_LENGTH ||
    !u8aEq(decoded.subarray(H160_LENGTH), ETH_ACCOUNT_SUFFIX)
  ) {
    throw new Error(
      `"${address}" is not an Ethereum derived address. Only addresses whose last 12 bytes are 0xEE map to an Ethereum key`
    );
  }

  return ethereumEncode(decoded.subarray(0, H160_LENGTH));
}

/**
 * Convert an H160 into the Polymesh address `revive` dispatches as, i.e. `<h160> ++ [0xEE; 12]`
 *
 * @param ss58Format - (optional) format to encode with. Defaults to 42
 *
 * @throws if the passed value is not a valid Ethereum address
 */
export function ss58FromEthAddress(h160: string, ss58Format = DEFAULT_SS58_FORMAT): string {
  if (!isEthereumAddress(h160)) {
    throw new Error(`"${h160}" is not a valid Ethereum address`);
  }

  return encodeAddress(u8aConcat(hexToU8a(h160), ETH_ACCOUNT_SUFFIX), ss58Format);
}

/**
 * Return the EIP-55 checksummed representation of an Ethereum address
 *
 * @throws if the passed value is not a valid Ethereum address
 */
export function normalizeEthAddress(h160: string): string {
  if (!isEthereumAddress(h160)) {
    throw new Error(`"${h160}" is not a valid Ethereum address`);
  }

  return ethereumEncode(hexToU8a(h160));
}

/**
 * Whether two Ethereum addresses refer to the same account, ignoring checksum casing
 */
export function isSameEthAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Parse a chain ID, tolerating hex (what `eth_chainId` returns) and decimal strings
 *
 * @note returns `undefined` rather than throwing when the value cannot be parsed
 */
export function parseChainId(chainId: string): bigint | undefined {
  try {
    return BigInt(chainId);
  } catch (err) {
    return undefined;
  }
}

/**
 * Whether two chain IDs refer to the same chain, ignoring hex encoding and casing
 *
 * @note an unreadable chain ID counts as a mismatch, failing closed — see
 *   `assertWalletOnTargetChain`
 */
export function isSameChainId(a: string, b: string): boolean {
  const parsedA = parseChainId(a);
  const parsedB = parseChainId(b);

  if (parsedA === undefined || parsedB === undefined) {
    return false;
  }

  return parsedA === parsedB;
}

/** Render a chain ID as `<hex> (<decimal>)` for error messages */
export function formatChainId(chainId: string): string {
  const parsed = parseChainId(chainId);

  return parsed === undefined ? `"${chainId}"` : `${chainId} (${parsed})`;
}

/**
 * Human readable messages for the EIP-1193 / JSON-RPC error codes a wallet can return
 *
 * @note the 4001 message must keep containing `Cancelled`: SDK versions predating the `code` check
 *   pattern match on it to detect a user rejection
 */
export const PROVIDER_ERROR_MESSAGES: Record<number, string> = {
  4001: 'Cancelled: the request was rejected by the user',
  4100: 'The requested Account or method has not been authorized by the wallet',
  4200: 'The wallet does not support the requested method',
  4900: 'The wallet is disconnected from all chains',
  4901: 'The wallet is not connected to the requested chain',
  [-32601]: 'The wallet does not implement the requested method',
  [-32602]: 'The wallet rejected the request as having invalid parameters',
};

/**
 * Extract the EIP-1193 error code from an unknown thrown value, if it has one
 */
export function getProviderErrorCode(error: unknown): number | undefined {
  const { code } = (error ?? {}) as ProviderRpcError;

  return typeof code === 'number' ? code : undefined;
}

/**
 * Whether a thrown value indicates that the wallet does not implement the requested method
 */
export function isUnsupportedMethodError(error: unknown): boolean {
  const code = getProviderErrorCode(error);

  if (code === 4200 || code === -32601) {
    return true;
  }

  const { message } = (error ?? {}) as ProviderRpcError;
  const normalized = (message ?? '').toLowerCase();

  return (
    normalized.includes('not supported') ||
    normalized.includes('unsupported method') ||
    normalized.includes('method not found') ||
    normalized.includes('does not exist')
  );
}

/**
 * Translate a provider error into one the caller and the SDK can act on, preserving its `code`
 *
 * @param action - what was being attempted, e.g. `'sign the transaction'`
 */
export function mapProviderError(error: unknown, action: string): ProviderRpcError {
  const original = (error ?? {}) as ProviderRpcError;
  const code = getProviderErrorCode(error);
  const originalMessage = original.message ?? String(error);

  const mapped = code === undefined ? undefined : PROVIDER_ERROR_MESSAGES[code];

  const message = mapped
    ? `${mapped} while attempting to ${action}: ${originalMessage}`
    : `Failed to ${action}: ${originalMessage}`;

  const mappedError: ProviderRpcError = new Error(message);
  mappedError.code = code;
  mappedError.data = original.data;

  return mappedError;
}

/**
 * Serialize an `EthTransactionRequest` for an EIP-1193 provider, dropping the `undefined` fields
 * wallets reject
 */
export function serializeTransactionRequest(tx: EthTransactionRequest): Record<string, unknown> {
  const entries = Object.entries(tx) as [string, unknown][];

  return entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key] = value;
    }

    return acc;
  }, {});
}

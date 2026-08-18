import { HexString } from '@polymeshassociation/signing-manager-types';

import {
  EthAccountLike,
  EthersTransactionRequest,
  EthLocalAccount,
  EthTransactionRequest,
  ViemTransactionRequest,
} from '../types';

/**
 * @hidden
 *
 * Sign with an account, asserting the request shape {@link EthAccountLike} leaves untyped. Called
 * as a method because ethers' `Wallet` needs its receiver
 */
async function sign(
  account: EthAccountLike,
  tx: ViemTransactionRequest | EthersTransactionRequest
): Promise<HexString> {
  const signer = account as unknown as {
    signTransaction: (request: typeof tx) => Promise<string>;
  };

  return (await signer.signTransaction(tx)) as HexString;
}

/** Convert an `EthTransactionRequest` into the shape viem signs */
export function toViemTransaction(tx: EthTransactionRequest): ViemTransactionRequest {
  const {
    to,
    data,
    value,
    gas,
    chainId,
    type,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPrice,
  } = tx;

  const request: ViemTransactionRequest = {
    to,
    data,
    value: BigInt(value),
    gas: BigInt(gas),
    chainId: Number(chainId),
    type: type === '0x2' ? 'eip1559' : 'legacy',
  };

  if (nonce !== undefined) {
    request.nonce = Number(nonce);
  }

  if (maxFeePerGas !== undefined) {
    request.maxFeePerGas = BigInt(maxFeePerGas);
  }

  if (maxPriorityFeePerGas !== undefined) {
    request.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas);
  }

  if (gasPrice !== undefined) {
    request.gasPrice = BigInt(gasPrice);
  }

  return request;
}

/** Convert an `EthTransactionRequest` into the shape ethers signs */
export function toEthersTransaction(tx: EthTransactionRequest): EthersTransactionRequest {
  const {
    from,
    to,
    data,
    value,
    gas,
    chainId,
    type,
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPrice,
  } = tx;

  const request: EthersTransactionRequest = {
    from,
    to,
    data,
    value: BigInt(value),
    gasLimit: BigInt(gas),
    chainId: BigInt(chainId),
    type: Number(type),
  };

  if (nonce !== undefined) {
    request.nonce = Number(nonce);
  }

  if (maxFeePerGas !== undefined) {
    request.maxFeePerGas = BigInt(maxFeePerGas);
  }

  if (maxPriorityFeePerGas !== undefined) {
    request.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas);
  }

  if (gasPrice !== undefined) {
    request.gasPrice = BigInt(gasPrice);
  }

  return request;
}

/** Adapt a viem `LocalAccount` (`privateKeyToAccount(...)`) into an account this manager can use */
export function fromViemAccount(account: EthAccountLike): EthLocalAccount {
  return {
    address: account.address,
    signTransaction: (tx) => sign(account, toViemTransaction(tx)),
  };
}

/** Adapt an ethers `Wallet`, or any `Signer` that signs offline, into an account this manager can use */
export function fromEthersWallet(wallet: EthAccountLike): EthLocalAccount {
  return {
    address: wallet.address,
    signTransaction: (tx) => sign(wallet, toEthersTransaction(tx)),
  };
}

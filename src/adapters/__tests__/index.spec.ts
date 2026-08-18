import { HexString } from '@polymeshassociation/signing-manager-types';
import { Transaction, Wallet } from 'ethers';
import { parseTransaction } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { EthAccountLike, EthTransactionRequest } from '../../types';
import {
  fromEthersWallet,
  fromViemAccount,
  toEthersTransaction,
  toViemTransaction,
} from '../index';

/** Alith, the first prefunded Moonbeam dev key */
const ALITH_KEY = '0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133';
const ALITH_H160: HexString = '0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac';

const EIP_1559_TX: EthTransactionRequest = {
  from: ALITH_H160,
  to: '0x6d6f646c70792f70616464720000000000000000',
  data: '0x0719',
  value: '0x0',
  gas: '0x74e',
  chainId: '0x190d5a',
  nonce: '0x3',
  maxFeePerGas: '0x5af3107a4000',
  maxPriorityFeePerGas: '0x0',
  type: '0x2',
};

const LEGACY_TX: EthTransactionRequest = {
  from: ALITH_H160,
  to: '0x6d6f646c70792f70616464720000000000000000',
  data: '0x0719',
  value: '0x0',
  gas: '0x74e',
  chainId: '0x190d5a',
  nonce: '0x3',
  gasPrice: '0x5af3107a4000',
  type: '0x0',
};

describe('EthAccountLike', () => {
  it('should be satisfied by a viem account and an ethers wallet', () => {
    const viemAccount: EthAccountLike = privateKeyToAccount(ALITH_KEY);
    const ethersWallet: EthAccountLike = new Wallet(ALITH_KEY);

    expect(viemAccount.address).toBe(ALITH_H160);
    expect(ethersWallet.address).toBe(ALITH_H160);
  });
});

describe('toViemTransaction', () => {
  it('should convert an EIP-1559 request into viem native types', () => {
    expect(toViemTransaction(EIP_1559_TX)).toEqual({
      to: EIP_1559_TX.to,
      data: EIP_1559_TX.data,
      value: BigInt(0),
      gas: BigInt(0x74e),
      chainId: 0x190d5a,
      nonce: 3,
      maxFeePerGas: BigInt('0x5af3107a4000'),
      maxPriorityFeePerGas: BigInt(0),
      type: 'eip1559',
    });
  });

  it('should convert a legacy request into viem native types', () => {
    expect(toViemTransaction(LEGACY_TX)).toMatchObject({
      gasPrice: BigInt('0x5af3107a4000'),
      type: 'legacy',
    });
  });

  it('should omit fields the SDK did not supply', () => {
    const result = toViemTransaction({ ...EIP_1559_TX, nonce: undefined });

    expect(result).not.toHaveProperty('nonce');
    expect(result).not.toHaveProperty('gasPrice');
  });
});

describe('toEthersTransaction', () => {
  it('should convert an EIP-1559 request into ethers native types', () => {
    expect(toEthersTransaction(EIP_1559_TX)).toEqual({
      from: ALITH_H160,
      to: EIP_1559_TX.to,
      data: EIP_1559_TX.data,
      value: BigInt(0),
      gasLimit: BigInt(0x74e),
      chainId: BigInt(0x190d5a),
      nonce: 3,
      maxFeePerGas: BigInt('0x5af3107a4000'),
      maxPriorityFeePerGas: BigInt(0),
      type: 2,
    });
  });

  it('should convert a legacy request into ethers native types', () => {
    expect(toEthersTransaction(LEGACY_TX)).toMatchObject({
      gasPrice: BigInt('0x5af3107a4000'),
      type: 0,
    });
  });

  it('should omit fields the SDK did not supply', () => {
    const result = toEthersTransaction({ ...EIP_1559_TX, nonce: undefined });

    expect(result).not.toHaveProperty('nonce');
    expect(result).not.toHaveProperty('gasPrice');
  });
});

describe('fromViemAccount', () => {
  it('should sign a transaction viem can parse back', async () => {
    const account = fromViemAccount(privateKeyToAccount(ALITH_KEY));

    expect(account.address).toBe(ALITH_H160);

    const parsed = parseTransaction(await account.signTransaction(EIP_1559_TX));

    expect(parsed.type).toBe('eip1559');
    expect(parsed.gas).toBe(BigInt(0x74e));
    expect(parsed.chainId).toBe(0x190d5a);
    expect(parsed.nonce).toBe(3);
    expect(parsed.data).toBe(EIP_1559_TX.data);
    expect(parsed.maxFeePerGas).toBe(BigInt('0x5af3107a4000'));
  });

  it('should sign a legacy transaction', async () => {
    const account = fromViemAccount(privateKeyToAccount(ALITH_KEY));
    const parsed = parseTransaction(await account.signTransaction(LEGACY_TX));

    expect(parsed.type).toBe('legacy');
    expect(parsed.gasPrice).toBe(BigInt('0x5af3107a4000'));
    expect(parsed.gas).toBe(BigInt(0x74e));
  });
});

describe('fromEthersWallet', () => {
  it('should sign a transaction ethers can parse back, with the SDK supplied gas limit', async () => {
    const account = fromEthersWallet(new Wallet(ALITH_KEY));

    expect(account.address).toBe(ALITH_H160);

    const parsed = Transaction.from(await account.signTransaction(EIP_1559_TX));

    expect(parsed.type).toBe(2);
    expect(parsed.gasLimit).toBe(BigInt(0x74e));
    expect(parsed.chainId).toBe(BigInt(0x190d5a));
    expect(parsed.nonce).toBe(3);
    expect(parsed.data).toBe(EIP_1559_TX.data);
    expect(parsed.from).toBe(ALITH_H160);
  });

  it('should sign a legacy transaction', async () => {
    const account = fromEthersWallet(new Wallet(ALITH_KEY));
    const parsed = Transaction.from(await account.signTransaction(LEGACY_TX));

    expect(parsed.type).toBe(0);
    expect(parsed.gasPrice).toBe(BigInt('0x5af3107a4000'));
    expect(parsed.gasLimit).toBe(BigInt(0x74e));
  });
});

import { u8aToHex } from '@polkadot/util';
import { decodeAddress } from '@polkadot/util-crypto';
import { HexString } from '@polymeshassociation/signing-manager-types';

import { EthTransactionRequest } from '../../types';
import {
  DEFAULT_SS58_FORMAT,
  ETH_ACCOUNT_SUFFIX,
  ethAddressFromSs58,
  getProviderErrorCode,
  isEthDerivedAddress,
  isSameEthAddress,
  isUnsupportedMethodError,
  mapProviderError,
  normalizeEthAddress,
  serializeTransactionRequest,
  ss58FromEthAddress,
} from '../index';

/**
 * The five prefunded Moonbeam dev keys, with the Polymesh addresses derived from them.
 *
 * `h160` is typed as `HexString` so the transactions built below are typechecked against
 * `EthTransactionRequest`
 *
 * @note mirrored in `polymesh-sdk`'s `src/utils/__tests__/eth.ts`, which derives these addresses
 * with its own copy of the code — see the note in `../index.ts`
 */
export const DEV_ACCOUNTS: {
  name: string;
  h160: HexString;
  ss58Format42: string;
  ss58Format12: string;
}[] = [
  {
    name: 'Alith',
    h160: '0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac',
    ss58Format42: '5HYRCKHYJN9z5xUtfFkyMj4JUhsAwWyvuU8vKB1FcnYTf9ZQ',
    ss58Format12: '2HvdSZ3SmdvBQCLyVHNG2h5Z69aMJ26KFFWyrfiDj8hqDb1S',
  },
  {
    name: 'Baltathar',
    h160: '0x3Cd0A705a2DC65e5b1E1205896BaA2be8A07c6e0',
    ss58Format42: '5DSSiJevXj8XQ6uKD5ZNQJEimLPWwxuW4MZE9YNcAtRsYgVG',
    ss58Format12: '2DpexYQpzztiiLmQ37Af5GFyNn6hJU1tQ8wHh35aHEbF7FTi',
  },
  {
    name: 'Charleth',
    h160: '0x798d4Ba9baf0064Ec19eB4F0a1a45785ae9D6DFc',
    ss58Format42: '5Ep5dBwRE7mhFsH69SLRTSHYJ7yugeTycZHeT8Ez4DPACvqz',
    ss58Format12: '2FCHsRhKhPXta79AyTwi8QJnuZh639aMxLfhzcwxAZYXm6wf',
  },
  {
    name: 'Dorothy',
    h160: '0x773539d4Ac0e786233D90A233654ccEE26a613D9',
    ss58Format42: '5Em1NEHgVvpXYBEzWeNf9JzuLyvuyyn3ZLifywLQPGdqFVU2',
    ss58Format12: '2F9DcU3ayCairR75LfywpH29xRe6LUtRu86jXS3NVcoCofey',
  },
  {
    name: 'Ethan',
    h160: '0xFf64d3F6efE2317EE2807d223a0Bdc4c0c49dfDB',
    ss58Format42: '5Hqa27HwFuRr2YLJHXLwrP7Q4JMftxEF1kSdFwXvoeZ1PnkA',
    ss58Format12: '2JDnGM3qjBC3LnCP7YxEXM8efk4rFTLdMXpgoSEtuziNx1WT',
  },
];

/** a native (sr25519) Polymesh address, i.e. one that is NOT Ethereum derived */
export const NATIVE_ADDRESS = '5Ef2XHepJvTUJLhhx39Nf5iqu6AACrfFAmc6AW8a3hKF4Rdc';

describe('address derivation utils', () => {
  describe('constants', () => {
    it('should default to SS58 format 42', () => {
      expect(DEFAULT_SS58_FORMAT).toBe(42);
    });

    it('should suffix Ethereum Accounts with 12 0xEE bytes', () => {
      expect(ETH_ACCOUNT_SUFFIX).toEqual(new Uint8Array(12).fill(0xee));
    });
  });

  describe('ss58FromEthAddress', () => {
    it.each(DEV_ACCOUNTS)(
      'should derive the Polymesh address of $name for both SS58 formats',
      ({ h160, ss58Format42, ss58Format12 }) => {
        expect(ss58FromEthAddress(h160, 42)).toBe(ss58Format42);
        expect(ss58FromEthAddress(h160, 12)).toBe(ss58Format12);
      }
    );

    it('should produce an AccountId32 of the H160 followed by twelve 0xEE bytes', () => {
      const { h160, ss58Format42 } = DEV_ACCOUNTS[0];

      expect(u8aToHex(decodeAddress(ss58Format42))).toBe(`${h160.toLowerCase()}${'ee'.repeat(12)}`);
    });

    it('should default to SS58 format 42', () => {
      const { h160, ss58Format42 } = DEV_ACCOUNTS[0];

      expect(ss58FromEthAddress(h160)).toBe(ss58Format42);
    });

    it('should accept a non checksummed address', () => {
      const { h160, ss58Format42 } = DEV_ACCOUNTS[0];

      expect(ss58FromEthAddress(h160.toLowerCase(), 42)).toBe(ss58Format42);
    });

    it('should throw if the passed value is not an Ethereum address', () => {
      expect(() => ss58FromEthAddress('0xnotAnAddress')).toThrow(
        '"0xnotAnAddress" is not a valid Ethereum address'
      );
      expect(() => ss58FromEthAddress(NATIVE_ADDRESS)).toThrow('is not a valid Ethereum address');
    });
  });

  describe('ethAddressFromSs58', () => {
    it.each(DEV_ACCOUNTS)(
      'should recover the checksummed Ethereum address of $name from either SS58 format',
      ({ h160, ss58Format42, ss58Format12 }) => {
        expect(ethAddressFromSs58(ss58Format42)).toBe(h160);
        expect(ethAddressFromSs58(ss58Format12)).toBe(h160);
      }
    );

    it('should accept an explicit SS58 format', () => {
      const { h160, ss58Format12 } = DEV_ACCOUNTS[0];

      expect(ethAddressFromSs58(ss58Format12, 12)).toBe(h160);
    });

    it('should throw if the address is encoded with a different SS58 format', () => {
      const { ss58Format42 } = DEV_ACCOUNTS[0];

      expect(() => ethAddressFromSs58(ss58Format42, 12)).toThrow(
        'is not a valid SS58 encoded address'
      );
    });

    it('should throw if the address is malformed', () => {
      expect(() => ethAddressFromSs58('notAnAddress')).toThrow(
        '"notAnAddress" is not a valid SS58 encoded address'
      );
    });

    it('should throw if the address is not Ethereum derived', () => {
      expect(() => ethAddressFromSs58(NATIVE_ADDRESS)).toThrow(
        'is not an Ethereum derived address'
      );
    });
  });

  describe('isEthDerivedAddress', () => {
    it.each(DEV_ACCOUNTS)('should return true for $name in either SS58 format', (account) => {
      expect(isEthDerivedAddress(account.ss58Format42)).toBe(true);
      expect(isEthDerivedAddress(account.ss58Format12)).toBe(true);
      expect(isEthDerivedAddress(account.ss58Format42, 42)).toBe(true);
      expect(isEthDerivedAddress(account.ss58Format12, 12)).toBe(true);
    });

    it('should return false for a native address', () => {
      expect(isEthDerivedAddress(NATIVE_ADDRESS)).toBe(false);
    });

    it('should return false, not throw, for a malformed address', () => {
      expect(isEthDerivedAddress('notAnAddress')).toBe(false);
      expect(isEthDerivedAddress('')).toBe(false);
    });

    it('should return false when the address is encoded with a different SS58 format', () => {
      expect(isEthDerivedAddress(DEV_ACCOUNTS[0].ss58Format42, 12)).toBe(false);
    });
  });

  describe('normalizeEthAddress', () => {
    it.each(DEV_ACCOUNTS)('should EIP-55 checksum the address of $name', ({ h160 }) => {
      expect(normalizeEthAddress(h160.toLowerCase())).toBe(h160);
      expect(normalizeEthAddress(h160)).toBe(h160);
    });

    it('should throw if the passed value is not an Ethereum address', () => {
      expect(() => normalizeEthAddress('0x1234')).toThrow('is not a valid Ethereum address');
    });
  });

  describe('isSameEthAddress', () => {
    it('should compare addresses ignoring checksum casing', () => {
      const { h160 } = DEV_ACCOUNTS[0];

      expect(isSameEthAddress(h160, h160.toLowerCase())).toBe(true);
      expect(isSameEthAddress(h160, DEV_ACCOUNTS[1].h160)).toBe(false);
    });
  });
});

describe('provider error utils', () => {
  const buildError = (code: number, message = 'something went wrong'): Error =>
    Object.assign(new Error(message), { code });

  describe('getProviderErrorCode', () => {
    it('should extract a numeric code', () => {
      expect(getProviderErrorCode(buildError(4001))).toBe(4001);
    });

    it('should return undefined when there is no numeric code', () => {
      expect(getProviderErrorCode(new Error('boom'))).toBeUndefined();
      expect(getProviderErrorCode(undefined)).toBeUndefined();
      expect(getProviderErrorCode({ code: '4001' })).toBeUndefined();
    });
  });

  describe('mapProviderError', () => {
    it('should map a user rejection to a message containing "Cancelled"', () => {
      const error = mapProviderError(buildError(4001, 'User denied transaction signature'), 'sign');

      expect(error.message).toContain('Cancelled');
      expect(error.code).toBe(4001);
    });

    it.each([
      [4100, 'has not been authorized'],
      [4200, 'does not support the requested method'],
      [4900, 'disconnected from all chains'],
      [4901, 'not connected to the requested chain'],
      [-32601, 'does not implement the requested method'],
      [-32602, 'invalid parameters'],
    ])('should map code %i to a clear message', (code, expected) => {
      expect(mapProviderError(buildError(code), 'sign the transaction').message).toContain(
        expected
      );
    });

    it('should mention the attempted action and the original message', () => {
      const error = mapProviderError(buildError(4001, 'nope'), 'submit the transaction');

      expect(error.message).toContain('submit the transaction');
      expect(error.message).toContain('nope');
    });

    it('should pass through unrecognized errors', () => {
      const error = mapProviderError(new Error('kaboom'), 'sign the transaction');

      expect(error.message).toBe('Failed to sign the transaction: kaboom');
      expect(error.code).toBeUndefined();
    });

    it('should preserve the error data', () => {
      const error = mapProviderError(
        Object.assign(new Error('nope'), { code: 4001, data: { foo: 'bar' } }),
        'sign'
      );

      expect(error.data).toEqual({ foo: 'bar' });
    });

    it('should handle a non Error value', () => {
      expect(mapProviderError('just a string', 'sign the transaction').message).toBe(
        'Failed to sign the transaction: just a string'
      );
    });

    it('should handle an undefined error', () => {
      expect(mapProviderError(undefined, 'sign the transaction').message).toBe(
        'Failed to sign the transaction: undefined'
      );
    });
  });

  describe('isUnsupportedMethodError', () => {
    it('should recognize the standard codes', () => {
      expect(isUnsupportedMethodError(buildError(4200))).toBe(true);
      expect(isUnsupportedMethodError(buildError(-32601))).toBe(true);
    });

    it('should recognize the message wallets return', () => {
      expect(isUnsupportedMethodError(new Error('Method not supported.'))).toBe(true);
      expect(
        isUnsupportedMethodError(new Error('the method eth_signTransaction does not exist'))
      ).toBe(true);
      expect(isUnsupportedMethodError(new Error('Method not found'))).toBe(true);
      expect(isUnsupportedMethodError(new Error('unsupported method'))).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isUnsupportedMethodError(buildError(4001, 'User rejected the request'))).toBe(false);
      expect(isUnsupportedMethodError(undefined)).toBe(false);
    });
  });
});

describe('serializeTransactionRequest', () => {
  const tx: EthTransactionRequest = {
    from: DEV_ACCOUNTS[0].h160,
    to: '0x6d6f646c70792f70616464720000000000000000',
    data: '0x0719',
    value: '0x0',
    gas: '0x74e',
    chainId: '0x190d5a',
    nonce: '0x0',
    maxFeePerGas: '0x5af3107a4000',
    maxPriorityFeePerGas: '0x0',
    type: '0x2',
  };

  it('should pass every supplied field through unchanged', () => {
    expect(serializeTransactionRequest(tx)).toEqual({
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: '0x0',
      gas: '0x74e',
      chainId: '0x190d5a',
      nonce: '0x0',
      maxFeePerGas: '0x5af3107a4000',
      maxPriorityFeePerGas: '0x0',
      type: '0x2',
    });
  });

  it('should drop undefined fields', () => {
    const result = serializeTransactionRequest({
      ...tx,
      nonce: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      gasPrice: '0x5af3107a4000',
      type: '0x0',
    });

    expect(result).not.toHaveProperty('nonce');
    expect(result).not.toHaveProperty('maxFeePerGas');
    expect(result).not.toHaveProperty('maxPriorityFeePerGas');
    expect(result).toMatchObject({ gasPrice: '0x5af3107a4000' });
  });
});

import { HexString, isEthSigningManager } from '@polymeshassociation/signing-manager-types';

import { Eip1193Provider, EthLocalAccount, EthSigner, EthTransactionRequest } from '../../types';
import { EthExternalSigner, EthSigningManager } from '../eth-signing-manager';

/**
 * `h160` is deliberately typed as `HexString` rather than left to infer `string`: the published
 * `EthTransactionRequest` narrows `from`/`to` to `HexString`, and typing the fixtures is what keeps
 * `tsc` checking the transactions these tests build instead of waving them through
 */
interface DevAccount {
  h160: HexString;
  ss58Format42: string;
}

const ALITH: DevAccount = {
  h160: '0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac',
  ss58Format42: '5HYRCKHYJN9z5xUtfFkyMj4JUhsAwWyvuU8vKB1FcnYTf9ZQ',
};
const BALTATHAR: DevAccount = {
  h160: '0x3Cd0A705a2DC65e5b1E1205896BaA2be8A07c6e0',
  ss58Format42: '5DSSiJevXj8XQ6uKD5ZNQJEimLPWwxuW4MZE9YNcAtRsYgVG',
};

const SAMPLE_TX: EthTransactionRequest = {
  from: ALITH.h160,
  to: '0x6d6f646c70792f70616464720000000000000000',
  data: '0x0719',
  value: '0x0',
  gas: '0x74e',
  chainId: '0x190d5a',
  nonce: '0x0',
  maxFeePerGas: '0x5af3107a4000',
  maxPriorityFeePerGas: '0x0',
  type: 2,
};

/**
 * Fetch a required capability method off an `EthSigner`, throwing a descriptive error (rather than
 * a bare non-null assertion) if the test set up the manager without it
 */
function requireSignTransaction(signer: EthSigner): NonNullable<EthSigner['signTransaction']> {
  const { signTransaction } = signer;
  if (!signTransaction) {
    throw new Error('Expected the EthSigner to expose signTransaction');
  }
  return signTransaction;
}

function requireSendTransaction(signer: EthSigner): NonNullable<EthSigner['sendTransaction']> {
  const { sendTransaction } = signer;
  if (!sendTransaction) {
    throw new Error('Expected the EthSigner to expose sendTransaction');
  }
  return sendTransaction;
}

/**
 * Build a mock EIP-1193 provider whose `request` is driven by the passed handler
 */
function createMockProvider(
  request: jest.Mock,
  { withEvents = true }: { withEvents?: boolean } = {}
): Eip1193Provider & { on: jest.Mock; removeListener: jest.Mock } {
  return {
    request,
    on: jest.fn(),
    removeListener: jest.fn(),
    ...(withEvents ? {} : { on: undefined, removeListener: undefined }),
  } as unknown as Eip1193Provider & { on: jest.Mock; removeListener: jest.Mock };
}

describe('EthSigningManager', () => {
  describe('create', () => {
    describe('with an EIP-1193 provider', () => {
      it('should call eth_requestAccounts by default and default to wallet-broadcast capabilities', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });

        expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
        expect(manager.resolvedCapabilities).toEqual({
          signTransaction: false,
          sendTransaction: true,
          eip1559: true,
        });

        // the resolution must show up as method presence, which is what the SDK reads
        const ethSigner = manager.getEthSigner();
        expect(ethSigner.signTransaction).toBeUndefined();
        expect(ethSigner.sendTransaction).toEqual(expect.any(Function));
      });

      it('should call eth_accounts instead when requestAccounts is false', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        await EthSigningManager.create({ provider, requestAccounts: false });

        expect(request).toHaveBeenCalledWith({ method: 'eth_accounts' });
        expect(request).not.toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
      });

      it('should fall back to eth_accounts if eth_requestAccounts is not implemented', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') {
            return Promise.reject(Object.assign(new Error('Method not supported'), { code: 4200 }));
          }
          return Promise.resolve([ALITH.h160]);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });

        expect(await manager.getEthAccounts()).toEqual([ALITH.h160]);
      });

      it('should allow overriding the resolved capabilities', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({
          provider,
          capabilities: { signTransaction: true },
        });

        expect(manager.resolvedCapabilities).toEqual({
          signTransaction: true,
          sendTransaction: true,
          eip1559: true,
        });

        // a signer that can do both attaches both; the SDK is what decides to prefer signing
        const ethSigner = manager.getEthSigner();
        expect(ethSigner.signTransaction).toEqual(expect.any(Function));
        expect(ethSigner.sendTransaction).toEqual(expect.any(Function));
      });

      it('should throw if the passed provider does not implement request', async () => {
        await expect(EthSigningManager.create({ provider: {} as Eip1193Provider })).rejects.toThrow(
          "does not implement EIP-1193's `request` method"
        );
      });

      it('should map a non-unsupported-method error from eth_requestAccounts', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') {
            return Promise.reject(Object.assign(new Error('chain mismatch'), { code: 4901 }));
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        await expect(EthSigningManager.create({ provider })).rejects.toThrow(
          'not connected to the requested chain'
        );
      });

      it('should map an error thrown by eth_accounts', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_accounts') {
            return Promise.reject(Object.assign(new Error('boom'), { code: 4900 }));
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        await expect(
          EthSigningManager.create({ provider, requestAccounts: false })
        ).rejects.toThrow('disconnected from all chains');
      });

      it('should throw if the wallet exposes no accounts', async () => {
        const request = jest.fn().mockResolvedValue([]);
        const provider = createMockProvider(request);

        await expect(EthSigningManager.create({ provider })).rejects.toThrow(
          'No Ethereum Accounts are available'
        );
      });

      it('should throw if both capabilities are disabled', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        await expect(
          EthSigningManager.create({
            provider,
            capabilities: { signTransaction: false, sendTransaction: false },
          })
        ).rejects.toThrow('Both capabilities were disabled');
      });

      it('should treat a null eth_requestAccounts response as no accounts', async () => {
        const request = jest.fn().mockResolvedValue(null);
        const provider = createMockProvider(request);

        await expect(EthSigningManager.create({ provider })).rejects.toThrow(
          'No Ethereum Accounts are available'
        );
      });

      it('should apply an explicit ss58Format at creation time', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider, ss58Format: 12 });

        expect(await manager.getAccounts()).toEqual([
          '2HvdSZ3SmdvBQCLyVHNG2h5Z69aMJ26KFFWyrfiDj8hqDb1S',
        ]);
      });
    });

    describe('with local accounts', () => {
      const account: EthLocalAccount = {
        address: ALITH.h160,
        signTransaction: jest.fn().mockResolvedValue('0xsigned'),
      };

      it('should default to sign-only capabilities', async () => {
        const manager = await EthSigningManager.create({ accounts: [account] });

        expect(manager.resolvedCapabilities).toEqual({
          signTransaction: true,
          sendTransaction: false,
          eip1559: true,
        });

        const ethSigner = manager.getEthSigner();
        expect(ethSigner.signTransaction).toEqual(expect.any(Function));
        expect(ethSigner.sendTransaction).toBeUndefined();
      });

      it('should throw if no accounts are passed', async () => {
        await expect(EthSigningManager.create({ accounts: [] })).rejects.toThrow(
          'At least one Account must be passed'
        );
      });

      it('should throw if accounts is omitted entirely', async () => {
        await expect(EthSigningManager.create({ accounts: undefined } as never)).rejects.toThrow(
          'At least one Account must be passed'
        );
      });

      it('should throw if sendTransaction is requested for local accounts', async () => {
        await expect(
          EthSigningManager.create({
            accounts: [account],
            capabilities: { sendTransaction: true },
          })
        ).rejects.toThrow('Local accounts cannot broadcast transactions');
      });

      it('should allow overriding eip1559', async () => {
        const manager = await EthSigningManager.create({
          accounts: [account],
          capabilities: { eip1559: false },
        });

        expect(manager.resolvedCapabilities.eip1559).toBe(false);
        // unlike the other two, eip1559 cannot be derived from the object's shape, so it is the
        // one flag that must reach the runtime signer
        expect(manager.getEthSigner().capabilities).toEqual({ eip1559: false });
      });
    });
  });

  describe('getAccounts / getEthAccounts', () => {
    it('should map each Ethereum address to its SS58 0xEE address', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160, BALTATHAR.h160]);
      const provider = createMockProvider(request);

      const manager = await EthSigningManager.create({ provider });
      manager.setSs58Format(42);

      await expect(manager.getAccounts()).resolves.toEqual([
        ALITH.ss58Format42,
        BALTATHAR.ss58Format42,
      ]);
      await expect(manager.getEthAccounts()).resolves.toEqual([ALITH.h160, BALTATHAR.h160]);
    });

    it('should default to SS58 format 42 without an explicit setSs58Format call', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      await expect(manager.getAccounts()).resolves.toEqual([ALITH.ss58Format42]);
    });

    it('should re-fetch accounts from the provider on every call', async () => {
      const request = jest
        .fn()
        .mockResolvedValueOnce([ALITH.h160])
        .mockResolvedValueOnce([BALTATHAR.h160]);
      const provider = createMockProvider(request);

      const manager = await EthSigningManager.create({ provider, requestAccounts: false });

      await expect(manager.getEthAccounts()).resolves.toEqual([BALTATHAR.h160]);
    });

    it('should return a stable list for local accounts', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      await expect(manager.getEthAccounts()).resolves.toEqual([ALITH.h160]);
    });

    it('should treat a null eth_accounts response as no accounts', async () => {
      const request = jest.fn().mockResolvedValueOnce([ALITH.h160]).mockResolvedValueOnce(null);
      const provider = createMockProvider(request);

      const manager = await EthSigningManager.create({ provider });

      await expect(manager.getEthAccounts()).resolves.toEqual([]);
    });

    it('should map an error thrown by eth_accounts on a later call', async () => {
      const request = jest
        .fn()
        .mockResolvedValueOnce([ALITH.h160])
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 4900 }));
      const provider = createMockProvider(request);

      const manager = await EthSigningManager.create({ provider });

      await expect(manager.getEthAccounts()).rejects.toThrow('disconnected from all chains');
    });
  });

  describe('setSs58Format', () => {
    it('should change the format used to encode returned addresses', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      manager.setSs58Format(12);

      expect(manager.ss58Format).toBe(12);
      await expect(manager.getAccounts()).resolves.toEqual([
        '2HvdSZ3SmdvBQCLyVHNG2h5Z69aMJ26KFFWyrfiDj8hqDb1S',
      ]);
    });
  });

  describe('toEthAddress / toSs58Address', () => {
    it('should convert between the two address encodings', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      expect(manager.toSs58Address(ALITH.h160)).toBe(ALITH.ss58Format42);
      expect(manager.toEthAddress(ALITH.ss58Format42)).toBe(ALITH.h160);
    });
  });

  describe('getExternalSigner', () => {
    it('should return a signer whose signPayload and signRaw always throw', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      const signer = manager.getExternalSigner();

      await expect(signer.signPayload({} as never)).rejects.toThrow(
        'Ethereum keys cannot sign SCALE payloads'
      );
      await expect(signer.signRaw({} as never)).rejects.toThrow(
        'Ethereum keys cannot sign SCALE payloads'
      );
    });

    it('should be an instance of EthExternalSigner', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      expect(manager.getExternalSigner()).toBeInstanceOf(EthExternalSigner);
    });
  });

  describe('getEthSigner', () => {
    describe('signTransaction (the SDK broadcasts)', () => {
      it('should sign via a local account and return the raw signed bytes', async () => {
        const signTransaction = jest.fn().mockResolvedValue('0xdeadbeef');
        const account: EthLocalAccount = { address: ALITH.h160, signTransaction };

        const manager = await EthSigningManager.create({ accounts: [account] });
        const ethSigner = manager.getEthSigner();

        const result = await requireSignTransaction(ethSigner)(SAMPLE_TX);

        expect(result).toBe('0xdeadbeef');
        expect(signTransaction).toHaveBeenCalledWith(SAMPLE_TX);
      });

      it('should map an error thrown by a local account signTransaction', async () => {
        const signTransaction = jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('locked'), { code: 4100 }));
        const account: EthLocalAccount = { address: ALITH.h160, signTransaction };

        const manager = await EthSigningManager.create({ accounts: [account] });

        await expect(requireSignTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'has not been authorized'
        );
      });

      it('should not expose sendTransaction for local accounts', async () => {
        const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
        const manager = await EthSigningManager.create({ accounts: [account] });

        expect(manager.getEthSigner().sendTransaction).toBeUndefined();
      });

      it('should throw if no local account matches the from address', async () => {
        const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
        const manager = await EthSigningManager.create({ accounts: [account] });

        await expect(
          requireSignTransaction(manager.getEthSigner())({ ...SAMPLE_TX, from: BALTATHAR.h160 })
        ).rejects.toThrow('no local account matches');
      });

      it('should sign via eth_signTransaction when overridden for a provider', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_signTransaction') return Promise.resolve('0xsignedbyprovider');
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({
          provider,
          capabilities: { signTransaction: true },
        });

        const result = await requireSignTransaction(manager.getEthSigner())(SAMPLE_TX);

        expect(result).toBe('0xsignedbyprovider');
        expect(request).toHaveBeenCalledWith({
          method: 'eth_signTransaction',
          params: [expect.objectContaining({ from: ALITH.h160, type: '0x2' })],
        });
      });

      it('should surface a clear, non-fallback error when the wallet does not implement eth_signTransaction', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_signTransaction') {
            return Promise.reject(
              Object.assign(new Error('The method eth_signTransaction does not exist'), {
                code: -32601,
              })
            );
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({
          provider,
          capabilities: { signTransaction: true },
        });

        await expect(requireSignTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          "does not implement 'eth_signTransaction'"
        );
        // must not have attempted to broadcast instead
        expect(request).not.toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_sendTransaction' })
        );
      });
    });

    describe('sendTransaction (the wallet broadcasts)', () => {
      it('should broadcast via eth_sendTransaction and return the tx hash', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_sendTransaction') return Promise.resolve('0xtxhash');
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });
        const modeBTx: EthTransactionRequest = { ...SAMPLE_TX, nonce: undefined };

        const result = await requireSendTransaction(manager.getEthSigner())(modeBTx);

        expect(result).toBe('0xtxhash');
        expect(request).toHaveBeenCalledWith({
          method: 'eth_sendTransaction',
          params: [expect.objectContaining({ from: ALITH.h160 })],
        });
      });

      it('should not expose signTransaction when the capability is disabled', async () => {
        const request = jest.fn().mockResolvedValue([ALITH.h160]);
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });

        expect(manager.getEthSigner().signTransaction).toBeUndefined();
      });

      it('should map a 4001 user rejection to an error containing "Cancelled"', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_sendTransaction') {
            return Promise.reject(
              Object.assign(new Error('User rejected the request'), { code: 4001 })
            );
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });

        await expect(requireSendTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'Cancelled'
        );
      });

      it('should map a 4001 rejection to "Cancelled" when signing too', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_signTransaction') {
            return Promise.reject(
              Object.assign(new Error('User denied transaction signature'), { code: 4001 })
            );
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({
          provider,
          capabilities: { signTransaction: true },
        });

        await expect(requireSignTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'Cancelled'
        );
      });

      it('should map other provider errors to a clear message', async () => {
        const request = jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(SAMPLE_TX.chainId);
          if (method === 'eth_sendTransaction') {
            return Promise.reject(Object.assign(new Error('chain mismatch'), { code: 4901 }));
          }
          throw new Error(`unexpected method ${method}`);
        });
        const provider = createMockProvider(request);

        const manager = await EthSigningManager.create({ provider });

        await expect(requireSendTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'not connected to the requested chain'
        );
      });
    });

    describe('target chain validation', () => {
      /**
       * Build a provider mock reporting a given chain, resolving sign/send if they are reached
       */
      function createChainMock(walletChainId: string): jest.Mock {
        return jest.fn().mockImplementation(({ method }) => {
          if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
          if (method === 'eth_chainId') return Promise.resolve(walletChainId);
          if (method === 'eth_sendTransaction') return Promise.resolve('0xtxhash');
          if (method === 'eth_signTransaction') return Promise.resolve('0xsigned');
          throw new Error(`unexpected method ${method}`);
        });
      }

      it('should refuse to broadcast when the wallet is on a different chain', async () => {
        // wallet left on Ethereum Mainnet while the transaction targets Polymesh
        const request = createChainMock('0x1');
        const manager = await EthSigningManager.create({ provider: createMockProvider(request) });

        await expect(requireSendTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'The wallet is connected to chain 0x1 (1), but this transaction targets the Polymesh chain'
        );

        // the transaction must never have reached the wallet
        expect(request).not.toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_sendTransaction' })
        );
      });

      it('should refuse to sign when the wallet is on a different chain', async () => {
        const request = createChainMock('0x1');
        const manager = await EthSigningManager.create({
          provider: createMockProvider(request),
          capabilities: { signTransaction: true },
        });

        await expect(requireSignTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          'Switch the wallet to the Polymesh network'
        );
        expect(request).not.toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_signTransaction' })
        );
      });

      it('should accept a matching chain ID regardless of hex encoding', async () => {
        // `0x0190d5a` and `0x190d5a` are the same chain
        const request = createChainMock('0x0190d5a');
        const manager = await EthSigningManager.create({ provider: createMockProvider(request) });

        await expect(requireSendTransaction(manager.getEthSigner())(SAMPLE_TX)).resolves.toBe(
          '0xtxhash'
        );
      });

      /**
       * `EthTransactionRequest.chainId` is documented as a MUST: the signer signs for the chain in
       * the request, never for whichever chain its provider happens to report. The two are equal in
       * value here but differ in spelling, so a signer that substituted the provider's answer would
       * be caught
       */
      it.each([
        ['sendTransaction', 'eth_sendTransaction', requireSendTransaction],
        ['signTransaction', 'eth_signTransaction', requireSignTransaction],
      ] as const)(
        'should forward the requested chain ID verbatim to the wallet via %s',
        async (_capability, method, requireMethod) => {
          // same chain, spelled with a redundant leading zero
          const request = createChainMock('0x0190d5a');
          const manager = await EthSigningManager.create({
            provider: createMockProvider(request),
            capabilities: { signTransaction: true },
          });

          await requireMethod(manager.getEthSigner())(SAMPLE_TX);

          expect(request).toHaveBeenCalledWith({
            method,
            params: [expect.objectContaining({ chainId: SAMPLE_TX.chainId })],
          });
        }
      );

      it('should fail closed when the wallet reports an unreadable chain ID', async () => {
        const request = createChainMock('not-a-chain-id');
        const manager = await EthSigningManager.create({ provider: createMockProvider(request) });

        await expect(requireSendTransaction(manager.getEthSigner())(SAMPLE_TX)).rejects.toThrow(
          '"not-a-chain-id"'
        );
        expect(request).not.toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_sendTransaction' })
        );
      });

      it('should not consult the chain for local accounts, which sign exactly what they are given', async () => {
        const signTransaction = jest.fn().mockResolvedValue('0xsignedlocally');
        const account: EthLocalAccount = { address: ALITH.h160, signTransaction };
        const manager = await EthSigningManager.create({ accounts: [account] });

        await expect(requireSignTransaction(manager.getEthSigner())(SAMPLE_TX)).resolves.toBe(
          '0xsignedlocally'
        );
        expect(signTransaction).toHaveBeenCalledWith(SAMPLE_TX);
      });
    });

    it('should expose only eip1559 as a runtime capability, never the resolved booleans', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      const { capabilities } = manager.getEthSigner();

      expect(capabilities).toEqual({ eip1559: true });
      // the construction time booleans must not leak onto the runtime signer, where they could
      // contradict the methods actually attached
      expect(capabilities).not.toHaveProperty('signTransaction');
      expect(capabilities).not.toHaveProperty('sendTransaction');
    });

    it('should hand back the same signer instance on every call', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      expect(manager.getEthSigner()).toBe(manager.getEthSigner());
    });

    it('should not let a caller mutate the resolved capabilities through the getter', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      manager.resolvedCapabilities.eip1559 = false;

      expect(manager.resolvedCapabilities.eip1559).toBe(true);
    });
  });

  describe('the published EthSigningManager contract', () => {
    it('should be recognized by the types package typeguard, which is how the SDK routes to it', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      expect(isEthSigningManager(manager)).toBe(true);
    });
  });

  describe('event subscriptions', () => {
    it('onAccountChange should map new accounts to SS58 addresses', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      let handler: (accounts: string[]) => void = () => undefined;
      provider.on.mockImplementation((event, listener) => {
        if (event === 'accountsChanged') handler = listener;
      });

      const cb = jest.fn();
      const unsubscribe = manager.onAccountChange(cb);

      expect(provider.on).toHaveBeenCalledWith('accountsChanged', expect.any(Function));

      handler([BALTATHAR.h160]);

      expect(cb).toHaveBeenCalledWith([BALTATHAR.ss58Format42]);

      unsubscribe();
      expect(provider.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
    });

    it('onAccountChange should optionally hand back raw Ethereum addresses', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      let handler: (accounts: string[]) => void = () => undefined;
      provider.on.mockImplementation((event, listener) => {
        if (event === 'accountsChanged') handler = listener;
      });

      const cb = jest.fn();
      manager.onAccountChange(cb, true);

      handler([BALTATHAR.h160]);

      expect(cb).toHaveBeenCalledWith([BALTATHAR.h160]);
    });

    it('onAccountChange should treat a null accounts payload as an empty list', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      let handler: (accounts: string[] | null) => void = () => undefined;
      provider.on.mockImplementation((event, listener) => {
        if (event === 'accountsChanged') handler = listener;
      });

      const cb = jest.fn();
      manager.onAccountChange(cb);

      handler(null);

      expect(cb).toHaveBeenCalledWith([]);
    });

    it('should tolerate a provider missing removeListener', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request);
      (provider as { removeListener?: jest.Mock }).removeListener = undefined;
      const manager = await EthSigningManager.create({ provider });

      const unsubscribe = manager.onAccountChange(jest.fn());

      expect(() => unsubscribe()).not.toThrow();
    });

    it('onNetworkChange should surface the new chain ID', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      let handler: (chainId: string) => void = () => undefined;
      provider.on.mockImplementation((event, listener) => {
        if (event === 'chainChanged') handler = listener;
      });

      const cb = jest.fn();
      manager.onNetworkChange(cb);

      handler('0x190d5a');

      expect(cb).toHaveBeenCalledWith({ chainId: '0x190d5a' });
    });

    it('should return a no-op unsubscribe for local accounts', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      const cb = jest.fn();
      const unsubscribe = manager.onAccountChange(cb);
      const unsubscribeNetwork = manager.onNetworkChange(jest.fn());

      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribeNetwork()).not.toThrow();
      expect(cb).not.toHaveBeenCalled();
    });

    it('should return a no-op unsubscribe when the provider does not support events', async () => {
      const request = jest.fn().mockResolvedValue([ALITH.h160]);
      const provider = createMockProvider(request, { withEvents: false });

      const manager = await EthSigningManager.create({ provider });

      expect(() => manager.onAccountChange(jest.fn())()).not.toThrow();
    });
  });

  describe('getCurrentNetwork', () => {
    it('should return the chain id reported by the provider', async () => {
      const request = jest.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
        if (method === 'eth_chainId') return Promise.resolve('0x190d5a');
        throw new Error(`unexpected method ${method}`);
      });
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      await expect(manager.getCurrentNetwork()).resolves.toEqual({ chainId: '0x190d5a' });
    });

    it('should return null for local accounts', async () => {
      const account: EthLocalAccount = { address: ALITH.h160, signTransaction: jest.fn() };
      const manager = await EthSigningManager.create({ accounts: [account] });

      await expect(manager.getCurrentNetwork()).resolves.toBeNull();
    });

    it('should map an error thrown by eth_chainId', async () => {
      const request = jest.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([ALITH.h160]);
        if (method === 'eth_chainId') {
          return Promise.reject(Object.assign(new Error('boom'), { code: 4900 }));
        }
        throw new Error(`unexpected method ${method}`);
      });
      const provider = createMockProvider(request);
      const manager = await EthSigningManager.create({ provider });

      await expect(manager.getCurrentNetwork()).rejects.toThrow('disconnected from all chains');
    });
  });
});

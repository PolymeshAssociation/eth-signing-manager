import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  HexString,
  PolkadotSigner,
  SignerResult,
  SigningManager,
} from '@polymeshassociation/signing-manager-types';

import {
  Eip1193Provider,
  EthLocalAccount,
  EthSigner,
  EthSigningManager as IEthSigningManager,
  EthSigningManagerArgs,
  EthTransactionRequest,
  NetworkInfo,
  ResolvedCapabilities,
  UnsubCallback,
} from '../types';
import {
  DEFAULT_SS58_FORMAT,
  ethAddressFromSs58,
  formatChainId,
  getProviderErrorCode,
  isSameChainId,
  isSameEthAddress,
  isUnsupportedMethodError,
  mapProviderError,
  normalizeEthAddress,
  serializeTransactionRequest,
  ss58FromEthAddress,
} from '../utils';

/**
 * EIP-1193 error code for "the user rejected the request"
 */
const USER_REJECTED_CODE = 4001;

const SCALE_PAYLOAD_MESSAGE =
  'Not supported — Ethereum keys cannot sign SCALE payloads. An Ethereum derived Account (`<h160> ++ [0xEE; 12]`) dispatches through the `revive` pallet by signing an Ethereum transaction, and the chain only verifies sr25519/ed25519 signatures over SCALE payloads. Use the Ethereum signer returned by `getEthSigner()` instead';

const SIGN_TRANSACTION_UNSUPPORTED_MESSAGE =
  "The connected wallet does not implement 'eth_signTransaction', so it cannot return a raw signed transaction for the SDK to broadcast. Recreate the Signing Manager with `capabilities: { signTransaction: false, sendTransaction: true }` so the wallet signs and broadcasts the transaction itself. This fallback is deliberately not automatic: it hands control of the nonce from the SDK to the wallet, and doing that silently mid-flight is worse than a clear error";

/**
 * @hidden
 *
 * A `PolkadotSigner` that always throws. Ethereum keys cannot produce a signature the chain will
 * accept for a SCALE `SignerPayload`, so failing loudly is the only correct behaviour. The Polymesh
 * SDK never invokes this on the Ethereum path, but the `SigningManager` interface requires it
 */
export class EthExternalSigner implements PolkadotSigner {
  /**
   * @throws always
   */
  public async signPayload(): Promise<SignerResult> {
    throw new Error(`signPayload: ${SCALE_PAYLOAD_MESSAGE}`);
  }

  /**
   * @throws always
   */
  public async signRaw(): Promise<SignerResult> {
    throw new Error(`signRaw: ${SCALE_PAYLOAD_MESSAGE}`);
  }
}

/**
 * Signing manager that manages Polymesh Accounts controlled by Ethereum keys.
 *
 * Polymesh's `revive` pallet lets an Ethereum key dispatch any runtime call as the Account
 * `AccountId32 = <20 byte H160> ++ [0xEE; 12]`, by putting the SCALE encoded call in the `data`
 * field of an Ethereum transaction. This manager enumerates the Ethereum Accounts and gets that
 * transaction signed, for the SDK to broadcast, or signed and broadcast by the wallet itself.
 *
 * The transaction itself — gas, nonce, destination and chain ID — is built entirely by the Polymesh
 * SDK from the Substrate connection. This manager never estimates gas, fetches a nonce or knows the
 * destination address
 */
export class EthSigningManager implements SigningManager, IEthSigningManager {
  private _ss58Format: number = DEFAULT_SS58_FORMAT;
  private ethAccounts: string[];

  private readonly provider?: Eip1193Provider;
  private readonly localAccounts: EthLocalAccount[];
  private readonly _capabilities: ResolvedCapabilities;
  private readonly externalSigner: PolkadotSigner = new EthExternalSigner();
  private readonly ethSigner: EthSigner;

  /**
   * Create a Signing Manager backed by an Ethereum wallet.
   *
   * Accounts and capabilities are resolved once, here, so that `getEthSigner` can be synchronous
   *
   * @param args.provider - an EIP-1193 provider (`window.ethereum`, WalletConnect, Coinbase SDK).
   *   Mutually exclusive with `args.accounts`
   * @param args.requestAccounts - (optional, provider only) whether to call `eth_requestAccounts`,
   *   prompting the user to connect. Defaults to `true`. Pass `false` to only read Accounts the
   *   dApp has already been authorized for
   * @param args.accounts - one or more local (in process) accounts, e.g. a viem `LocalAccount` or
   *   an ethers `Wallet` adapter. Mutually exclusive with `args.provider`
   * @param args.ss58Format - (optional) SS58 format for the returned Polymesh addresses. Defaults
   *   to 42. The Polymesh SDK overrides this with the connected chain's format
   * @param args.capabilities - (optional) explicit capability overrides
   *
   * @note capability defaults are conservative, because `eth_signTransaction` support cannot be
   *   feature detected without sending a request to the wallet:
   *   - EIP-1193 providers default to `{ signTransaction: false, sendTransaction: true }`, since
   *     MetaMask (and wallets modelled on it) answer `eth_signTransaction` with
   *     "method not supported"
   *   - local accounts default to `{ signTransaction: true, sendTransaction: false }`, since they
   *     sign in process and have no way to broadcast
   *   - `eip1559` defaults to `true` for both
   *   Override any of them explicitly when you know better, e.g. a Ledger or Fireblocks wallet
   *   reached over WalletConnect that does implement `eth_signTransaction`
   *
   * @throws
   *   - if neither `provider` nor `accounts` is passed
   *   - if the resulting capabilities advertise neither `signTransaction` nor `sendTransaction`
   *   - if `sendTransaction` is requested for local accounts, which cannot broadcast
   *   - if the wallet exposes no Accounts
   */
  public static async create(args: EthSigningManagerArgs): Promise<EthSigningManager> {
    await cryptoWaitReady();

    const { ss58Format, capabilities: overrides } = args;

    let provider: Eip1193Provider | undefined;
    let localAccounts: EthLocalAccount[] = [];
    let ethAccounts: string[];
    let defaults: ResolvedCapabilities;

    if ('provider' in args) {
      provider = args.provider;

      if (!provider || typeof provider.request !== 'function') {
        throw new Error(
          "The passed provider does not implement EIP-1193's `request` method. Expected something like `window.ethereum`"
        );
      }

      defaults = { signTransaction: false, sendTransaction: true, eip1559: true };
      ethAccounts = await EthSigningManager.resolveProviderAccounts(
        provider,
        args.requestAccounts ?? true
      );
    } else {
      localAccounts = args.accounts ?? [];

      if (!localAccounts.length) {
        throw new Error('At least one Account must be passed to create a Signing Manager');
      }

      defaults = { signTransaction: true, sendTransaction: false, eip1559: true };
      ethAccounts = localAccounts.map(({ address }) => normalizeEthAddress(address));
    }

    const capabilities: ResolvedCapabilities = { ...defaults, ...overrides };

    if (!capabilities.signTransaction && !capabilities.sendTransaction) {
      throw new Error(
        'A signer must be able to either sign (`signTransaction`) or broadcast (`sendTransaction`) a transaction. Both capabilities were disabled'
      );
    }

    if (!provider && capabilities.sendTransaction) {
      throw new Error(
        'Local accounts cannot broadcast transactions — they have no connection to a node. Remove the `sendTransaction` capability override, or pass an EIP-1193 provider instead'
      );
    }

    if (!ethAccounts.length) {
      throw new Error(
        'No Ethereum Accounts are available. Make sure the wallet is unlocked and has authorized this dApp'
      );
    }

    const signingManager = new EthSigningManager(
      provider,
      localAccounts,
      capabilities,
      ethAccounts
    );

    if (ss58Format !== undefined) {
      signingManager.setSs58Format(ss58Format);
    }

    return signingManager;
  }

  /**
   * @hidden
   */
  private constructor(
    provider: Eip1193Provider | undefined,
    localAccounts: EthLocalAccount[],
    capabilities: ResolvedCapabilities,
    ethAccounts: string[]
  ) {
    this.provider = provider;
    this.localAccounts = localAccounts;
    this._capabilities = capabilities;
    this.ethAccounts = ethAccounts;

    /*
     * `capabilities` on the runtime signer carries only what the object's shape cannot already
     * say. Whether this signer can sign or broadcast is expressed solely by which of the two
     * methods is attached below — the SDK reads that, and never a flag
     */
    const ethSigner: EthSigner = { capabilities: { eip1559: capabilities.eip1559 } };

    if (capabilities.signTransaction) {
      ethSigner.signTransaction = (tx): Promise<HexString> => this.signTransaction(tx);
    }

    if (capabilities.sendTransaction) {
      ethSigner.sendTransaction = (tx): Promise<HexString> => this.sendTransaction(tx);
    }

    this.ethSigner = ethSigner;
  }

  /**
   * @hidden
   *
   * Enumerate the Accounts an EIP-1193 provider exposes, normalized to EIP-55 checksummed addresses
   */
  private static async resolveProviderAccounts(
    provider: Eip1193Provider,
    requestAccounts: boolean
  ): Promise<string[]> {
    let accounts: unknown;

    if (requestAccounts) {
      try {
        accounts = await provider.request({ method: 'eth_requestAccounts' });
      } catch (err) {
        if (!isUnsupportedMethodError(err)) {
          throw mapProviderError(err, 'connect to the Ethereum wallet');
        }
        // some providers (e.g. an already authorized session) only implement `eth_accounts`
      }
    }

    if (accounts === undefined) {
      try {
        accounts = await provider.request({ method: 'eth_accounts' });
      } catch (err) {
        throw mapProviderError(err, 'fetch the Ethereum wallet Accounts');
      }
    }

    return ((accounts as string[] | null) ?? []).map(normalizeEthAddress);
  }

  /**
   * Set the SS58 format in which the returned Polymesh addresses will be encoded
   *
   * @note the Polymesh SDK calls this with the connected chain's format before calling
   *   `getAccounts`. Until then the manager uses 42
   */
  public setSs58Format(ss58Format: number): void {
    this._ss58Format = ss58Format;
  }

  /**
   * The SS58 format currently used to encode the returned Polymesh addresses
   */
  public get ss58Format(): number {
    return this._ss58Format;
  }

  /**
   * Return the Polymesh addresses of all Ethereum Accounts in the wallet.
   *
   * Each Ethereum address `h160` is returned as the SS58 encoding of `<h160> ++ [0xEE; 12]`, which
   * is the `AccountId32` the `revive` pallet dispatches as
   */
  public async getAccounts(): Promise<string[]> {
    const ethAccounts = await this.getEthAccounts();

    return ethAccounts.map((address) => ss58FromEthAddress(address, this._ss58Format));
  }

  /**
   * Return the underlying Ethereum (H160) addresses, EIP-55 checksummed.
   *
   * They are returned in the same order as `getAccounts`, so the two can be zipped
   */
  public async getEthAccounts(): Promise<string[]> {
    const { provider } = this;

    if (provider) {
      let accounts: unknown;

      try {
        accounts = await provider.request({ method: 'eth_accounts' });
      } catch (err) {
        throw mapProviderError(err, 'fetch the Ethereum wallet Accounts');
      }

      this.ethAccounts = ((accounts as string[] | null) ?? []).map(normalizeEthAddress);
    }

    return [...this.ethAccounts];
  }

  /**
   * Convert an Ethereum derived Polymesh address into the checksummed Ethereum address controlling
   * it
   *
   * @throws if the address is not Ethereum derived
   */
  public toEthAddress(address: string): string {
    return ethAddressFromSs58(address);
  }

  /**
   * Convert an Ethereum address into the Polymesh address it controls, encoded with this manager's
   * SS58 format
   *
   * @throws if the passed value is not a valid Ethereum address
   */
  public toSs58Address(h160: string): string {
    return ss58FromEthAddress(h160, this._ss58Format);
  }

  /**
   * Return a signer object that throws for every operation.
   *
   * Ethereum keys cannot sign the SCALE payloads a natively signed extrinsic requires, so there is
   * no meaningful implementation. The Polymesh SDK routes Ethereum derived Accounts to
   * `getEthSigner` instead and never calls this
   */
  public getExternalSigner(): PolkadotSigner {
    return this.externalSigner;
  }

  /**
   * Return the Ethereum signer the Polymesh SDK uses to sign or submit the
   * Ethereum transaction carrying the SCALE encoded runtime call.
   *
   * Synchronous, because capabilities were resolved in `create`
   */
  public getEthSigner(): EthSigner {
    return this.ethSigner;
  }

  /**
   * What `create` resolved this wallet to be able to do, from its conservative defaults plus any
   * overrides. See `create` for how the defaults are chosen.
   *
   * This is diagnostic, and reports a *construction time* decision — it is deliberately not the
   * runtime `EthSignerCapabilities` the SDK reads. To ask what the signer will actually do, check
   * which methods `getEthSigner()` exposes, which is the same thing the SDK checks
   */
  public get resolvedCapabilities(): ResolvedCapabilities {
    return { ...this._capabilities };
  }

  /**
   * Subscribe to any change in the wallet's Accounts. This can be either from an Account being
   * added/removed, or from the user changing the selected Account.
   *
   * The callback is called with the new array of Polymesh addresses. Convention is for the
   * currently selected Account to be first, but that depends on the wallet implementation
   *
   * @param cb - called with the new Accounts
   * @param callbackWithEthAddresses - pass `true` to receive the raw Ethereum (H160) addresses
   *   instead of the derived Polymesh addresses
   *
   * @note returns a no-op unsubscribe callback when the manager wraps local accounts, or a provider
   *   that does not support events
   */
  public onAccountChange(
    cb: (accounts: string[]) => void,
    callbackWithEthAddresses = false
  ): UnsubCallback {
    return this.subscribe('accountsChanged', (accounts: string[] | null) => {
      const ethAccounts = (accounts ?? []).map(normalizeEthAddress);

      this.ethAccounts = ethAccounts;

      cb(
        callbackWithEthAddresses
          ? ethAccounts
          : ethAccounts.map((address) => ss58FromEthAddress(address, this._ss58Format))
      );
    });
  }

  /**
   * Subscribe to a change in the wallet's selected network (i.e. the user switching chains).
   *
   * The callback is called with the new network information
   *
   * @note returns a no-op unsubscribe callback when the manager wraps local accounts, or a provider
   *   that does not support events
   */
  public onNetworkChange(cb: (networkInfo: NetworkInfo) => void): UnsubCallback {
    return this.subscribe('chainChanged', (chainId: HexString) => {
      const networkInfo: NetworkInfo = { chainId };
      cb(networkInfo);
    });
  }

  /**
   * Return the network the wrapped provider is currently connected to, or `null` when the manager
   * wraps local accounts
   */
  public async getCurrentNetwork(): Promise<NetworkInfo | null> {
    const { provider } = this;

    if (!provider) {
      return null;
    }

    try {
      const chainId = await provider.request({ method: 'eth_chainId' });

      return { chainId: chainId as HexString };
    } catch (err) {
      throw mapProviderError(err, 'fetch the current chain ID');
    }
  }

  /**
   * @hidden
   *
   * Return the raw signed transaction bytes, letting the SDK broadcast and track the
   * result over its existing Substrate connection
   */
  private async signTransaction(tx: EthTransactionRequest): Promise<HexString> {
    const { provider } = this;

    if (!provider) {
      const account = this.getLocalAccount(tx.from);

      try {
        return await account.signTransaction(tx);
      } catch (err) {
        throw mapProviderError(err, 'sign the transaction');
      }
    }

    await this.assertWalletOnTargetChain(tx);

    try {
      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [serializeTransactionRequest(tx)],
      });

      return signed as HexString;
    } catch (err) {
      if (getProviderErrorCode(err) !== USER_REJECTED_CODE && isUnsupportedMethodError(err)) {
        throw new Error(SIGN_TRANSACTION_UNSUPPORTED_MESSAGE);
      }

      throw mapProviderError(err, 'sign the transaction');
    }
  }

  /**
   * @hidden
   *
   * Have the wallet sign and broadcast, returning the Ethereum transaction hash. The SDK
   * correlates that hash back to the Substrate extrinsic
   */
  private async sendTransaction(tx: EthTransactionRequest): Promise<HexString> {
    const { provider } = this;

    /* istanbul ignore next: `create` rejects the `sendTransaction` capability without a provider */
    if (!provider) {
      throw new Error('Local accounts cannot broadcast transactions');
    }

    await this.assertWalletOnTargetChain(tx);

    try {
      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [serializeTransactionRequest(tx)],
      });

      return txHash as HexString;
    } catch (err) {
      throw mapProviderError(err, 'submit the transaction');
    }
  }

  /**
   * @hidden
   *
   * Verify that the wallet is connected to the chain the transaction targets, before asking it to
   * sign or broadcast anything.
   *
   * The SDK reads `chainId` from the connected Polymesh chain's `consts.revive.chainId`, so the
   * request already carries the correct value — this only has to confirm the wallet agrees. Without
   * the check, a wallet left on a different network (Ethereum Mainnet being the obvious case) can
   * broadcast the SCALE encoded call to that network instead, where the destination is not a
   * contract: the caller spends gas for no effect, the Polymesh transaction never happens, and the
   * SDK waits for a correlation that will never arrive
   *
   * @throws if the wallet is on a different chain, or its chain ID cannot be read
   */
  private async assertWalletOnTargetChain(tx: EthTransactionRequest): Promise<void> {
    const network = await this.getCurrentNetwork();

    /* istanbul ignore next: only reachable on the provider path, where `getCurrentNetwork` is never null */
    if (!network) {
      return;
    }

    const { chainId: walletChainId } = network;

    if (!isSameChainId(walletChainId, tx.chainId)) {
      throw new Error(
        `The wallet is connected to chain ${formatChainId(
          walletChainId
        )}, but this transaction targets the Polymesh chain ${formatChainId(
          tx.chainId
        )}. Switch the wallet to the Polymesh network and try again. Signing on the wrong chain would at best be rejected, and at worst broadcast the encoded Polymesh call to an unrelated network, spending gas there for no effect`
      );
    }
  }

  /**
   * @hidden
   *
   * @throws if no local account matches the transaction's `from` address
   */
  private getLocalAccount(from: string): EthLocalAccount {
    const account = this.localAccounts.find(({ address }) => isSameEthAddress(address, from));

    if (!account) {
      throw new Error(
        `The signer cannot sign transactions on behalf of the calling Account: no local account matches "${from}"`
      );
    }

    return account;
  }

  /**
   * @hidden
   *
   * Attach a listener to the wrapped provider, returning an unsubscribe callback
   */
  private subscribe(event: string, listener: (...args: never[]) => void): UnsubCallback {
    const { provider } = this;

    if (!provider || !provider.on) {
      return (): void => undefined;
    }

    provider.on(event, listener);

    return (): void => {
      provider.removeListener?.(event, listener);
    };
  }
}

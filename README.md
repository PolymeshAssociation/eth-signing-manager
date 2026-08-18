[![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat-square)](https://github.com/standard/semistandard)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

# Eth Signing Manager

Polymesh SDK signing manager backed by an Ethereum key — MetaMask and other
[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) providers, plus local (in process) accounts
such as a viem `LocalAccount` or an ethers `Wallet`.

## Background

Polymesh's `revive` pallet lets an Ethereum key dispatch any Polymesh runtime call as the Account

```
AccountId32 = <20-byte H160> ++ [0xEE; 12]
```

by putting the SCALE-encoded call in the `data` field of an Ethereum transaction addressed to a
sentinel address. The Polymesh SDK builds that transaction entirely — gas, nonce, the sentinel
address and the chain ID all come from the Substrate connection. This package's only job is to
enumerate accounts and get the transaction **signed**, for the SDK to broadcast, or **signed and
broadcast** by the wallet itself.

| | Sign only — the SDK broadcasts | The wallet signs and broadcasts |
|---|---|---|
| Method | `signTransaction` returns raw signed bytes | `sendTransaction` returns the Ethereum tx hash |
| Who broadcasts | the SDK, over its existing Substrate connection | the wallet, via `eth_sendTransaction` |
| Nonce control | the SDK | the wallet |
| Used by | viem/ethers local accounts, Ledger, Fireblocks, WalletConnect wallets that implement `eth_signTransaction` | MetaMask, Rabby, Coinbase Wallet and most injected wallets, which do not implement `eth_signTransaction` |

Signing only is strictly better, and the SDK prefers it whenever the signer implements
`signTransaction`; wallet broadcast exists because MetaMask — the wallet most users reach for — does
not support `eth_signTransaction`.

This package never estimates gas, fetches a nonce, or knows the sentinel address or chain ID. It
only signs (or signs and broadcasts) whatever `EthTransactionRequest` the SDK hands it.

## Install

```bash
yarn add @polymeshassociation/eth-signing-manager
```

## Usage — MetaMask (or any injected EIP-1193 provider)

```typescript
import { EthSigningManager } from '@polymeshassociation/eth-signing-manager';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

// prompts the user to connect, via eth_requestAccounts
const signingManager = await EthSigningManager.create({
  provider: window.ethereum,
});

const polymesh = await Polymesh.connect({
  nodeUrl,
  signingManager,
});

// the SS58 encoded 0xEE Account(s) — set as the signing Account automatically by `connect`
const accounts = await signingManager.getAccounts();

polymesh.setSigningAccount(accounts[0]);

// react to the user switching Accounts or networks in the wallet
signingManager.onAccountChange((newAccounts) => {
  // update UI, re-set the signing Account, etc.
});

signingManager.onNetworkChange((networkInfo) => {
  // networkInfo.chainId is the 0x-prefixed hex chain ID
});
```

MetaMask does not implement `eth_signTransaction`, so `EthSigningManager` defaults an injected
provider to **wallet broadcast**. That decision is made once, at `create()` time, and is expressed
by which methods the returned `EthSigner` defines: the Polymesh SDK picks its submission strategy by
looking at whether `signTransaction` or `sendTransaction` is present. No further configuration is
required.

### If you know the wallet supports `eth_signTransaction`

Some WalletConnect-reachable wallets, Ledger-via-WalletConnect, and similar do implement
`eth_signTransaction`. Opt into signing explicitly — it is never auto-detected, because probing would
mean sending a speculative request to the user's wallet:

```typescript
const signingManager = await EthSigningManager.create({
  provider: someEip1193Provider,
  capabilities: { signTransaction: true },
});
```

If the override turns out to be wrong, the resulting `signTransaction` call throws a clear error
naming the problem. It never silently falls back to wallet broadcast — handing control of the nonce from the
SDK to the wallet mid-flight would be a worse failure mode than a loud error.

## Usage — a local account (viem / ethers)

`viem` and `ethers` are **not** dependencies of this package. Adapt an account from either with
`fromViemAccount` / `fromEthersWallet`, which convert the transaction into that library's native
types before signing.

Do not pass a viem or ethers account straight through: an `EthTransactionRequest` is EIP-1193 wire
format (hex strings, `gas` rather than `gasLimit`), which viem rejects and ethers silently signs
with a zero gas limit.

### viem

```typescript
import { privateKeyToAccount } from 'viem/accounts';
import { EthSigningManager, fromViemAccount } from '@polymeshassociation/eth-signing-manager';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

const account = fromViemAccount(privateKeyToAccount('0x...'));

const signingManager = await EthSigningManager.create({ accounts: [account] });

const polymesh = await Polymesh.connect({ nodeUrl, signingManager });
```

### ethers

```typescript
import { Wallet } from 'ethers';
import { EthSigningManager, fromEthersWallet } from '@polymeshassociation/eth-signing-manager';

const account = fromEthersWallet(new Wallet('0x...'));

const signingManager = await EthSigningManager.create({ accounts: [account] });
```

Any other in-process signer can implement `EthLocalAccount` directly, converting the request
itself:

```typescript
interface EthLocalAccount {
  address: string;
  signTransaction(tx: EthTransactionRequest): Promise<HexString>; // raw signed (RLP) bytes
}
```

`toViemTransaction(tx)` and `toEthersTransaction(tx)` are exported for that case.

Local accounts always **sign only** (`signTransaction: true, sendTransaction: false`) — they sign
in process and have no way to broadcast a transaction. Multiple accounts can be passed; the SDK
selects the one matching the current signing Account's `from` address.

## Address derivation

Each Ethereum address (`H160`) is exposed to the Polymesh SDK as the SS58 encoding of
`<h160> ++ [0xEE; 12]`. Helpers for converting between the two encodings are also exported:

```typescript
import {
  ss58FromEthAddress,
  ethAddressFromSs58,
  isEthDerivedAddress,
} from '@polymeshassociation/eth-signing-manager';

ss58FromEthAddress('0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac', 42);
// '5HYRCKHYJN9z5xUtfFkyMj4JUhsAwWyvuU8vKB1FcnYTf9ZQ'

ethAddressFromSs58('5HYRCKHYJN9z5xUtfFkyMj4JUhsAwWyvuU8vKB1FcnYTf9ZQ');
// '0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac'

isEthDerivedAddress('5Ef2XHepJvTUJLhhx39Nf5iqu6AACrfFAmc6AW8a3hKF4Rdc'); // false — native address
```

`EthSigningManager` also exposes instance helpers `getEthAccounts()` (the raw H160 addresses, in
the same order as `getAccounts()`), `toEthAddress(ss58)` and `toSs58Address(h160)`.

## SS58 format

`setSs58Format(n)` is called by the Polymesh SDK's `Context.setSigningManager` **before**
`getAccounts()`, so it does not normally need to be called manually. The manager defaults to `42`
so that constructing it standalone (before connecting to a chain) still produces valid addresses.

```typescript
signingManager.setSs58Format(12); // e.g. Polymesh testnet
```

## Capability resolution

`eth_signTransaction` support cannot be feature-detected without sending a request to the wallet, so
`EthSigningManager.create()` resolves conservative defaults once, up front:

| Signer | `signTransaction` | `sendTransaction` | `eip1559` |
|---|---|---|---|
| EIP-1193 provider (`provider: ...`) | `false` | `true` | `true` |
| Local account (`accounts: [...]`) | `true` | `false` | `true` |

Pass `capabilities` to `create()` to override any of these explicitly:

```typescript
await EthSigningManager.create({
  provider,
  capabilities: { signTransaction: true, eip1559: false },
});
```

These three booleans are a **construction-time** input, and are not what the SDK reads at runtime.
`signTransaction` and `sendTransaction` decide which methods get attached to the `EthSigner` that
`getEthSigner()` returns, and the SDK reads that method presence — so a signer can never advertise a
capability it does not have. Only `eip1559` survives onto the runtime
`EthSigner.capabilities`, because it is the one thing the object's shape cannot express.

`manager.resolvedCapabilities` reports what `create()` decided, for diagnostics. To ask what the
signer will actually do, check which methods `getEthSigner()` exposes.

## API surface

`SigningManager`, `EthSigningManager`, `EthSigner`, `EthSignerCapabilities` and
`EthTransactionRequest` are all defined by
[`@polymeshassociation/signing-manager-types`](https://www.npmjs.com/package/@polymeshassociation/signing-manager-types).
This package re-exports them for convenience, so you can name them without adding a dependency of
your own.

```typescript
class EthSigningManager implements SigningManager, EthSigningManager /* eth-signer contract */ {
  static create(args: EthSigningManagerArgs): Promise<EthSigningManager>;

  // SigningManager
  getAccounts(): Promise<string[]>;
  setSs58Format(ss58Format: number): void;
  getExternalSigner(): PolkadotSigner; // signPayload/signRaw always throw — see below

  // Eth signer contract
  getEthSigner(): EthSigner; // { capabilities: { eip1559 }, signTransaction?, sendTransaction? }

  // Diagnostics: what `create()` resolved. Not the runtime contract — see "Capability resolution"
  resolvedCapabilities: ResolvedCapabilities;

  // Convenience
  getEthAccounts(): Promise<string[]>;
  toEthAddress(ss58Address: string): string;
  toSs58Address(h160: string): string;
  getCurrentNetwork(): Promise<NetworkInfo | null>;
  onAccountChange(cb: (accounts: string[]) => void, ethAddresses?: boolean): UnsubCallback;
  onNetworkChange(cb: (networkInfo: NetworkInfo) => void): UnsubCallback;
}
```

## Network safety

Before asking the wallet to sign or broadcast, the manager reads `eth_chainId` and compares it to
the `chainId` the Polymesh SDK put in the transaction request (which the SDK reads from the chain's
`consts.revive.chainId`). If they disagree, it throws before the wallet is ever opened.

This matters because the destination is a sentinel address that only means something on Polymesh. A
wallet left on Ethereum Mainnet would otherwise broadcast the SCALE-encoded call there, to an
address with no contract code — spending real gas for no effect, while the Polymesh transaction
never happens and the SDK waits for a result that will never arrive.

An unreadable chain ID is treated as a mismatch (fail closed). Local accounts skip the check
entirely: they have no notion of a "current network" and sign exactly the request they are given.

## Limitations

- **Off-chain signatures are not supported.** `getExternalSigner().signPayload` /
  `.signRaw` always throw. The chain's `verify_any_signature` only accepts sr25519/ed25519
  signatures over SCALE payloads, and an Ethereum key fundamentally cannot produce one. This blocks
  bulk `identity.addSecondaryKeysWithAuthorization` and off-chain settlement/investment receipts —
  onboarding a single Ethereum key into an existing Identity is unaffected, since that flow is two
  ordinary signed dispatches (`inviteAccount` + `joinIdentityAsKey`), not an off-chain signature.
- **MultiSig is out of scope.** An Ethereum key acting as a MultiSig signer is not supported by the
  SDK in this release.
- **MetaMask shows an unavoidable warning.** Because the sentinel address has no contract code,
  MetaMask always displays "You're sending call data to an address that isn't a contract." This
  cannot be suppressed from either the SDK or this package; it is safe to proceed.
- **Transaction history is not yet indexed for Ethereum accounts.** The SubQuery-based middleware
  the Polymesh SDK's `getTransactionHistory()` relies on cannot currently attribute a `revive`
  extrinsic to the Ethereum Account, and records reverted `revive` transactions as successful.
  `getTransactionHistory()` throws `NotSupported` for an Ethereum derived Account rather than
  silently returning an empty (and misleading) list. Balance-changing activity driven by chain
  events (e.g. `getPolyxTransactions`) is unaffected.
- **Gas is never estimated by this package.** It only signs/sends whatever `EthTransactionRequest`
  the Polymesh SDK supplies (see [Background](#background)). Do not pass a hand-built transaction
  request to a raw EIP-1193 provider through this manager expecting gas or nonce inference.

## License

ISC — see [LICENSE](./LICENSE).

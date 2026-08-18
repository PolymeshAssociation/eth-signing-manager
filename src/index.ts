/* istanbul ignore file */

export {
  fromEthersWallet,
  fromViemAccount,
  toEthersTransaction,
  toViemTransaction,
} from './adapters';
export { EthSigningManager } from './lib/eth-signing-manager';
export {
  DEFAULT_SS58_FORMAT,
  ETH_ACCOUNT_SUFFIX,
  ethAddressFromSs58,
  isEthDerivedAddress,
  normalizeEthAddress,
  ss58FromEthAddress,
} from './utils';

export type {
  Eip1193Provider,
  EthAccountLike,
  EthersTransactionRequest,
  EthLocalAccount,
  EthSigner,
  EthSignerCapabilities,
  EthSignerCapabilityOverrides,
  EthSigningManagerArgs,
  EthSigningManagerLocalArgs,
  EthSigningManagerProviderArgs,
  EthTransactionRequest,
  NetworkInfo,
  ProviderRpcError,
  ResolvedCapabilities,
  UnsubCallback,
  ViemTransactionRequest,
} from './types';

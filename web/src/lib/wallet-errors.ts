export function walletError(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/User closed the window|didn't complete the action|reject|denied|cancel/i.test(message)) return 'You closed Meteor Wallet without approving. Nothing new was sent. Choose Account to try again.';
  if (/Popup window blocked|open popup window/i.test(message)) return 'Your browser blocked Meteor Wallet. Allow pop-ups for this site, then choose Account again.';
  if (/No Meteor (Wallet )?account found/i.test(message)) return 'Create a NEAR testnet account in Meteor Wallet, then choose Account again.';
  if (/not signed in|No wallet selected/i.test(message)) return 'Connect Meteor Wallet with Account before signing.';
  if (/UNKNOWN_ACCOUNT|does not exist|mainnet account/i.test(message)) return 'This account is not available on NEAR testnet. Disconnect and choose a funded testnet account.';
  if (/NotEnoughBalance|insufficient|not enough balance/i.test(message)) return 'Your testnet account needs more NEAR for escrow, storage and gas. Add testnet NEAR on Credits and retry.';
  return 'Meteor Wallet could not complete this request. Check the wallet and your connection, then retry.';
}

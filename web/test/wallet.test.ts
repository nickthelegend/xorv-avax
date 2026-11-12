import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { walletError } from '../src/lib/wallet-errors.ts';

const root = path.resolve(import.meta.dirname, '../../..');
function dependencyVersion(parent: string, dependency: string) {
  const req = createRequire(realpathSync(path.join(root, 'packages/web/node_modules', parent, 'package.json')));
  let dir = path.dirname(req.resolve(dependency));
  while (dir !== path.dirname(dir)) {
    try { const p = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')); if (p.name === dependency) return p.version; } catch {}
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot resolve ${dependency}`);
}
test('Meteor has the NEAR 6 API and utils 2, isolated from the NEAR 7 node signer', () => {
  assert.equal(dependencyVersion('@near-wallet-selector/meteor-wallet', 'near-api-js'), '6.2.5');
  for (const name of ['@near-wallet-selector/core', '@near-wallet-selector/meteor-wallet']) {
    assert.equal(dependencyVersion(name, '@near-js/utils'), '2.5.1');
    assert.equal(JSON.parse(readFileSync(path.join(root, 'packages/web/node_modules', name, 'package.json'), 'utf8')).version, '10.1.4');
  }
  assert.equal(JSON.parse(readFileSync(path.join(root, 'node_modules/near-api-js/package.json'), 'utf8')).version, '7.3.1');
});
test('Meteor popup cancellation and popup blocking have different recovery instructions', () => {
  assert.match(walletError(new Error('User closed the window')), /closed Meteor Wallet.*Nothing new was sent/);
  assert.match(walletError(new Error("User didn't complete the action")), /closed Meteor Wallet/);
  assert.match(walletError(new Error('Failed to open popup window')), /browser blocked Meteor Wallet.*Allow pop-ups/);
  assert.match(walletError(new Error('No Meteor account found')), /Create a NEAR testnet account/);
  assert.match(walletError(new Error('UNKNOWN_ACCOUNT')), /not available on NEAR testnet/);
  assert.match(walletError(new Error('NotEnoughBalance')), /needs more NEAR/);
});
test('the pinned Meteor SDK never logs the generated sign-in access key', () => {
  const req = createRequire(realpathSync(path.join(root, 'packages/web/node_modules/@near-wallet-selector/meteor-wallet/package.json')));
  const source = readFileSync(req.resolve('@meteorwallet/sdk'), 'utf8');
  assert.ok(!source.includes('console.log(accessKey)'), 'sign-in keys must not reach the browser console');
});

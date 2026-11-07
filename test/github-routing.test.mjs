// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveGithubAccount} from '../src/github-routing.mjs';
const registry={accounts:[{login:'account-one',connections:[{provider:'selected-plugin',status:'verified',capabilities:['read','write'],repositories:['account-one/approved']}]},{login:'account-two',connections:[]},{login:'account-three',connections:[{status:'pending',capabilities:['read'],repositoryScope:'all'}]}]};
test('explicit owner routes only to a matching verified authorized connection',()=>{const r=resolveGithubAccount(registry,'account-one/approved','write');assert.equal(r.canProceed,true);assert.equal(r.channels[0].provider,'selected-plugin');});
test('selected repository scope does not authorize other repositories or creation',()=>{assert.equal(resolveGithubAccount(registry,'account-one/unapproved').canProceed,false);assert.equal(resolveGithubAccount(registry,'account-one/new','create-repository').canProceed,false);});
test('unconnected and pending accounts never fall back to the primary account',()=>{for(const owner of ['account-two','account-three'])assert.equal(resolveGithubAccount(registry,owner+'/test').canProceed,false);});
test('unknown owner, missing owner and unsupported operation fail closed',()=>{assert.throws(()=>resolveGithubAccount(registry,'unknown/test'));assert.throws(()=>resolveGithubAccount(registry,'test'));assert.throws(()=>resolveGithubAccount(registry,'account-one/approved','merge'));});
test('organization uses the member account and keeps OAuth restrictions blocked',()=>{const r=resolveGithubAccount({...registry,organizations:[{login:'dev-org',type:'Organization',viaAccount:'account-one',connections:[]}]},'dev-org/project','write');assert.equal(r.ownerType,'Organization');assert.equal(r.viaAccount,'account-one');assert.equal(r.canProceed,false);});

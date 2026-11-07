// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
export function resolveGithubAccount(registry, repository, operation='read') {
  if(typeof repository!=='string'||!/^[-a-zA-Z0-9]+\/[a-zA-Z0-9_.-]+$/.test(repository)||!['read','write','create-repository'].includes(operation))throw Error('Explicit owner/repository and supported operation required');
  const [owner]=repository.split('/');
  const account=[...registry.accounts,...(registry.organizations||[])].find(a=>a.login.toLowerCase()===owner.toLowerCase());
  if(!account)throw Error('Repository owner is not in the authorized account registry');
  const channels=(account.connections||[]).filter(c=>c.status==='verified'&&c.capabilities.includes(operation)&&
    (c.repositoryScope==='all'||(c.repositories||[]).some(r=>r.toLowerCase()===repository.toLowerCase())));
  return {repository,owner:account.login,ownerType:account.type||'User',viaAccount:account.viaAccount||account.login,operation,canProceed:channels.length>0,channels,
    nextAction:channels.length?'Use the specified connection and recheck remote identity before mutation':'Authenticate this account or authorize this repository; do not substitute another account',
    warning:'Registry is routing metadata, not credentials or a replacement for provider authorization.'};
}

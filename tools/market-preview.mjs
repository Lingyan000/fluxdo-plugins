import {createHash} from 'node:crypto';

/** 只从实际包推导目录预览；调用方仍须先验证包摘要与签名。 */
export function marketPreview(bundle) {
  const m=bundle.manifest,p=m.permissions??{};
  const declared={
    sandbox:true,network:!!p.network?.length,foregroundTasks:!!m.tasks?.length,
    identity:p.identity===true,
    serviceAccount:!!((m.auth?.type&&m.auth.type!=='none')||m.webLogin||Object.keys(p.credentials??{}).length||p.connect?.length),
    payments:!!p.payments?.length,
    forumProfiles:!!p.forum?.includes('profiles'),forumActivity:!!p.forum?.includes('activity'),forumFollowing:!!p.forum?.includes('following'),
    background:p.background===true,notifications:p.notifications===true,
    links:!!m.links?.length,publicImages:p.publicImages===true,
  };
  const key=bundle.publisher?.key;
  return {
    permissionsSummary:{permissions:Object.keys(declared).filter(k=>declared[k]).sort(),
      networkHosts:[...new Set(p.network??[])].sort(),linkHosts:[...new Set((m.links??[]).map(r=>r.host))].sort()},
    publisherKeyFingerprint:key?createHash('sha256').update(JSON.stringify({e:key.e,kty:key.kty,n:key.n})).digest('hex'):null,
  };
}

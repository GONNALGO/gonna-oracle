import { nextChallengeId, readMeta } from './.tmp-kit-campaign.mjs';
const nid = await nextChallengeId();
console.log('next_challenge_id =', nid);
for (let cid = 80; cid < nid; cid++) {
  try { const m = await readMeta(cid); console.log(cid, JSON.stringify({seats:m.seatsTotal??m.seats_total, joined:m.joinedCount??m.joined, signed:m.signedCount??m.signed, deadline:m.deadline??m.sealedUntil, stage:m.stageIdx})); }
  catch(e){ console.log(cid, 'ERR', String(e).slice(0,80)); }
}

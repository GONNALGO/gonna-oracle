import * as kit from '../src/game/arena/testnetKit.ts';
import algosdk from 'algosdk';
const r = await kit.readPlayers(1);
r.forEach((p, i) => console.log(i, algosdk.encodeAddress(Uint8Array.from(p.addr)).slice(0,12), 'score', Number(p.score), 'signed', p.signed, 'claimed', p.claimed));
const m = await kit.readMeta(1);
console.log('meta seats', m && m.seatsTotal, 'taken', m && m.seatsTaken, 'status', m && m.status);

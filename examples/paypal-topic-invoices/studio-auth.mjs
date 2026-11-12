import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.mjs';

export function makePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw Error('Studio passwords must contain 12–200 characters');
  const salt = randomBytes(16).toString('hex');
  return { salt, password_hash: scryptSync(password, salt, 64).toString('hex') };
}
const dummy = makePassword(randomBytes(24).toString('base64url'));
function equal(a,b) { const aa=Buffer.from(a),bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); }
function passwordMatches(password, member) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const target = member ?? dummy;
  const actual = scryptSync(password, target.salt, 64).toString('hex');
  return equal(actual,target.password_hash) && Boolean(member);
}
export class StudioAuth {
  #members; #sessions = new Map(); #attempts = new Map();
  constructor(members) {
    for (const member of members) if (!/^[a-f0-9]{32}$/.test(member.salt ?? '') || !/^[a-f0-9]{128}$/.test(member.password_hash ?? '')) throw Error('Every studio member needs a salted password hash. Run studio:init.');
    this.#members = members;
  }
  #cookie(res,id) { res.setHeader('Set-Cookie', `theone_studio=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`); }
  #new(res,actorId=null) {
    const now=Date.now(); for (const [id,s] of this.#sessions) if(s.expires<=now)this.#sessions.delete(id);
    if(this.#sessions.size>=1000)throw new AppError('SESSION_LIMIT','Too many sessions; try again later.',429);
    const session={id:randomBytes(32).toString('hex'),csrf:randomBytes(32).toString('hex'),actorId,expires:now+8*60*60*1000};
    this.#sessions.set(session.id,session);this.#cookie(res,session.id);return session;
  }
  session(req,res) {
    const id=/(?:^|;\s*)theone_studio=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1];
    const session=id&&this.#sessions.get(id);
    if(session&&session.expires>Date.now())return session;
    if(id)this.#sessions.delete(id);return this.#new(res);
  }
  requireActor(session) { if(!session.actorId)throw new AppError('AUTH_REQUIRED','Sign in to your studio.',401);return session.actorId; }
  checkCsrf(req,session) {
    const token=req.headers['x-theone-token'];
    if(typeof token!=='string'||!equal(token,session.csrf))throw new AppError('CSRF_INVALID','Refresh your studio session and try again.',403);
  }
  login(req,res,session,{name,password}) {
    const normalized=typeof name==='string'?name.trim().toLocaleLowerCase('en-US'):'';
    const key=`${req.socket.remoteAddress??'local'}:${normalized.slice(0,80)}`,now=Date.now();
    for(const [k,v] of this.#attempts)if(v.reset<=now)this.#attempts.delete(k);
    const prior=this.#attempts.get(key)??{count:0,reset:now+60_000};
    if(prior.count>=8)throw new AppError('LOGIN_RATE_LIMIT','Too many sign-in attempts. Wait a minute and try again.',429);
    prior.count++;this.#attempts.set(key,prior);
    const member=this.#members.find(m=>m.name.toLocaleLowerCase('en-US')===normalized);
    if(!passwordMatches(password,member))throw new AppError('INVALID_CREDENTIALS','The name or password is incorrect.',401);
    this.#attempts.delete(key);this.#sessions.delete(session.id);return this.#new(res,member.id);
  }
  logout(res,session) { this.#sessions.delete(session.id);return this.#new(res); }
  close() { this.#sessions.clear();this.#attempts.clear(); }
}

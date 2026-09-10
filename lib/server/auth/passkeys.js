import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import Passkey from '@/models/Passkey';
import AuthChallenge from '@/models/AuthChallenge';
import User from '@/models/User';
import { requireObjectId, workbenchError } from '@/lib/server/workbench/apiHelpers';

function relyingParty() {
  const configured = process.env.PUBLIC_APP_URL;
  if (!configured) throw workbenchError('网站地址尚未配置，无法使用通行密钥', 503);
  const url = new URL(configured);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) throw new Error('通行密钥需要 HTTPS 网站地址');
  return { rpID: url.hostname, origin: url.origin, rpName: 'Vectaix AI' };
}

export async function consumeChallenge(id, purpose, auth) {
  const query = { _id: requireObjectId(id), purpose, expiresAt: { $gt: new Date() } };
  if (purpose === 'registration') {
    if (!auth?.userId || !auth?.sessionId) throw workbenchError('请重新登录', 401);
    query.userId = auth.userId;
    query.sessionId = auth.sessionId;
  }
  const challenge = await AuthChallenge.findOneAndDelete(query).lean();
  if (!challenge) throw workbenchError('验证已过期或已经使用，请重新开始');
  return challenge;
}

export async function registrationOptions(auth, name) {
  const user = await User.findOne({ _id: auth.userId, deletionInProgress: { $ne: true } }).lean();
  if (!user) throw workbenchError('账号不可用', 401);
  const keys = await Passkey.find({ userId: auth.userId }).lean();
  const { rpID, rpName } = relyingParty();
  const options = await generateRegistrationOptions({ rpID, rpName, userName: user.email, userID: Buffer.from(String(user._id)), attestationType: 'none', excludeCredentials: keys.map(key => ({ id: key.credentialId, transports: key.transports })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
  const item = await AuthChallenge.create({ userId: auth.userId, sessionId: auth.sessionId, purpose: 'registration', name: typeof name === 'string' && name.trim() ? name.trim().slice(0,100) : '我的通行密钥', challenge: options.challenge, expiresAt: new Date(Date.now() + 300000) });
  return { options, challengeId: String(item._id) };
}

export async function registerPasskey(auth, challengeId, response) {
  const challenge = await consumeChallenge(challengeId, 'registration', auth);
  const { origin, rpID } = relyingParty();
  const verified = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!verified.verified || !verified.registrationInfo) throw workbenchError('通行密钥验证失败');
  const { credential } = verified.registrationInfo;
  await Passkey.create({ userId: auth.userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter, transports: credential.transports, name: challenge.name });
}

export async function authenticationOptions() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const item = await AuthChallenge.create({ purpose: 'authentication', challenge: options.challenge, expiresAt: new Date(Date.now() + 300000) });
  return { options, challengeId: String(item._id) };
}

export async function authenticatePasskey(challengeId, response) {
  const challenge = await consumeChallenge(challengeId, 'authentication');
  const key = await Passkey.findOne({ credentialId: response?.id }).select('+publicKey');
  if (!key) throw workbenchError('通行密钥未注册', 401);
  const { origin, rpID } = relyingParty();
  const verified = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: key.counter, transports: key.transports } });
  if (!verified.verified) throw workbenchError('通行密钥验证失败', 401);
  const changed = await Passkey.updateOne({ _id: key._id, counter: key.counter }, { $set: { counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  if (!changed.matchedCount) throw workbenchError('通行密钥状态已变化，请重新验证', 409);
  const user = await User.findOne({ _id: key.userId, deletionInProgress: { $ne: true } }).lean();
  if (!user) throw workbenchError('账号不可用', 401);
  return user;
}

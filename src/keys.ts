import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';

/** Key agreement with key wrapping, so that one envelope can have several recipients. */
export const ALG = 'ECDH-ES+A256KW';
/** Content encryption. */
export const ENC = 'A256GCM';
/** P-256: supported by every browser's Web Crypto, which is where sealing happens. */
export const CRV = 'P-256';

/** A recipient's key pair. Keys are plain JWKs so that they can live wherever the recipient keeps keys. */
export interface KeyPair {
  kid: string;
  privateJwk: JWK;
  publicJwk: JWK;
}

/** Generates a P-256 key pair for a recipient. */
export async function generateKey(): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { crv: CRV, extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return { kid, privateJwk: { ...privateJwk, kid, alg: ALG }, publicJwk: { ...publicJwk, kid, alg: ALG } };
}

/** The public half of a JWK, as it is published to the forms that seal to it. */
export function toPublic(jwk: JWK): JWK {
  const { d: _d, ...pub } = jwk;
  return pub;
}

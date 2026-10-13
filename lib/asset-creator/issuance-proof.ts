/** Separate proof of current issuer-key possession from the public transaction signature. */
export function issuanceProofMessage(transactionHash: Buffer): Buffer {
  const proof = transactionHash.slice();
  proof[0] ^= 0xff;
  return proof;
}

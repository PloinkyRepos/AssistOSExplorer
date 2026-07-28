function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function dpuSnapshotPersistenceAdvanced(initialSnapshot, candidateSnapshot) {
  if (!initialSnapshot || !candidateSnapshot) return false;
  if (
    !nonEmptyString(initialSnapshot.blobSha256)
    || !nonEmptyString(candidateSnapshot.blobSha256)
    || !nonEmptyString(initialSnapshot.updatedAt)
    || !nonEmptyString(candidateSnapshot.updatedAt)
  ) {
    return false;
  }
  return candidateSnapshot.blobSha256 !== initialSnapshot.blobSha256
    && candidateSnapshot.updatedAt !== initialSnapshot.updatedAt;
}

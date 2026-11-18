-- An owner's votes (API /internal/scan/owners/{address}/votes): the
-- same columns as locks_owner, declared UNIQUE ((escrow, token_id) is
-- the primary key, so (owner, escrow, token_id) is unique) so SQLite
-- knows each lock comes once per owner and reads each lock's votes in
-- lock_votes_lock order instead of sorting them.
CREATE UNIQUE INDEX IF NOT EXISTS locks_owner_lock
  ON locks (owner, escrow, token_id);

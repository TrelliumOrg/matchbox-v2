-- Open troves by owner: the API's /internal/scan/borrow/troves lists
-- status = 'active' troves in owner order, one range scan of this index
-- instead of every trove of the network. Additive and idempotent; the live
-- snapshot's writes add one index entry per trove row they change.
CREATE INDEX IF NOT EXISTS troves_status
  ON troves (network, status, owner);

import {
  buildDefaultBlocks,
  buildSeedBlocks,
  getSeedCount
} from "../../../shared/lib/blocks/block-seeds";
import { makeLocalId } from "../../../shared/lib/id/id-factory";

export const DEFAULT_PAGE_UID = "inbox";

export const buildLocalDefaults = () => buildDefaultBlocks(makeLocalId);

export const defaultBlocks = buildLocalDefaults();

export const resolveInitialBlocks = () => {
  const seedCount = getSeedCount();
  if (seedCount) {
    return buildSeedBlocks(makeLocalId, seedCount);
  }
  return defaultBlocks;
};

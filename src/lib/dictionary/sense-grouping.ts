import type { Sense } from './types';

/**
 * A run of senses sharing a common primary part-of-speech, plus any further
 * pos/misc tags common to the whole run, rendered under one heading.
 *
 * Ported almost verbatim from @birchill/jpdict-idb's `groupSenses` — the engine
 * behind 10ten Japanese Reader — adapted only for our non-optional `pos`/`misc`
 * arrays (jpdict-idb leaves them `undefined` when empty). See README credits.
 * https://github.com/birchill/jpdict-idb/blob/main/src/grouping.ts
 */
export interface PosGroup {
  pos: string[];
  misc: string[];
  senses: Sense[];
}

export function groupSenses(senses: Sense[]): PosGroup[] {
  const groups: PosGroup[] = [];

  // Do an initial grouping based on the first part-of-speech (POS).
  let previousPos: string | undefined;
  for (const sense of senses) {
    // Look for a match. Note that a match can be one of two kinds:
    //
    // a) Where the sense includes the POS we are grouping on
    // b) Where we currently have a group where there is no POS and the sense
    //    also has no POS.
    if (
      (previousPos && sense.pos.includes(previousPos)) ||
      (!previousPos && groups.length > 0 && sense.pos.length === 0)
    ) {
      groups[groups.length - 1].senses.push(dropPos(sense, previousPos));
    } else {
      // If there was no match, start a new group.
      const thisPos = sense.pos.length ? sense.pos[0] : undefined;
      const pos = thisPos ? [thisPos] : [];
      groups.push({ pos, misc: [], senses: [dropPos(sense, thisPos)] });
      previousPos = thisPos;
    }
  }

  // Having done the initial grouping, see if there are any additional POS that
  // are common to all senses that we can hoist to the group heading.
  for (const group of groups) {
    let commonPos = group.senses[0]?.pos;
    if (!commonPos || commonPos.length === 0) {
      continue;
    }

    for (const sense of group.senses.slice(1)) {
      commonPos = commonPos.filter((pos) => sense.pos.includes(pos));
      if (commonPos.length === 0) {
        break;
      }
    }

    if (commonPos.length) {
      group.pos.push(...commonPos);
      group.senses = group.senses.map((sense) => dropPos(sense, commonPos!));
    }
  }

  // Hoist any common misc readings.
  for (const group of groups) {
    let commonMisc = group.senses[0]?.misc;
    if (!commonMisc || commonMisc.length === 0) {
      continue;
    }

    for (const sense of group.senses.slice(1)) {
      commonMisc = commonMisc.filter((misc) => sense.misc.includes(misc));
      if (commonMisc.length === 0) {
        break;
      }
    }

    if (commonMisc.length) {
      group.misc = commonMisc;
      group.senses = group.senses.map((sense) => ({
        ...sense,
        misc: sense.misc.filter((misc) => !commonMisc!.includes(misc))
      }));
    }
  }

  return groups;
}

/** A copy of a sense with the specified part(s)-of-speech removed. */
function dropPos(sense: Sense, posToDrop: string | string[] | undefined): Sense {
  if (posToDrop === undefined) {
    return { ...sense };
  }
  const drop = Array.isArray(posToDrop) ? posToDrop : [posToDrop];
  return { ...sense, pos: sense.pos.filter((pos) => !drop.includes(pos)) };
}

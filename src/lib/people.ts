export interface PersonRef {
  id: string;
  name: string;
  handle?: string | null;
  isGuest?: boolean;
}

export type DisplayNameStyle = "short" | "full";

export interface DisplayNameOptions {
  style: DisplayNameStyle;
  viewerId?: string;
  selfLabel?: string;
}

const PT_PARTICLES: Record<string, true> = {
  da: true,
  de: true,
  do: true,
  das: true,
  dos: true,
  e: true,
  "d'": true,
  "d’": true,
};

const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });

function getLetterOrNumberGraphemes(text: string): string[] {
  const graphemes: string[] = [];
  for (const item of segmenter.segment(text)) {
    if (/\p{L}|\p{N}/u.test(item.segment)) {
      graphemes.push(item.segment);
    }
  }
  return graphemes;
}

export function initialsOf(name: string): string {
  if (!name || name.trim().length === 0) return "?";

  const withoutParens = name.replace(/\([^)]*\)/g, " ").trim();
  const normalized = (withoutParens.length > 0 ? withoutParens : name.trim()).normalize("NFC");

  const allLetterGraphemes = getLetterOrNumberGraphemes(normalized);
  if (allLetterGraphemes.length === 0) {
    for (const item of segmenter.segment(normalized)) {
      if (/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}/u.test(item.segment)) {
        return item.segment;
      }
    }
    return "?";
  }

  const rawTokens = normalized.split(/[\s-]+/).filter((token) => token.length > 0);
  const validTokens = rawTokens.filter((token) => getLetterOrNumberGraphemes(token).length > 0);
  if (validTokens.length === 0) return "?";

  if (validTokens.length === 1) {
    const letters = getLetterOrNumberGraphemes(validTokens[0]);
    if (letters.length >= 2) {
      return (letters[0] + letters[1]).toLocaleUpperCase("pt-BR");
    }
    return letters[0].toLocaleUpperCase("pt-BR");
  }

  const firstToken = validTokens[0];
  const firstInitial = getLetterOrNumberGraphemes(firstToken)[0].toLocaleUpperCase("pt-BR");

  let lastNonParticleIndex = -1;
  for (let i = validTokens.length - 1; i >= 1; i--) {
    if (PT_PARTICLES[validTokens[i].toLowerCase()] !== true) {
      lastNonParticleIndex = i;
      break;
    }
  }

  if (lastNonParticleIndex !== -1) {
    const lastToken = validTokens[lastNonParticleIndex];
    const lastInitial = getLetterOrNumberGraphemes(lastToken)[0].toLocaleUpperCase("pt-BR");
    return firstInitial + lastInitial;
  }

  const firstLetters = getLetterOrNumberGraphemes(firstToken);
  if (firstLetters.length >= 2) {
    return (firstLetters[0] + firstLetters[1]).toLocaleUpperCase("pt-BR");
  }
  return firstLetters[0].toLocaleUpperCase("pt-BR");
}

export function firstNameOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(/\s+/)[0];
}

/** The name a group created from these people gets when nobody types one: "Ana e Bia", "Ana, Bia +2". */
export function defaultGroupName(names: string[]): string {
  const firstNames = names.map(firstNameOf);
  if (firstNames.length === 0) return "";
  return firstNames.length <= 3
    ? firstNames.join(" e ")
    : `${firstNames.slice(0, 2).join(", ")} +${firstNames.length - 2}`;
}

export function avatarToneIndex(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 8;
}

export function sentenceStart(label: string): string {
  if (label.length === 0) return "";
  const iterator = segmenter.segment(label)[Symbol.iterator]();
  const first = iterator.next();
  if (first.done) return "";
  const firstGrapheme = first.value.segment;
  return firstGrapheme.toLocaleUpperCase("pt-BR") + label.slice(firstGrapheme.length);
}

function disambiguateCollidingFullNames(colliding: readonly PersonRef[]): Map<string, string> {
  const assigned = new Map<string, string>();
  let ordinal = 1;

  for (const person of colliding) {
    const base = person.name.trim();
    if (person.handle && person.handle.trim().length > 0) {
      assigned.set(person.id, base + " (@" + person.handle.trim() + ")");
    } else if (person.isGuest) {
      assigned.set(person.id, base + " (convidado)");
    } else {
      if (ordinal === 1) {
        assigned.set(person.id, base);
      } else {
        assigned.set(person.id, base + " " + ordinal);
      }
      ordinal++;
    }
  }

  const labelCounts = new Map<string, number>();
  for (const label of assigned.values()) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  for (const [label, count] of labelCounts) {
    if (count > 1) {
      let subOrdinal = 1;
      for (const person of colliding) {
        if (assigned.get(person.id) === label) {
          if (subOrdinal > 1) {
            assigned.set(person.id, label + " " + subOrdinal);
          }
          subOrdinal++;
        }
      }
    }
  }

  return assigned;
}

export function displayNames(
  people: readonly PersonRef[],
  options: DisplayNameOptions,
): Map<string, string> {
  const result = new Map<string, string>();
  const seenIds = new Set<string>();
  const uniquePeople: PersonRef[] = [];

  for (const person of people) {
    if (!seenIds.has(person.id)) {
      seenIds.add(person.id);
      uniquePeople.push(person);
    }
  }

  const viewerId = options.viewerId;
  const selfLabel = options.selfLabel ?? "Você";
  const nonViewers: PersonRef[] = [];

  for (const person of uniquePeople) {
    if (viewerId !== undefined && person.id === viewerId) {
      result.set(person.id, selfLabel);
    } else {
      nonViewers.push(person);
    }
  }

  if (options.style === "full") {
    const groups: PersonRef[][] = [];
    for (const person of nonViewers) {
      const trimmed = person.name.trim();
      let targetGroup: PersonRef[] | undefined;
      for (const group of groups) {
        if (group[0].name.trim().localeCompare(trimmed, "pt-BR", { sensitivity: "base" }) === 0) {
          targetGroup = group;
          break;
        }
      }
      if (targetGroup) {
        targetGroup.push(person);
      } else {
        groups.push([person]);
      }
    }

    for (const group of groups) {
      if (group.length === 1) {
        result.set(group[0].id, group[0].name.trim());
      } else {
        const disambiguated = disambiguateCollidingFullNames(group);
        for (const [id, label] of disambiguated) {
          result.set(id, label);
        }
      }
    }

    return result;
  }

  const firstNameGroups: PersonRef[][] = [];
  for (const person of nonViewers) {
    const fn = firstNameOf(person.name);
    let targetGroup: PersonRef[] | undefined;
    for (const group of firstNameGroups) {
      if (firstNameOf(group[0].name).localeCompare(fn, "pt-BR", { sensitivity: "base" }) === 0) {
        targetGroup = group;
        break;
      }
    }
    if (targetGroup) {
      targetGroup.push(person);
    } else {
      firstNameGroups.push([person]);
    }
  }

  for (const group of firstNameGroups) {
    if (group.length === 1) {
      result.set(group[0].id, firstNameOf(group[0].name));
      continue;
    }

    const candidateByPersonId = new Map<string, string>();
    for (const person of group) {
      const fn = firstNameOf(person.name);
      const normalized = person.name.normalize("NFC").trim();
      const rawTokens = normalized.split(/[\s-]+/).filter((token) => token.length > 0);
      const validTokens = rawTokens.filter((token) => getLetterOrNumberGraphemes(token).length > 0);

      let lastInitial: string | null = null;
      if (validTokens.length >= 2) {
        for (let i = validTokens.length - 1; i >= 1; i--) {
          if (PT_PARTICLES[validTokens[i].toLowerCase()] !== true) {
            const letters = getLetterOrNumberGraphemes(validTokens[i]);
            if (letters.length > 0) {
              lastInitial = letters[0].toLocaleUpperCase("pt-BR");
              break;
            }
          }
        }
      }

      if (lastInitial !== null) {
        candidateByPersonId.set(person.id, fn + " " + lastInitial + ".");
      } else {
        candidateByPersonId.set(person.id, person.name.trim());
      }
    }

    const candidateMatches = new Map<string, number>();
    for (const p1 of group) {
      const c1 = candidateByPersonId.get(p1.id) ?? "";
      let count = 0;
      for (const p2 of group) {
        const c2 = candidateByPersonId.get(p2.id) ?? "";
        if (c1.localeCompare(c2, "pt-BR", { sensitivity: "base" }) === 0) {
          count++;
        }
      }
      candidateMatches.set(p1.id, count);
    }

    const fallbackToFull: PersonRef[] = [];
    for (const person of group) {
      const count = candidateMatches.get(person.id) ?? 0;
      if (count > 1) {
        fallbackToFull.push(person);
      } else {
        result.set(person.id, candidateByPersonId.get(person.id) ?? "");
      }
    }

    if (fallbackToFull.length > 0) {
      const fullGroups: PersonRef[][] = [];
      for (const person of fallbackToFull) {
        const trimmed = person.name.trim();
        let targetGroup: PersonRef[] | undefined;
        for (const fg of fullGroups) {
          if (fg[0].name.trim().localeCompare(trimmed, "pt-BR", { sensitivity: "base" }) === 0) {
            targetGroup = fg;
            break;
          }
        }
        if (targetGroup) {
          targetGroup.push(person);
        } else {
          fullGroups.push([person]);
        }
      }

      for (const fg of fullGroups) {
        if (fg.length === 1) {
          result.set(fg[0].id, fg[0].name.trim());
        } else {
          const disambiguated = disambiguateCollidingFullNames(fg);
          for (const [id, label] of disambiguated) {
            result.set(id, label);
          }
        }
      }
    }
  }

  return result;
}

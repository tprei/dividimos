export function displayName(
  user: { name: string; handle?: string },
  allParticipants: { name: string }[],
): string {
  const firstName = user.name.split(" ")[0];
  const collides = allParticipants.filter(
    (p) => p.name.split(" ")[0] === firstName,
  ).length > 1;
  if (collides && user.handle) {
    return `${firstName} (@${user.handle})`;
  }
  return firstName;
}

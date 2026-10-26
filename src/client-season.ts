/** Halloween's eve and day (30 and 31 October, local time): main chat's entry wears a pumpkin behind its mark. */
export const halloween = (now = new Date()) => now.getMonth() === 9 && now.getDate() >= 30

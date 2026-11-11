// Car names in the UI (design 6c). The short name drops the make: "Opel Mokka-e" -> "Mokka-e".
export function carShortName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.slice(1).join(" ") : name;
}

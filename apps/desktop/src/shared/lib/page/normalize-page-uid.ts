export const normalizePageUid = (value: string) => {
  let output = "";
  let wasDash = false;
  for (const ch of value) {
    if (/^[A-Za-z0-9]$/.test(ch)) {
      output += ch.toLowerCase();
      wasDash = false;
    } else if (!wasDash) {
      output += "-";
      wasDash = true;
    }
  }
  const trimmed = output.replace(/^-+|-+$/g, "");
  return trimmed || "page";
};

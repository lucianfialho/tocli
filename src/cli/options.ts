export function flagNameForParam(paramName: string): string {
  const flagName = paramName
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return flagName || "value";
}

export function optionKeyForParam(paramName: string): string {
  return camelcase(flagNameForParam(paramName));
}

export function optionValueForParam(
  opts: Record<string, unknown>,
  paramName: string
): unknown {
  return opts[paramName] ?? opts[optionKeyForParam(paramName)];
}

function camelcase(value: string): string {
  return value.split("-").reduce((result, word) => {
    if (!word) return result;
    return result + word[0].toUpperCase() + word.slice(1);
  });
}

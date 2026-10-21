export function hasBlockingDestructiveSql(content) {
  // TRUNCATE can be an event or a revoked privilege. Neither executes TRUNCATE.
  // Strip only those grammatical prefixes, leaving any subsequent commands visible.
  const executable = content
    .replace(/\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+\w+\s+(?:before|after)\s+truncate\s+on\b/gi, "CREATE TRIGGER truncate_event ON")
    .replace(/\b(?:grant|revoke)\s+(?:[a-z_]+\s*,\s*)*truncate(?:\s*,\s*[a-z_]+)*\s+on\b/gi, "PRIVILEGE ON");
  return /\bdrop\s+table\b|\btruncate(?:\s+table)?\b|\balter\s+table[\s\S]{0,160}\balter\s+column[\s\S]{0,80}\btype\b/i.test(executable);
}

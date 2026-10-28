process.env.MODE = "test";
// Caches are opt-in per test via the reset helpers; defaulting them off
// keeps test files (and leftover on-disk state in TMPDIR) from leaking
// cache behavior into each other.
process.env.UNPKG_TARBALL_CACHE = "off";
process.env.UNPKG_EXTRACTED_CACHE = "off";
process.env.UNPKG_FILE_CACHE = "off";

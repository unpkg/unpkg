import path from 'path';
import tar from 'tar-stream';

import asyncHandler from '../utils/asyncHandler.js';
import bufferStream from '../utils/bufferStream.js';
import createPackageURL from '../utils/createPackageURL.js';
import getContentType from '../utils/getContentType.js';
import getIntegrity from '../utils/getIntegrity.js';
import { getPackage } from '../utils/npm.js';

function fileRedirect(req, res, entry) {
  // Redirect to the file with the extension so it's
  // clear which file is being served.
  res
    .set({
      'Cache-Control': 'public, max-age=31536000', // 1 year
      'Cache-Tag': 'redirect, file-redirect'
    })
    .redirect(
      302,
      createPackageURL(
        req.packageName,
        req.packageVersion,
        entry.path,
        req.query
      )
    );
}

function indexRedirect(req, res, entry) {
  // Redirect to the index file so relative imports
  // resolve correctly.
  res
    .set({
      'Cache-Control': 'public, max-age=31536000', // 1 year
      'Cache-Tag': 'redirect, index-redirect'
    })
    .redirect(
      302,
      createPackageURL(
        req.packageName,
        req.packageVersion,
        entry.path,
        req.query
      )
    );
}

/**
 * Search the given tarball for entries that match the given name.
 * Follows node's resolution algorithm.
 * https://nodejs.org/api/modules.html#modules_all_together
 */
function searchEntries(stream, filename) {
  // filename = /some/file/name.js or /some/dir/name
  return new Promise((accept, reject) => {
    const jsEntryFilename = `${filename}.js`;
    const jsonEntryFilename = `${filename}.json`;

    const matchingEntries = {};
    let foundEntry;

    if (filename === '/') {
      foundEntry = matchingEntries['/'] = { name: '/', type: 'directory' };
    }

    stream
      .pipe(tar.extract())
      .on('error', reject)
      .on('entry', async (header, stream, next) => {
        const entry = {
          // Most packages have header names that look like `package/index.js`
          // so we shorten that to just `index.js` here. A few packages use a
          // prefix other than `package/`. e.g. the firebase package uses the
          // `firebase_npm/` prefix. So we just strip the first dir name.
          path: header.name.replace(/^[^/]+/g, ''),
          type: header.type
        };

        // Skip non-files and files that don't match the entryName.
        if (entry.type !== 'file' || !entry.path.startsWith(filename)) {
          stream.resume();
          stream.on('end', next);
          return;
        }

        matchingEntries[entry.path] = entry;

        // Dynamically create "directory" entries for all directories
        // that are in this file's path. Some tarballs omit these entries
        // for some reason, so this is the "brute force" method.
        let dir = path.dirname(entry.path);
        while (dir !== '/') {
          if (!matchingEntries[dir]) {
            matchingEntries[dir] = { name: dir, type: 'directory' };
          }
          dir = path.dirname(dir);
        }

        if (
          entry.path === filename ||
          // Allow accessing e.g. `/index.js` or `/index.json`
          // using `/index` for compatibility with npm
          entry.path === jsEntryFilename ||
          entry.path === jsonEntryFilename
        ) {
          if (foundEntry) {
            if (
              foundEntry.path !== filename &&
              (entry.path === filename ||
                (entry.path === jsEntryFilename &&
                  foundEntry.path === jsonEntryFilename))
            ) {
              // This entry is higher priority than the one
              // we already found. Replace it.
              delete foundEntry.content;
              foundEntry = entry;
            }
          } else {
            foundEntry = entry;
          }
        }

        try {
          const content = await bufferStream(stream);

          entry.contentType = getContentType(entry.path);
          entry.integrity = getIntegrity(content);
          entry.lastModified = header.mtime.toUTCString();
          entry.size = content.length;

          // Set the content only for the foundEntry and
          // discard the buffer for all others.
          if (entry === foundEntry) {
            entry.content = content;
          }

          next();
        } catch (error) {
          next(error);
        }
      })
      .on('finish', () => {
        accept({
          // If we didn't find a matching file entry,
          // try a directory entry with the same name.
          foundEntry: foundEntry || matchingEntries[filename] || null,
          matchingEntries: matchingEntries
        });
      });
  });
}

/**
 * Fetch and search the archive to try and find the requested file.
 * Redirect to the "index" file if a directory was requested.
 */
async function findEntry(req, res, next) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.headers.authorization, req.log);
  const { foundEntry: entry, matchingEntries: entries } = await searchEntries(
    stream,
    req.filename
  );

  if (!entry) {
    return res
      .status(404)
      .set({
        'Cache-Control': 'public, max-age=31536000', // 1 year
        'Cache-Tag': 'missing, missing-entry'
      })
      .type('text')
      .send(`Cannot find "${req.filename}" in ${req.packageSpec}`);
  }

  if (entry.type === 'file' && entry.path !== req.filename) {
    return fileRedirect(req, res, entry);
  }

  if (entry.type === 'directory') {
    // We need to redirect to some "index" file inside the directory so
    // our URLs work in a similar way to require("lib") in node where it
    // uses `lib/index.js` when `lib` is a directory.
    const indexEntry =
      entries[`${req.filename}/index.js`] ||
      entries[`${req.filename}/index.json`];

    if (indexEntry && indexEntry.type === 'file') {
      return indexRedirect(req, res, indexEntry);
    }

    return res
      .status(404)
      .set({
        'Cache-Control': 'public, max-age=31536000', // 1 year
        'Cache-Tag': 'missing, missing-index'
      })
      .type('text')
      .send(`Cannot find an index in "${req.filename}" in ${req.packageSpec}`);
  }

  req.entry = entry;

  next();
}

export default asyncHandler(findEntry);

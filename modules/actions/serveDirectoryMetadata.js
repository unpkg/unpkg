import path from 'path';
import tar from 'tar-stream';

import asyncHandler from '../utils/asyncHandler.js';
import bufferStream from '../utils/bufferStream.js';
import getContentType from '../utils/getContentType.js';
import getIntegrity from '../utils/getIntegrity.js';
import { getPackage } from '../utils/npm.js';

async function findMatchingEntries(stream, filename) {
  // filename = /some/dir/name
  return new Promise((accept, reject) => {
    const entries = {};

    entries[filename] = { path: filename, type: 'directory' };

    stream
      .pipe(tar.extract())
      .on('error', reject)
      .on('entry', async (header, stream, next) => {
        const entry = {
          // Most packages have header names that look like `package/index.js`
          // so we shorten that to just `/index.js` here. A few packages use a
          // prefix other than `package/`. e.g. the firebase package uses the
          // `firebase_npm/` prefix. So we just strip the first dir name.
          path: header.name.replace(/^[^/]+\/?/, '/'),
          type: header.type
        };

        // Dynamically create "directory" entries for all subdirectories
        // in this entry's path. Some tarballs omit directory entries for
        // some reason, so this is the "brute force" method.
        let dir = path.dirname(entry.path);
        while (dir !== '/') {
          if (!entries[dir] && dir.startsWith(filename)) {
            entries[dir] = { path: dir, type: 'directory' };
          }
          dir = path.dirname(dir);
        }

        // Ignore non-files and files that don't match the prefix.
        if (entry.type !== 'file' || !entry.path.startsWith(filename)) {
          stream.resume();
          stream.on('end', next);
          return;
        }

        try {
          const content = await bufferStream(stream);

          entry.contentType = getContentType(entry.path);
          entry.integrity = getIntegrity(content);
          entry.lastModified = header.mtime.toUTCString();
          entry.size = content.length;

          entries[entry.path] = entry;

          next();
        } catch (error) {
          next(error);
        }
      })
      .on('finish', () => {
        accept(entries);
      });
  });
}

function getMatchingEntries(entry, entries) {
  return Object.keys(entries)
    .filter(key => entry.path !== key && path.dirname(key) === entry.path)
    .map(key => entries[key]);
}

function getMetadata(entry, entries) {
  const metadata = { path: entry.path, type: entry.type };

  if (entry.type === 'file') {
    metadata.contentType = entry.contentType;
    metadata.integrity = entry.integrity;
    metadata.lastModified = entry.lastModified;
    metadata.size = entry.size;
  } else if (entry.type === 'directory') {
    metadata.files = getMatchingEntries(entry, entries).map(e =>
      getMetadata(e, entries)
    );
  }

  return metadata;
}

async function serveDirectoryMetadata(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.headers.authorization, req.log);

  const filename = req.filename.slice(0, -1) || '/';
  const entries = await findMatchingEntries(stream, filename);
  const metadata = getMetadata(entries[filename], entries);

  res.send(metadata);
}

export default asyncHandler(serveDirectoryMetadata);

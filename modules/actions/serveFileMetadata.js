import tar from 'tar-stream';

import asyncHandler from '../utils/asyncHandler.js';
import bufferStream from '../utils/bufferStream.js';
import getContentType from '../utils/getContentType.js';
import getIntegrity from '../utils/getIntegrity.js';
import { getPackage } from '../utils/npm.js';

async function findEntry(stream, filename) {
  // filename = /some/file/name.js
  return new Promise((accept, reject) => {
    let foundEntry = null;

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

        // Ignore non-files and files that don't match the name.
        if (entry.type !== 'file' || entry.path !== filename) {
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

          foundEntry = entry;

          next();
        } catch (error) {
          next(error);
        }
      })
      .on('finish', () => {
        accept(foundEntry);
      });
  });
}

async function serveFileMetadata(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.headers.authorization, req.log);
  const entry = await findEntry(stream, req.filename);

  if (!entry) {
    // TODO: 404
  }

  res.send(entry);
}

export default asyncHandler(serveFileMetadata);

import tar from 'tar-stream';

import asyncHandler from '../utils/asyncHandler.js';
import bufferStream from '../utils/bufferStream.js';
import createDataURI from '../utils/createDataURI.js';
import getContentType from '../utils/getContentType.js';
import getIntegrity from '../utils/getIntegrity.js';
import { getPackage } from '../utils/npm.js';
import getHighlights from '../utils/getHighlights.js';
import getLanguageName from '../utils/getLanguageName.js';

import serveBrowsePage from './serveBrowsePage.js';

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
          entry.content = await bufferStream(stream);

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

async function serveFileBrowser(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.headers.authorization, req.log);
  const entry = await findEntry(stream, req.filename);

  if (!entry) {
    return res.status(404).send(`Not found: ${req.packageSpec}${req.filename}`);
  }

  const details = {
    contentType: getContentType(entry.path),
    integrity: getIntegrity(entry.content),
    language: getLanguageName(entry.path),
    size: entry.content.length
  };

  if (/^image\//.test(details.contentType)) {
    details.uri = createDataURI(details.contentType, entry.content);
    details.highlights = null;
  } else {
    details.uri = null;
    details.highlights = getHighlights(
      entry.content.toString('utf8'),
      entry.path
    );
  }

  req.browseTarget = {
    path: req.filename,
    type: 'file',
    details
  };

  serveBrowsePage(req, res);
}

export default asyncHandler(serveFileBrowser);

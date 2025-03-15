import path from 'path';
import etag from 'etag';

import getContentTypeHeader from '../utils/getContentTypeHeader.js';

export default function serveFile(req, res) {
  const tags = ['file'];

  const ext = path.extname(req.entry.path).substr(1);
  if (ext) {
    tags.push(`${ext}-file`);
  }

  res
    .set({
      'Content-Type': getContentTypeHeader(req.entry.contentType),
      'Content-Length': req.entry.size,
      'Cache-Control': 'public, max-age=31536000', // 1 year
      'Last-Modified': req.entry.lastModified,
      ETag: etag(req.entry.content),
      'Cache-Tag': tags.join(', '),
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    .send(req.entry.content);
}
